/**
 * Unit tests for cron modules.
 *
 * cron/alerts.ts — anomaly detection (mass exports, auth failures, edit spike)
 * cron/backup.ts — encrypted database backup and retention pruning
 *
 * All external dependencies are mocked: DB pool, file system, child_process.
 * No real disk I/O or database connections occur.
 */

import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";

// ─── Module mocks (hoisted before any import) ─────────────────────────────

jest.mock("../../src/db/pool", () => {
  const queryFn = jest.fn();
  return {
    dbPool: { query: queryFn },
    __queryFn: queryFn,
  };
});

jest.mock("fs/promises", () => ({
  appendFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("fs", () => {
  return {
    createReadStream: jest.fn(() => {
      const pt = new PassThrough();
      setImmediate(() => {
        pt.write(Buffer.from("-- mock sql dump\n"));
        pt.end();
      });
      return pt;
    }),
    createWriteStream: jest.fn(() => {
      return new Writable({ write(_chunk, _enc, cb) { cb(); } });
    }),
  };
});

jest.mock("child_process", () => ({ spawn: jest.fn() }));

// ─── Imports (after mock declarations) ────────────────────────────────────

import { appendFile } from "fs/promises";
import { spawn } from "child_process";
import { runAnomalyDetectors, startAlertCronJobs } from "../../src/cron/alerts";
import { runNightlyBackup, runMonthlyArchive, startBackupCronJobs } from "../../src/cron/backup";
import { startEscalationCronJobs } from "../../src/cron/escalation";

const { __queryFn: queryFn } = jest.requireMock("../../src/db/pool") as {
  __queryFn: jest.Mock;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeMockChild(exitCode: number) {
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  (child as any).stdout = new PassThrough();
  (child as any).stderr = new EventEmitter();
  setImmediate(() => {
    ((child as any).stdout as PassThrough).end();
    child.emit("close", exitCode);
  });
  return child;
}

// ─── cron/alerts.ts ───────────────────────────────────────────────────────

describe("runAnomalyDetectors — mass CSV exports", () => {
  beforeEach(() => {
    queryFn.mockReset();
    (appendFile as jest.Mock).mockClear();
  });

  test("writes alert when a user has ≥3 exports in the past 15 minutes", async () => {
    queryFn
      .mockResolvedValueOnce([[{ user_id: 7, export_count: 5 }], []]) // mass exports
      .mockResolvedValueOnce([[], []])                                 // auth failures
      .mockResolvedValueOnce([[{ edits_last_15m: 0, baseline_15m: 0 }], []]);

    await runAnomalyDetectors();

    expect(appendFile).toHaveBeenCalledTimes(1);
    const written = (appendFile as jest.Mock).mock.calls[0][1] as string;
    const alert = JSON.parse(written.trim());
    expect(alert.type).toBe("mass_csv_exports");
    expect(alert.user_id).toBe(7);
    expect(alert.export_count).toBe(5);
    expect(typeof alert.at).toBe("string");
  });

  test("writes one alert per user who exceeds the export threshold", async () => {
    queryFn
      .mockResolvedValueOnce([[
        { user_id: 1, export_count: 4 },
        { user_id: 2, export_count: 7 },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ edits_last_15m: 0, baseline_15m: 0 }], []]);

    await runAnomalyDetectors();

    expect(appendFile).toHaveBeenCalledTimes(2);
  });

  test("writes no alert when no users exceed the export threshold", async () => {
    queryFn
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ edits_last_15m: 0, baseline_15m: 0 }], []]);

    await runAnomalyDetectors();

    expect(appendFile).not.toHaveBeenCalled();
  });
});

describe("runAnomalyDetectors — repeated auth failures", () => {
  beforeEach(() => {
    queryFn.mockReset();
    (appendFile as jest.Mock).mockClear();
  });

  test("writes alert for each locked or high-failure user", async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    queryFn
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[
        { id: 2, username: "reporter1", login_attempts: 10, locked_until: lockedUntil },
        { id: 3, username: "dispatcher1", login_attempts: 12, locked_until: null },
      ], []])
      .mockResolvedValueOnce([[{ edits_last_15m: 0, baseline_15m: 0 }], []]);

    await runAnomalyDetectors();

    expect(appendFile).toHaveBeenCalledTimes(2);

    const firstAlert = JSON.parse((appendFile as jest.Mock).mock.calls[0][1] as string);
    expect(firstAlert.type).toBe("repeated_auth_failures");
    expect(firstAlert.username).toBe("reporter1");
    expect(firstAlert.login_attempts).toBe(10);
    expect(firstAlert.locked_until).toBeDefined();

    const secondAlert = JSON.parse((appendFile as jest.Mock).mock.calls[1][1] as string);
    expect(secondAlert.username).toBe("dispatcher1");
  });

  test("writes no alert when no locked or failed accounts exist", async () => {
    queryFn
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ edits_last_15m: 0, baseline_15m: 0 }], []]);

    await runAnomalyDetectors();

    expect(appendFile).not.toHaveBeenCalled();
  });
});

