import type { RequestHandler } from "express";
import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";
import { authenticateJwt, requireRole, secureStateChangingRoute } from "../middleware/security";

const DEFAULT_ACK_MINUTES = 15;
const DEFAULT_CLOSE_HOURS = 72;

interface SettingRow extends RowDataPacket {
  config_key: string;
  config_value: string;
}

const DEFAULT_INCIDENT_TYPES = ["Injury", "Fire", "Spill", "Equipment Failure", "Security", "Near Miss"];

const updateSlaHandler: RequestHandler = async (req, res) => {
  try {
    const ackMinutes = req.body?.ack_minutes ?? DEFAULT_ACK_MINUTES;
    const closeHours = req.body?.close_hours ?? DEFAULT_CLOSE_HOURS;

    const ackValue = Number(ackMinutes);
    const closeValue = Number(closeHours);

    if (!Number.isInteger(ackValue) || ackValue <= 0 || ackValue > 240) {
      res.status(400).json({ error: "ack_minutes must be an integer between 1 and 240" });
      return;
    }

    if (!Number.isInteger(closeValue) || closeValue <= 0 || closeValue > 720) {
      res.status(400).json({ error: "close_hours must be an integer between 1 and 720" });
      return;
    }

    const payload = {
      ack_minutes: ackValue,
      close_hours: closeValue,
    };

    await dbPool.execute<ResultSetHeader>(
      "INSERT INTO settings (config_key, config_value) VALUES ('sla_defaults', CAST(? AS JSON)) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
      [JSON.stringify(payload)],
    );

    res.locals.auditAfter = {
      action: "SLA_UPDATED",
      settings: payload,
    };

    res.status(200).json({
      message: "SLA settings updated",
      settings: payload,
    });
  } catch (error) {
    console.error("sla-update-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to update settings" });
  }
};

const settingsRouter = Router();

const getSettingsConfigHandler: RequestHandler = async (_req, res) => {
  try {
    const [rows] = await dbPool.query<SettingRow[]>(
      "SELECT config_key, CAST(config_value AS CHAR) AS config_value FROM settings WHERE config_key IN ('sla_defaults', 'incident_types', 'sla_rules', 'severity_rules', 'facility_sites')",
    );

    const payload: Record<string, unknown> = {
      sla_defaults: {
        ack_minutes: DEFAULT_ACK_MINUTES,
        close_hours: DEFAULT_CLOSE_HOURS,
      },
      incident_types: DEFAULT_INCIDENT_TYPES,
      sla_rules: [],
      severity_rules: [],
      facility_sites: [],
    };

    for (const row of rows) {
      try {
        payload[row.config_key] = JSON.parse(row.config_value);
      } catch {
        payload[row.config_key] = row.config_value;
      }
    }

    res.status(200).json(payload);
  } catch (error) {
    console.error("settings-fetch-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to fetch settings" });
  }
};

const updateIncidentTypesHandler: RequestHandler = async (req, res) => {
  try {
    const rawTypes = Array.isArray(req.body?.incident_types) ? req.body.incident_types : [];
    const incidentTypes = rawTypes
      .map((entry: unknown) => String(entry).trim())
      .filter((entry: string) => entry.length > 0)
      .slice(0, 50);

    if (incidentTypes.length === 0) {
      res.status(400).json({ error: "incident_types must contain at least one value" });
      return;
    }

    await dbPool.execute<ResultSetHeader>(
      "INSERT INTO settings (config_key, config_value) VALUES ('incident_types', CAST(? AS JSON)) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
      [JSON.stringify(incidentTypes)],
    );

    res.locals.auditAfter = {
      action: "INCIDENT_TYPES_UPDATED",
      incident_types: incidentTypes,
    };

    res.status(200).json({ incident_types: incidentTypes });
  } catch (error) {
    console.error("incident-types-update-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to update incident types" });
  }
};

const updateSlaRulesHandler: RequestHandler = async (req, res) => {
  try {
    const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
    if (rules.length > 100) {
      res.status(400).json({ error: "rules exceeds maximum allowed entries" });
      return;
    }

    await dbPool.execute<ResultSetHeader>(
      "INSERT INTO settings (config_key, config_value) VALUES ('sla_rules', CAST(? AS JSON)) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
      [JSON.stringify(rules)],
    );

    res.locals.auditAfter = {
      action: "SLA_RULES_UPDATED",
      rules_count: rules.length,
    };

    res.status(200).json({ rules });
  } catch (error) {
    console.error("sla-rules-update-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to update custom SLA rules" });
  }
};

