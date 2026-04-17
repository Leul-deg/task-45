/**
 * Frontend API contract tests.
 *
 * The Vue frontend mocks the HTTP client in every component test, so an API
 * shape change (renamed field, restructured payload) would never be caught by
 * the frontend test suite alone.  These tests run the real Express app against
 * a real MySQL instance (TEST_REAL_DB=1) and assert that every endpoint returns
 * the exact field names and types that the Vue components destructure from
 * the Axios response.
 *
 * Each contract assertion is annotated with the Vue file that depends on it.
 */

import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";
import { dbPool } from "../../src/db/pool";

const RUN = !!process.env.TEST_REAL_DB;
const maybeDescribe = RUN ? describe : describe.skip;

// ─── helpers ──────────────────────────────────────────────────────────────

async function loginAs(username: string, password: string) {
  const res = await request(app).post("/auth/login").send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${username} → ${res.status}`);
  return res.body as { access_token: string; csrf_token: string };
}

function stateHeaders(token: string, csrf: string) {
  return {
    Authorization: `Bearer ${token}`,
    "x-csrf-token": csrf,
    "x-request-timestamp": Date.now().toString(),
    "x-request-nonce": crypto.randomUUID(),
  };
}

async function deleteIncidents(ids: number[]) {
  if (ids.length === 0) return;
  const ph = ids.map(() => "?").join(", ");
  await dbPool.execute(`DELETE FROM incident_actions WHERE incident_id IN (${ph})`, ids);
  await dbPool.execute(`DELETE FROM incidents WHERE id IN (${ph})`, ids);
}

// ─── POST /auth/login ─────────────────────────────────────────────────────
// Consumed by: frontend/src/views/Login.vue
//   session.accessToken  = res.data.access_token
//   session.csrfToken    = res.data.csrf_token
//   session.expiresAt    = Date.now() + res.data.expires_in * 1000
//   session.user         = res.data.user  (needs id, username, role)

maybeDescribe("Contract: POST /auth/login", () => {
  test("response contains access_token (string)", async () => {
    const res = await request(app).post("/auth/login").send({ username: "admin", password: "admin123" });
    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
    expect(res.body.access_token.length).toBeGreaterThan(0);
  });

  test("response contains csrf_token (string)", async () => {
    const res = await request(app).post("/auth/login").send({ username: "admin", password: "admin123" });
    expect(res.status).toBe(200);
    expect(typeof res.body.csrf_token).toBe("string");
    expect(res.body.csrf_token.length).toBeGreaterThan(0);
  });

  test("response contains expires_in (number, seconds)", async () => {
    const res = await request(app).post("/auth/login").send({ username: "admin", password: "admin123" });
    expect(res.status).toBe(200);
    expect(typeof res.body.expires_in).toBe("number");
    expect(res.body.expires_in).toBe(900); // 15 minutes
  });

  test("response.user contains id, username, role", async () => {
    const res = await request(app).post("/auth/login").send({ username: "reporter1", password: "reporter123" });
    expect(res.status).toBe(200);
    expect(typeof res.body.user.id).toBe("number");
    expect(typeof res.body.user.username).toBe("string");
    expect(typeof res.body.user.role).toBe("string");
    expect(res.body.user.username).toBe("reporter1");
    expect(res.body.user.role).toBe("Reporter");
  });
});

// ─── GET /settings/config ─────────────────────────────────────────────────
// Consumed by:
//   Triage.vue    → sla_defaults.ack_minutes, sla_defaults.close_hours
//   ReportIncident.vue → incident_types[], facility_sites[]
//   Admin.vue     → sla_defaults, incident_types, sla_rules

maybeDescribe("Contract: GET /settings/config", () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = (await loginAs("admin", "admin123")).access_token;
  });

  test("response contains sla_defaults with ack_minutes and close_hours (numbers)", async () => {
    const res = await request(app)
      .get("/settings/config")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(typeof res.body.sla_defaults).toBe("object");
    expect(typeof res.body.sla_defaults.ack_minutes).toBe("number");
    expect(typeof res.body.sla_defaults.close_hours).toBe("number");
  });

  test("response contains incident_types as a non-empty string array", async () => {
    const res = await request(app)
      .get("/settings/config")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incident_types)).toBe(true);
    expect(res.body.incident_types.length).toBeGreaterThan(0);
    expect(typeof res.body.incident_types[0]).toBe("string");
  });

  test("response contains facility_sites as a string array", async () => {
    const res = await request(app)
      .get("/settings/config")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.facility_sites)).toBe(true);
  });

  test("response contains sla_rules as an array", async () => {
    const res = await request(app)
      .get("/settings/config")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sla_rules)).toBe(true);
  });
});

maybeDescribe("Contract: GET /settings/config role-filtered payloads", () => {
  test("Reporter response includes only incident_types and facility_sites", async () => {
    const token = (await loginAs("reporter1", "reporter123")).access_token;
    const res = await request(app).get("/settings/config").set("Authorization", `Bearer ${token}`).send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incident_types)).toBe(true);
    expect(Array.isArray(res.body.facility_sites)).toBe(true);
    expect(res.body.sla_defaults).toBeUndefined();
    expect(res.body.severity_rules).toBeUndefined();
  });

  test("Dispatcher receives sla_defaults and empty severity_rules", async () => {
    const token = (await loginAs("dispatcher1", "dispatcher123")).access_token;
    const res = await request(app).get("/settings/config").set("Authorization", `Bearer ${token}`).send();

    expect(res.status).toBe(200);
    expect(typeof res.body.sla_defaults.ack_minutes).toBe("number");
    expect(typeof res.body.sla_defaults.close_hours).toBe("number");
    expect(Array.isArray(res.body.severity_rules)).toBe(true);
    expect(res.body.severity_rules).toHaveLength(0);
  });
});

// ─── GET /incidents (list) ────────────────────────────────────────────────
// Consumed by: Triage.vue, Search.vue
//   res.data.results  (search uses /search/incidents)
//   res.data.incidents, res.data.total, res.data.page, res.data.limit

maybeDescribe("Contract: GET /incidents list shape", () => {
  let dispatcherToken: string;

  beforeAll(async () => {
    dispatcherToken = (await loginAs("dispatcher1", "dispatcher123")).access_token;
  });

  test("response contains incidents array, total, page, and limit", async () => {
    const res = await request(app)
      .get("/incidents")
      .set("Authorization", `Bearer ${dispatcherToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.page).toBe("number");
    expect(typeof res.body.limit).toBe("number");
  });

  test("each list row exposes id, type, site, status, reporter_id without description", async () => {
    const createdIds: number[] = [];
    const reporter = await loginAs("reporter1", "reporter123");
    const r = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporter.access_token, reporter.csrf_token))
      .send({ type: "Injury", description: "Contract list test", site: "Main Campus", time: new Date().toISOString() });
    if (r.status === 201) createdIds.push(r.body.id);

    const res = await request(app)
      .get("/incidents")
      .set("Authorization", `Bearer ${dispatcherToken}`)
      .send();

    expect(res.status).toBe(200);
    if (res.body.incidents.length > 0) {
      const row = res.body.incidents[0];
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("type");
      expect(row).toHaveProperty("site");
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("reporter_id");
      // description is intentionally excluded from list rows
      expect(row).not.toHaveProperty("description");
    }

    await deleteIncidents(createdIds);
  });
});

