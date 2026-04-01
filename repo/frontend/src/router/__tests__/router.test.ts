import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  saveSession,
  setPrivacyConsentAccepted,
} from "../../utils/auth";
import type { UserRole } from "../../utils/auth";

vi.mock("../../utils/http", () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

function makeSession(role: UserRole) {
  return {
    accessToken: "test-token",
    expiresAt: Date.now() + 15 * 60 * 1000,
    csrfToken: "test-csrf",
    user: { id: 1, username: "testuser", role },
  };
}

beforeEach(() => {
  localStorage.clear();
  setPrivacyConsentAccepted(false);
});

afterEach(() => {
  localStorage.clear();
});

async function importRouter() {
  vi.resetModules();
  const mod = await import("../index");
  return mod.default;
}

describe("Unauthenticated users are redirected to /login", () => {
  it("redirects /report to /login when no session", async () => {
    const router = await importRouter();
    await router.push("/report");
    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("redirects /admin to /login when no session", async () => {
    const router = await importRouter();
    await router.push("/admin");
    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("allows public /login route without session", async () => {
    const router = await importRouter();
    await router.push("/login");
    expect(router.currentRoute.value.path).toBe("/login");
  });
});

describe("Reporter role can access /report but not /admin", () => {
  beforeEach(() => {
    saveSession(makeSession("Reporter"));
    setPrivacyConsentAccepted(true);
  });

  it("Reporter can access /report", async () => {
    const router = await importRouter();
    await router.push("/report");
    expect(router.currentRoute.value.path).toBe("/report");
  });

  it("Reporter is redirected away from /admin", async () => {
    const router = await importRouter();
    await router.push("/admin");
    expect(router.currentRoute.value.path).toBe("/report");
  });

  it("Reporter cannot access /triage (Dispatcher role required)", async () => {
    const router = await importRouter();
    await router.push("/triage");
    expect(router.currentRoute.value.path).toBe("/report");
  });
});

describe("Dispatcher role can access /triage", () => {
  beforeEach(() => {
    saveSession(makeSession("Dispatcher"));
    setPrivacyConsentAccepted(true);
  });

  it("Dispatcher can access /triage", async () => {
    const router = await importRouter();
    await router.push("/triage");
    expect(router.currentRoute.value.path).toBe("/triage");
  });

  it("Dispatcher cannot access /report", async () => {
    const router = await importRouter();
    await router.push("/report");
    expect(router.currentRoute.value.path).toBe("/triage");
  });
});

describe("Privacy consent redirect", () => {
  it("redirects to /privacy-consent when consent not given", async () => {
    saveSession(makeSession("Reporter"));
    const router = await importRouter();
    await router.push("/report");
    expect(router.currentRoute.value.path).toBe("/privacy-consent");
  });

  it("allows access to /privacy-consent without consent", async () => {
    saveSession(makeSession("Reporter"));
    const router = await importRouter();
    await router.push("/privacy-consent");
    expect(router.currentRoute.value.path).toBe("/privacy-consent");
  });

  it("allows access when consent is given", async () => {
    saveSession(makeSession("Reporter"));
    setPrivacyConsentAccepted(true);
    const router = await importRouter();
    await router.push("/report");
    expect(router.currentRoute.value.path).toBe("/report");
  });
});

describe("Login page redirect for authenticated users", () => {
  it("redirects authenticated user from /login to their default route", async () => {
    saveSession(makeSession("Reporter"));
    setPrivacyConsentAccepted(true);
    const router = await importRouter();
    await router.push("/login");
    expect(router.currentRoute.value.path).toBe("/report");
  });

  it("redirects authenticated admin from /login to /search", async () => {
    saveSession(makeSession("Administrator"));
    setPrivacyConsentAccepted(true);
    const router = await importRouter();
    await router.push("/login");
    expect(router.currentRoute.value.path).toBe("/search");
  });
});
