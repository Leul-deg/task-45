import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";
import { authHeaders, makeTestToken, TEST_CSRF } from "./helpers";

jest.mock("../../src/db/pool", () => {
  return {
    dbPool: {
      query: () => Promise.resolve([[], []]),
      execute: () => Promise.resolve([{}]),
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: () => Promise.resolve([[], []]),
        execute: () => Promise.resolve([{}]),
      }),
    },
  };
});

describe("Anti-Replay Protections", () => {
  const token = makeTestToken(1, "admin", "Administrator");

  test("rejects request with missing x-request-nonce on state-changing route", async () => {
    const res = await request(app)
      .post("/protected/admin-check")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nonce/i);
  });

  test("rejects request with missing x-request-timestamp on state-changing route", async () => {
    const res = await request(app)
      .post("/protected/admin-check")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestamp/i);
  });

  test("rejects request with expired timestamp (too old)", async () => {
    const oldTimestamp = (Date.now() - 6 * 60 * 1000).toString();
    const res = await request(app)
      .post("/protected/admin-check")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", oldTimestamp)
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestamp/i);
  });

  test("rejects request with wrong CSRF token", async () => {
    const res = await request(app)
      .post("/protected/admin-check")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", "wrong-csrf-token-value")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/csrf/i);
  });

  test("rejects request with missing CSRF token", async () => {
    const res = await request(app)
      .post("/protected/admin-check")
      .set("Authorization", `Bearer ${token}`)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/csrf/i);
  });

  test("rejects reused nonce (replay attack)", async () => {
    const nonce = crypto.randomUUID();

    const res1 = await request(app)
      .post("/protected/admin-check")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", nonce)
      .send({});

    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post("/protected/admin-check")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", nonce)
      .send({});

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/nonce/i);
  });

  test("accepts request with valid anti-replay headers", async () => {
    const res = await request(app)
      .post("/protected/admin-check")
      .set(authHeaders(token))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("authorized");
  });

  test("rejects request without Authorization header", async () => {
    const res = await request(app)
      .post("/protected/admin-check")
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(401);
  });
});

describe("Anti-Replay on Auth Endpoints", () => {
  const token = makeTestToken(1, "admin", "Administrator");

  test("rejects /auth/refresh without timestamp header", async () => {
    const res = await request(app)
      .post("/auth/refresh")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestamp/i);
  });

  test("rejects /auth/refresh without nonce header", async () => {
    const res = await request(app)
      .post("/auth/refresh")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nonce/i);
  });

  test("rejects /auth/logout without timestamp header", async () => {
    const res = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestamp/i);
  });

  test("rejects /auth/logout with replayed nonce", async () => {
    const jwt = require("jsonwebtoken");
    const nonce = crypto.randomUUID();
    const csrfToken = TEST_CSRF;

    const token1 = jwt.sign(
      { sub: 1, username: "admin", role: "Administrator", csrfToken, jti: crypto.randomUUID() },
      "test_secret",
      { expiresIn: "15m" },
    );

    await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token1}`)
      .set("x-csrf-token", csrfToken)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", nonce)
      .send({});

    const token2 = jwt.sign(
      { sub: 1, username: "admin", role: "Administrator", csrfToken, jti: crypto.randomUUID() },
      "test_secret",
      { expiresIn: "15m" },
    );

    const res = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token2}`)
      .set("x-csrf-token", csrfToken)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", nonce)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/nonce/i);
  });

  test("rejects /auth/refresh with invalid csrf token", async () => {
    const res = await request(app)
      .post("/auth/refresh")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", "invalid-csrf")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/csrf/i);
  });

  test("rejects /auth/logout with invalid csrf token", async () => {
    const res = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .set("x-csrf-token", "invalid-csrf")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/csrf/i);
  });
});
