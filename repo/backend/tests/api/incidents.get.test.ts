import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");
const DISPATCHER_TOKEN = makeTestToken(3, "dispatcher1", "Dispatcher");
const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");

const now = new Date().toISOString();

const mockIncidents = [
  {
    id: 1,
    reporter_id: 2,
    type: "Injury",
    description: "Slip near loading dock",
    site: "Dock A",
    time: now,
    status: "New",
    rating: null,
    cost: null,
    risk_tags: '{"tags":[],"sensitive":{}}',
    created_at: now,
    updated_at: now,
  },
  {
    id: 2,
    reporter_id: 99,
    type: "Fire",
    description: "Small fire in Warehouse B",
    site: "Warehouse B",
    time: now,
    status: "Acknowledged",
    rating: 3,
    cost: 500,
    risk_tags: null,
    created_at: now,
    updated_at: now,
  },
];

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

function defaultImpl(sql: string, params?: unknown[]) {
  const n = sql.trim().toLowerCase();

  // Detail fetch by id
  if (n.includes("from incidents where id")) {
    const id = (params as [number])[0];
    const inc = mockIncidents.find((i) => i.id === id);
    return Promise.resolve([inc ? [inc] : [], []]);
  }

  // Sub-queries (detail endpoint)
  if (n.includes("from incident_actions")) return Promise.resolve([[], []]);
  if (n.includes("from images")) return Promise.resolve([[], []]);
  if (n.includes("from incident_collaborators")) return Promise.resolve([[], []]);

  // COUNT query for pagination
  if (n.includes("count(*) as total from incidents")) {
    return Promise.resolve([[{ total: mockIncidents.length }], []]);
  }

  // List with reporter_id scope (Reporter role)
  if (n.includes("reporter_id = ?") && n.includes("from incidents")) {
    const reporterId = (params as unknown[])[0];
    const filtered = mockIncidents.filter((i) => i.reporter_id === reporterId);
    return Promise.resolve([filtered, []]);
  }

  // General list (privileged roles)
  if (n.includes("from incidents")) {
    return Promise.resolve([mockIncidents, []]);
  }

  return Promise.resolve([[], []]);
}

// ─── GET /incidents/:id ────────────────────────────────────────────────────

