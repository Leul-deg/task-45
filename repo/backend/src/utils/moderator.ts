const blockedTerms = ["password", "credit card", "ssn", "social security number", "api key", "secret"];

const piiPatterns: Array<{ name: string; regex: RegExp }> = [
  { name: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { name: "phone", regex: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/ },
  { name: "possible_id", regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "card_number", regex: /\b(?:\d[ -]*?){13,19}\b/ },
];

export interface ModerationIssue {
  field: string;
  type: "blocked_term" | "pii";
  detail: string;
}

export function moderateTextInputs(values: Record<string, string | undefined | null>): ModerationIssue[] {
  const issues: ModerationIssue[] = [];

  for (const [field, raw] of Object.entries(values)) {
    if (!raw) {
      continue;
    }

    const value = raw.trim();
    const normalized = value.toLowerCase();

    for (const term of blockedTerms) {
      if (normalized.includes(term)) {
        issues.push({
          field,
          type: "blocked_term",
          detail: `Contains blocked term: ${term}`,
        });
      }
    }

    for (const pattern of piiPatterns) {
      if (pattern.regex.test(value)) {
        issues.push({
          field,
          type: "pii",
          detail: `Detected possible PII (${pattern.name})`,
        });
      }
    }
  }

  return issues;
}
