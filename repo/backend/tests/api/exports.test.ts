import request from "supertest";

import app from "../../src/app";
import { makeTestToken } from "./helpers";

const ADMIN_TOKEN = makeTestToken(1, "admin", "Administrator");
const SAFETY_MGR_TOKEN = makeTestToken(4, "safety_mgr", "Safety Manager");
const REPORTER_TOKEN = makeTestToken(2, "reporter1", "Reporter");
const AUDITOR_TOKEN = makeTestToken(5, "auditor1", "Auditor");

const INCIDENT_TIME = new Date("2026-03-01T09:00:00.000Z");
const CREATED_AT = new Date("2026-03-01T08:55:00.000Z");

const mockIncidentRows = [
  {
    id: 1,
    reporter_id: 2,
    type: "Fire",
    description: "Warehouse fire near loading bay",
    site: "Main Campus",
    time: INCIDENT_TIME,
    status: "New",
    rating: 3,
    cost: 1500.0,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  },
  {
    id: 2,
    reporter_id: 3,
    type: "Injury",
    description: 'Worker slipped — note with "quotes" and commas, here',
    site: "Warehouse A",
    time: INCIDENT_TIME,
    status: "Closed",
    rating: null,
    cost: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  },
];

// Expose query as a jest.fn() so tests can inspect SQL and params.
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

function incidentsQueryImpl(_sql: string, _params?: unknown[]) {
  const n = (_sql as string).trim().toLowerCase();
  if (n.includes("status as label")) {
    return Promise.resolve([[{ label: "New", count: 5 }, { label: "Closed", count: 3 }], []]);
  }
  if (n.includes("action as label")) {
    return Promise.resolve([[{ label: "STATUS_UPDATED", count: 10 }], []]);
  }
  if (n.includes("from incidents")) {
    return Promise.resolve([mockIncidentRows, []]);
  }
  return Promise.resolve([[], []]);
}

describe("GET /export/incidents", () => {
  beforeEach(() => {
    queryFn.mockReset();
    queryFn.mockImplementation(incidentsQueryImpl);
  });

  test("returns CSV with correct headers", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const lines = res.text.split("\n");
    const header = lines[0];
    expect(header).toBe("ID,Reporter ID,Type,Description,Site,Time,Status,Rating,Cost,Created At,Updated At");
  });

  test("CSV contains one data row per incident", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const lines = res.text.split("\n").filter((l) => l.trim() !== "");
    // 1 header + 2 data rows
    expect(lines).toHaveLength(3);
  });

  test("CSV data rows contain correct field values", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const lines = res.text.split("\n");
    const firstDataRow = lines[1];

    // id, reporter_id, type, site, status should appear in row 1
    expect(firstDataRow).toContain("1");
    expect(firstDataRow).toContain("Fire");
    expect(firstDataRow).toContain("Main Campus");
    expect(firstDataRow).toContain("New");
    expect(firstDataRow).toContain("1500");
  });

  test("CSV escapes fields containing commas and quotes", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    // Row 2 description has commas and quotes — must be wrapped in double-quotes with internal quotes doubled
    expect(res.text).toContain('"Worker slipped');
    expect(res.text).toContain('""quotes""');
  });

  test("empty rating and cost are exported as empty fields", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const lines = res.text.split("\n");
    const secondDataRow = lines[2];
    // rating and cost are null → exported as empty string between commas
    // Row format: id,reporter_id,type,description,site,time,status,rating,cost,...
    const cols = secondDataRow.match(/,/g);
    expect(cols).not.toBeNull();
    // Should have 10 commas for 11 columns
    expect(cols!.length).toBeGreaterThanOrEqual(10);
  });

  test("Content-Disposition header specifies incidents-export.csv filename", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("incidents-export.csv");
  });

  test("status filter is forwarded as SQL WHERE param", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .query({ status: "New" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const [sql, params] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).toContain("status = ?");
    expect(params as unknown[]).toContain("New");
  });

  test("date_from filter is forwarded as SQL WHERE param", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .query({ date_from: "2026-01-01" })
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    const [sql, params] = queryFn.mock.calls[0];
    expect((sql as string).toLowerCase()).toContain("created_at >= ?");
    const dateParams = (params as unknown[]).filter((p) => p instanceof Date);
    expect(dateParams).toHaveLength(1);
  });

  test("auditor role can export", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${AUDITOR_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });

  test("Safety Manager role can export", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${SAFETY_MGR_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
  });

  test("Reporter role is denied with 403", async () => {
    const res = await request(app)
      .get("/export/incidents")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(403);
  });

  test("unauthenticated request returns 401", async () => {
    const res = await request(app).get("/export/incidents").send();
    expect(res.status).toBe(401);
  });
});

describe("GET /export/metrics", () => {
  beforeEach(() => {
    queryFn.mockReset();
    queryFn.mockImplementation(incidentsQueryImpl);
  });

  test("returns CSV with correct Metric Group header", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.text.split("\n");
    expect(lines[0]).toBe("Metric Group,Dimension,Count");
  });

  test("CSV contains incidents_by_status rows", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toContain("incidents_by_status");
    expect(res.text).toContain("New");
    expect(res.text).toContain("Closed");
  });

  test("CSV contains moderation_actions rows", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toContain("moderation_actions");
    expect(res.text).toContain("STATUS_UPDATED");
  });

  test("Content-Disposition header specifies metrics-export.csv filename", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set("Authorization", `Bearer ${ADMIN_TOKEN}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("metrics-export.csv");
  });

  test("Reporter role is denied with 403", async () => {
    const res = await request(app)
      .get("/export/metrics")
      .set("Authorization", `Bearer ${REPORTER_TOKEN}`)
      .send();

    expect(res.status).toBe(403);
  });
});
