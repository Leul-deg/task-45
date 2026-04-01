export type UserRole =
  | "Administrator"
  | "Reporter"
  | "Dispatcher"
  | "Safety Manager"
  | "Auditor";

export interface AuthSession {
  accessToken: string;
  expiresAt: number;
  csrfToken: string;
  user: {
    id: number;
    username: string;
    role: UserRole;
  };
}

const SESSION_KEY = "incident.session";
const CONSENT_KEY = "incident.privacy_consent.v1";

export function saveSession(session: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getSession(): AuthSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.accessToken || !parsed?.expiresAt || !parsed?.user?.role) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function hasValidSession(): boolean {
  const session = getSession();
  if (!session) {
    return false;
  }

  return Date.now() < session.expiresAt;
}

export function setPrivacyConsentAccepted(value: boolean): void {
  const session = getSession();
  const userId = session?.user?.id ?? "unknown";
  localStorage.setItem(`${CONSENT_KEY}.${userId}`, value ? "true" : "false");
}

export function isPrivacyConsentAccepted(): boolean {
  const session = getSession();
  const userId = session?.user?.id ?? "unknown";
  return localStorage.getItem(`${CONSENT_KEY}.${userId}`) === "true";
}

export async function syncConsentToServer(http: { post: (url: string, data: unknown) => Promise<unknown> }): Promise<void> {
  try {
    await http.post("/auth/consent", { consented: true });
  } catch {
    // Server sync is best-effort; localStorage is the primary check for UX
  }
}

export async function checkServerConsent(http: { get: (url: string) => Promise<{ data: { consented: boolean } }> }): Promise<boolean> {
  try {
    const response = await http.get("/auth/consent");
    return response.data.consented;
  } catch {
    return false;
  }
}

export function defaultRouteForRole(role: UserRole): string {
  if (role === "Auditor") {
    return "/admin";
  }

  if (role === "Safety Manager" || role === "Administrator") {
    return "/search";
  }

  if (role === "Dispatcher") {
    return "/triage";
  }

  if (role === "Reporter") {
    return "/report";
  }

  return "/triage";
}
