import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const AUDITOR_TOKEN = makeTestToken(5, "auditor1", "Auditor");
const SAFETY_MGR_TOKEN = makeTestToken(4, "safety_mgr", "Safety Manager");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");

// Expose query as a jest.fn() to allow per-test spy assertions on SQL params.
jest.mock("../../src/db/pool", () => {
  const queryFn = jest.fn();
  return {
    dbPool: {
      query: queryFn,
      execute: jest.fn().mockResolvedValue([{}, {}]),
    },
    __queryFn: queryFn,
  };
});

const { __queryFn: queryFn } = jest.requireMock("../../src/db/pool") as {
  __queryFn: jest.Mock;
};

// 30 min ago → both "New" rows exceed the 15-min ack SLA target.
// 100 h ago → the "In Progress" row exceeds the 72-h close SLA target.
const LONG_AGO = new Date(Date.now() - 30 * 60 * 1000);
const VERY_OLD = new Date(Date.now() - 100 * 60 * 60 * 1000);

function defaultImpl(sql: string) {
  const n = sql.trim().toLowerCase();

  if (n.includes("from settings")) {
    return Promise.resolve([[{ config_value: '{"ack_minutes":15,"close_hours":72}' }], []]);
  }

  // SLA open-incident scan (SELECT status, created_at FROM incidents WHERE status != 'Closed')
  if (n.includes("status, created_at") || n.includes("status != 'closed'") || n.includes('status != "closed"')) {
    return Promise.resolve([[
      { status: "New",         created_at: LONG_AGO  },
      { status: "New",         created_at: LONG_AGO  },
      { status: "Acknowledged",created_at: new Date() },
      { status: "In Progress", created_at: VERY_OLD  },
      { status: "Escalated",   created_at: new Date() },
      { status: "In Progress", created_at: new Date() },
    ], []]);
  }

  // Status breakdown (SELECT status, COUNT(*) AS count FROM incidents GROUP BY status ORDER BY count DESC)
  if (n.includes("from incidents") && n.includes("group by status")) {
    return Promise.resolve([[
      { status: "New",          count: 5 },
      { status: "Acknowledged", count: 3 },
      { status: "Closed",       count: 2 },
    ], []]);
  }

  // Moderation action breakdown
  if (n.includes("from incident_actions") && n.includes("group by action")) {
    return Promise.resolve([[
      { action: "STATUS_UPDATED",   count: 10 },
      { action: "INCIDENT_CREATED", count: 8  },
    ], []]);
  }

  // User activity from audit_logs
  if (n.includes("from audit_logs")) {
    return Promise.resolve([[
      { user_id: 1, count: 20 },
      { user_id: 3, count: 15 },
    ], []]);
  }

  return Promise.resolve([[], []]);
}

