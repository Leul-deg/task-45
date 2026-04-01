import { Router } from "express";
import type { RequestHandler } from "express";
import type { RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";
import { authenticateJwt, requireRole } from "../middleware/security";

interface StatusMetricRow extends RowDataPacket {
  status: string;
  count: number;
}

interface ActionMetricRow extends RowDataPacket {
  action: string;
  count: number;
}

interface UserActivityRow extends RowDataPacket {
  user_id: number | null;
  count: number;
}

interface SlaAtRiskRow extends RowDataPacket {
  ack_at_risk: number;
  close_at_risk: number;
  escalated: number;
  total_open: number;
}

const getMetricsHandler: RequestHandler = async (req, res) => {
  try {
    const dateFrom = String(req.query.date_from ?? "").trim();
    const dateTo = String(req.query.date_to ?? "").trim();

    const incidentWhere: string[] = [];
    const incidentParams: unknown[] = [];
    const actionWhere: string[] = [];
    const actionParams: unknown[] = [];

    if (dateFrom) {
      incidentWhere.push("created_at >= ?");
      incidentParams.push(new Date(dateFrom));
      actionWhere.push("created_at >= ?");
      actionParams.push(new Date(dateFrom));
    }

    if (dateTo) {
      incidentWhere.push("created_at <= ?");
      incidentParams.push(new Date(dateTo));
      actionWhere.push("created_at <= ?");
      actionParams.push(new Date(dateTo));
    }

    const incidentWhereClause = incidentWhere.length > 0 ? `WHERE ${incidentWhere.join(" AND ")}` : "";
    const actionWhereClause = actionWhere.length > 0 ? `WHERE ${actionWhere.join(" AND ")}` : "";

    const [statusRows] = await dbPool.query<StatusMetricRow[]>(
      `SELECT status, COUNT(*) AS count FROM incidents ${incidentWhereClause} GROUP BY status ORDER BY count DESC`,
      incidentParams,
    );

    const [moderationRows] = await dbPool.query<ActionMetricRow[]>(
      `SELECT action, COUNT(*) AS count
       FROM incident_actions
       ${actionWhereClause}
       GROUP BY action
       ORDER BY count DESC`,
      actionParams,
    );

    const [userRows] = await dbPool.query<UserActivityRow[]>(
      `SELECT user_id, COUNT(*) AS count
       FROM audit_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY user_id
       ORDER BY count DESC
       LIMIT 20`,
    );

    let slaAtRisk = { ack_at_risk: 0, close_at_risk: 0, escalated: 0, total_open: 0 };
    try {
      const [slaRows] = await dbPool.query<SlaAtRiskRow[]>(
        `SELECT
          SUM(CASE WHEN status = 'New' AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= 15 THEN 1 ELSE 0 END) AS ack_at_risk,
          SUM(CASE WHEN status != 'Closed' AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= 72 THEN 1 ELSE 0 END) AS close_at_risk,
          SUM(CASE WHEN status = 'Escalated' THEN 1 ELSE 0 END) AS escalated,
          COUNT(*) AS total_open
        FROM incidents
        WHERE status != 'Closed'`,
      );
      if (slaRows[0]) {
        slaAtRisk = {
          ack_at_risk: Number(slaRows[0].ack_at_risk) || 0,
          close_at_risk: Number(slaRows[0].close_at_risk) || 0,
          escalated: Number(slaRows[0].escalated) || 0,
          total_open: Number(slaRows[0].total_open) || 0,
        };
      }
    } catch {
      // SLA summary is non-critical; fail silently
    }

    res.status(200).json({
      incidents_by_status: statusRows,
      moderation_actions: moderationRows,
      user_activity_logs: userRows,
      sla_at_risk: slaAtRisk,
    });
  } catch (error) {
    console.error("admin-metrics-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to fetch admin metrics" });
  }
};

const adminRouter = Router();

adminRouter.get(
  "/metrics",
  requireRole("Safety Manager", "Auditor", "Administrator"),
  getMetricsHandler,
);

export default adminRouter;
