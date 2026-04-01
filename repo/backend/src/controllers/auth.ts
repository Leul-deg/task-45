import crypto from "crypto";
import type { Request, RequestHandler, Response } from "express";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { RowDataPacket } from "mysql2";

import { dbPool } from "../db/pool";
import { revokeToken, isTokenRevoked } from "../utils/tokenBlocklist";
import { APP_ROLES, type AppRole, type AuthClaims } from "../types/auth";
import { authenticateJwt, secureStateChangingRoute } from "../middleware/security";

const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_LOGIN_REQUESTS = 60;
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 10;
const LOCKOUT_MS = 5 * 60 * 1000;

const loginRateStore = new Map<string, number[]>();
const failureStore = new Map<string, number[]>();

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
  role: AppRole;
  login_attempts: number;
  locked_until: Date | null;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return secret;
}

function trackRateLimit(key: string): boolean {
  const now = Date.now();
  const existing = loginRateStore.get(key) ?? [];
  const recent = existing.filter((ts) => now - ts < LOGIN_WINDOW_MS);

  recent.push(now);
  loginRateStore.set(key, recent);

  return recent.length <= MAX_LOGIN_REQUESTS;
}

function registerFailure(key: string): number {
  const now = Date.now();
  const existing = failureStore.get(key) ?? [];
  const recent = existing.filter((ts) => now - ts < FAIL_WINDOW_MS);

  recent.push(now);
  failureStore.set(key, recent);

  return recent.length;
}

function clearFailures(key: string): void {
  failureStore.delete(key);
}

function createClaims(user: UserRow): AuthClaims {
  return {
    sub: user.id,
    username: user.username,
    role: user.role,
    csrfToken: crypto.randomBytes(16).toString("hex"),
    jti: crypto.randomUUID(),
  };
}

async function failLogin(user: UserRow | null, key: string): Promise<void> {
  if (!user) {
    registerFailure(key);
    return;
  }

  const failures = registerFailure(String(user.id));

  if (failures >= MAX_FAILURES) {
    await dbPool.execute(
      "UPDATE users SET login_attempts = login_attempts + 1, locked_until = ? WHERE id = ?",
      [new Date(Date.now() + LOCKOUT_MS), user.id],
    );
    return;
  }

  await dbPool.execute("UPDATE users SET login_attempts = login_attempts + 1 WHERE id = ?", [user.id]);
}

export const refreshHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const expMs = (req.auth.exp ?? 0) * 1000;
    const timeLeft = expMs - Date.now();
    if (timeLeft > REFRESH_WINDOW_MS) {
      res.status(429).json({
        error: "Token is not within 5 minutes of expiry. Refresh too early.",
        seconds_remaining: Math.floor(timeLeft / 1000),
      });
      return;
    }

    if (isTokenRevoked(req.auth.jti)) {
      res.status(401).json({ error: "Token has been revoked" });
      return;
    }

    const [rows] = await dbPool.query<UserRow[]>(
      "SELECT id, username, password_hash, role, login_attempts, locked_until FROM users WHERE id = ? LIMIT 1",
      [req.auth.sub],
    );

    const user = rows[0] ?? null;
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      res.status(423).json({ error: "Account is locked" });
      return;
    }

    const newClaims: AuthClaims = {
      sub: user.id,
      username: user.username,
      role: user.role,
      csrfToken: crypto.randomBytes(16).toString("hex"),
      jti: crypto.randomUUID(),
    };

    const newToken = jwt.sign(newClaims, getJwtSecret(), { expiresIn: "15m" });

    res.status(200).json({
      token_type: "Bearer",
      expires_in: 900,
      access_token: newToken,
      csrf_token: newClaims.csrfToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("token-refresh-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to refresh token" });
  }
};

export const logoutHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    await revokeToken(req.auth.jti, req.auth.exp);

    res.status(200).json({ message: "Token revoked successfully" });
  } catch (error) {
    console.error("logout-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to revoke token" });
  }
};

export const loginHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    const rateKey = username.toLowerCase();
    if (!trackRateLimit(rateKey)) {
      res.status(429).json({ error: "Too many login attempts. Try again in a minute." });
      return;
    }

    const [rows] = await dbPool.query<UserRow[]>(
      "SELECT id, username, password_hash, role, login_attempts, locked_until FROM users WHERE username = ? LIMIT 1",
      [username],
    );

    const user = rows[0] ?? null;

    if (!user) {
      await failLogin(null, rateKey);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!APP_ROLES.includes(user.role)) {
      res.status(403).json({ error: "User role is not permitted" });
      return;
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      res.status(423).json({ error: "Account locked due to repeated failures" });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      await failLogin(user, rateKey);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    clearFailures(String(user.id));
    clearFailures(rateKey);
    await dbPool.execute("UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?", [user.id]);

    const claims = createClaims(user);
    const token = jwt.sign(claims, getJwtSecret(), { expiresIn: "15m" });

    res.status(200).json({
      token_type: "Bearer",
      expires_in: 900,
      access_token: token,
      csrf_token: claims.csrfToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("login-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to process login request" });
  }
};

interface ConsentRow extends RowDataPacket {
  consented: number;
  consented_at: Date | null;
}

export const recordConsentHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const consented = Boolean(req.body?.consented);
    const ipAddress = req.ip ?? null;

    await dbPool.execute(
      `INSERT INTO privacy_consent (user_id, consented, consented_at, ip_address)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE consented = VALUES(consented), consented_at = VALUES(consented_at), ip_address = VALUES(ip_address)`,
      [req.auth.sub, consented, consented ? new Date() : null, ipAddress],
    );

    res.locals.auditAfter = { action: "PRIVACY_CONSENT_RECORDED", consented };

    res.status(200).json({ message: "Consent recorded", consented });
  } catch (error) {
    console.error("consent-record-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to record consent" });
  }
};

export const getConsentHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const [rows] = await dbPool.query<ConsentRow[]>(
      "SELECT consented, consented_at FROM privacy_consent WHERE user_id = ? LIMIT 1",
      [req.auth.sub],
    );

    const row = rows[0];
    res.status(200).json({
      consented: row ? Boolean(row.consented) : false,
      consented_at: row?.consented_at ?? null,
    });
  } catch (error) {
    console.error("consent-check-failure:", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Unable to check consent status" });
  }
};

const authRouter = Router();

authRouter.post("/login", loginHandler);
authRouter.post("/refresh", authenticateJwt, refreshHandler);
authRouter.post("/logout", authenticateJwt, logoutHandler);
authRouter.post("/consent", ...secureStateChangingRoute, recordConsentHandler);
authRouter.get("/consent", authenticateJwt, getConsentHandler);

export default authRouter;