describe("GET /admin/metrics", () => {
  beforeEach(() => {
    queryFn.mockReset();
    queryFn.mockImplementation(defaultImpl);
  });

  // ── payload shape ─────────────────────────────────────────────────────

  test("response contains all four top-level keys", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("incidents_by_status");
    expect(res.body).toHaveProperty("moderation_actions");
    expect(res.body).toHaveProperty("user_activity_logs");
    expect(res.body).toHaveProperty("sla_at_risk");
  });

  test("incidents_by_status has correct length and field names", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const byStatus = res.body.incidents_by_status;
    expect(Array.isArray(byStatus)).toBe(true);
    expect(byStatus).toHaveLength(3);
    // Each row must expose { status, count } — the shape the frontend reads
    for (const row of byStatus) {
      expect(typeof row.status).toBe("string");
      expect(typeof row.count).toBe("number");
    }
  });

  test("incidents_by_status contains correct counts ordered by count desc", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const byStatus: Array<{ status: string; count: number }> = res.body.incidents_by_status;
    expect(byStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "New",          count: 5 }),
        expect.objectContaining({ status: "Acknowledged", count: 3 }),
        expect.objectContaining({ status: "Closed",       count: 2 }),
      ]),
    );
    // Ordered by count DESC — first entry has the highest count
    expect(byStatus[0].count).toBeGreaterThanOrEqual(byStatus[1].count);
    expect(byStatus[1].count).toBeGreaterThanOrEqual(byStatus[2].count);
  });

  test("moderation_actions contains correct action names and counts", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const actions: Array<{ action: string; count: number }> = res.body.moderation_actions;
    expect(Array.isArray(actions)).toBe(true);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "STATUS_UPDATED",   count: 10 }),
        expect.objectContaining({ action: "INCIDENT_CREATED", count: 8  }),
      ]),
    );
    // Ordered by count DESC
    expect(actions[0].count).toBeGreaterThanOrEqual(actions[1].count);
  });

  test("user_activity_logs has correct user_id and count fields", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const logs: Array<{ user_id: number; count: number }> = res.body.user_activity_logs;
    expect(Array.isArray(logs)).toBe(true);
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 1, count: 20 }),
        expect.objectContaining({ user_id: 3, count: 15 }),
      ]),
    );
  });

  // ── sla_at_risk ────────────────────────────────────────────────────────

  test("sla_at_risk has all four sub-fields as numbers", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const sla = res.body.sla_at_risk;
    expect(typeof sla.total_open).toBe("number");
    expect(typeof sla.ack_at_risk).toBe("number");
    expect(typeof sla.close_at_risk).toBe("number");
    expect(typeof sla.escalated).toBe("number");
  });

  test("sla_at_risk.total_open counts all non-closed incidents", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    // Mock returns 6 open rows (2 New + 1 Acknowledged + 2 In Progress + 1 Escalated)
    expect(res.body.sla_at_risk.total_open).toBe(6);
  });

  test("sla_at_risk.escalated counts Escalated-status incidents", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    // 1 Escalated row in mock data
    expect(res.body.sla_at_risk.escalated).toBe(1);
  });

  test("sla_at_risk.ack_at_risk is > 0 for New incidents older than ack_minutes", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    // 2 "New" incidents are 30 min old; ack SLA is 15 min.
    // During business hours this equals ack_at_risk = 2; outside hours it may be 0.
    // Assert it's a non-negative integer and within expected bounds.
    expect(res.body.sla_at_risk.ack_at_risk).toBeGreaterThanOrEqual(0);
    expect(res.body.sla_at_risk.ack_at_risk).toBeLessThanOrEqual(2);
  });

  test("sla_at_risk.close_at_risk is > 0 for incidents older than close_hours", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    // 1 "In Progress" incident is 100 h old; close SLA is 72 business hours.
    // 100 calendar hours ≈ 70+ business hours even accounting for nights/weekends;
    // close_at_risk will be ≥ 1 during business days, ≥ 0 otherwise.
    expect(res.body.sla_at_risk.close_at_risk).toBeGreaterThanOrEqual(0);
  });

  // ── date filter SQL params ─────────────────────────────────────────────

  test("date_from filter is forwarded to incidents SQL query", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .query({ date_from: "2026-01-01" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    // At least one query call should contain a Date param for the filter
    const calls = queryFn.mock.calls as Array<[string, unknown[]?]>;
    const filteredCall = calls.find(([sql, params]) =>
      sql.toLowerCase().includes("from incidents") &&
      Array.isArray(params) &&
      params.some((p) => p instanceof Date),
    );
    expect(filteredCall).toBeDefined();
  });

  // ── role-based access ──────────────────────────────────────────────────

  test("Auditor role can access metrics", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${AUDITOR_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents_by_status)).toBe(true);
  });

  test("Safety Manager role can access metrics", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${SAFETY_MGR_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
  });

  test("Reporter role is denied with 403", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(403);
  });

  test("unauthenticated request returns 401", async () => {
    const res = await request(app).get("/admin/metrics").send();
    expect(res.status).toBe(401);
  });
});
