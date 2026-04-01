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

  const baseSettings = [
    {
      config_key: "sla_defaults",
      config_value: JSON.stringify({ ack_minutes: 15, close_hours: 72 }),
    },
    {
      config_key: "incident_types",
      config_value: JSON.stringify(["Injury", "Fire", "Spill"]),
    },
    {
      config_key: "sla_rules",
      config_value: JSON.stringify([]),
    },
  ];

  let data: {
    users: typeof baseUsers;
    incidents: Array<any>;
    incidentActions: Array<any>;
    images: Array<any>;
    auditLogs: Array<any>;
    settings: typeof baseSettings;
  };
  let incidentIdSeq = 1;
  let actionIdSeq = 1;
  let imageIdSeq = 1;

  function resetData() {
    data = {
      users: baseUsers.map((u) => ({ ...u, login_attempts: 0, locked_until: null })),
      incidents: [],
      incidentActions: [],
      images: [],
      auditLogs: [],
      settings: baseSettings.map((s) => ({ ...s })),
    };
    incidentIdSeq = 1;
    actionIdSeq = 1;
    imageIdSeq = 1;
  }

  resetData();

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

    if (normalized.includes("from users where id =")) {
      const userId = params[0];
      const user = data.users.find((u) => u.id === userId);
      return [user ? [clone(user)] : []];
    }

    if (normalized.includes("from incidents where id")) {
      const incidentId = params[0];
      const incident = data.incidents.find((i) => i.id === incidentId);
      return [incident ? [clone(incident)] : []];
    }

    if (normalized.startsWith("select id, reporter_id")) {
      const hasStatusFilter = normalized.includes("where status =" );
      const limit = Number(params[params.length - 2]);
      const offset = Number(params[params.length - 1]);
      const statusParam = hasStatusFilter ? params[0] : undefined;
      let incidents = data.incidents;
      if (statusParam) {
        incidents = incidents.filter((i) => i.status === statusParam);
      }
      const rows = incidents
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(offset, offset + limit)
        .map((i) => ({
          id: i.id,
          reporter_id: i.reporter_id,
          type: i.type,
          site: i.site,
          status: i.status,
          rating: i.rating,
          cost: i.cost,
          created_at: i.created_at,
          updated_at: i.updated_at,
        }));
      return [rows];
    }

    if (normalized.startsWith("select count(*) as total from incidents")) {
      const hasStatusFilter = normalized.includes("where status =");
      const statusParam = hasStatusFilter ? params[0] : undefined;
      let incidents = data.incidents;
      if (statusParam) {
        incidents = incidents.filter((i) => i.status === statusParam);
      }
      return [[{ total: incidents.length }]];
    }

    if (normalized.includes("from incident_actions where incident_id")) {
      const incidentId = params[0];
      const actions = data.incidentActions.filter((a) => a.incident_id === incidentId);
      return [actions.map((a) => clone(a))];
    }

    if (normalized.includes("from images where incident_id")) {
      const incidentId = params[0];
      const imgs = data.images.filter((img) => img.incident_id === incidentId);
      return [imgs.map((img) => clone(img))];
    }

    if (normalized.includes("from incident_collaborators")) {
      return [[]];
    }

    if (normalized.includes("from settings")) {
      return [data.settings.map((s) => clone(s))];
    }

    return [[]];
  }

  async function handleExecute(sql: string, params: unknown[] = []) {
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith("insert into incidents")) {
      const [reporter_id, type, description, site, time, rating, cost, riskTags] = params;
      const now = new Date().toISOString();
      const incident = {
        id: incidentIdSeq++,
        reporter_id,
        type,
        description,
        site,
        time,
        status: "New",
        rating,
        cost,
        risk_tags: riskTags,
        created_at: now,
        updated_at: now,
      };
      data.incidents.push(incident);
      return [{ insertId: incident.id }];
    }

    if (normalized.startsWith("insert into incident_actions")) {
      const [incident_id, user_id, action, evidence_log] = params;
      data.incidentActions.push({
        id: actionIdSeq++,
        incident_id,
        user_id,
        action,
        evidence_log,
        created_at: new Date().toISOString(),
      });
      return [{}];
    }

    if (normalized.startsWith("insert into images")) {
      const [incident_id, file_ref, uploaded_by] = params;
      data.images.push({
        id: imageIdSeq++,
        incident_id,
        file_ref,
        uploaded_by,
        created_at: new Date().toISOString(),
      });
      return [{}];
    }

    if (normalized.startsWith("update incidents set status")) {
      const [status, id] = params;
      const incident = data.incidents.find((i) => i.id === id);
      if (incident) {
        incident.status = status;
      }
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

    if (normalized.startsWith("insert into audit_logs")) {
      const [route, user_id, before_val, after_val, created_at] = params;
      data.auditLogs.push({ route, user_id, before_val, after_val, created_at });
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
    __resetMockData: resetData,
  };
});

const dbMock = jest.requireMock("../../src/db/pool") as unknown as MockDbModule;

describe("POST /incidents", () => {
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

  test("creates incident and returns within_goal flag", async () => {
    const login = await loginReporter();
    const res = await request(app)
      .post("/incidents")
      .set("Authorization", `Bearer ${login.access_token}`)
      .set("x-csrf-token", login.csrf_token)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        type: "Injury",
        description: "Minor slip near Dock A",
        site: "Dock A",
        time: new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(typeof res.body.within_goal).toBe("boolean");
    expect(res.body.status).toBe("New");

    const mockData = dbMock.__getMockData();
    expect(mockData.incidents).toHaveLength(1);
    expect(mockData.incidents[0].status).toBe("New");
  });

  test("rejects incident when description contains PII", async () => {
    const login = await loginReporter();
    const res = await request(app)
      .post("/incidents")
      .set("Authorization", `Bearer ${login.access_token}`)
      .set("x-csrf-token", login.csrf_token)
      .set("x-request-timestamp", Date.now().toString())
      .set("x-request-nonce", crypto.randomUUID())
      .send({
        type: "Injury",
        description: "Contact john.doe@email.com or 555-555-5555",
        site: "Dock A",
        time: new Date().toISOString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("Moderation");

    const mockData = dbMock.__getMockData();
    expect(mockData.incidents).toHaveLength(0);
  });
});
