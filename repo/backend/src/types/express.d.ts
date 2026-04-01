import type { AuthClaims } from "./auth";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }

    interface Locals {
      auditBefore?: unknown;
      auditAfter?: unknown;
      auditAction?: string;
    }
  }
}

export {};
