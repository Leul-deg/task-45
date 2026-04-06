import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");
const AUDITOR_TOKEN = makeTestToken(5, "auditor1", "Auditor");

jest.mock("../../src/db/pool", () => ({
  dbPool: {
    query: (_sql: string, _params?: unknown[]) => {
      const normalized = (_sql as string).trim().toLowerCase();
      if (normalized.includes("from incidents") && normalized.includes("select id")) {
        return Promise.resolve([[
          {
            id: 1, reporter_id: 2, type: "Fire", description: "Warehouse fire",
            site: "Main Campus", time: new Date(), status: "New",
            rating: 3, cost: 1500.00, created_at: new Date(), updated_at: new Date(),
          },
        ], []]);
      }
      if (normalized.includes("status as label")) {
        return Promise.resolve([[
          { label: "New", count: 5 },
          { label: "Closed", count: 3 },
        ], []]);
      }
      if (normalized.includes("action as label")) {
        return Promise.resolve([[
          { label: "STATUS_UPDATED", count: 10 },
        ], []]);
      }
      return Promise.resolve([[], []]);
    },
    execute: () => Promise.resolve([{}, {}]),
  },
}));

describe("GET /export/incidents", () => {
  test("returns CSV for admin", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("ID");
    expect(res.text).toContain("Fire");
  });

  test("returns CSV for auditor", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${AUDITOR_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });

  test("rejects reporter role with 403", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(403);
  });

  test("returns 401 without auth", async () => {
    const res = await request(app).get("/export/incidents").send();
    expect(res.status).toBe(401);
  });

  test("accepts filter params", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .query({ status: "New", date_from: "2026-01-01" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("incidents-export.csv");
  });
});

describe("GET /export/metrics", () => {
  test("returns CSV for admin", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("Metric Group");
  });

  test("rejects reporter role with 403", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(403);
  });
});
