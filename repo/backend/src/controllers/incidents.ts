import type { Request, RequestHandler, Response } from "express";
import { Router } from "express";
import multer from "multer";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";
import { authenticateJwt, secureStateChangingRoute, requireRole } from "../middleware/security";
import { UploadValidationError, cleanupFiles, uploadImagesMiddleware, validateAndPersistImages } from "../services/upload";
import { encryptAtRest, maskField } from "../utils/crypto";
import { moderateTextInputs } from "../utils/moderator";

const submissionGoalMs = 2 * 60 * 1000;
const incidentStatuses = ["New", "Acknowledged", "In Progress", "Escalated", "Closed"] as const;

type IncidentStatus = (typeof incidentStatuses)[number];

const validTransitions: Record<IncidentStatus, IncidentStatus[]> = {
  "New": ["Acknowledged", "Escalated"],
  "Acknowledged": ["In Progress", "Escalated", "Closed"],
  "In Progress": ["Escalated", "Closed"],
  "Escalated": ["In Progress", "Closed"],
  "Closed": [],
};

interface IncidentRow extends RowDataPacket {
  id: number;
  status: IncidentStatus;
}

const createIncidentHandler: RequestHandler = async (req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    const type = String(req.body?.type ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    const site = String(req.body?.site ?? "").trim();
    const occurredAt = String(req.body?.time ?? "").trim();
    const rating = req.body?.rating ? Number(req.body.rating) : null;
    const cost = req.body?.cost ? Number(req.body.cost) : null;

    const riskTags = Array.isArray(req.body?.risk_tags)
      ? req.body.risk_tags.map((value: unknown) => String(value))
      : [];

    if (!type || !description || !site || !occurredAt) {
      res.status(400).json({ error: "type, description, site, and time are required" });
      return;
    }

    const parsedTime = new Date(occurredAt);
    if (Number.isNaN(parsedTime.getTime())) {
      res.status(400).json({ error: "Invalid incident time" });
      return;
    }

    const moderationIssues = moderateTextInputs({
      type,
      description,
      site,
      phone: req.body?.phone,
      medical_notes: req.body?.medical_notes,
    });

    if (moderationIssues.length > 0) {
      res.status(422).json({ error: "Moderation check failed", issues: moderationIssues });
      return;
    }

    const encryptedSensitive: Record<string, string> = {};
    if (req.body?.phone) {
      encryptedSensitive.phone = encryptAtRest(String(req.body.phone));
    }
    if (req.body?.medical_notes) {
      encryptedSensitive.medical_notes = encryptAtRest(String(req.body.medical_notes));
    }

    const riskPayload = {
      tags: riskTags,
      sensitive: encryptedSensitive,
    };

    const reporterId = req.auth?.sub;
    if (!reporterId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const connection = await dbPool.getConnection();
    let diskPaths: string[] = [];

    try {
      await connection.beginTransaction();

      const [insertResult] = await connection.execute<ResultSetHeader>(
        "INSERT INTO incidents (reporter_id, type, description, site, time, status, rating, cost, risk_tags) VALUES (?, ?, ?, ?, ?, 'New', ?, ?, ?)",
        [
          reporterId,
          type,
          description,
          site,
          parsedTime,
          Number.isFinite(rating) ? rating : null,
          Number.isFinite(cost) ? cost : null,
          JSON.stringify(riskPayload),
        ],
      );

      const incidentId = insertResult.insertId;
      const uploadResult = await validateAndPersistImages(
        connection,
        req.files as Express.Multer.File[] | undefined,
        incidentId,
        reporterId,
      );
      const uploadedRefs = uploadResult.refs;
      diskPaths = uploadResult.diskPaths;

      await connection.execute<ResultSetHeader>(
        "INSERT INTO incident_actions (incident_id, user_id, action, evidence_log) VALUES (?, ?, ?, ?)",
        [incidentId, reporterId, "INCIDENT_CREATED", JSON.stringify({ uploaded_images: uploadedRefs.length })],
      );

      await connection.commit();

      const processingMs = Date.now() - startedAt;
      res.locals.auditAfter = {
        action: "INCIDENT_CREATED",
        incident_id: incidentId,
        uploaded_images: uploadedRefs,
        processing_ms: processingMs,
      };

      res.status(201).json({
        id: incidentId,
        status: "New",
        uploaded_images: uploadedRefs,
        processing_ms: processingMs,
        submission_goal_ms: submissionGoalMs,
        within_goal: processingMs < submissionGoalMs,
      });
    } catch (error) {
      await cleanupFiles(diskPaths);
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (error instanceof UploadValidationError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Each image must be 10MB or less" });
        return;
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        res.status(400).json({ error: "Maximum of 5 images allowed" });
        return;
      }

      res.status(400).json({ error: "Invalid upload request" });
      return;
    }

    console.error("incident-creation-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to create incident" });
  }
};

const updateIncidentStatusHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    const incidentId = Number(req.params.id);
    if (!Number.isInteger(incidentId) || incidentId <= 0) {
      res.status(400).json({ error: "Invalid incident id" });
      return;
    }

    const nextStatus = String(req.body?.status ?? "").trim() as IncidentStatus;
    const collaborators = Array.isArray(req.body?.collaborators)
      ? req.body.collaborators.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)
      : [];
    const triageNotes = String(req.body?.triage_notes ?? "").trim();

    if (!incidentStatuses.includes(nextStatus)) {
      res.status(400).json({ error: "Invalid status value" });
      return;
    }

    const moderationIssues = moderateTextInputs({ triage_notes: triageNotes });
    if (moderationIssues.length > 0) {
      res.status(422).json({ error: "Moderation check failed", issues: moderationIssues });
      return;
    }

    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const connection = await dbPool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<IncidentRow[]>("SELECT id, status FROM incidents WHERE id = ? LIMIT 1", [incidentId]);
      const current = rows[0];

      if (!current) {
        await connection.rollback();
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      const allowed = validTransitions[current.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        await connection.rollback();
        res.status(400).json({ error: `Cannot transition from ${current.status} to ${nextStatus}` });
        return;
      }

      await connection.execute<ResultSetHeader>("UPDATE incidents SET status = ? WHERE id = ?", [nextStatus, incidentId]);

      const actionLog = {
        previous_status: current.status,
        next_status: nextStatus,
        triage_notes: triageNotes || null,
        collaborators,
      };

      await connection.execute<ResultSetHeader>(
        "INSERT INTO incident_actions (incident_id, user_id, action, evidence_log) VALUES (?, ?, ?, ?)",
        [incidentId, userId, "STATUS_UPDATED", JSON.stringify(actionLog)],
      );

      for (const collaboratorId of collaborators) {
        await connection.execute<ResultSetHeader>(
          "INSERT IGNORE INTO incident_collaborators (incident_id, user_id, assigned_by) VALUES (?, ?, ?)",
          [incidentId, collaboratorId, userId],
        );
        await connection.execute<ResultSetHeader>(
          "INSERT INTO incident_actions (incident_id, user_id, action, evidence_log) VALUES (?, ?, ?, ?)",
          [incidentId, userId, "COLLABORATOR_ASSIGNED", JSON.stringify({ collaborator_id: collaboratorId })],
        );
      }

      await connection.commit();

      res.locals.auditBefore = { status: current.status };
      res.locals.auditAfter = actionLog;
      res.locals.auditAction = "INCIDENT_STATUS_UPDATED";

      res.status(200).json({
        id: incidentId,
        status: nextStatus,
        collaborators,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("incident-status-update-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to update incident status" });
  }
};

interface ListIncidentRow extends RowDataPacket {
  id: number;
  reporter_id: number;
  type: string;
  site: string;
  status: IncidentStatus;
  rating: number | null;
  cost: number | null;
  created_at: Date;
  updated_at: Date;
}

interface DetailIncidentRow extends RowDataPacket {
  id: number;
  reporter_id: number;
  type: string;
  description: string;
  site: string;
  time: Date;
  status: IncidentStatus;
  rating: number | null;
  cost: number | null;
  risk_tags: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ActionRow extends RowDataPacket {
  id: number;
  user_id: number;
  action: string;
  evidence_log: string | null;
  created_at: Date;
}

interface ImageRow extends RowDataPacket {
  id: number;
  file_ref: string;
  uploaded_by: number | null;
  created_at: Date;
}

interface CollaboratorRow extends RowDataPacket {
  user_id: number;
  assigned_by: number;
  assigned_at: Date;
}

function maskSensitiveFields(riskTags: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!riskTags || typeof riskTags !== "object") {
    return null;
  }

  const sensitive = riskTags["sensitive"];
  if (!sensitive || typeof sensitive !== "object") {
    return riskTags;
  }

  const maskedSensitive: Record<string, string> = {};
  const sensitiveObj = sensitive as Record<string, unknown>;

