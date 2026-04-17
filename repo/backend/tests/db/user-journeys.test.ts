/**
 * User journey tests.
 *
 * Each suite replays the sequence of HTTP calls a Vue component makes for a
 * specific user role.  The goal is to catch regressions that unit/API tests
 * miss because every frontend component test mocks the HTTP client — a field
 * rename or response restructure goes undetected there.
 *
 * Requires TEST_REAL_DB=1 and a live MySQL instance (provided by the
 * backend-realdb-test Docker Compose service).
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
  if (res.status !== 200) {
    throw new Error(`login failed: ${username} → ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { access_token: string; csrf_token: string };
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
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
  await dbPool.execute(`DELETE FROM incident_collaborators WHERE incident_id IN (${ph})`, ids);
  await dbPool.execute(`DELETE FROM images WHERE incident_id IN (${ph})`, ids);
  await dbPool.execute(`DELETE FROM incidents WHERE id IN (${ph})`, ids);
}

// ─── Reporter journey ──────────────────────────────────────────────────────
//
// Mirrors the call sequence in:
//   Login.vue          → POST /auth/login
//   useSettings.ts     → GET  /settings/config   (to populate type/site dropdowns)
//   IncidentForm.vue   → POST /incidents
//   IncidentDetail.vue → GET  /incidents/:id
//   IncidentList.vue   → GET  /incidents          (scoped to own incidents)

maybeDescribe("User journey: Reporter", () => {
  const createdIds: number[] = [];
  let session: { access_token: string; csrf_token: string };

  beforeAll(async () => {
    session = await loginAs("reporter1", "reporter123");
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("step 1 — login returns access_token, csrf_token, and user object", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "reporter1", password: "reporter123" });

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
    expect(typeof res.body.csrf_token).toBe("string");
    expect(res.body.user.role).toBe("Reporter");
    expect(typeof res.body.user.id).toBe("number");
  });

  test("step 2 — settings/config provides incident_types and facility_sites for form dropdowns", async () => {
    const res = await request(app)
      .get("/settings/config")
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incident_types)).toBe(true);
    expect(res.body.incident_types.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.facility_sites)).toBe(true);
    expect(res.body.facility_sites.length).toBeGreaterThan(0);
  });

  test("step 3 — Reporter submits a new incident using valid type and site from settings", async () => {
    // First fetch valid type/site values from settings
    const settingsRes = await request(app)
      .get("/settings/config")
      .set(authHeader(session.access_token))
      .send();

    const type: string = settingsRes.body.incident_types[0];
    const site: string = settingsRes.body.facility_sites[0];

    const res = await request(app)
      .post("/incidents")
      .set(stateHeaders(session.access_token, session.csrf_token))
      .send({
        type,
        description: "Journey test: reporter submits incident via form",
        site,
        time: new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("New");
    expect(typeof res.body.id).toBe("number");
    expect(typeof res.body.within_goal).toBe("boolean");
    createdIds.push(res.body.id);
  });

  test("step 4 — IncidentDetail.vue fields are present on GET /incidents/:id", async () => {
    const id = createdIds[0];
    const res = await request(app)
      .get(`/incidents/${id}`)
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    // Scalar fields the Vue detail view destructures
    expect(typeof res.body.id).toBe("number");
    expect(typeof res.body.type).toBe("string");
    expect(typeof res.body.description).toBe("string");
    expect(typeof res.body.site).toBe("string");
    expect(typeof res.body.status).toBe("string");
    // Array fields rendered in the detail view tabs
    expect(Array.isArray(res.body.collaborators)).toBe(true);
    expect(Array.isArray(res.body.actions)).toBe(true);
    expect(Array.isArray(res.body.images)).toBe(true);
  });

  test("step 5 — IncidentList.vue list is scoped: Reporter only sees own incidents", async () => {
    const res = await request(app)
      .get("/incidents")
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.page).toBe("number");
    expect(typeof res.body.limit).toBe("number");

    // Every row must belong to the authenticated reporter
    const reporterRes = await request(app)
      .post("/auth/login")
      .send({ username: "reporter1", password: "reporter123" });
    const reporterId: number = reporterRes.body.user.id;
    for (const inc of res.body.incidents) {
      expect(inc.reporter_id).toBe(reporterId);
    }
  });

  test("step 5b — list rows do not expose description (detail-only field)", async () => {
    const res = await request(app)
      .get("/incidents")
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    for (const inc of res.body.incidents) {
      expect(inc).not.toHaveProperty("description");
    }
  });
});

// ─── Dispatcher journey ────────────────────────────────────────────────────
//
// Mirrors the call sequence in:
//   Login.vue             → POST /auth/login
//   IncidentQueue.vue     → GET  /incidents          (full queue, no scope)
//   IncidentDetail.vue    → GET  /incidents/:id      (view detail before triage)
//   StatusUpdateForm.vue  → PATCH /incidents/:id/status
//   IncidentDetail.vue    → GET  /incidents/:id      (re-fetch to confirm change)

maybeDescribe("User journey: Dispatcher", () => {
  const createdIds: number[] = [];
  let reporterSession: { access_token: string; csrf_token: string };
  let dispatcherSession: { access_token: string; csrf_token: string };
  let incidentId: number;

  beforeAll(async () => {
    [reporterSession, dispatcherSession] = await Promise.all([
      loginAs("reporter1", "reporter123"),
      loginAs("dispatcher1", "dispatcher123"),
    ]);

    // Create an incident via Reporter so Dispatcher has something to triage
    const settingsRes = await request(app)
      .get("/settings/config")
      .set(authHeader(reporterSession.access_token))
      .send();
    const type: string = settingsRes.body.incident_types[0];
    const site: string = settingsRes.body.facility_sites[0];

    const createRes = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporterSession.access_token, reporterSession.csrf_token))
      .send({
        type,
        description: "Journey test: dispatcher triage flow",
        site,
        time: new Date().toISOString(),
      });
    if (createRes.status !== 201) {
      throw new Error(`setup: incident creation failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
    }
    incidentId = createRes.body.id;
    createdIds.push(incidentId);
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("step 1 — Dispatcher login returns correct role", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "dispatcher1", password: "dispatcher123" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("Dispatcher");
  });

  test("step 2 — Dispatcher sees full queue (not scoped to own incidents)", async () => {
    const res = await request(app)
      .get("/incidents")
      .set(authHeader(dispatcherSession.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents)).toBe(true);
    // Queue must include incidents from other reporters
    const ids = res.body.incidents.map((i: { id: number }) => i.id);
    expect(ids).toContain(incidentId);
  });

  test("step 3 — Dispatcher views incident detail before triaging", async () => {
    const res = await request(app)
      .get(`/incidents/${incidentId}`)
      .set(authHeader(dispatcherSession.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(incidentId);
    expect(res.body.status).toBe("New");
  });

  test("step 4 — Dispatcher transitions incident New → Acknowledged", async () => {
    const res = await request(app)
      .patch(`/incidents/${incidentId}/status`)
      .set(stateHeaders(dispatcherSession.access_token, dispatcherSession.csrf_token))
      .send({ status: "Acknowledged", triage_notes: "Reviewed on-site", collaborators: [] });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(incidentId);
    expect(res.body.status).toBe("Acknowledged");
    expect(Array.isArray(res.body.collaborators)).toBe(true);
  });

  test("step 5 — Re-fetch confirms status persisted in DB", async () => {
    const res = await request(app)
      .get(`/incidents/${incidentId}`)
      .set(authHeader(dispatcherSession.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Acknowledged");
    // actions log must record the transition
    const statusAction = res.body.actions.find(
      (a: { action: string }) => a.action === "STATUS_UPDATED",
    );
    expect(statusAction).toBeDefined();
  });

  test("step 5b — Dispatcher can filter queue by status to focus triage work", async () => {
    const res = await request(app)
      .get("/incidents")
      .query({ status: "Acknowledged" })
      .set(authHeader(dispatcherSession.access_token))
      .send();

    expect(res.status).toBe(200);
    for (const inc of res.body.incidents) {
      expect(inc.status).toBe("Acknowledged");
    }
    const ids = res.body.incidents.map((i: { id: number }) => i.id);
    expect(ids).toContain(incidentId);
  });
});

// ─── Admin journey ─────────────────────────────────────────────────────────
//
// Mirrors the call sequence in:
//   Login.vue       → POST /auth/login
//   AdminPanel.vue  → GET  /admin/metrics
//   ExportPage.vue  → GET  /export/incidents   (CSV download)
//   ExportPage.vue  → GET  /export/metrics     (CSV download)
//   SearchPage.vue  → GET  /search/incidents   (keyword search)

maybeDescribe("User journey: Admin", () => {
  let session: { access_token: string; csrf_token: string };
  const createdIds: number[] = [];

  beforeAll(async () => {
    session = await loginAs("admin", "admin123");
    // Seed one incident so metrics/export endpoints have data to aggregate.
    const reporter = await loginAs("reporter1", "reporter123");
    const r = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporter.access_token, reporter.csrf_token))
      .send({
        type: "Injury",
        description: "Admin journey seed incident",
        site: "Main Campus",
        time: new Date().toISOString(),
      });
    if (r.status === 201) createdIds.push(r.body.id);
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("step 1 — Admin login returns Administrator role", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin", password: "admin123" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("Administrator");
  });

  test("step 2 — GET /admin/metrics returns all four top-level keys with correct types", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);

    // AdminPanel.vue reads these keys
    expect(Array.isArray(res.body.incidents_by_status)).toBe(true);
    expect(Array.isArray(res.body.moderation_actions)).toBe(true);
    expect(Array.isArray(res.body.user_activity_logs)).toBe(true);
    expect(typeof res.body.sla_at_risk).toBe("object");

    const sla = res.body.sla_at_risk;
    expect(typeof sla.total_open).toBe("number");
    expect(typeof sla.ack_at_risk).toBe("number");
    expect(typeof sla.close_at_risk).toBe("number");
    expect(typeof sla.escalated).toBe("number");
  });

  test("step 2b — incidents_by_status rows have { status, count } shape", async () => {
    const res = await request(app)
      .get("/admin/metrics")
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    for (const row of res.body.incidents_by_status) {
      expect(typeof row.status).toBe("string");
      expect(typeof row.count).toBe("number");
    }
  });

  test("step 3 — GET /export/incidents returns text/csv with expected header", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("incidents-export.csv");

    const headerLine = res.text.split("\n")[0];
    expect(headerLine).toBe(
      "ID,Reporter ID,Type,Description,Site,Time,Status,Rating,Cost,Created At,Updated At",
    );
  });

  test("step 4 — GET /export/metrics returns text/csv with Metric Group header", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("metrics-export.csv");

    const headerLine = res.text.split("\n")[0];
    expect(headerLine).toBe("Metric Group,Dimension,Count");
  });

  test("step 4b — metrics CSV contains incidents_by_status section", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toContain("incidents_by_status");
  });

  test("step 5 — GET /search/incidents returns count, results array, and relevance_score per row", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .query({ q: "injury" })
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe("number");
    expect(Array.isArray(res.body.results)).toBe(true);

    for (const row of res.body.results) {
      expect(typeof row.relevance_score).toBe("number");
      expect(typeof row.id).toBe("number");
    }
  });

  test("step 5b — search respects status filter and returns only matching rows", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .query({ status: "New" })
      .set(authHeader(session.access_token))
      .send();

    expect(res.status).toBe(200);
    for (const row of res.body.results) {
      expect(row.status).toBe("New");
    }
  });

});
