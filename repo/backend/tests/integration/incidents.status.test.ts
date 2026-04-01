import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";

type MockDbData = {
  users: Array<{
    id: number;
    username: string;
    password_hash: string;
    role: string;
    login_attempts: number;
    locked_until: Date | null;
  }>;
  incidents: Array<{
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
  incidentActions: Array<any>;
  auditLogs: Array<any>;
};

type MockDbModule = {
  __getMockData: () => MockDbData;
  __resetMockData: () => void;
};

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

  let data: MockDbData;

  function reset() {
    const now = new Date().toISOString();
    data = {
      users: baseUsers.map((u) => ({ ...u })),
      incidents: [
        {
          id: 1,
          status: "New",
          reporter_id: 99,
          type: "Injury",
          description: "Slip on floor",
          site: "Dock A",
          time: now,
          rating: null,
          cost: null,
          risk_tags: JSON.stringify({ tags: [], sensitive: {} }),
          created_at: now,
          updated_at: now,
        },
      ],
      incidentActions: [],
      auditLogs: [],
    };
  }

  reset();

  function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  async function handleQuery(sql: string, params: unknown[] = []) {
    const normalized = sql.trim().toLowerCase();

    if (normalized.includes("from users where username")) {
      const username = params[0];
      const user = data.users.find((u) => u.username === username);
      return [user ? [clone(user)] : []];
    }

    if (normalized.includes("from users where id")) {
      const userId = params[0];
      const user = data.users.find((u) => u.id === userId);
      return [user ? [clone(user)] : []];
    }

    if (normalized.includes("from incidents where id")) {
      const incidentId = params[0];
      const incident = data.incidents.find((i) => i.id === incidentId);
      return [incident ? [clone(incident)] : []];
    }

    if (normalized.includes("from incident_actions where incident_id")) {
      const incidentId = params[0];
      const actions = data.incidentActions.filter((a) => a.incident_id === incidentId);
      return [actions.map((a) => clone(a))];
    }

    if (normalized.includes("from incident_collaborators")) {
      return [[]];
    }

    return [[]];
  }

  async function handleExecute(sql: string, params: unknown[] = []) {
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith("update incidents set status")) {
      const [status, id] = params;
      const incident = data.incidents.find((i) => i.id === id);
      if (incident) {
        incident.status = status;
        incident.updated_at = new Date().toISOString();
      }
      return [{}];
    }

    if (normalized.startsWith("insert ignore into incident_collaborators")) {
      return [{}];
    }

    if (normalized.startsWith("insert into incident_actions")) {
      const [incident_id, user_id, action, evidence_log] = params;
      data.incidentActions.push({
        id: data.incidentActions.length + 1,
        incident_id,
        user_id,
        action,
        evidence_log,
        created_at: new Date().toISOString(),
      });
      return [{}];
    }

    if (normalized.startsWith("insert into audit_logs")) {
      const [route, user_id, before_val, after_val, created_at] = params;
      data.auditLogs.push({ route, user_id, before_val, after_val, created_at });
      return [{}];
    }

    if (normalized.startsWith("update users set login_attempts = 0")) {
      const userId = params[0];
      const user = data.users.find((u) => u.id === userId);
      if (user) {
        user.login_attempts = 0;
        user.locked_until = null;
      }
      return [{}];
    }

    if (normalized.startsWith("update users set login_attempts = login_attempts + 1")) {
      const userId = params[1];
      const user = data.users.find((u) => u.id === userId);
      if (user) {
        user.login_attempts += 1;
      }
      return [{}];
    }

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
    __getMockData: () => data,
    __resetMockData: reset,
  };
});

const dbMock = jest.requireMock("../../src/db/pool") as unknown as MockDbModule;

describe("PATCH /incidents/:id/status", () => {
  beforeEach(() => {
    dbMock.__resetMockData();
  });

  async function loginDispatcher() {
    const response = await request(app).post("/auth/login").send({
      username: "dispatcher1",
      password: "dispatcher123",
    });

    expect(response.status).toBe(200);
    return response.body as { access_token: string; csrf_token: string };
  }

  test("updates status and writes audit logs", async () => {
    const login = await loginDispatcher();

    const res = await request(app)
      .patch("/incidents/1/status")
      .set("Authorization", `Bearer ${login.access_token}`)
      .set("x-csrf-token", login.csrf_token)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        status: "Acknowledged",
        triage_notes: "Verified on site",
        collaborators: [10, 11],
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Acknowledged");

    const mockData = dbMock.__getMockData();
    expect(mockData.incidents[0].status).toBe("Acknowledged");

    const statusUpdateAction = mockData.incidentActions.find((a) => a.action === "STATUS_UPDATED");
    expect(statusUpdateAction).toBeTruthy();
    expect(statusUpdateAction.evidence_log).toContain("Acknowledged");

    const auditEntry = mockData.auditLogs.find((log) => log.route.includes("/incidents/1/status"));
    expect(auditEntry).toBeTruthy();
    expect(JSON.parse(auditEntry.before_val)).toBeNull();
    expect(JSON.parse(auditEntry.after_val)).toEqual({ previous_status: "New", next_status: "Acknowledged", triage_notes: "Verified on site", collaborators: [10, 11] });
  });
});
