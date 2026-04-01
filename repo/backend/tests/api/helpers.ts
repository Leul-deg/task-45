import crypto from "crypto";
import jwt from "jsonwebtoken";

export const TEST_SECRET = "test_secret";
export const TEST_CSRF = "abcd1234efgh5678ijkl9012mnop3456";
export const TEST_JTI = "00000000-0000-0000-0000-000000000001";

export function makeTestToken(
  userId: number,
  username: string,
  role: string,
  expiresIn = "15m",
) {
  return jwt.sign(
    {
      sub: userId,
      username,
      role,
      csrfToken: TEST_CSRF,
      jti: TEST_JTI,
    },
    TEST_SECRET,
    { expiresIn } as jwt.SignOptions,
  );
}

export function authHeaders(token: string, csrf = TEST_CSRF) {
  return {
    Authorization: `Bearer ${token}`,
    "x-csrf-token": csrf,
    "x-request-timestamp": Date.now().toString(),
    "x-request-nonce": crypto.randomUUID(),
  };
}

export function freshNonce() {
  return crypto.randomUUID();
}
