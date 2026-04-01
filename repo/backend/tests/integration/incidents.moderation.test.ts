import crypto from "crypto";
import request from "supertest";

import app from "../../src/app";

type MockDbModule = {
  __getMockData: () => {
    incidents: Array<{ status: string }>;
  } & Record<string, unknown>;
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
      username: "reporter1",
      password_hash: bcrypt.hashSync("reporter123", 10),
      role: "Reporter",
      login_attempts: 0,
      locked_until: null,
    },
  ];

  let data: {
    users: typeof baseUsers;
    incidents: Array<any>;
    incidentActions: Array<any>;
    images: Array<any>;
    auditLogs: Array<any>;
  };

  function reset() {
    data = {
      users: baseUsers.map((u) => ({ ...u })),
      incidents: [],
      incidentActions: [],
      images: [],
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

    return [[]];
  }

  async function handleExecute(sql: string, params: unknown[] = []) {
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith("insert into incidents")) {
      const [reporter_id, type, description, site, time] = params;
      data.incidents.push({ reporter_id, type, description, site, time, status: "New" });
      return [{ insertId: crypto.randomUUID() }];
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

describe("POST /incidents moderation", () => {
  beforeEach(() => {
    dbMock.__resetMockData();
  });

  async function loginReporter() {
    const response = await request(app).post("/auth/login").send({
      username: "reporter1",
      password: "reporter123",
    });

    expect(response.status).toBe(200);
    return response.body as { access_token: string; csrf_token: string };
  }

  test("rejects descriptions containing PII", async () => {
    const login = await loginReporter();
    const response = await request(app)
      .post("/incidents")
      .set("Authorization", `Bearer ${login.access_token}`)
      .set("x-csrf-token", login.csrf_token)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        type: "Injury",
        description: "Reach me at john.doe@email.com or 555-123-4567",
        site: "Dock A",
        time: new Date().toISOString(),
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toContain("Moderation");
    expect(Array.isArray(response.body.issues)).toBe(true);
    expect(response.body.issues.length).toBeGreaterThan(0);

    const mockData = dbMock.__getMockData();
    expect(mockData.incidents).toHaveLength(0);
  });
});