  for (const [key, value] of Object.entries(sensitiveObj)) {
    if (typeof value === "string" && value.length > 0) {
      maskedSensitive[key] = maskField(value);
    } else {
      maskedSensitive[key] = String(value ?? "");
    }
  }

  return { ...riskTags, sensitive: maskedSensitive };
}

function parseRiskTags(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

const PRIVILEGED_LIST_ROLES = new Set(["Dispatcher", "Safety Manager", "Auditor", "Administrator"]);

const listIncidentsHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.sub;
    const userRole = req.auth?.role;
    if (!userId || !userRole) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const status = String(req.query.status ?? "").trim();
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];

    if (!PRIVILEGED_LIST_ROLES.has(userRole)) {
      where.push("reporter_id = ?");
      params.push(userId);
    }

    if (status && incidentStatuses.includes(status as IncidentStatus)) {
      where.push("status = ?");
      params.push(status);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await dbPool.query<ListIncidentRow[]>(
      `SELECT id, reporter_id, type, site, status, rating, cost, created_at, updated_at
       FROM incidents ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const [countRows] = await dbPool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM incidents ${whereClause}`,
      params,
    );

    const total = (countRows[0] as { total: number }).total ?? 0;

    res.status(200).json({
      incidents: rows.map((row) => ({
        id: row.id,
        reporter_id: row.reporter_id,
        type: row.type,
        site: row.site,
        status: row.status,
        rating: row.rating,
        cost: row.cost,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("incident-list-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to list incidents" });
  }
};

const getIncidentHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.sub;
    const userRole = req.auth?.role;
    if (!userId || !userRole) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const incidentId = Number(req.params.id);

    if (!Number.isInteger(incidentId) || incidentId <= 0) {
      res.status(400).json({ error: "Invalid incident id" });
      return;
    }

    const [incidentRows] = await dbPool.query<DetailIncidentRow[]>(
      "SELECT * FROM incidents WHERE id = ? LIMIT 1",
      [incidentId],
    );

    const incident = incidentRows[0];

    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    if (!PRIVILEGED_LIST_ROLES.has(userRole) && incident.reporter_id !== userId) {
      res.status(403).json({ error: "You do not have access to this incident" });
      return;
    }

    const [actionRows] = await dbPool.query<ActionRow[]>(
      "SELECT id, user_id, action, evidence_log, created_at FROM incident_actions WHERE incident_id = ? ORDER BY created_at ASC",
      [incidentId],
    );

    const [imageRows] = await dbPool.query<ImageRow[]>(
      "SELECT id, file_ref, uploaded_by, created_at FROM images WHERE incident_id = ? ORDER BY created_at ASC",
      [incidentId],
    );

    const [collaboratorRows] = await dbPool.query<CollaboratorRow[]>(
      "SELECT user_id, assigned_by, assigned_at FROM incident_collaborators WHERE incident_id = ? ORDER BY assigned_at ASC",
      [incidentId],
    );

    const rawRiskTags = parseRiskTags(incident.risk_tags);
    const maskedRiskTags = maskSensitiveFields(rawRiskTags);

    res.status(200).json({
      id: incident.id,
      reporter_id: incident.reporter_id,
      type: incident.type,
      description: incident.description,
      site: incident.site,
      time: incident.time,
      status: incident.status,
      rating: incident.rating,
      cost: incident.cost,
      risk_tags: maskedRiskTags,
      created_at: incident.created_at,
      updated_at: incident.updated_at,
      collaborators: collaboratorRows.map((row) => ({
        user_id: row.user_id,
        assigned_by: row.assigned_by,
        assigned_at: row.assigned_at,
      })),
      actions: actionRows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        action: row.action,
        evidence_log: row.evidence_log ? JSON.parse(row.evidence_log) : null,
        created_at: row.created_at,
      })),
      images: imageRows.map((row) => ({
        id: row.id,
        file_ref: row.file_ref,
        uploaded_by: row.uploaded_by,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    console.error("incident-get-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to fetch incident" });
  }
};

const incidentsRouter = Router();

incidentsRouter.get("/", listIncidentsHandler);
incidentsRouter.get("/:id", getIncidentHandler);

incidentsRouter.post(
  "/",
  ...secureStateChangingRoute,
  requireRole("Reporter"),
  (req, res, next) => {
    uploadImagesMiddleware(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      next();
    });
  },
  createIncidentHandler,
);

incidentsRouter.patch(
  "/:id/status",
  ...secureStateChangingRoute,
  requireRole("Dispatcher"),
  updateIncidentStatusHandler,
);

export default incidentsRouter;