// ─── GET /incidents/:id (detail) ──────────────────────────────────────────
// Consumed by: Triage.vue (inline detail), ReportIncident.vue (confirmation)
//   res.data.id, .type, .site, .status, .description
//   res.data.collaborators[], res.data.actions[], res.data.images[]

maybeDescribe("Contract: GET /incidents/:id detail shape", () => {
  const createdIds: number[] = [];
  let reporterSession: { access_token: string; csrf_token: string };
  let incidentId: number;

  beforeAll(async () => {
    reporterSession = await loginAs("reporter1", "reporter123");
    const r = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporterSession.access_token, reporterSession.csrf_token))
      .send({ type: "Fire", description: "Detail contract test incident", site: "Warehouse A", time: new Date().toISOString() });
    if (r.status === 201) {
      incidentId = r.body.id;
      createdIds.push(incidentId);
    }
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("detail response contains all expected scalar fields", async () => {
    const res = await request(app)
      .get(`/incidents/${incidentId}`)
      .set("Authorization", `Bearer ${reporterSession.access_token}`)
      .send();

    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe("number");
    expect(typeof res.body.type).toBe("string");
    expect(typeof res.body.site).toBe("string");
    expect(typeof res.body.status).toBe("string");
    expect(typeof res.body.description).toBe("string");
    expect(typeof res.body.reporter_id).toBe("number");
  });

  test("detail response contains collaborators, actions, images as arrays", async () => {
    const res = await request(app)
      .get(`/incidents/${incidentId}`)
      .set("Authorization", `Bearer ${reporterSession.access_token}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.collaborators)).toBe(true);
    expect(Array.isArray(res.body.actions)).toBe(true);
    expect(Array.isArray(res.body.images)).toBe(true);
  });
});

// ─── PATCH /incidents/:id/status ─────────────────────────────────────────
// Consumed by: Triage.vue
//   http.patch("/incidents/${id}/status", { status, triage_notes, collaborators })
//   → res.data.id, res.data.status

maybeDescribe("Contract: PATCH /incidents/:id/status response shape", () => {
  const createdIds: number[] = [];
  let dispatcherSession: { access_token: string; csrf_token: string };
  let incidentId: number;

  beforeAll(async () => {
    dispatcherSession = await loginAs("dispatcher1", "dispatcher123");
    const reporter = await loginAs("reporter1", "reporter123");
    const r = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporter.access_token, reporter.csrf_token))
      .send({ type: "Injury", description: "Status contract test", site: "Main Campus", time: new Date().toISOString() });
    if (r.status === 201) {
      incidentId = r.body.id;
      createdIds.push(incidentId);
    }
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("status update response contains id (number) and status (string)", async () => {
    const res = await request(app)
      .patch(`/incidents/${incidentId}/status`)
      .set(stateHeaders(dispatcherSession.access_token, dispatcherSession.csrf_token))
      .send({ status: "Acknowledged", triage_notes: "Contract check", collaborators: [] });

    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe("number");
    expect(typeof res.body.status).toBe("string");
    expect(res.body.id).toBe(incidentId);
    expect(res.body.status).toBe("Acknowledged");
  });

  test("status update response contains collaborators array", async () => {
    const res = await request(app)
      .patch(`/incidents/${incidentId}/status`)
      .set(stateHeaders(dispatcherSession.access_token, dispatcherSession.csrf_token))
      .send({ status: "Escalated", triage_notes: "", collaborators: [] });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.collaborators)).toBe(true);
  });
});

// ─── GET /search/incidents ────────────────────────────────────────────────
// Consumed by: Search.vue, Triage.vue
//   res.data.results  → each row needs id, site, type, status, reporter_id
//   res.data.count, res.data.filters, res.data.sort

maybeDescribe("Contract: GET /search/incidents response shape", () => {
  const createdIds: number[] = [];
  let adminToken: string;

  beforeAll(async () => {
    adminToken = (await loginAs("admin", "admin123")).access_token;
    const reporter = await loginAs("reporter1", "reporter123");
    const r = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporter.access_token, reporter.csrf_token))
      .send({ type: "Fire", description: "Search contract incident", site: "Warehouse B", time: new Date().toISOString() });
    if (r.status === 201) createdIds.push(r.body.id);
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("response contains count (number), results (array), filters (object), sort (string)", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe("number");
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(typeof res.body.filters).toBe("object");
    expect(typeof res.body.sort).toBe("string");
  });

  test("each result row exposes id, site, type, status, reporter_id, relevance_score", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ sort: "recent_activity", limit: 1 })
      .send();

    expect(res.status).toBe(200);
    if (res.body.results.length > 0) {
      const row = res.body.results[0];
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("site");
      expect(row).toHaveProperty("type");
      expect(row).toHaveProperty("status");
      expect(row).toHaveProperty("reporter_id");
      expect(row).toHaveProperty("relevance_score");
    }
  });

  test("filters object echoes back sent query params", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ site: "Warehouse B", status: "New", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.site).toBe("Warehouse B");
    expect(res.body.filters.status).toBe("New");
  });
});

// ─── GET /admin/metrics ───────────────────────────────────────────────────
// Consumed by: Admin.vue
//   res.data.incidents_by_status  → [{status, count}]
//   res.data.sla_at_risk          → {ack_at_risk, close_at_risk, escalated, total_open}

maybeDescribe("Contract: GET /admin/metrics response shape", () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = (await loginAs("admin", "admin123")).access_token;
  });

  test("incidents_by_status rows have status (string) and count (number)", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents_by_status)).toBe(true);
    for (const row of res.body.incidents_by_status) {
      expect(typeof row.status).toBe("string");
      expect(typeof row.count).toBe("number");
    }
  });

  test("moderation_actions rows have action (string) and count (number)", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.moderation_actions)).toBe(true);
    for (const row of res.body.moderation_actions) {
      expect(typeof row.action).toBe("string");
      expect(typeof row.count).toBe("number");
    }
  });

  test("sla_at_risk has ack_at_risk, close_at_risk, escalated, total_open as numbers", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    const sla = res.body.sla_at_risk;
    expect(typeof sla.ack_at_risk).toBe("number");
    expect(typeof sla.close_at_risk).toBe("number");
    expect(typeof sla.escalated).toBe("number");
    expect(typeof sla.total_open).toBe("number");
  });

  test("user_activity_logs rows have user_id and count", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.user_activity_logs)).toBe(true);
    for (const row of res.body.user_activity_logs) {
      expect(typeof row.count).toBe("number");
      // user_id may be null for anonymous actions
      expect(row).toHaveProperty("user_id");
    }
  });
});

// ─── GET /search/resources ────────────────────────────────────────────────
// Consumed by: Resources.vue
//   res.data.results → [{id, title, category, description, url, tags[], relevance_score}]
//   res.data.count, res.data.total

maybeDescribe("Contract: GET /search/resources response shape", () => {
  let reporterToken: string;

  beforeAll(async () => {
    reporterToken = (await loginAs("reporter1", "reporter123")).access_token;
  });

  test("response contains count, total, results array", async () => {
    const res = await request(app)
      .get("/search/resources")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe("number");
    expect(typeof res.body.total).toBe("number");
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  test("each resource result has id, title, category, description, tags, price, rating, popularity, relevance_score", async () => {
    const res = await request(app)
      .get("/search/resources")
      .set("Authorization", `Bearer ${reporterToken}`)
      .send();

    expect(res.status).toBe(200);
    // Seed data loads 8 resources — at least one should be present
    expect(res.body.results.length).toBeGreaterThan(0);
    const row = res.body.results[0];
    expect(typeof row.id).toBe("number");
    expect(typeof row.title).toBe("string");
    expect(typeof row.category).toBe("string");
    expect(typeof row.description).toBe("string");
    expect(Array.isArray(row.tags)).toBe(true);
    expect(row).toHaveProperty("price");
    expect(row).toHaveProperty("rating");
    expect(row).toHaveProperty("popularity");
    expect(row).toHaveProperty("updated_at");
    expect(typeof row.relevance_score).toBe("number");
  });
});
