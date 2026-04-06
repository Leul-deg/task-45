import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");

jest.mock("../../src/db/pool", () => ({
  dbPool: {
    query: (_sql: string, _params?: unknown[]) => {
      const normalized = (_sql as string).trim().toLowerCase();
      if (normalized.includes("from safety_resources") && normalized.includes("select id")) {
        return Promise.resolve([[
          {
            id: 1,
            title: "Fire Extinguisher SOP",
            category: "Fire Safety",
            description: "PASS technique for ABC extinguishers",
            url: "/docs/fire-sop.pdf",
            tags: '["fire","extinguisher","PASS"]',
            created_at: new Date("2026-01-01"),
          },
          {
            id: 2,
            title: "Chemical Spill Guide",
            category: "Hazardous Materials",
            description: "Containment and cleanup for chemical spills",
            url: null,
            tags: '["chemical","spill","hazmat"]',
            created_at: new Date("2026-01-02"),
          },
        ], []]);
      }
      if (normalized.includes("count(*)") && normalized.includes("safety_resources")) {
        return Promise.resolve([[{ total: 2 }], []]);
      }
      return Promise.resolve([[], []]);
    },
    execute: () => Promise.resolve([{}, {}]),
  },
}));

describe("GET /search/resources", () => {
  test("returns resources for authenticated user", async () => {
    const res = await request(app)
      .get("/search/resources")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].title).toBeDefined();
    expect(res.body.results[0].tags).toBeDefined();
  });

  test("returns resources for reporter role too", async () => {
    const res = await request(app)
      .get("/search/resources")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  test("returns 401 without auth", async () => {
    const res = await request(app).get("/search/resources").send();
    expect(res.status).toBe(401);
  });

  test("accepts category filter", async () => {
    const res = await request(app)
      .get("/search/resources")
      .query({ category: "Fire Safety" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.category).toBe("Fire Safety");
  });

  test("accepts keyword, tags, date, and sort filters", async () => {
    const res = await request(app)
      .get("/search/resources")
      .query({ q: "fire", tags: "PASS", date_from: "2026-01-01", sort: "title" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.q).toBe("fire");
    expect(res.body.sort).toBe("title");
  });

  test("accepts extended filters and category sort", async () => {
    const res = await request(app)
      .get("/search/resources")
      .query({
        title_contains: "guide",
        description_contains: "cleanup",
        has_url: "true",
        sort: "category",
      })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.title_contains).toBe("guide");
    expect(res.body.filters.description_contains).toBe("cleanup");
    expect(res.body.filters.has_url).toBe(true);
    expect(res.body.sort).toBe("category");
  });

  test("includes relevance_score in results", async () => {
    const res = await request(app)
      .get("/search/resources")
      .query({ q: "fire" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    for (const result of res.body.results) {
      expect(typeof result.relevance_score).toBe("number");
    }
  });
});
