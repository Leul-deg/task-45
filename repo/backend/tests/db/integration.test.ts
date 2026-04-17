/**
 * Real-DB integration tests.
 *
 * These tests connect to a live MySQL instance and are only executed when
 * TEST_REAL_DB=1 is set in the environment.  The docker-compose.test.yml
 * backend-realdb-test service sets this variable and wires DB_* vars to the
 * db-test container, so the tests run against a freshly seeded database.
 *
 * When TEST_REAL_DB is absent (standard unit/api test runs) every suite is
 * skipped and the pool is never touched.
 *
 * Idempotency: each suite tracks the IDs of incidents it creates and deletes
 * them in afterAll, so suites don't bleed state into one another within a
 * single Docker container session.
 */

import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";
import { dbPool } from "../../src/db/pool";

const RUN = !!process.env.TEST_REAL_DB;
const maybeDescribe = RUN ? describe : describe.skip;

// ─── helpers ──────────────────────────────────────────────────────────────

async function login(username: string, password: string) {
  const res = await request(app).post("/auth/login").send({ username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
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
  const placeholders = ids.map(() => "?").join(", ");
  await dbPool.execute(`DELETE FROM incident_actions WHERE incident_id IN (${placeholders})`, ids);
  await dbPool.execute(`DELETE FROM incident_collaborators WHERE incident_id IN (${placeholders})`, ids);
  await dbPool.execute(`DELETE FROM images WHERE incident_id IN (${placeholders})`, ids);
  await dbPool.execute(`DELETE FROM incidents WHERE id IN (${placeholders})`, ids);
}

// ─── auth ─────────────────────────────────────────────────────────────────

maybeDescribe("Real-DB: authentication", () => {
  test("seeded admin user can log in and receives a JWT", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin", password: "admin123" });

    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe("string");
    expect(res.body.user.role).toBe("Administrator");
    expect(res.body.expires_in).toBe(900);
  });

  test("wrong password returns 401", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin", password: "wrongpassword" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  test("missing fields return 400", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "admin" });

    expect(res.status).toBe(400);
  });

  test("logout revokes token — subsequent refresh returns 401", async () => {
    const { access_token, csrf_token } = await login("admin", "admin123");

    const logoutRes = await request(app)
      .post("/auth/logout")
      .set(stateHeaders(access_token, csrf_token))
      .send();

    expect(logoutRes.status).toBe(200);

    // After revocation a refresh attempt must fail
    const refreshRes = await request(app)
      .post("/auth/refresh")
      .set(stateHeaders(access_token, csrf_token))
      .send();

    expect(refreshRes.status).toBe(401);
  });
});

// ─── settings ─────────────────────────────────────────────────────────────

