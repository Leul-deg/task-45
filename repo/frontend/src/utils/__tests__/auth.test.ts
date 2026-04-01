import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearSession,
  defaultRouteForRole,
  getSession,
  hasValidSession,
  isPrivacyConsentAccepted,
  saveSession,
  setPrivacyConsentAccepted,
  type AuthSession,
} from "../auth";

const VALID_SESSION: AuthSession = {
  accessToken: "test-token-abc123",
  expiresAt: Date.now() + 15 * 60 * 1000,
  csrfToken: "csrf-token-xyz",
  user: { id: 1, username: "testuser", role: "Reporter" },
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("saveSession and getSession", () => {
  it("stores session in localStorage", () => {
    saveSession(VALID_SESSION);
    expect(localStorage.getItem("incident.session")).not.toBeNull();
  });

  it("retrieves and parses stored session", () => {
    saveSession(VALID_SESSION);
    const session = getSession();
    expect(session).not.toBeNull();
    expect(session?.accessToken).toBe(VALID_SESSION.accessToken);
    expect(session?.user.username).toBe("testuser");
    expect(session?.user.role).toBe("Reporter");
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem("incident.session", "not valid json at all {{{");
    expect(getSession()).toBeNull();
  });

  it("returns null for session missing required fields", () => {
    localStorage.setItem("incident.session", JSON.stringify({ foo: "bar" }));
    expect(getSession()).toBeNull();
  });
});

describe("clearSession", () => {
  it("removes session from localStorage", () => {
    saveSession(VALID_SESSION);
    expect(localStorage.getItem("incident.session")).not.toBeNull();
    clearSession();
    expect(localStorage.getItem("incident.session")).toBeNull();
  });
});

describe("hasValidSession", () => {
  it("returns true when expiresAt is in the future", () => {
    const futureSession: AuthSession = { ...VALID_SESSION, expiresAt: Date.now() + 15 * 60 * 1000 };
    saveSession(futureSession);
    expect(hasValidSession()).toBe(true);
  });

  it("returns false when expiresAt is in the past", () => {
    const expiredSession: AuthSession = { ...VALID_SESSION, expiresAt: Date.now() - 1000 };
    saveSession(expiredSession);
    expect(hasValidSession()).toBe(false);
  });

  it("returns false when no session exists", () => {
    expect(hasValidSession()).toBe(false);
  });
});

describe("isPrivacyConsentAccepted / setPrivacyConsentAccepted", () => {
  it("isPrivacyConsentAccepted returns false by default", () => {
    expect(isPrivacyConsentAccepted()).toBe(false);
  });

  it("setPrivacyConsentAccepted(true) stores true", () => {
    saveSession(VALID_SESSION);
    setPrivacyConsentAccepted(true);
    expect(isPrivacyConsentAccepted()).toBe(true);
    expect(localStorage.getItem("incident.privacy_consent.v1.1")).toBe("true");
  });

  it("setPrivacyConsentAccepted(false) stores false", () => {
    saveSession(VALID_SESSION);
    setPrivacyConsentAccepted(true);
    setPrivacyConsentAccepted(false);
    expect(isPrivacyConsentAccepted()).toBe(false);
    expect(localStorage.getItem("incident.privacy_consent.v1.1")).toBe("false");
  });

  it("scopes consent per user", () => {
    const session1: AuthSession = { ...VALID_SESSION, user: { id: 10, username: "user1", role: "Reporter" } };
    const session2: AuthSession = { ...VALID_SESSION, user: { id: 20, username: "user2", role: "Reporter" } };
    saveSession(session1);
    setPrivacyConsentAccepted(true);
    expect(isPrivacyConsentAccepted()).toBe(true);
    saveSession(session2);
    expect(isPrivacyConsentAccepted()).toBe(false);
  });
});

describe("defaultRouteForRole", () => {
  it('returns "/admin" for Auditor', () => {
    expect(defaultRouteForRole("Auditor")).toBe("/admin");
  });

  it('returns "/search" for Safety Manager', () => {
    expect(defaultRouteForRole("Safety Manager")).toBe("/search");
  });

  it('returns "/search" for Administrator', () => {
    expect(defaultRouteForRole("Administrator")).toBe("/search");
  });

  it('returns "/triage" for Dispatcher', () => {
    expect(defaultRouteForRole("Dispatcher")).toBe("/triage");
  });

  it('returns "/report" for Reporter', () => {
    expect(defaultRouteForRole("Reporter")).toBe("/report");
  });
});
