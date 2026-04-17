import cron from "node-cron";
import type { RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";

const ESCALATION_ACTOR_USER_ID = Number(process.env.ESCALATION_SYSTEM_USER_ID) || 1;

interface SeverityRuleRow {
  incident_type: string;
  auto_escalate: boolean;
  escalate_after_hours?: number;
}

interface OpenIncidentRow extends RowDataPacket {
  id: number;
  type: string;
  status: string;
  created_at: Date;
}

function canTransitionToEscalated(status: string): boolean {
  return status === "New" || status === "Acknowledged" || status === "In Progress";
}

async function loadAutoEscalationRules(): Promise<SeverityRuleRow[]> {
  const [rows] = await dbPool.query<RowDataPacket[]>(
    "SELECT CAST(config_value AS CHAR) AS config_value FROM settings WHERE config_key = 'severity_rules' LIMIT 1",
  );
  if (!rows[0]) {
    return [];
  }
  try {
    const parsed = JSON.parse((rows[0] as { config_value: string }).config_value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (r: unknown) =>
        r &&
        typeof r === "object" &&
        Boolean((r as SeverityRuleRow).auto_escalate) &&
        typeof (r as SeverityRuleRow).incident_type === "string" &&
        typeof (r as SeverityRuleRow).escalate_after_hours === "number",
    ) as SeverityRuleRow[];
  } catch {
    return [];
  }
}

function hoursSince(createdAt: Date): number {
  return (Date.now() - new Date(createdAt).getTime()) / (3600 * 1000);
}

function matchingRule(rules: SeverityRuleRow[], incidentType: string): SeverityRuleRow | null {
  const t = incidentType.toLowerCase();
  let best: SeverityRuleRow | null = null;
  let bestHours = Infinity;
  for (const r of rules) {
    if (!r.auto_escalate || !r.incident_type) {
      continue;
    }
    const h = Number(r.escalate_after_hours);
    if (!Number.isFinite(h) || h <= 0) {
      continue;
    }
    if (r.incident_type.toLowerCase() !== t) {
      continue;
    }
    if (h < bestHours) {
      bestHours = h;
      best = r;
    }
  }
  return best;
}

/** Applies persisted severity rules: auto-escalate open incidents after configured calendar hours. */
export async function runSeverityAutoEscalation(): Promise<number> {
  const rules = await loadAutoEscalationRules();
  if (rules.length === 0) {
    return 0;
  }

  const [incidentRows] = await dbPool.query<OpenIncidentRow[]>(
    "SELECT id, type, status, created_at FROM incidents WHERE status IN ('New','Acknowledged','In Progress')",
  );

  let escalated = 0;

  for (const inc of incidentRows) {
    const rule = matchingRule(rules, inc.type);
    if (!rule || rule.escalate_after_hours === undefined) {
      continue;
    }
    if (!canTransitionToEscalated(inc.status)) {
      continue;
    }
    if (hoursSince(inc.created_at) < rule.escalate_after_hours) {
      continue;
    }

    const connection = await dbPool.getConnection();
    try {
      await connection.beginTransaction();
      const [currentRows] = await connection.query<OpenIncidentRow[]>(
        "SELECT id, type, status, created_at FROM incidents WHERE id = ? FOR UPDATE",
        [inc.id],
      );
      const current = currentRows[0];
      if (!current || !canTransitionToEscalated(current.status)) {
        await connection.rollback();
        continue;
      }
      const stillRule = matchingRule(rules, current.type);
      if (!stillRule || hoursSince(current.created_at) < stillRule.escalate_after_hours) {
        await connection.rollback();
        continue;
      }

      await connection.execute("UPDATE incidents SET status = 'Escalated' WHERE id = ?", [inc.id]);
      await connection.execute(
        "INSERT INTO incident_actions (incident_id, user_id, action, evidence_log) VALUES (?, ?, ?, ?)",
        [
          inc.id,
          ESCALATION_ACTOR_USER_ID,
          "STATUS_UPDATED",
          JSON.stringify({
            previous_status: current.status,
            next_status: "Escalated",
            triage_notes: null,
            collaborators: [],
            auto_escalation: true,
            severity_rule: {
              incident_type: stillRule.incident_type,
              escalate_after_hours: stillRule.escalate_after_hours,
            },
          }),
        ],
      );
      await connection.commit();
      escalated++;
    } catch (error) {
      await connection.rollback();
      const message = error instanceof Error ? error.message : "unknown escalation error";
      console.error(`severity-auto-escalation failed for incident ${inc.id}: ${message}`);
    } finally {
      connection.release();
    }
  }

  if (escalated > 0) {
    console.log(`Severity auto-escalation: ${escalated} incident(s) moved to Escalated`);
  }

  return escalated;
}

export function startEscalationCronJobs(): void {
  cron.schedule("*/5 * * * *", () => {
    void runSeverityAutoEscalation().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown escalation cron error";
      console.error(`Severity auto-escalation cron failed: ${message}`);
    });
  });
}
