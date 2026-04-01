import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");
const MANAGER_TOKEN = makeTestToken(4, "safety_mgr", "Safety Manager");

jest.mock("../../src/db/pool", () => ({
  dbPool: {
    query: (_sql: string, _params?: unknown) => {
      const settings = [
        { config_key: "sla_defaults", config_value: '{"ack_minutes":15,"close_hours":72}' },
        { config_key: "incident_types", config_value: '["Injury","Fire","Spill"]' },
        { config_key: "sla_rules", config_value: "[]" },
      ];
      return Promise.resolve([settings, []]);
    },
    execute: (_sql: string, _params?: unknown) => Promise.resolve([{}, {}]),
  },
}));

describe("GET /settings/config", () => {
  test("returns SLA defaults and incident types", async () => {
    const res = await request(app)
      .get("/settings/config")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.sla_defaults.ack_minutes).toBe(15);
    expect(res.body.sla_defaults.close_hours).toBe(72);
    expect(Array.isArray(res.body.incident_types)).toBe(true);
  });

  test("returns 401 without auth", async () => {
    const res = await request(app).get("/settings/config").send();
    expect(res.status).toBe(401);
  });
});

describe("PATCH /settings/sla", () => {
  test("Safety Manager can update SLA", async () => {
    const res = await request(app)
      .patch("/settings/sla")
      .set("Authorization", `Bearer ${MANAGER_TOKEN}`)
      .set("x-csrf-token", "abcd1234efgh5678ijkl9012mnop3456")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ ack_minutes: 30, close_hours: 48 });

    expect(res.status).toBe(200);
    expect(res.body.settings.ack_minutes).toBe(30);
  });

  test("Reporter role returns 403", async () => {
    const res = await request(app)
      .patch("/settings/sla")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .set("x-csrf-token", "abcd1234efgh5678ijkl9012mnop3456")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ ack_minutes: 20, close_hours: 60 });

    expect(res.status).toBe(403);
  });

  test("requires security headers", async () => {
    const res = await request(app)
      .patch("/settings/sla")
      .set("Authorization", `Bearer ${MANAGER_TOKEN}`)
      .send({ ack_minutes: 20 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestamp|nonce|csrf/i);
  });
});

describe("PATCH /settings/incident-types", () => {
  test("empty array returns 400", async () => {
    const res = await request(app)
      .patch("/settings/incident-types")
      .set("Authorization", `Bearer ${MANAGER_TOKEN}`)
      .set("x-csrf-token", "abcd1234efgh5678ijkl9012mnop3456")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ incident_types: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("at least one");
  });

  test("valid update returns 200", async () => {
    const res = await request(app)
      .patch("/settings/incident-types")
      .set("Authorization", `Bearer ${MANAGER_TOKEN}`)
      .set("x-csrf-token", "abcd1234efgh5678ijkl9012mnop3456")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ incident_types: ["Injury", "Fire", "Near Miss"] });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incident_types)).toBe(true);
  });
});

describe("PATCH /settings/severity-rules", () => {
  test("Safety Manager can set valid severity rules", async () => {
    const res = await request(app)
      .patch("/settings/severity-rules")
      .set("Authorization", `Bearer ${MANAGER_TOKEN}`)
      .set("x-csrf-token", "abcd1234efgh5678ijkl9012mnop3456")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        rules: [
          { incident_type: "Injury", severity: "high", auto_escalate: true, escalate_after_hours: 24 },
          { incident_type: "Near Miss", severity: "low", auto_escalate: false },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.rules).toHaveLength(2);
    expect(res.body.rules[0].severity).toBe("high");
  });

  test("rejects rules with invalid severity value", async () => {
    const res = await request(app)
      .patch("/settings/severity-rules")
      .set("Authorization", `Bearer ${MANAGER_TOKEN}`)
      .set("x-csrf-token", "abcd1234efgh5678ijkl9012mnop3456")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        rules: [
          { incident_type: "Injury", severity: "extreme", auto_escalate: false },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("severity");
  });

  test("rejects rules missing incident_type", async () => {
    const res = await request(app)
      .patch("/settings/severity-rules")
      .set("Authorization", `Bearer ${MANAGER_TOKEN}`)
      .set("x-csrf-token", "abcd1234efgh5678ijkl9012mnop3456")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        rules: [
          { severity: "high", auto_escalate: false },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("incident_type");
  });

  test("Reporter role returns 403", async () => {
    const res = await request(app)
      .patch("/settings/severity-rules")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .set("x-csrf-token", "abcd1234efgh5678ijkl9012mnop3456")
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({ rules: [] });

    expect(res.status).toBe(403);
  });
});
