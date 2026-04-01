import { appendFile, mkdir } from "fs/promises";
import path from "path";

import cron from "node-cron";
import type { RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";

const ALERT_LOG_PATH = path.resolve(process.cwd(), "logs", "anomaly-alerts.log");

interface ExportAlertRow extends RowDataPacket {
  user_id: number | null;
  export_count: number;
}

interface AuthAlertRow extends RowDataPacket {
  id: number;
  username: string;
  login_attempts: number;
  locked_until: Date | null;
}

interface EditSpikeRow extends RowDataPacket {
  edits_last_15m: number;
  baseline_15m: number;
}

async function writeAlert(type: string, payload: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(ALERT_LOG_PATH), { recursive: true });

  const entry = JSON.stringify({
    at: new Date().toISOString(),
    type,
    ...payload,
  });

  await appendFile(ALERT_LOG_PATH, `${entry}\n`, "utf8");
  console.warn(`Anomaly alert: ${entry}`);
}

async function detectMassCsvExports(): Promise<void> {
  const [rows] = await dbPool.query<ExportAlertRow[]>(
    `SELECT user_id, COUNT(*) AS export_count
     FROM audit_logs
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
       AND (
         route LIKE '%export%'
         OR JSON_UNQUOTE(JSON_EXTRACT(after_val, '$.format')) = 'csv'
         OR JSON_SEARCH(CAST(after_val AS CHAR), 'one', '%csv%') IS NOT NULL
       )
     GROUP BY user_id
     HAVING COUNT(*) >= 3`,
  );

  for (const row of rows) {
    await writeAlert("mass_csv_exports", {
      user_id: row.user_id,
      export_count: row.export_count,
      window_minutes: 15,
    });
  }
}

async function detectRepeatedAuthFailures(): Promise<void> {
  const [rows] = await dbPool.query<AuthAlertRow[]>(
    `SELECT id, username, login_attempts, locked_until
     FROM users
     WHERE login_attempts >= 10 OR (locked_until IS NOT NULL AND locked_until > NOW())`,
  );

  for (const row of rows) {
    await writeAlert("repeated_auth_failures", {
      user_id: row.id,
      username: row.username,
      login_attempts: row.login_attempts,
      locked_until: row.locked_until,
    });
  }
}

async function detectIncidentEditSpike(): Promise<void> {
  const [rows] = await dbPool.query<EditSpikeRow[]>(
    `SELECT
       SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) THEN 1 ELSE 0 END) AS edits_last_15m,
       (SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) / 96) AS baseline_15m
     FROM audit_logs
     WHERE route LIKE '/incidents/%' AND route LIKE '%/status%'`,
  );

  const row = rows[0];
  if (!row) {
    return;
  }

  const baseline = Number(row.baseline_15m) || 0;
  const current = Number(row.edits_last_15m) || 0;
  const threshold = Math.max(12, baseline * 3);

  if (current >= threshold) {
    await writeAlert("incident_edit_spike", {
      edits_last_15m: current,
      baseline_15m: Number(baseline.toFixed(2)),
      threshold: Number(threshold.toFixed(2)),
    });
  }
}

export async function runAnomalyDetectors(): Promise<void> {
  await detectMassCsvExports();
  await detectRepeatedAuthFailures();
  await detectIncidentEditSpike();
}

export function startAlertCronJobs(): void {
  cron.schedule("*/10 * * * *", () => {
    void runAnomalyDetectors().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown anomaly detection error";
      console.error(`Anomaly detection failed: ${message}`);
    });
  });
}