interface SeverityRule {
  incident_type: string;
  severity: string;
  auto_escalate: boolean;
  escalate_after_hours?: number;
}

const VALID_SEVERITIES = ["low", "medium", "high", "critical"];

function validateSeverityRule(rule: unknown, index: number): string | null {
  if (!rule || typeof rule !== "object") {
    return `Rule at index ${index} must be an object`;
  }

  const r = rule as Record<string, unknown>;

  if (typeof r.incident_type !== "string" || !r.incident_type.trim()) {
    return `Rule at index ${index}: incident_type is required and must be a non-empty string`;
  }

  if (typeof r.severity !== "string" || !VALID_SEVERITIES.includes(r.severity.toLowerCase())) {
    return `Rule at index ${index}: severity must be one of ${VALID_SEVERITIES.join(", ")}`;
  }

  if (typeof r.auto_escalate !== "boolean") {
    return `Rule at index ${index}: auto_escalate must be a boolean`;
  }

  if (r.auto_escalate && r.escalate_after_hours !== undefined) {
    const hours = Number(r.escalate_after_hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 720) {
      return `Rule at index ${index}: escalate_after_hours must be between 1 and 720`;
    }
  }

  return null;
}

const updateSeverityRulesHandler: RequestHandler = async (req, res) => {
  try {
    const rawRules = Array.isArray(req.body?.rules) ? req.body.rules : [];
    if (rawRules.length > 100) {
      res.status(400).json({ error: "Maximum of 100 severity rules allowed" });
      return;
    }

    for (let i = 0; i < rawRules.length; i++) {
      const validationError = validateSeverityRule(rawRules[i], i);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
    }

    const rules: SeverityRule[] = rawRules.map((r: Record<string, unknown>) => ({
      incident_type: String(r.incident_type).trim(),
      severity: String(r.severity).toLowerCase(),
      auto_escalate: Boolean(r.auto_escalate),
      ...(r.auto_escalate && r.escalate_after_hours !== undefined
        ? { escalate_after_hours: Number(r.escalate_after_hours) }
        : {}),
    }));

    await dbPool.execute<ResultSetHeader>(
      "INSERT INTO settings (config_key, config_value) VALUES ('severity_rules', CAST(? AS JSON)) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
      [JSON.stringify(rules)],
    );

    res.locals.auditAfter = {
      action: "SEVERITY_RULES_UPDATED",
      rules_count: rules.length,
    };

    res.status(200).json({ rules });
  } catch (error) {
    console.error("severity-rules-update-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to update severity rules" });
  }
};

const updateFacilitySitesHandler: RequestHandler = async (req, res) => {
  try {
    const rawSites = Array.isArray(req.body?.sites) ? req.body.sites : [];
    const sites = rawSites
      .map((entry: unknown) => String(entry).trim())
      .filter((entry: string) => entry.length > 0)
      .slice(0, 100);

    if (sites.length === 0) {
      res.status(400).json({ error: "sites must contain at least one value" });
      return;
    }

    await dbPool.execute<ResultSetHeader>(
      "INSERT INTO settings (config_key, config_value) VALUES ('facility_sites', CAST(? AS JSON)) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
      [JSON.stringify(sites)],
    );

    res.locals.auditAfter = {
      action: "FACILITY_SITES_UPDATED",
      sites_count: sites.length,
    };

    res.status(200).json({ sites });
  } catch (error) {
    console.error("facility-sites-update-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to update facility sites" });
  }
};

settingsRouter.get(
  "/config",
  getSettingsConfigHandler,
);
settingsRouter.patch("/sla", ...secureStateChangingRoute, requireRole("Safety Manager"), updateSlaHandler);
settingsRouter.patch(
  "/incident-types",
  ...secureStateChangingRoute,
  requireRole("Safety Manager"),
  updateIncidentTypesHandler,
);
settingsRouter.patch("/sla-rules", ...secureStateChangingRoute, requireRole("Safety Manager"), updateSlaRulesHandler);
settingsRouter.patch("/severity-rules", ...secureStateChangingRoute, requireRole("Safety Manager"), updateSeverityRulesHandler);
settingsRouter.patch("/facility-sites", ...secureStateChangingRoute, requireRole("Safety Manager", "Administrator"), updateFacilitySitesHandler);

export default settingsRouter;
