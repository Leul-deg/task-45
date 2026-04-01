import axiosMockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveSession } from "../auth";
import { http } from "../http";

const mock = new axiosMockAdapter(http, { delayResponse: 0 });

const VALID_SESSION = {
  accessToken: "test-access-token",
  expiresAt: Date.now() + 15 * 60 * 1000,
  csrfToken: "test-csrf-token",
  user: { id: 1, username: "testuser", role: "Reporter" as const },
};

beforeEach(() => {
  localStorage.clear();
  mock.resetHandlers();
});

afterEach(() => {
  localStorage.clear();
});

describe("Axios instance configuration", () => {
  it("uses correct baseURL from VITE_API_BASE_URL env", () => {
    expect(http.defaults.baseURL).toMatch(/^http/);
  });

  it("has a timeout of 15000ms", () => {
    expect(http.defaults.timeout).toBe(15000);
  });
});

describe("Request interceptor — Authorization header", () => {
  it("does not add Authorization header when no session exists", async () => {
    let capturedConfig: any = {};
    mock.onGet("/test").reply((config) => {
      capturedConfig = config;
      return [200, {}];
    });

    await http.get("/test");
    expect(capturedConfig.headers?.Authorization).toBeUndefined();
  });

  it("adds Authorization header when session exists", async () => {
    saveSession(VALID_SESSION);

    let capturedConfig: any = {};
    mock.onGet("/test").reply((config) => {
      capturedConfig = config;
      return [200, {}];
    });

    await http.get("/test");
    expect(capturedConfig.headers?.Authorization).toBe(`Bearer ${VALID_SESSION.accessToken}`);
  });
});

describe("Request interceptor — security headers for state-changing methods", () => {
  beforeEach(() => {
    saveSession(VALID_SESSION);
  });

  it("adds timestamp and nonce headers for POST requests", async () => {
    let capturedConfig: any = {};
    mock.onPost("/test").reply((config) => {
      capturedConfig = config;
      return [200, {}];
    });

    await http.post("/test", {});
    expect(typeof capturedConfig.headers?.["x-request-timestamp"]).toBe("string");
    expect(typeof capturedConfig.headers?.["x-request-nonce"]).toBe("string");
    expect(capturedConfig.headers?.["x-csrf-token"]).toBe(VALID_SESSION.csrfToken);
  });

  it("adds timestamp and nonce headers for PATCH requests", async () => {
    let capturedConfig: any = {};
    mock.onPatch("/test").reply((config) => {
      capturedConfig = config;
      return [200, {}];
    });

    await http.patch("/test", {});
    expect(typeof capturedConfig.headers?.["x-request-timestamp"]).toBe("string");
    expect(typeof capturedConfig.headers?.["x-request-nonce"]).toBe("string");
  });

  it("adds timestamp and nonce headers for DELETE requests", async () => {
    let capturedConfig: any = {};
    mock.onDelete("/test").reply((config) => {
      capturedConfig = config;
      return [200, {}];
    });

    await http.delete("/test");
    expect(typeof capturedConfig.headers?.["x-request-timestamp"]).toBe("string");
    expect(typeof capturedConfig.headers?.["x-request-nonce"]).toBe("string");
  });

  it("does not add timestamp/nonce headers for GET requests", async () => {
    let capturedConfig: any = {};
    mock.onGet("/test").reply((config) => {
      capturedConfig = config;
      return [200, {}];
    });

    await http.get("/test");
    expect(capturedConfig.headers?.["x-request-timestamp"]).toBeUndefined();
    expect(capturedConfig.headers?.["x-request-nonce"]).toBeUndefined();
  });
});

describe("Response interceptor — session clear on 401", () => {
  it("clears session when server returns 401", async () => {
    saveSession(VALID_SESSION);
    expect(localStorage.getItem("incident.session")).not.toBeNull();

    mock.onPost("/test").reply(401, { error: "Unauthorized" });

    await expect(http.post("/test", {})).rejects.toMatchObject({ response: { status: 401 } });

    expect(localStorage.getItem("incident.session")).toBeNull();
  });

  it("does not clear session on other errors", async () => {
    saveSession(VALID_SESSION);
    mock.onPost("/test").reply(500, { error: "Server error" });

    await expect(http.post("/test", {})).rejects.toMatchObject({ response: { status: 500 } });

    expect(localStorage.getItem("incident.session")).not.toBeNull();
  });
});