describe("runAnomalyDetectors — incident edit spike", () => {
  beforeEach(() => {
    queryFn.mockReset();
    (appendFile as jest.Mock).mockClear();
  });

  test("writes alert when current edits exceed max(12, baseline×3)", async () => {
    // threshold = max(12, 5×3) = 15; current = 30 → spike
    queryFn
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ edits_last_15m: 30, baseline_15m: 5 }], []]);

    await runAnomalyDetectors();

    expect(appendFile).toHaveBeenCalledTimes(1);
    const alert = JSON.parse((appendFile as jest.Mock).mock.calls[0][1] as string);
    expect(alert.type).toBe("incident_edit_spike");
    expect(alert.edits_last_15m).toBe(30);
    expect(typeof alert.threshold).toBe("number");
    expect(alert.threshold).toBeGreaterThanOrEqual(15);
  });

  test("uses the hardcoded minimum threshold of 12 when baseline is very low", async () => {
    // threshold = max(12, 1×3) = 12; current = 15 → spike
    queryFn
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ edits_last_15m: 15, baseline_15m: 1 }], []]);

    await runAnomalyDetectors();

    expect(appendFile).toHaveBeenCalledTimes(1);
    const alert = JSON.parse((appendFile as jest.Mock).mock.calls[0][1] as string);
    expect(alert.threshold).toBe(12);
  });

  test("does not write alert when edits are below threshold", async () => {
    // threshold = max(12, 10×3) = 30; current = 5 → no spike
    queryFn
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ edits_last_15m: 5, baseline_15m: 10 }], []]);

    await runAnomalyDetectors();

    expect(appendFile).not.toHaveBeenCalled();
  });

  test("does not write alert when query returns no rows", async () => {
    queryFn
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    await runAnomalyDetectors();

    expect(appendFile).not.toHaveBeenCalled();
  });
});

describe("startAlertCronJobs", () => {
  test("registers cron schedule without throwing", () => {
    expect(() => startAlertCronJobs()).not.toThrow();
  });
});

// ─── cron/backup.ts ───────────────────────────────────────────────────────

describe("runNightlyBackup — mysqldump failure", () => {
  beforeEach(() => {
    (spawn as jest.Mock).mockClear();
  });

  test("rejects with mysqldump error message when spawn exits non-zero", async () => {
    (spawn as jest.Mock).mockReturnValue(makeMockChild(1));

    await expect(runNightlyBackup()).rejects.toThrow(/mysqldump failed/i);
  });

  test("propagates non-zero exit code in the error message", async () => {
    (spawn as jest.Mock).mockReturnValue(makeMockChild(2));

    let errorMessage = "";
    try {
      await runNightlyBackup();
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    expect(errorMessage).toMatch(/\(2\)/);
  });
});

describe("runMonthlyArchive — mysqldump failure", () => {
  beforeEach(() => {
    (spawn as jest.Mock).mockClear();
  });

  test("rejects with mysqldump error message when spawn exits non-zero", async () => {
    (spawn as jest.Mock).mockReturnValue(makeMockChild(1));

    await expect(runMonthlyArchive()).rejects.toThrow(/mysqldump failed/i);
  });
});

describe("runNightlyBackup — success path", () => {
  beforeEach(() => {
    (spawn as jest.Mock).mockClear();
  });

  test("resolves without error when mysqldump exits 0", async () => {
    (spawn as jest.Mock).mockReturnValue(makeMockChild(0));
    await runNightlyBackup();
  });
});

describe("runMonthlyArchive — success path", () => {
  beforeEach(() => {
    (spawn as jest.Mock).mockClear();
  });

  test("resolves without error when mysqldump exits 0", async () => {
    (spawn as jest.Mock).mockReturnValue(makeMockChild(0));
    await runMonthlyArchive();
  });
});

describe("startBackupCronJobs", () => {
  test("registers nightly and monthly cron schedules without throwing", () => {
    expect(() => startBackupCronJobs()).not.toThrow();
  });
});

describe("startEscalationCronJobs", () => {
  test("registers severity auto-escalation schedule without throwing", () => {
    expect(() => startEscalationCronJobs()).not.toThrow();
  });
});
