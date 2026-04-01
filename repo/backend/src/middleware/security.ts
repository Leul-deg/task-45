import type { NextFunction, Request, RequestHandler, Response } from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";

import { APP_ROLES, type AppRole, type AuthClaims } from "../types/auth";
import { isTokenRevoked } from "../utils/tokenBlocklist";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;
const nonceStore = new Map<string, number>();

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return secret;
}

function parseTimestamp(raw: string): number | null {
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    return raw.length <= 10 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function purgeExpiredNonces(nowMs: number): void {
  for (const [nonce, expiresAt] of nonceStore.entries()) {
    if (expiresAt <= nowMs) {
      nonceStore.delete(nonce);
    }
  }
}

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: "no-referrer" },
  xDnsPrefetchControl: { allow: false },
  noSniff: true,
  frameguard: { action: "deny" },
});

export const requireHttps: RequestHandler = (req, res, next) => {
  const requireTls = process.env.REQUIRE_HTTPS === "true" || process.env.NODE_ENV === "production";
  if (!requireTls) {
    next();
    return;
  }

  const forwardedProto = req.header("x-forwarded-proto");
  const isSecure = req.secure || forwardedProto === "https";

  if (!isSecure) {
    res.status(400).json({ error: "HTTPS is required" });
    return;
  }

  next();
};

export const validateRequestTimestamp: RequestHandler = (req, res, next) => {
  if (!stateChangingMethods.has(req.method)) {
    next();
    return;
  }

  const timestampHeader = req.header("x-request-timestamp");

  if (!timestampHeader) {
    res.status(400).json({ error: "Missing x-request-timestamp header" });
    return;
  }

  const requestTime = parseTimestamp(timestampHeader);
  if (requestTime === null) {
    res.status(400).json({ error: "Invalid request timestamp" });
    return;
  }

  const delta = Math.abs(Date.now() - requestTime);
  if (delta > FIVE_MINUTES_MS) {
    res.status(400).json({ error: "Request timestamp outside allowed window" });
    return;
  }

  next();
};

export const nonceReplayGuard: RequestHandler = (req, res, next) => {
  if (!stateChangingMethods.has(req.method)) {
    next();
    return;
  }

  const nonce = req.header("x-request-nonce");
  if (!nonce) {
    res.status(400).json({ error: "Missing x-request-nonce header" });
    return;
  }

  const now = Date.now();
  purgeExpiredNonces(now);

  if (nonceStore.has(nonce)) {
    res.status(409).json({ error: "Replay attack detected: nonce already used" });
    return;
  }

  nonceStore.set(nonce, now + NONCE_TTL_MS);
  next();
};

export const authenticateJwt: RequestHandler = (req, res, next) => {
  const authHeader = req.header("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const token = authHeader.replace("Bearer ", "").trim();

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload | string;

    if (typeof decoded === "string") {
      res.status(401).json({ error: "Invalid token payload" });
      return;
    }

    if (
      typeof decoded.sub !== "number" ||
      typeof decoded.username !== "string" ||
      typeof decoded.role !== "string" ||
      typeof decoded.csrfToken !== "string" ||
      typeof decoded.jti !== "string"
    ) {
      res.status(401).json({ error: "Invalid token claims" });
      return;
    }

    if (isTokenRevoked(decoded.jti)) {
      res.status(401).json({ error: "Token has been revoked" });
      return;
    }

    if (!APP_ROLES.includes(decoded.role as AppRole)) {
      res.status(401).json({ error: "Invalid role claim" });
      return;
    }

    const claims: AuthClaims = {
      sub: decoded.sub,
      username: decoded.username,
      role: decoded.role as AppRole,
      csrfToken: decoded.csrfToken,
      jti: decoded.jti,
      iat: decoded.iat,
      exp: decoded.exp,
    };

    req.auth = claims;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

export function requireRole(...allowedRoles: AppRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({ error: "Insufficient privileges" });
      return;
    }

    next();
  };
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!stateChangingMethods.has(req.method)) {
    next();
    return;
  }

  const csrfHeader = req.header("x-csrf-token");
  if (!csrfHeader) {
    res.status(400).json({ error: "Missing x-csrf-token header" });
    return;
  }

  if (req.auth?.csrfToken && csrfHeader !== req.auth.csrfToken) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
};

export const secureStateChangingRoute: RequestHandler[] = [
  authenticateJwt,
  csrfProtection,
  validateRequestTimestamp,
  nonceReplayGuard,
];
