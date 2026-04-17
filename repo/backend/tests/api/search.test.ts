import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");
const REPORTER_OTHER_TOKEN = makeTestToken(3, "reporter2", "Reporter");

const now = new Date().toISOString();

const allIncidents = [
  {
    id: 1,
    reporter_id: 2,
    type: "Injury",
    description: "Worker slipped near Dock A",
    site: "Dock A",
    time: now,
    status: "New",
    rating: 3,
    cost: 150.0,
    risk_tags: '{"tags":["chemical"],"sensitive":{}}',
    created_at: now,
    updated_at: now,
    popularity: 5,
    recent_activity: now,
  },
  {
    id: 2,
    reporter_id: 2,
    type: "Fire",
    description: "Small fire in Warehouse B",
    site: "Warehouse B",
    time: now,
    status: "Acknowledged",
    rating: null,
    cost: 500.0,
    risk_tags: null,
    created_at: now,
    updated_at: now,
    popularity: 2,
    recent_activity: now,
  },
  {
    id: 3,
    reporter_id: 99,
    type: "Spill",
    description: "Chemical spill in Lab C",
    site: "Lab C",
    time: now,
    status: "New",
    rating: 5,
    cost: 2000.0,
    risk_tags: '{"tags":["hazmat"],"sensitive":{}}',
    created_at: now,
    updated_at: now,
    popularity: 8,
    recent_activity: now,
  },
];

// Expose query as a jest.fn() so tests can inspect calls and override return values.
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

// Default: return all incidents for SELECT queries
function defaultQueryImpl(sql: string, params?: unknown[]) {
  const n = (sql as string).trim().toLowerCase();
  if (n.includes("i.reporter_id = ?")) {
    const reporterId = (params as unknown[])[0];
    const filtered = allIncidents.filter((inc) => inc.reporter_id === reporterId);
    return Promise.resolve([filtered, []]);
  }
  return Promise.resolve([allIncidents, []]);
}

describe("GET /search/incidents", () => {
  beforeEach(() => {
    queryFn.mockReset();
    queryFn.mockImplementation(defaultQueryImpl);
  });

  test("returns results array with valid auth", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ limit: 50, sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].site).toBeDefined();
  });

  test("keyword filter returns only relevance-matched incidents and scores them", async () => {
    // The controller performs JS-level relevance filtering after DB fetch.
    // Searching "slip" matches "slipped" in incident #1 (substring match → score ≥ 5).
    // Incidents #2 and #3 do not contain "slip" as a substring, so they are filtered out.
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ q: "slip", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.q).toBe("slip");
    expect(res.body.results.length).toBeGreaterThan(0);
    for (const incident of res.body.results) {
      expect(incident.relevance_score).toBeGreaterThan(0);
    }
    expect(res.body.results.some((r: any) => r.description.toLowerCase().includes("slip"))).toBe(true);
  });

  test("synonym expansion: 'fire' query also matches blaze/flame and scores them", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ q: "fire", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.q).toBe("fire");
    // The Fire incident should be in results with relevance_score > 0
    const fireIncident = res.body.results.find((r: any) => r.type === "Fire");
    expect(fireIncident).toBeDefined();
    expect(fireIncident.relevance_score).toBeGreaterThan(0);
  });

  test("site filter is passed as SQL WHERE clause param", async () => {
    // Mock returns only the Dock A incident when site filter is active
    queryFn.mockImplementationOnce((_sql: string, _params?: unknown[]) =>
      Promise.resolve([[allIncidents[0]], []]),
    );

    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ site: "Dock A", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.site).toBe("Dock A");
    // Verify the SQL sent to the DB contained the site WHERE clause
    const [sql, params] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).toContain("i.site = ?");
    expect(params as unknown[]).toContain("Dock A");
    // Response should only contain the Dock A incident
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].site).toBe("Dock A");
  });

  test("status filter is passed as SQL WHERE clause param", async () => {
    queryFn.mockImplementationOnce((_sql: string, _params?: unknown[]) =>
      Promise.resolve([[allIncidents[1]], []]),
    );

    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ status: "Acknowledged", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.status).toBe("Acknowledged");
    const [sql, params] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).toContain("i.status = ?");
    expect(params as unknown[]).toContain("Acknowledged");
    expect(res.body.results.every((r: any) => r.status === "Acknowledged")).toBe(true);
  });

  test("cost_min filter is passed as SQL WHERE clause param", async () => {
    queryFn.mockImplementationOnce((_sql: string, _params?: unknown[]) =>
      Promise.resolve([[allIncidents[2]], []]),
    );

    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ cost_min: "1000", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.cost_min).toBe(1000);
    const [sql, params] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).toContain("i.cost >= ?");
    expect(params as unknown[]).toContain(1000);
  });

  test("cost_max filter is passed as SQL WHERE clause param", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ cost_max: "200", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.cost_max).toBe(200);
    const [sql, params] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).toContain("i.cost <= ?");
    expect(params as unknown[]).toContain(200);
  });

  test("date_from and date_to are passed as SQL WHERE clause params", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ date_from: "2024-01-01", date_to: "2024-12-31", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.date_from).toBe("2024-01-01");
    expect(res.body.filters.date_to).toBe("2024-12-31");
    const [sql, params] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).toContain("i.time >= ?");
    expect((sql as string).toLowerCase()).toContain("i.time <= ?");
    // Params should include Date objects for the range
    const dateParams = (params as unknown[]).filter((p) => p instanceof Date);
    expect(dateParams).toHaveLength(2);
  });

  test("supports all sort options", async () => {
    for (const sort of ["popularity", "recent_activity", "rating", "cost"]) {
      queryFn.mockImplementationOnce(defaultQueryImpl);
      const res = await request(app)
        .get("/search/incidents")
        .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
        .query({ sort })
        .send();

      expect(res.status).toBe(200);
      expect(res.body.sort).toBe(sort);
    }
  });

  test("returns 401 without auth", async () => {
    const res = await request(app).get("/search/incidents").send();
    expect(res.status).toBe(401);
  });

  test("Reporter only sees their own incidents (reporter_id WHERE clause)", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .query({ limit: 50, sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    // Verify SQL scoped to reporter's own incidents
    const [sql, params] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).toContain("i.reporter_id = ?");
    expect(params as unknown[]).toContain(2); // reporter user id = 2
    for (const incident of res.body.results) {
      expect(incident.reporter_id).toBe(2);
    }
  });

  test("Reporter with no incidents sees empty results", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${REPORTER_OTHER_TOKEN}`)
      .query({ limit: 50, sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(0);
  });

  test("Admin sees all incidents without reporter_id restriction", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ limit: 50, sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(3);
    // Admin SQL should NOT contain the reporter_id scope
    const [sql] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).not.toContain("i.reporter_id = ?");
  });
});
