import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");
const AUDITOR_TOKEN = makeTestToken(5, "auditor1", "Auditor");

jest.mock("../../src/db/pool", () => ({
  dbPool: {
    query: (_sql: string, _params?: unknown) => {
      const normalized = (_sql as string).trim().toLowerCase();
      if (normalized.includes("from settings")) {
        return Promise.resolve([[
          { config_value: '{"ack_minutes":15,"close_hours":72}' },
        ], []]);
      }
      if (normalized.includes("select status, created_at from incidents")) {
        const longAgo = new Date(Date.now() - 30 * 60 * 1000);
        const veryOld = new Date(Date.now() - 100 * 60 * 60 * 1000);
        return Promise.resolve([[
          { status: "New", created_at: longAgo },
          { status: "New", created_at: longAgo },
          { status: "Acknowledged", created_at: new Date() },
          { status: "In Progress", created_at: veryOld },
          { status: "Escalated", created_at: new Date() },
          { status: "In Progress", created_at: new Date() },
        ], []]);
      }
      if (normalized.includes("status") && normalized.includes("from incidents")) {
        return Promise.resolve([[
          { status: "New", count: 5 },
          { status: "Acknowledged", count: 3 },
          { status: "Closed", count: 2 },
        ], []]);
      }
      if (normalized.includes("action") && normalized.includes("from incident_actions")) {
        return Promise.resolve([[
          { action: "STATUS_UPDATED", count: 10 },
          { action: "INCIDENT_CREATED", count: 8 },
        ], []]);
      }
      if (normalized.includes("audit_logs") || normalized.includes("user_id")) {
        return Promise.resolve([[
          { user_id: 1, count: 20 },
          { user_id: 3, count: 15 },
        ], []]);
      }
      return Promise.resolve([[], []]);
    },
    execute: () => Promise.resolve([{}, {}]),
  },
}));

describe("GET /admin/metrics", () => {
  test("admin gets incidents_by_status, moderation_actions, user_activity_logs", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents_by_status)).toBe(true);
    expect(Array.isArray(res.body.moderation_actions)).toBe(true);
    expect(Array.isArray(res.body.user_activity_logs)).toBe(true);
    expect(res.body.incidents_by_status[0].status).toBeDefined();
    expect(res.body.sla_at_risk).toBeDefined();
    expect(res.body.sla_at_risk.total_open).toBe(6);
    expect(res.body.sla_at_risk.escalated).toBe(1);
  });

  test("auditor also gets metrics", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${AUDITOR_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
  });

  test("returns 401 without auth", async () => {
    const res = await request(app).get("/admin/metrics").send();
    expect(res.status).toBe(401);
  });

  test("Reporter role returns 403", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(403);
  });
});
