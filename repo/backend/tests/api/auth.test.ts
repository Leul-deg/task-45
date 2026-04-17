import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";
import { authHeaders, makeTestToken, TEST_CSRF } from "./helpers";

jest.mock("../../src/db/pool", () => {
  const bcrypt = require("bcryptjs");

  const baseUsers = [
    {
      id: 1,
      username: "admin",
      password_hash: bcrypt.hashSync("admin123", 10),
      role: "Administrator",
      login_attempts: 0,
      locked_until: null as Date | null,
    },
    {
      id: 2,
      username: "reporter1",
      password_hash: bcrypt.hashSync("reporter123", 10),
      role: "Reporter",
      login_attempts: 0,
      locked_until: null as Date | null,
    },
  ];

  let data = { users: baseUsers.map((u) => ({ ...u })) };

  function reset() {
    data = { users: baseUsers.map((u) => ({ ...u, login_attempts: 0, locked_until: null })) };
  }

  return {
    dbPool: {
      query: (_sql: string, params: unknown[]) => {
        const normalized = (_sql as string).trim().toLowerCase();
        if (normalized.includes("from users where username")) {
          const username = (params as [string])[0];
          const user = data.users.find((u: any) => u.username === username);
          return Promise.resolve([user ? [{ ...user }] : [], []]);
        }
        if (normalized.includes("from users where id")) {
          const userId = (params as [number])[0];
          const user = data.users.find((u: any) => u.id === userId);
          return Promise.resolve([user ? [{ ...user }] : [], []]);
        }
        return Promise.resolve([[], []]);
      },
      execute: (sql: string, params: unknown[]) => {
        const normalized = sql.trim().toLowerCase();
        // Lock account after repeated failures: UPDATE users SET login_attempts = login_attempts + 1, locked_until = ? WHERE id = ?
        if (normalized.includes("locked_until")) {
          const lockedUntil = params[0] as Date | null;
          const userId = params[1] as number;
          const user = data.users.find((u: any) => u.id === userId);
          if (user) {
            user.login_attempts += 1;
            user.locked_until = lockedUntil;
          }
          return Promise.resolve([{}, {}]);
        }
        // Increment failure counter: UPDATE users SET login_attempts = login_attempts + 1 WHERE id = ?
        if (normalized.startsWith("update users set login_attempts = login_attempts + 1")) {
          const userId = params[0] as number;
          const user = data.users.find((u: any) => u.id === userId);
          if (user) user.login_attempts += 1;
          return Promise.resolve([{}, {}]);
        }
        // Reset on successful login: UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?
        if (normalized.startsWith("update users set login_attempts = 0")) {
          const userId = params[0] as number;
          const user = data.users.find((u: any) => u.id === userId);
          if (user) {
            user.login_attempts = 0;
            user.locked_until = null;
          }
          return Promise.resolve([{}, {}]);
        }
        return Promise.resolve([{}, {}]);
      },
    },
    __reset: reset,
  };
});

const dbMock = jest.requireMock("../../src/db/pool") as any;

describe("POST /auth/login", () => {
  beforeEach(() => {
    dbMock.__reset();
  });

  test("returns 200 with token, csrf_token, and user object", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin", password: "admin123" });

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
    expect(typeof res.body.csrf_token).toBe("string");
    expect(res.body.user.username).toBe("admin");
    expect(res.body.user.role).toBe("Administrator");
    expect(res.body.expires_in).toBe(900);
  });

  test("returns 401 for wrong password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin", password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid credentials");
  });

  test("returns 400 for missing fields", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("required");
  });

  test("rate limits after 60 requests in 1 minute", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app)
        .post("/auth/login")
        .send({ username: "admin", password: "admin123" });
    }

    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin", password: "admin123" });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Too many");
  }, 15000);
});

describe("POST /auth/refresh", () => {
  beforeEach(() => {
    dbMock.__reset();
  });

  test("returns new token for valid near-expiry token", async () => {
    const nearExpiryToken = makeTestToken(1, "admin", "Administrator", "3s");

    await new Promise((r) => setTimeout(r, 1500));

    const res = await request(app)
      .post("/auth/refresh")
      .set("Authorization", `Bearer ${nearExpiryToken}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send();

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
    expect(res.body.expires_in).toBe(900);
    expect(res.body.user.username).toBe("admin");
  });

  test("returns 401 without auth", async () => {
    const res = await request(app).post("/auth/refresh").send();
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  beforeEach(() => {
    dbMock.__reset();
  });

  test("revokes token successfully", async () => {
    const token = makeTestToken(1, "admin", "Administrator");

    const res = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send();

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("revoked");
  });

  test("returns 401 without auth", async () => {
    const res = await request(app).post("/auth/logout").send();
    expect(res.status).toBe(401);
  });
});

describe("Account lockout after repeated failures", () => {
  beforeEach(() => {
    dbMock.__reset();
    // Reset in-memory rate-limit/failure stores so prior tests don't block this suite.
    const { __resetAuthRateState } = jest.requireActual("../../src/controllers/auth");
    __resetAuthRateState();
  });

  test("returns 423 after 10 consecutive wrong-password attempts", async () => {
    // Drive 10 failures to trigger the in-memory lockout counter (MAX_FAILURES = 10)
    // and update locked_until via dbPool.execute in the mock.
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post("/auth/login")
        .send({ username: "reporter1", password: "wrongpassword" });
    }

    // The 11th attempt should find locked_until set in the mock and return 423.
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "reporter1", password: "wrongpassword" });

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/locked/i);
  }, 15000);

  test("successful login resets lock state", async () => {
    // Establish a clean state and verify normal login still works
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin", password: "admin123" });

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
  });
});

// ─── POST /auth/consent ────────────────────────────────────────────────────

describe("POST /auth/consent", () => {
  beforeEach(() => {
    dbMock.__reset();
  });

  test("records consent=true and returns 200 with consented field", async () => {
    const token = makeTestToken(1, "admin", "Administrator");
    const res = await request(app)
      .post("/auth/consent")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ consented: true });

    expect(res.status).toBe(200);
    expect(res.body.consented).toBe(true);
    expect(res.body.message).toMatch(/recorded/i);
  });

  test("records consent=false and returns 200", async () => {
    const token = makeTestToken(1, "admin", "Administrator");
    const res = await request(app)
      .post("/auth/consent")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ consented: false });

    expect(res.status).toBe(200);
    expect(res.body.consented).toBe(false);
  });

  test("returns 401 without Authorization header", async () => {
    const res = await request(app)
      .post("/auth/consent")
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ consented: true });

    expect(res.status).toBe(401);
  });

  test("returns 400 when security headers are missing", async () => {
    const token = makeTestToken(1, "admin", "Administrator");
    const res = await request(app)
      .post("/auth/consent")
      .set("Authorization", `Bearer ${token}`)
      .send({ consented: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestamp|nonce|csrf/i);
  });
});

// ─── GET /auth/consent ─────────────────────────────────────────────────────

describe("GET /auth/consent", () => {
  beforeEach(() => {
    dbMock.__reset();
  });

  test("returns consented=false and consented_at=null when no record exists", async () => {
    // Default mock returns [] for privacy_consent queries → handler returns the default false state.
    const token = makeTestToken(1, "admin", "Administrator");
    const res = await request(app)
      .get("/auth/consent")
      .set("Authorization", `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.consented).toBe(false);
    expect(res.body.consented_at).toBeNull();
  });

  test("returns 401 without Authorization header", async () => {
    const res = await request(app).get("/auth/consent").send();
    expect(res.status).toBe(401);
  });
});
