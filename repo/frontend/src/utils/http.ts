import axios, { AxiosHeaders } from "axios";
import { clearSession, getSession, saveSession } from "./auth";

const stateChangingMethods = new Set(["post", "put", "patch", "delete"]);
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

let refreshInProgress: Promise<void> | null = null;

function createNonce(length = 24): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function refreshTokenIfNeeded(): Promise<void> {
  const session = getSession();
  if (!session) return;

  const timeLeft = session.expiresAt - Date.now();
  if (timeLeft > REFRESH_THRESHOLD_MS || timeLeft <= 0) return;

  if (refreshInProgress) {
    await refreshInProgress;
    return;
  }

  refreshInProgress = (async () => {
    try {
      const response = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:3000"}/auth/refresh`,
        {},
        {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "x-request-timestamp": Date.now().toString(),
            "x-request-nonce": createNonce(),
            "x-csrf-token": session.csrfToken,
          },
        },
      );
      const data = response.data as {
        access_token: string;
        expires_in: number;
        csrf_token: string;
        user: { id: number; username: string; role: string };
      };
      saveSession({
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        csrfToken: data.csrf_token,
        user: data.user as any,
      });
    } catch {
      // Refresh failed; session will expire naturally
    } finally {
      refreshInProgress = null;
    }
  })();

  await refreshInProgress;
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000",
  timeout: 15000,
});

http.interceptors.request.use(async (config) => {
  await refreshTokenIfNeeded();

  const session = getSession();
  config.headers = config.headers ?? new AxiosHeaders();

  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const method = (config.method || "get").toLowerCase();
  if (stateChangingMethods.has(method)) {
    config.headers["x-request-timestamp"] = Date.now().toString();
    config.headers["x-request-nonce"] = createNonce();

    if (session?.csrfToken) {
      config.headers["x-csrf-token"] = session.csrfToken;
    }
  }

  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearSession();
    }
    return Promise.reject(error);
  },
);
