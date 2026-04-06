import type { RequestHandler } from "express";

import { dbPool } from "../db/pool";

const auditableMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const sensitiveFields = new Set(["password", "password_hash", "new_password", "old_password", "token", "secret"]);
const sensitiveRoutePatterns = [/^\/auth\/login/, /^\/auth\/register/];

function sanitizeBody(body: unknown, route: string): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }

  if (sensitiveRoutePatterns.some((pattern) => pattern.test(route))) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      sanitized[key] = sensitiveFields.has(key) ? "[REDACTED]" : value;
    }
    return sanitized;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    result[key] = sensitiveFields.has(key) ? "[REDACTED]" : value;
  }
  return result;
}

export const auditLogger: RequestHandler = (req, res, next) => {
  if (!auditableMethods.has(req.method)) {
    next();
    return;
  }

  const startedAt = new Date();
  const route = req.originalUrl;

  res.on("finish", () => {
    if (res.statusCode >= 500) {
      return;
    }

    const userId = req.auth?.sub ?? null;
    const beforeVal = res.locals.auditBefore ?? null;

    const afterVal =
      res.locals.auditAfter ?? {
        action: res.locals.auditAction ?? req.method,
        request_body: sanitizeBody(req.body, route),
        status_code: res.statusCode,
      };

    void dbPool
      .execute(
        "INSERT INTO audit_logs (route, user_id, before_val, after_val, created_at) VALUES (?, ?, ?, ?, ?)",
        [route, userId, JSON.stringify(beforeVal), JSON.stringify(afterVal), startedAt],
      )
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown audit log error";
        console.error(`audit-log-failure: ${message}`);
      });
  });

  next();
};
