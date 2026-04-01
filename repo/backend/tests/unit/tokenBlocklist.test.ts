import { isTokenRevoked, revokeToken, loadRevokedTokensFromDb } from "../../src/utils/tokenBlocklist";

jest.mock("../../src/db/pool", () => ({
  dbPool: {
    query: jest.fn().mockResolvedValue([[]]),
    execute: jest.fn().mockResolvedValue([{}]),
  },
}));

describe("tokenBlocklist", () => {
  describe("isTokenRevoked", () => {
    test("returns false for unknown tokens", () => {
      expect(isTokenRevoked("unknown-token-id")).toBe(false);
    });
  });

  describe("revokeToken", () => {
    test("isTokenRevoked returns true after revokeToken", async () => {
      const jti = "token-to-revoke-123";
      expect(isTokenRevoked(jti)).toBe(false);

      await revokeToken(jti, Math.floor(Date.now() / 1000) + 900);

      expect(isTokenRevoked(jti)).toBe(true);
    });

    test("revoking same token twice does not throw", async () => {
      const jti = "duplicate-revoke-test";
      await expect(revokeToken(jti, Math.floor(Date.now() / 1000) + 900)).resolves.not.toThrow();
      await expect(revokeToken(jti, Math.floor(Date.now() / 1000) + 900)).resolves.not.toThrow();
    });
  });

  describe("loadRevokedTokensFromDb", () => {
    test("loads without throwing when DB returns empty", async () => {
      await expect(loadRevokedTokensFromDb()).resolves.not.toThrow();
    });
  });
});
