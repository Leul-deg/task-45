export const APP_ROLES = [
  "Administrator",
  "Reporter",
  "Dispatcher",
  "Safety Manager",
  "Auditor",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export interface AuthClaims {
  sub: number;
  username: string;
  role: AppRole;
  csrfToken: string;
  jti: string;
  iat?: number;
  exp?: number;
}
