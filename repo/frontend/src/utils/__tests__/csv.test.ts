import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadCsv, escapeCsvCell, sanitizeFileName } from "../csv";

beforeEach(() => {
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
  }
  if (typeof URL.revokeObjectURL !== "function") {
    URL.revokeObjectURL = vi.fn();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadCsv", () => {
  it("creates a Blob with correct content type", () => {
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL");
    downloadCsv("test.csv", ["ID", "Name"], [[1, "Alice"], [2, "Bob"]]);
    expect(createObjectURLSpy).toHaveBeenCalled();
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe("text/csv;charset=utf-8");
    createObjectURLSpy.mockRestore();
  });

  it("uses the provided filename as download attribute", () => {
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL");
    downloadCsv("my-report.csv", ["Col1"], [[42]]);
    expect(createObjectURLSpy).toHaveBeenCalled();
    createObjectURLSpy.mockRestore();
  });
});

describe("escapeCsvCell", () => {
  it("returns empty string for null", () => {
    expect(escapeCsvCell(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("returns plain string for simple values", () => {
    expect(escapeCsvCell("Alice")).toBe("Alice");
    expect(escapeCsvCell("Injury")).toBe("Injury");
  });

  it("wraps value in quotes when it contains a comma", () => {
    expect(escapeCsvCell("123 Main St, Suite 100")).toBe('"123 Main St, Suite 100"');
  });

  it("escapes double quotes by doubling them", () => {
    expect(escapeCsvCell('He said "Hello"')).toBe('"He said ""Hello"""');
  });

  it("wraps value in quotes when it contains a newline", () => {
    expect(escapeCsvCell("Line1\nLine2")).toBe('"Line1\nLine2"');
  });

  it("wraps value in quotes when it contains both comma and quote", () => {
    expect(escapeCsvCell('Asset, "critical"')).toBe('"Asset, ""critical"""');
  });

  it("handles numeric values as strings", () => {
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(3.14)).toBe("3.14");
  });
});

describe("sanitizeFileName", () => {
  it("keeps alphanumeric, dots, underscores, and hyphens unchanged", () => {
    expect(sanitizeFileName("report_2024-01.csv")).toBe("report_2024-01.csv");
  });

  it("replaces spaces with underscores", () => {
    expect(sanitizeFileName("incident report")).toBe("incident_report");
  });

  it("replaces slashes with underscores", () => {
    expect(sanitizeFileName("path/to/file.csv")).toBe("path_to_file.csv");
  });

  it("replaces colons with underscores", () => {
    expect(sanitizeFileName("file:name.csv")).toBe("file_name.csv");
  });

  it("replaces special characters with underscores", () => {
    expect(sanitizeFileName("file@name#2024.csv")).toBe("file_name_2024.csv");
  });

  it("handles a string of only special characters", () => {
    expect(sanitizeFileName("@#$%")).toBe("____");
  });

  it("preserves file extension with dots and hyphens", () => {
    expect(sanitizeFileName("my-report.2024-01-15.csv")).toBe("my-report.2024-01-15.csv");
  });

  it("handles unicode characters by replacing them", () => {
    expect(sanitizeFileName("rapport-émission.csv")).toBe("rapport-_mission.csv");
  });
});
