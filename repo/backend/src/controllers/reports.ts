import { Router } from "express";
import type { RequestHandler } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";
import { requireRole, secureStateChangingRoute } from "../middleware/security";

interface ReportDefRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  created_by: number;
  config: string;
  created_at: Date;
  updated_at: Date;
}

interface ReportConfig {
  group_by: string;
  date_from?: string;
  date_to?: string;
  status_filter?: string;
  site_filter?: string;
  type_filter?: string;
  include_fields?: string[];
}

const VALID_GROUP_BY = ["status", "site", "type", "reporter_id"];
const VALID_INCLUDE_FIELDS = ["id", "reporter_id", "type", "site", "status", "rating", "cost", "created_at"];

function validateReportConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") return "config must be an object";
  const c = config as Record<string, unknown>;

  if (typeof c.group_by !== "string" || !VALID_GROUP_BY.includes(c.group_by)) {
    return `group_by must be one of: ${VALID_GROUP_BY.join(", ")}`;
  }

  if (c.include_fields !== undefined) {
    if (!Array.isArray(c.include_fields)) return "include_fields must be an array";
    for (const f of c.include_fields) {
      if (!VALID_INCLUDE_FIELDS.includes(String(f))) {
        return `include_fields contains invalid field: ${f}`;
      }
    }
  }

  return null;
}

const createReportHandler: RequestHandler = async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const description = String(req.body?.description ?? "").trim() || null;
    const config = req.body?.config;

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const validationError = validateReportConfig(config);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const userId = req.auth?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const [result] = await dbPool.execute<ResultSetHeader>(
      "INSERT INTO report_definitions (name, description, created_by, config) VALUES (?, ?, ?, CAST(? AS JSON))",
      [name, description, userId, JSON.stringify(config)],
    );

    res.locals.auditAfter = { action: "REPORT_CREATED", report_id: result.insertId };

    res.status(201).json({
      id: result.insertId,
      name,
      description,
      config,
    });
  } catch (error) {
    console.error("report-create-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to create report definition" });
  }
};

const listReportsHandler: RequestHandler = async (req, res) => {
  try {
    const [rows] = await dbPool.query<ReportDefRow[]>(
      "SELECT id, name, description, created_by, CAST(config AS CHAR) AS config, created_at, updated_at FROM report_definitions ORDER BY updated_at DESC LIMIT 100",
    );

    const results = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      created_by: r.created_by,
      config: JSON.parse(r.config),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    res.status(200).json({ reports: results });
  } catch (error) {
    console.error("report-list-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to list reports" });
  }
};

const runReportHandler: RequestHandler = async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      res.status(400).json({ error: "Invalid report id" });
      return;
    }

    const [rows] = await dbPool.query<ReportDefRow[]>(
      "SELECT id, name, CAST(config AS CHAR) AS config FROM report_definitions WHERE id = ? LIMIT 1",
      [reportId],
    );

    const report = rows[0];
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    const config: ReportConfig = JSON.parse(report.config);
    const where: string[] = [];
    const params: unknown[] = [];

    if (config.date_from) {
      where.push("created_at >= ?");
      params.push(new Date(config.date_from));
    }
    if (config.date_to) {
      where.push("created_at <= ?");
      params.push(new Date(config.date_to));
    }
    if (config.status_filter) {
      where.push("status = ?");
      params.push(config.status_filter);
    }
    if (config.site_filter) {
      where.push("site = ?");
      params.push(config.site_filter);
    }
    if (config.type_filter) {
      where.push("type = ?");
      params.push(config.type_filter);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const groupByCol = VALID_GROUP_BY.includes(config.group_by) ? config.group_by : "status";

    const [resultRows] = await dbPool.query<RowDataPacket[]>(
      `SELECT ${groupByCol} AS dimension, COUNT(*) AS count
       FROM incidents ${whereClause}
       GROUP BY ${groupByCol}
       ORDER BY count DESC`,
      params,
    );

    let detailRows: RowDataPacket[] = [];
    const includeFields = config.include_fields ?? VALID_INCLUDE_FIELDS;
    const safeFields = includeFields.filter((f) => VALID_INCLUDE_FIELDS.includes(f));
    if (safeFields.length > 0) {
      const [details] = await dbPool.query<RowDataPacket[]>(
        `SELECT ${safeFields.join(", ")} FROM incidents ${whereClause} ORDER BY created_at DESC LIMIT 1000`,
        params,
      );
      detailRows = details;
    }

    const userId = req.auth?.sub;
    void logReportRunAudit(reportId, userId, resultRows.length);

    const format = String(req.query.format ?? "").trim();
    if (format === "csv") {
      const lines = [`dimension,count`];
      for (const r of resultRows) {
        lines.push(`"${String(r.dimension).replace(/"/g, '""')}",${r.count}`);
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=report-${reportId}.csv`);
      res.status(200).send(lines.join("\n"));
      return;
    }

    res.status(200).json({
      report_id: reportId,
      name: report.name,
      config,
      summary: resultRows.map((r) => ({ dimension: r.dimension, count: r.count })),
      details: detailRows,
    });
  } catch (error) {
    console.error("report-run-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to run report" });
  }
};

async function logReportRunAudit(reportId: number, userId: number | undefined, rows: number): Promise<void> {
  try {
    await dbPool.execute(
      "INSERT INTO audit_logs (route, user_id, before_val, after_val, created_at) VALUES (?, ?, NULL, ?, ?)",
      [`/reports/${reportId}/run`, userId ?? null, JSON.stringify({ action: "REPORT_RUN", report_id: reportId, result_rows: rows }), new Date()],
    );
  } catch (err) {
    console.error("report-audit-failure:", err instanceof Error ? err.message : err);
  }
}

const deleteReportHandler: RequestHandler = async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      res.status(400).json({ error: "Invalid report id" });
      return;
    }

    const [beforeRows] = await dbPool.query<ReportDefRow[]>(
      "SELECT id, name, description, created_by, CAST(config AS CHAR) AS config, created_at, updated_at FROM report_definitions WHERE id = ? LIMIT 1",
      [reportId],
    );
    const beforeRow = beforeRows[0];
    if (beforeRow) {
      res.locals.auditBefore = {
        id: beforeRow.id,
        name: beforeRow.name,
        description: beforeRow.description,
        created_by: beforeRow.created_by,
        config: JSON.parse(beforeRow.config),
        created_at: beforeRow.created_at,
        updated_at: beforeRow.updated_at,
      };
    }

    const [result] = await dbPool.execute<ResultSetHeader>(
      "DELETE FROM report_definitions WHERE id = ?",
      [reportId],
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    res.locals.auditAfter = { action: "REPORT_DELETED", report_id: reportId };
    res.status(200).json({ message: "Report deleted" });
  } catch (error) {
    console.error("report-delete-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to delete report" });
  }
};

const reportsRouter = Router();

reportsRouter.get(
  "/",
  requireRole("Safety Manager", "Auditor", "Administrator"),
  listReportsHandler,
);

reportsRouter.post(
  "/",
  ...secureStateChangingRoute,
  requireRole("Safety Manager", "Administrator"),
  createReportHandler,
);

reportsRouter.get(
  "/:id/run",
  requireRole("Safety Manager", "Auditor", "Administrator"),
  runReportHandler,
);

reportsRouter.delete(
  "/:id",
  ...secureStateChangingRoute,
  requireRole("Safety Manager", "Administrator"),
  deleteReportHandler,
);

export default reportsRouter;
