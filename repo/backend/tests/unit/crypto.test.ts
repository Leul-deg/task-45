import { encryptAtRest, decryptAtRest, maskField } from "../../src/utils/crypto";

beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = "test-key-for-unit-tests-32-bytes!!";
});

afterAll(() => {
  delete process.env.DATA_ENCRYPTION_KEY;
});

describe("encryptAtRest / decryptAtRest", () => {
  test("returns base64:base64:base64 format", () => {
    const encrypted = encryptAtRest("hello world");
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    parts.forEach((part) => {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    });
  });

  test("round-trip works correctly", () => {
    const plaintext = "sensitive data with unicode: \u00e9\u00e0\u00f1";
    const encrypted = encryptAtRest(plaintext);
    const decrypted = decryptAtRest(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test("different calls produce different outputs (random IV)", () => {
    const input = "same input";
    const a = encryptAtRest(input);
    const b = encryptAtRest(input);
    expect(a).not.toBe(b);
  });

  test("decryptAtRest throws on invalid payload", () => {
    expect(() => decryptAtRest("not-valid")).toThrow();
    expect(() => decryptAtRest("only-one-part")).toThrow();
    expect(() => decryptAtRest("a:b")).toThrow();
  });

  test("decryptAtRest throws on corrupted ciphertext", () => {
    const valid = encryptAtRest("test");
    const parts = valid.split(":");
    const corrupted = `${parts[0]}:${parts[1]}:${Buffer.from("tampered").toString("base64")}`;
    expect(() => decryptAtRest(corrupted)).toThrow();
  });
});

describe("maskField", () => {
  test('maskField("1234567890") defaults to last 4 visible', () => {
    expect(maskField("1234567890")).toBe("******7890");
  });

  test("maskField accepts custom visible count", () => {
    expect(maskField("1234567890", 6)).toBe("****567890");
    expect(maskField("1234567890", 2)).toBe("********90");
  });

  test("maskField returns value as-is when shorter than visible", () => {
    expect(maskField("ab", 4)).toBe("ab");
    expect(maskField("x", 4)).toBe("x");
  });

  test("maskField uses custom mask character", () => {
    expect(maskField("1234567890", 4, "#")).toBe("######7890");
  });

  test("maskField with zero visible returns fully masked string", () => {
    expect(maskField("1234567890", 0)).toBe("**********");
  });

  test("maskField with negative visible returns value unchanged", () => {
    expect(maskField("1234567890", -1)).toBe("1234567890");
  });
});