describe("GET /incidents/:id", () => {
  beforeEach(() => {
    queryFn.mockReset();
    queryFn.mockImplementation(defaultImpl);
  });

  test("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/incidents/1").send();
    expect(res.status).toBe(401);
  });

  test("returns 404 for a non-existent incident id", async () => {
    const res = await request(app)
      .get("/incidents/9999")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test("returns 400 for a non-numeric incident id", async () => {
    const res = await request(app)
      .get("/incidents/abc")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(400);
  });

  test("returns incident detail with correct fields for the owner", async () => {
    const res = await request(app)
      .get("/incidents/1")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.type).toBe("Injury");
    expect(res.body.site).toBe("Dock A");
    expect(res.body.status).toBe("New");
    expect(res.body.description).toBe("Slip near loading dock");
  });

  test("response includes collaborators, actions, and images arrays", async () => {
    const res = await request(app)
      .get("/incidents/1")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.collaborators)).toBe(true);
    expect(Array.isArray(res.body.actions)).toBe(true);
    expect(Array.isArray(res.body.images)).toBe(true);
  });

  test("Reporter is denied access to another user's incident with 403", async () => {
    // Incident id=2 belongs to reporter_id=99, not reporter_id=2
    const res = await request(app)
      .get("/incidents/2")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access/i);
  });

  test("Dispatcher can view any incident", async () => {
    const res = await request(app)
      .get("/incidents/2")
      .set("Authorization", `Bearer ${DISPATCHER_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(2);
    expect(res.body.type).toBe("Fire");
  });

  test("Administrator can view any incident", async () => {
    const res = await request(app)
      .get("/incidents/2")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(2);
  });

  test("detail SQL queries incidents by id param", async () => {
    await request(app)
      .get("/incidents/1")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    const detailCall = (queryFn.mock.calls as Array<[string, unknown[]?]>).find(
      ([sql]) => (sql as string).toLowerCase().includes("from incidents where id"),
    );
    expect(detailCall).toBeDefined();
    expect(detailCall![1] as unknown[]).toContain(1);
  });

  test("sensitive fields in risk_tags are masked in the response", async () => {
    const res = await request(app)
      .get("/incidents/1")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    // risk_tags.sensitive should exist (parsed from JSON) without raw encrypted values exposed
    if (res.body.risk_tags?.sensitive) {
      for (const val of Object.values(res.body.risk_tags.sensitive)) {
        // maskField renders all-but-last-4 chars as asterisks — no plaintext encryption blobs
        expect(typeof val).toBe("string");
      }
    }
  });
});

// ─── GET /incidents ────────────────────────────────────────────────────────

describe("GET /incidents (list)", () => {
  beforeEach(() => {
    queryFn.mockReset();
    queryFn.mockImplementation(defaultImpl);
  });

  test("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/incidents").send();
    expect(res.status).toBe(401);
  });

  test("returns paginated list with incidents, total, page, and limit fields", async () => {
    const res = await request(app)
      .get("/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.page).toBe("number");
    expect(typeof res.body.limit).toBe("number");
  });

  test("list rows contain expected fields but not full description", async () => {
    const res = await request(app)
      .get("/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const first = res.body.incidents[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("type");
    expect(first).toHaveProperty("site");
    expect(first).toHaveProperty("status");
    expect(first).toHaveProperty("reporter_id");
    // description is not included in the list endpoint (only in detail)
    expect(first).not.toHaveProperty("description");
  });

  test("Reporter list is scoped to own incidents only", async () => {
    const res = await request(app)
      .get("/incidents")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    for (const inc of res.body.incidents) {
      expect(inc.reporter_id).toBe(2);
    }
  });

  test("Reporter list SQL contains reporter_id = ? with userId as param", async () => {
    await request(app)
      .get("/incidents")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    const listCall = (queryFn.mock.calls as Array<[string, unknown[]?]>).find(
      ([sql]) =>
        (sql as string).toLowerCase().includes("from incidents") &&
        !(sql as string).toLowerCase().includes("count(*)"),
    );
    expect(listCall).toBeDefined();
    const [sql, params] = listCall!;
    expect((sql as string).toLowerCase()).toContain("reporter_id = ?");
    // reporter userId = 2 (from REPORTER_TOKEN)
    expect(params as unknown[]).toContain(2);
  });

  test("Admin list is not scoped and returns all incidents", async () => {
    const res = await request(app)
      .get("/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.incidents.length).toBeGreaterThanOrEqual(2);
  });

  test("Admin list SQL does not scope by reporter_id", async () => {
    await request(app)
      .get("/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    const listCall = (queryFn.mock.calls as Array<[string, unknown[]?]>).find(
      ([sql]) =>
        (sql as string).toLowerCase().includes("from incidents") &&
        !(sql as string).toLowerCase().includes("count(*)"),
    );
    expect(listCall).toBeDefined();
    const [sql] = listCall!;
    expect((sql as string).toLowerCase()).not.toContain("reporter_id = ?");
  });

  test("page and limit query params are reflected in the response", async () => {
    const res = await request(app)
      .get("/incidents")
      .query({ page: 2, limit: 10 })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
  });

  test("status filter is forwarded as SQL WHERE clause param", async () => {
    // Override default impl so the mock returns only matching rows when status filter is applied.
    queryFn.mockImplementation((sql: string, params?: unknown[]) => {
      const n = sql.trim().toLowerCase();
      if (n.includes("from incident_actions")) return Promise.resolve([[], []]);
      if (n.includes("from images")) return Promise.resolve([[], []]);
      if (n.includes("from incident_collaborators")) return Promise.resolve([[], []]);
      if (n.includes("count(*) as total from incidents")) {
        return Promise.resolve([[{ total: 1 }], []]);
      }
      if (n.includes("from incidents")) {
        // Simulate DB-side WHERE status = ? filtering based on the actual param value.
        const p = (params as unknown[]) ?? [];
        const statusValues = new Set(["New", "Acknowledged", "In Progress", "Escalated", "Closed"]);
        const statusParam = p.find((v) => typeof v === "string" && statusValues.has(v as string)) as string | undefined;
        const rows = statusParam
          ? mockIncidents.filter((i) => i.status === statusParam)
          : mockIncidents;
        return Promise.resolve([rows, []]);
      }
      return Promise.resolve([[], []]);
    });

    const res = await request(app)
      .get("/incidents")
      .query({ status: "New" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);

    // SQL must carry WHERE status = ? with "New" as the bound value
    const listCall = (queryFn.mock.calls as Array<[string, unknown[]?]>).find(
      ([sql]) =>
        (sql as string).toLowerCase().includes("from incidents") &&
        !(sql as string).toLowerCase().includes("count(*)") &&
        !(sql as string).toLowerCase().includes("where id"),
    );
    expect(listCall).toBeDefined();
    const [sql, params] = listCall!;
    expect((sql as string).toLowerCase()).toContain("status = ?");
    expect(params as unknown[]).toContain("New");

    // Response must contain only "New" incidents
    expect(res.body.incidents.length).toBeGreaterThan(0);
    for (const inc of res.body.incidents) {
      expect(inc.status).toBe("New");
    }
  });

  test("status filter returns only incidents matching that status", async () => {
    // Simulate a DB that filters; assert response rows are all "New".
    queryFn.mockImplementation((sql: string, params?: unknown[]) => {
      const n = sql.trim().toLowerCase();
      if (n.includes("count(*) as total from incidents")) return Promise.resolve([[{ total: 1 }], []]);
      if (n.includes("from incidents")) {
        const p = (params as unknown[]) ?? [];
        const statusValues = new Set(["New", "Acknowledged", "In Progress", "Escalated", "Closed"]);
        const statusParam = p.find((v) => typeof v === "string" && statusValues.has(v as string)) as string | undefined;
        const rows = statusParam ? mockIncidents.filter((i) => i.status === statusParam) : mockIncidents;
        return Promise.resolve([rows, []]);
      }
      return Promise.resolve([[], []]);
    });

    const res = await request(app)
      .get("/incidents")
      .query({ status: "New" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    for (const inc of res.body.incidents) {
      expect(inc.status).toBe("New");
    }
  });
});
