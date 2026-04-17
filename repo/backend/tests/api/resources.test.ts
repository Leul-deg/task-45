import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");

jest.mock("../../src/db/pool", () => ({
  dbPool: {
    query: (_sql: string, _params?: unknown[]) => {
      const normalized = (_sql as string).trim().toLowerCase();
      if (normalized.includes("from safety_resources") && normalized.includes("select") && normalized.includes("popularity")) {
        return Promise.resolve([[
          {
            id: 1,
            title: "Fire Extinguisher SOP",
            category: "Fire Safety",
            description: "PASS technique for ABC extinguishers",
            url: "/docs/fire-sop.pdf",
            tags: '["fire","extinguisher","PASS"]',
            price: 10,
            rating: 5,
            created_at: new Date("2026-01-01"),
            updated_at: new Date("2026-01-01"),
            popularity: 50,
          },
          {
            id: 2,
            title: "Chemical Spill Guide",
            category: "Hazardous Materials",
            description: "Containment and cleanup for chemical spills",
            url: null,
            tags: '["chemical","spill","hazmat"]',
            price: 200,
            rating: 4,
            created_at: new Date("2026-01-02"),
            updated_at: new Date("2026-01-02"),
            popularity: 80,
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

  test("accepts price and rating filters and cost sort", async () => {
    const res = await request(app)
      .get("/search/resources")
      .query({ price_min: 5, price_max: 500, rating_min: 4, sort: "cost" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.filters.price_min).toBe(5);
    expect(res.body.filters.rating_min).toBe(4);
    expect(res.body.sort).toBe("cost");
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
