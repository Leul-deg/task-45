import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");
const REPORTER_OTHER_TOKEN = makeTestToken(3, "reporter2", "Reporter");

const allIncidents = [
  {
    id: 1,
    reporter_id: 2,
    type: "Injury",
    description: "Worker slipped near Dock A",
    site: "Dock A",
    time: new Date().toISOString(),
    status: "New",
    rating: 3,
    cost: 150.0,
    risk_tags: '{"tags":["chemical"],"sensitive":{}}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    popularity: 5,
    recent_activity: new Date().toISOString(),
  },
  {
    id: 2,
    reporter_id: 2,
    type: "Fire",
    description: "Small fire in Warehouse B",
    site: "Warehouse B",
    time: new Date().toISOString(),
    status: "Acknowledged",
    rating: null,
    cost: 500.0,
    risk_tags: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    popularity: 2,
    recent_activity: new Date().toISOString(),
  },
  {
    id: 3,
    reporter_id: 99,
    type: "Spill",
    description: "Chemical spill in Lab C",
    site: "Lab C",
    time: new Date().toISOString(),
    status: "New",
    rating: 5,
    cost: 2000.0,
    risk_tags: '{"tags":["hazmat"],"sensitive":{}}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    popularity: 8,
    recent_activity: new Date().toISOString(),
  },
];

jest.mock("../../src/db/pool", () => ({
  dbPool: {
    query: (_sql: string, _params?: unknown) => {
      const normalized = (_sql as string).trim().toLowerCase();
      const params = (_params as unknown[]) ?? [];
      if (normalized.startsWith("select")) {
        if (normalized.includes("i.reporter_id = ?")) {
          const reporterId = params[0];
          const filtered = allIncidents.filter((inc) => inc.reporter_id === reporterId);
          return Promise.resolve([filtered, []]);
        }
        return Promise.resolve([allIncidents, []]);
      }
      if (normalized.includes("count(*)")) {
        return Promise.resolve([[{ total: allIncidents.length }], []]);
      }
      return Promise.resolve([[], []]);
    },
    execute: () => Promise.resolve([{}, {}]),
  },
}));

describe("GET /search/incidents", () => {
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

  test("supports keyword q param", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ q: "slip", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.q).toBe("slip");
  });

  test("supports site filter", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ site: "Dock A", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.site).toBe("Dock A");
  });

  test("supports status filter", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ status: "New", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.status).toBe("New");
  });

  test("supports date range filters", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({
        date_from: "2024-01-01",
        date_to: "2024-12-31",
        sort: "recent_activity",
      })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.date_from).toBe("2024-01-01");
    expect(res.body.filters.date_to).toBe("2024-12-31");
  });

  test("supports cost_min and cost_max filters", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ cost_min: "100", cost_max: "1000", sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.cost_min).toBe(100);
    expect(res.body.filters.cost_max).toBe(1000);
  });

  test("supports sort options", async () => {
    for (const sort of ["popularity", "recent_activity", "rating", "cost"]) {
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
    const res = await request(app)
      .get("/search/incidents")
      .send();

    expect(res.status).toBe(401);
  });

  test("Reporter only sees their own incidents", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .query({ limit: 50, sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    for (const incident of res.body.results) {
      expect(incident.reporter_id).toBe(2);
    }
  });

  test("Reporter cannot see other users incidents", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${REPORTER_OTHER_TOKEN}`)
      .query({ limit: 50, sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(0);
  });

  test("Admin sees all incidents without restriction", async () => {
    const res = await request(app)
      .get("/search/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .query({ limit: 50, sort: "recent_activity" })
      .send();

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(3);
  });
});
