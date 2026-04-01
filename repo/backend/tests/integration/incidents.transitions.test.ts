import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";

jest.mock("../../src/services/upload", () => {
  const actual = jest.requireActual("../../src/services/upload");
  return {
    ...actual,
    uploadImagesMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
    validateAndPersistImages: jest.fn(async () => ({ refs: [], diskPaths: [] })),
    cleanupFiles: jest.fn(async () => {}),
  };
});

jest.mock("../../src/db/pool", () => {
  const bcrypt = require("bcryptjs");

  const baseUsers = [
    {
      id: 1,
      username: "dispatcher1",
      password_hash: bcrypt.hashSync("dispatcher123", 10),
      role: "Dispatcher",
      login_attempts: 0,
      locked_until: null,
    },
  ];

  let incidents: Array<{
    id: number;
    status: string;
    reporter_id: number;
    type: string;
    description: string;
    site: string;
    time: string;
    rating: number | null;
    cost: number | null;
    risk_tags: string | null;
    created_at: string;
    updated_at: string;
  }>;
  let incidentActions: Array<any>;
  let auditLogs: Array<any>;

  function reset() {
    const now = new Date().toISOString();
    incidents = [
      {
        id: 1, status: "New", reporter_id: 99, type: "Injury",
        description: "Slip", site: "Dock A", time: now,
        rating: null, cost: null, risk_tags: JSON.stringify({ tags: [], sensitive: {} }),
        created_at: now, updated_at: now,
      },
      {
        id: 2, status: "Closed", reporter_id: 99, type: "Fire",
        description: "Extinguished", site: "Lab", time: now,
        rating: null, cost: null, risk_tags: null,
        created_at: now, updated_at: now,
      },
    ];
    incidentActions = [];
    auditLogs = [];
  }

  reset();

  function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

  async function handleQuery(sql: string, params: unknown[] = []) {
    const n = sql.trim().toLowerCase();
    if (n.includes("from users where username")) {
      const u = baseUsers.find((u) => u.username === params[0]);
      return [u ? [clone(u)] : []];
    }
    if (n.includes("from users where id")) {
      const u = baseUsers.find((u) => u.id === params[0]);
      return [u ? [clone(u)] : []];
    }
    if (n.includes("from incidents where id")) {
      const i = incidents.find((i) => i.id === params[0]);
      return [i ? [clone(i)] : []];
    }
    if (n.includes("from incident_actions")) {
      return [incidentActions.filter((a) => a.incident_id === params[0]).map(clone)];
    }
    if (n.includes("from incident_collaborators")) {
      return [[]];
    }
    if (n.includes("from images")) {
      return [[]];
    }
    return [[]];
  }

  async function handleExecute(sql: string, params: unknown[] = []) {
    const n = sql.trim().toLowerCase();
    if (n.startsWith("update incidents set status")) {
      const i = incidents.find((i) => i.id === params[1]);
      if (i) { i.status = params[0] as string; }
      return [{}];
    }
    if (n.startsWith("insert into incident_actions")) {
      incidentActions.push({ id: incidentActions.length + 1, incident_id: params[0], user_id: params[1], action: params[2], evidence_log: params[3], created_at: new Date().toISOString() });
      return [{}];
    }
    if (n.startsWith("insert ignore into incident_collaborators")) {
      return [{}];
    }
    if (n.startsWith("insert into audit_logs")) {
      auditLogs.push({ route: params[0], user_id: params[1], before_val: params[2], after_val: params[3] });
      return [{}];
    }
    if (n.startsWith("update users")) { return [{}]; }
    return [{}];
  }

  function createConnection() {
    return {
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      query: (sql: string, params?: unknown[]) => handleQuery(sql, params),
      execute: (sql: string, params?: unknown[]) => handleExecute(sql, params),
    };
  }

  return {
    dbPool: {
      query: (sql: string, params?: unknown[]) => handleQuery(sql, params),
      execute: (sql: string, params?: unknown[]) => handleExecute(sql, params),
      getConnection: async () => createConnection(),
    },
    __reset: reset,
  };
});

const dbMock = jest.requireMock("../../src/db/pool") as { __reset: () => void };

describe("Invalid status transitions", () => {
  beforeEach(() => dbMock.__reset());

  async function loginDispatcher() {
    const res = await request(app).post("/auth/login").send({ username: "dispatcher1", password: "dispatcher123" });
    expect(res.status).toBe(200);
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

  test("rejects New → Closed (not a valid transition)", async () => {
    const login = await loginDispatcher();
    const res = await request(app)
      .patch("/incidents/1/status")
      .set(stateHeaders(login.access_token, login.csrf_token))
      .send({ status: "Closed", triage_notes: "", collaborators: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot transition");
  });

  test("rejects New → In Progress (not a valid transition)", async () => {
    const login = await loginDispatcher();
    const res = await request(app)
      .patch("/incidents/1/status")
      .set(stateHeaders(login.access_token, login.csrf_token))
      .send({ status: "In Progress", triage_notes: "", collaborators: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot transition");
  });

  test("rejects Closed → Acknowledged (no transitions from Closed)", async () => {
    const login = await loginDispatcher();
    const res = await request(app)
      .patch("/incidents/2/status")
      .set(stateHeaders(login.access_token, login.csrf_token))
      .send({ status: "Acknowledged", triage_notes: "", collaborators: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot transition");
  });

  test("allows New → Acknowledged (valid transition)", async () => {
    const login = await loginDispatcher();
    const res = await request(app)
      .patch("/incidents/1/status")
      .set(stateHeaders(login.access_token, login.csrf_token))
      .send({ status: "Acknowledged", triage_notes: "Verified", collaborators: [] });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Acknowledged");
  });

  test("allows New → Escalated (valid transition)", async () => {
    const login = await loginDispatcher();
    const res = await request(app)
      .patch("/incidents/1/status")
      .set(stateHeaders(login.access_token, login.csrf_token))
      .send({ status: "Escalated", triage_notes: "Critical", collaborators: [] });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Escalated");
  });
});

describe("Incident not found", () => {
  beforeEach(() => dbMock.__reset());

  async function loginDispatcher() {
    const res = await request(app).post("/auth/login").send({ username: "dispatcher1", password: "dispatcher123" });
    expect(res.status).toBe(200);
    return res.body as { access_token: string; csrf_token: string };
  }

  test("returns 404 for non-existent incident on status update", async () => {
    const login = await loginDispatcher();
    const res = await request(app)
      .patch("/incidents/9999/status")
      .set({
        Authorization: `Bearer ${login.access_token}`,
        "x-csrf-token": login.csrf_token,
        "x-request-timestamp": Date.now().toString(),
        "x-request-nonce": crypto.randomUUID(),
      })
      .send({ status: "Acknowledged", triage_notes: "", collaborators: [] });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  test("returns 404 for non-existent incident on detail view", async () => {
    const login = await loginDispatcher();
    const res = await request(app)
      .get("/incidents/9999")
      .set("Authorization", `Bearer ${login.access_token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });
});