maybeDescribe("Real-DB: settings", () => {
  test("GET /settings/config returns seeded SLA defaults", async () => {
    const { access_token } = await login("admin", "admin123");

    const res = await request(app)
      .get("/settings/config")
      .set("Authorization", `Bearer ${access_token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.sla_defaults).toBeDefined();
    expect(res.body.sla_defaults.ack_minutes).toBe(15);
    expect(res.body.sla_defaults.close_hours).toBe(72);
  });

  test("GET /settings/config returns seeded incident types", async () => {
    const { access_token } = await login("admin", "admin123");

    const res = await request(app)
      .get("/settings/config")
      .set("Authorization", `Bearer ${access_token}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incident_types)).toBe(true);
    expect(res.body.incident_types).toContain("Injury");
    expect(res.body.incident_types).toContain("Fire");
  });

  test("GET /settings/config returns seeded facility sites", async () => {
    const { access_token } = await login("admin", "admin123");

    const res = await request(app)
      .get("/settings/config")
      .set("Authorization", `Bearer ${access_token}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.facility_sites)).toBe(true);
    expect(res.body.facility_sites).toContain("Main Campus");
    expect(res.body.facility_sites).toContain("Warehouse A");
  });
});

// ─── full incident lifecycle ───────────────────────────────────────────────

maybeDescribe("Real-DB: full incident lifecycle", () => {
  const createdIds: number[] = [];
  let reporterSession: { access_token: string; csrf_token: string };
  let dispatcherSession: { access_token: string; csrf_token: string };

  beforeAll(async () => {
    [reporterSession, dispatcherSession] = await Promise.all([
      login("reporter1", "reporter123"),
      login("dispatcher1", "dispatcher123"),
    ]);
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("Reporter can create an incident and receives within_goal flag", async () => {
    const res = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporterSession.access_token, reporterSession.csrf_token))
      .send({
        type: "Injury",
        description: "Worker slipped on wet floor near loading dock",
        site: "Main Campus",
        time: new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("New");
    expect(typeof res.body.within_goal).toBe("boolean");
    createdIds.push(res.body.id);
  });

  test("Created incident is retrievable via GET /incidents/:id", async () => {
    const id = createdIds[0];
    const res = await request(app)
      .get(`/incidents/${id}`)
      .set("Authorization", `Bearer ${reporterSession.access_token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.status).toBe("New");
    expect(res.body.type).toBe("Injury");
    expect(Array.isArray(res.body.actions)).toBe(true);
    expect(Array.isArray(res.body.collaborators)).toBe(true);
    expect(Array.isArray(res.body.images)).toBe(true);
  });

  test("Reporter cannot view a non-existent incident", async () => {
    const res = await request(app)
      .get("/incidents/9999999")
      .set("Authorization", `Bearer ${reporterSession.access_token}`)
      .send();

    expect([403, 404]).toContain(res.status);
  });

  test("Dispatcher transitions incident New → Acknowledged", async () => {
    const id = createdIds[0];
    const res = await request(app)
      .patch(`/incidents/${id}/status`)
      .set(stateHeaders(dispatcherSession.access_token, dispatcherSession.csrf_token))
      .send({ status: "Acknowledged", triage_notes: "On-site check completed", collaborators: [] });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Acknowledged");
  });

  test("Status change is persisted — subsequent GET reflects new status", async () => {
    const id = createdIds[0];
    const res = await request(app)
      .get(`/incidents/${id}`)
      .set("Authorization", `Bearer ${reporterSession.access_token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Acknowledged");
    const statusAction = res.body.actions.find((a: any) => a.action === "STATUS_UPDATED");
    expect(statusAction).toBeDefined();
    expect(statusAction.evidence_log.previous_status).toBe("New");
    expect(statusAction.evidence_log.next_status).toBe("Acknowledged");
  });

  test("Invalid transition Acknowledged → New is rejected with 400", async () => {
    const id = createdIds[0];
    const res = await request(app)
      .patch(`/incidents/${id}/status`)
      .set(stateHeaders(dispatcherSession.access_token, dispatcherSession.csrf_token))
      .send({ status: "New", triage_notes: "", collaborators: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot transition/i);
  });

  test("Dispatcher transitions Acknowledged → Closed", async () => {
    const id = createdIds[0];
    const res = await request(app)
      .patch(`/incidents/${id}/status`)
      .set(stateHeaders(dispatcherSession.access_token, dispatcherSession.csrf_token))
      .send({ status: "Closed", triage_notes: "Resolved", collaborators: [] });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Closed");
  });

  test("No further transitions allowed from Closed", async () => {
    const id = createdIds[0];
    const res = await request(app)
      .patch(`/incidents/${id}/status`)
      .set(stateHeaders(dispatcherSession.access_token, dispatcherSession.csrf_token))
      .send({ status: "Acknowledged", triage_notes: "", collaborators: [] });

    expect(res.status).toBe(400);
  });
});

// ─── moderation and PII rejection ─────────────────────────────────────────

maybeDescribe("Real-DB: moderation and PII rejection", () => {
  test("Incident with email in description is rejected with 422", async () => {
    const { access_token, csrf_token } = await login("reporter1", "reporter123");

    const res = await request(app)
      .post("/incidents")
      .set(stateHeaders(access_token, csrf_token))
      .send({
        type: "Injury",
        description: "Contact john.doe@example.com for details",
        site: "Main Campus",
        time: new Date().toISOString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/moderation/i);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  test("Incident with phone number in description is rejected with 422", async () => {
    const { access_token, csrf_token } = await login("reporter1", "reporter123");

    const res = await request(app)
      .post("/incidents")
      .set(stateHeaders(access_token, csrf_token))
      .send({
        type: "Injury",
        description: "Call 555-867-5309 for more information",
        site: "Main Campus",
        time: new Date().toISOString(),
      });

    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  test("Rejected incidents are not persisted in the database", async () => {
    const { access_token, csrf_token } = await login("reporter1", "reporter123");
    const uniqueDesc = `PIITEST_${Date.now()} contact user@domain.com`;

    await request(app)
      .post("/incidents")
      .set(stateHeaders(access_token, csrf_token))
      .send({ type: "Injury", description: uniqueDesc, site: "Main Campus", time: new Date().toISOString() });

    // Verify nothing was persisted with that description
    const [rows] = await dbPool.query<any[]>(
      "SELECT id FROM incidents WHERE description = ? LIMIT 1",
      [uniqueDesc],
    );
    expect(rows).toHaveLength(0);
  });
});

// ─── search against real data ──────────────────────────────────────────────

maybeDescribe("Real-DB: search with real data", () => {
  const createdIds: number[] = [];
  let adminToken: string;

  beforeAll(async () => {
    const reporterSession = await login("reporter1", "reporter123");
    adminToken = (await login("admin", "admin123")).access_token;

    // Create two incidents with distinct sites and types for filter testing
    const r1 = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporterSession.access_token, reporterSession.csrf_token))
      .send({ type: "Fire", description: "Electrical blaze near server room", site: "Warehouse A", time: new Date().toISOString() });
    if (r1.status === 201) createdIds.push(r1.body.id);

    const r2 = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporterSession.access_token, reporterSession.csrf_token))
      .send({ type: "Injury", description: "Slip on wet floor", site: "Lab Building", time: new Date().toISOString() });
    if (r2.status === 201) createdIds.push(r2.body.id);
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("keyword search returns incident with positive relevance_score", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ q: "blaze", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    const found = res.body.results.find((r: any) => r.id === createdIds[0]);
    expect(found).toBeDefined();
    expect(found.relevance_score).toBeGreaterThan(0);
  });

  test("site filter returns only incidents from that site", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ site: "Warehouse A", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    for (const inc of res.body.results) {
      expect(inc.site).toBe("Warehouse A");
    }
  });

  test("status filter returns only matching incidents", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ status: "New", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    for (const inc of res.body.results) {
      expect(inc.status).toBe("New");
    }
  });

  test("combined site + status filter narrows results correctly", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({ site: "Lab Building", status: "New", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    for (const inc of res.body.results) {
      expect(inc.site).toBe("Lab Building");
      expect(inc.status).toBe("New");
    }
  });
});

// ─── CSV export with real rows ─────────────────────────────────────────────

maybeDescribe("Real-DB: CSV export", () => {
  const createdIds: number[] = [];
  let adminToken: string;

  beforeAll(async () => {
    const reporterSession = await login("reporter1", "reporter123");
    adminToken = (await login("admin", "admin123")).access_token;

    const r = await request(app)
      .post("/incidents")
      .set(stateHeaders(reporterSession.access_token, reporterSession.csrf_token))
      .send({ type: "Injury", description: "Export test incident", site: "Main Campus", time: new Date().toISOString() });
    if (r.status === 201) createdIds.push(r.body.id);
  });

  afterAll(async () => {
    await deleteIncidents(createdIds);
  });

  test("export produces valid CSV with correct header and at least one data row", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const lines = res.text.split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]).toBe(
      "ID,Reporter ID,Type,Description (truncated),Site,Time,Status,Rating,Cost,Created At,Updated At",
    );
    expect(lines.length).toBeGreaterThan(1);
  });

  test("status filter in export only includes matching rows", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .query({ status: "New" })
      .set("Authorization", `Bearer ${adminToken}`)
      .send();

    expect(res.status).toBe(200);
    const lines = res.text.split("\n").filter((l) => l.trim() !== "");
    // Every data row (after header) must have "New" in the status column (index 6)
    for (let i = 1; i < lines.length; i++) {
      // The Status column contains "New" — check as a comma-delimited field
      expect(lines[i]).toContain(",New,");
    }
  });
});
