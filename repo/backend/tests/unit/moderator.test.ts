import { moderateTextInputs } from "../../src/utils/moderator";

describe("moderateTextInputs", () => {
  test("returns empty array for clean text", () => {
    const issues = moderateTextInputs({
      description: "Worker slipped on a wet floor near the entrance.",
      notes: "No injuries reported.",
    });
    expect(issues).toHaveLength(0);
  });

  test("detects blocked terms", () => {
    const terms = ["password", "credit card", "ssn", "social security number", "api key", "secret"];
    for (const term of terms) {
      const issues = moderateTextInputs({ field: term });
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe("blocked_term");
      expect(issues[0].field).toBe("field");
    }
  });

  test("detects email PII pattern", () => {
    const issues = moderateTextInputs({ field: "Contact john.doe@email.com for details" });
    expect(issues.some((i) => i.type === "pii" && i.detail.includes("email"))).toBe(true);
  });

  test("detects phone number PII pattern", () => {
    const issues = moderateTextInputs({ field: "Call me at 555-123-4567" });
    expect(issues.some((i) => i.type === "pii" && i.detail.includes("phone"))).toBe(true);
  });

  test("detects SSN-like pattern", () => {
    const issues = moderateTextInputs({ field: "ID: 123-45-6789" });
    expect(issues.some((i) => i.type === "pii" && i.detail.includes("possible_id"))).toBe(true);
  });

  test("detects card-number-like pattern", () => {
    const issues = moderateTextInputs({ field: "Card: 4111 1111 1111 1111" });
    expect(issues.some((i) => i.type === "pii" && i.detail.includes("card_number"))).toBe(true);
  });

  test("handles null and undefined fields gracefully", () => {
    expect(() =>
      moderateTextInputs({
        a: null,
        b: undefined,
        c: "",
      }),
    ).not.toThrow();
    const issues = moderateTextInputs({ a: null as unknown as string, b: undefined as unknown as string });
    expect(issues).toHaveLength(0);
  });

  test("is case-insensitive for blocked terms", () => {
    const upper = moderateTextInputs({ field: "PASSWORD leaked" });
    const mixed = moderateTextInputs({ field: "My PASSWORD is visible" });
    const lower = moderateTextInputs({ field: "secret info here" });

    expect(upper.length).toBeGreaterThan(0);
    expect(mixed.length).toBeGreaterThan(0);
    expect(lower.length).toBeGreaterThan(0);
  });

  test("returns multiple issues for multiple violations in same field", () => {
    const issues = moderateTextInputs({ field: "Email: john@test.com and password: supersecret" });
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});
