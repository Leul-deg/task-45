import { Router } from "express";
import type { RequestHandler } from "express";
import type { RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";
import { requireRole } from "../middleware/security";

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return lines.join("\n");
}

interface IncidentExportRow extends RowDataPacket {
  id: number;
  reporter_id: number;
  type: string;
  description: string;
  site: string;
  time: Date;
  status: string;
  rating: number | null;
  cost: number | null;
  created_at: Date;
  updated_at: Date;
}

interface MetricExportRow extends RowDataPacket {
  label: string;
  count: number;
}

async function logExportAudit(route: string, userId: number | undefined, payload: Record<string, unknown>): Promise<void> {
  try {
    await dbPool.execute(
      "INSERT INTO audit_logs (route, user_id, before_val, after_val, created_at) VALUES (?, ?, NULL, ?, ?)",
      [route, userId ?? null, JSON.stringify(payload), new Date()],
    );
  } catch (err) {
    console.error("export-audit-failure:", err instanceof Error ? err.message : err);
  }
}

const exportIncidentsHandler: RequestHandler = async (req, res) => {
  try {
    const status = String(req.query.status ?? "").trim();
    const dateFrom = String(req.query.date_from ?? "").trim();
    const dateTo = String(req.query.date_to ?? "").trim();

    const where: string[] = [];
    const params: unknown[] = [];

    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (dateFrom) {
      where.push("created_at >= ?");
      params.push(new Date(dateFrom));
    }
    if (dateTo) {
      where.push("created_at <= ?");
      params.push(new Date(dateTo));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await dbPool.query<IncidentExportRow[]>(
      `SELECT id, reporter_id, type, description, site, time, status, rating, cost, created_at, updated_at
       FROM incidents ${whereClause}
       ORDER BY created_at DESC
       LIMIT 5000`,
      params,
    );

    const auditPayload = {
      action: "INCIDENT_CSV_EXPORT",
      format: "csv",
      row_count: rows.length,
      filters: { status: status || null, date_from: dateFrom || null, date_to: dateTo || null },
    };
    void logExportAudit("/export/incidents", req.auth?.sub, auditPayload);

    const csvRows = rows.map((r) => [
      r.id, r.reporter_id, r.type, r.description, r.site,
      r.time, r.status, r.rating ?? "", r.cost ?? "",
      r.created_at, r.updated_at,
    ]);

    const csv = toCsv(
      ["ID", "Reporter ID", "Type", "Description", "Site", "Time", "Status", "Rating", "Cost", "Created At", "Updated At"],
      csvRows,
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=incidents-export.csv");
    res.status(200).send(csv);
  } catch (error) {
    console.error("incident-export-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to export incidents" });
  }
};

const exportMetricsHandler: RequestHandler = async (req, res) => {
  try {
    const [statusRows] = await dbPool.query<MetricExportRow[]>(
      "SELECT status AS label, COUNT(*) AS count FROM incidents GROUP BY status ORDER BY count DESC",
    );

    const [actionRows] = await dbPool.query<MetricExportRow[]>(
      "SELECT action AS label, COUNT(*) AS count FROM incident_actions GROUP BY action ORDER BY count DESC",
    );

    const csvRows: unknown[][] = [];
    for (const r of statusRows) {
      csvRows.push(["incidents_by_status", r.label, r.count]);
    }
    for (const r of actionRows) {
      csvRows.push(["moderation_actions", r.label, r.count]);
    }

    const auditPayload = {
      action: "METRICS_CSV_EXPORT",
      format: "csv",
      row_count: csvRows.length,
    };
    void logExportAudit("/export/metrics", req.auth?.sub, auditPayload);

    const csv = toCsv(["Metric Group", "Dimension", "Count"], csvRows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=metrics-export.csv");
    res.status(200).send(csv);
  } catch (error) {
    console.error("metrics-export-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to export metrics" });
  }
};

const exportsRouter = Router();

exportsRouter.get(
  "/incidents",
  requireRole("Safety Manager", "Auditor", "Administrator"),
  exportIncidentsHandler,
);

exportsRouter.get(
  "/metrics",
  requireRole("Safety Manager", "Auditor", "Administrator"),
  exportMetricsHandler,
);

export default exportsRouter;
