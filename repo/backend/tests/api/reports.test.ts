import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";
import { makeTestToken, TEST_CSRF } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const AUDITOR_TOKEN = makeTestToken(5, "auditor1", "Auditor");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");

jest.mock("../../src/db/pool", () => {
  type ReportRow = {
    id: number;
    name: string;
    description: string | null;
    created_by: number;
    config: string;
    created_at: Date;
    updated_at: Date;
  };

  const reports: ReportRow[] = [
    {
      id: 1,
      name: "Status Summary",
      description: "By status",
      created_by: 1,
      config: JSON.stringify({ group_by: "status" }),
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-01T00:00:00Z"),
    },
  ];
  let nextId = 2;

  return {
    dbPool: {
      query: (sql: string, params?: unknown[]) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes("from report_definitions where id =")) {
          const id = Number((params ?? [])[0]);
          const row = reports.find((r) => r.id === id);
          return Promise.resolve([row ? [row] : [], []]);
        }
        if (normalized.includes("from report_definitions order by")) {
          return Promise.resolve([reports, []]);
        }
        if (normalized.includes("select status as dimension")) {
          return Promise.resolve([[{ dimension: "New", count: 3 }, { dimension: "Closed", count: 1 }], []]);
        }
        if (normalized.includes("from incidents") && normalized.includes("order by created_at desc")) {
          return Promise.resolve([[{ id: 1, status: "New", type: "Fire", site: "Main Campus" }], []]);
        }
        return Promise.resolve([[], []]);
      },
      execute: (sql: string, params?: unknown[]) => {
        const normalized = sql.toLowerCase();
        if (normalized.startsWith("insert into report_definitions")) {
          const [name, description, createdBy, config] = params as [string, string | null, number, string];
          reports.push({
            id: nextId,
            name,
            description,
            created_by: createdBy,
            config,
            created_at: new Date(),
            updated_at: new Date(),
          });
          const inserted = nextId;
          nextId += 1;
          return Promise.resolve([{ insertId: inserted, affectedRows: 1 }, {}]);
        }
        if (normalized.startsWith("delete from report_definitions")) {
          const id = Number((params ?? [])[0]);
          const idx = reports.findIndex((r) => r.id === id);
          if (idx === -1) {
            return Promise.resolve([{ affectedRows: 0 }, {}]);
          }
          reports.splice(idx, 1);
          return Promise.resolve([{ affectedRows: 1 }, {}]);
        }
        if (normalized.startsWith("insert into audit_logs")) {
          return Promise.resolve([{ affectedRows: 1 }, {}]);
        }
        return Promise.resolve([{ affectedRows: 1 }, {}]);
      },
    },
  };
});

describe("GET /reports", () => {
  test("returns reports for admin", async () => {
    const res = await request(app).get("/reports").set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.reports)).toBe(true);
    expect(res.body.reports[0].name).toBeDefined();
  });

  test("returns reports for auditor", async () => {
    const res = await request(app).get("/reports").set("Authorization", `Bearer ${AUDITOR_TOKEN}`);
    expect(res.status).toBe(200);
  });

  test("rejects reporter with 403", async () => {
    const res = await request(app).get("/reports").set("Authorization", `Bearer ${REPORTER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test("rejects unauthenticated request with 401", async () => {
    const res = await request(app).get("/reports");
    expect(res.status).toBe(401);
  });
});

describe("POST /reports", () => {
  test("creates report for admin with valid payload", async () => {
    const res = await request(app)
      .post("/reports")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        name: "Site Summary",
        description: "By site",
        config: { group_by: "site", status_filter: "New" },
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test("rejects invalid config with 400", async () => {
    const res = await request(app)
      .post("/reports")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        name: "Bad Config",
        config: { group_by: "invalid_group" },
      });
    expect(res.status).toBe(400);
  });

  test("rejects reporter with 403", async () => {
    const res = await request(app)
      .post("/reports")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ name: "x", config: { group_by: "status" } });
    expect(res.status).toBe(403);
  });
});

describe("GET /reports/:id/run", () => {
  test("runs existing report and returns JSON", async () => {
    const res = await request(app).get("/reports/1/run").set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.summary)).toBe(true);
  });

  test("returns CSV output when format=csv", async () => {
    const res = await request(app)
      .get("/reports/1/run")
      .query({ format: "csv" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("dimension,count");
  });

  test("returns 404 for missing report", async () => {
    const res = await request(app).get("/reports/999/run").set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test("returns 400 for invalid report id", async () => {
    const res = await request(app).get("/reports/abc/run").set("Authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /reports/:id", () => {
  test("deletes existing report for admin", async () => {
    const create = await request(app)
      .post("/reports")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ name: "Delete Me", config: { group_by: "status" } });

    const id = create.body.id;
    const res = await request(app)
      .delete(`/reports/${id}`)
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID());
    expect(res.status).toBe(200);
  });

  test("returns 404 for unknown report", async () => {
    const res = await request(app)
      .delete("/reports/999")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .set("x-csrf-token", TEST_CSRF)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID());
    expect(res.status).toBe(404);
  });
});
