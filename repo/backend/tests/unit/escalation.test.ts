/**
 * Unit tests for cron/escalation.ts — severity-rule auto-escalation.
 */

jest.mock("../../src/db/pool", () => {
  const queryFn = jest.fn();
  const beginTransaction = jest.fn();
  const commit = jest.fn();
  const rollback = jest.fn();
  const release = jest.fn();
  const connQuery = jest.fn();
  const connExecute = jest.fn();

  const connection = {
    beginTransaction,
    commit,
    rollback,
    release,
    query: connQuery,
    execute: connExecute,
  };

  return {
    dbPool: {
      query: queryFn,
      getConnection: jest.fn(async () => connection),
    },
    __queryFn: queryFn,
    __connQuery: connQuery,
    __connExecute: connExecute,
    __beginTransaction: beginTransaction,
    __commit: commit,
    __rollback: rollback,
    __release: release,
  };
});

import { runSeverityAutoEscalation } from "../../src/cron/escalation";

const { __queryFn: queryFn, __connQuery: connQuery, __connExecute: connExecute } = jest.requireMock(
  "../../src/db/pool",
) as {
  __queryFn: jest.Mock;
  __connQuery: jest.Mock;
  __connExecute: jest.Mock;
  __beginTransaction: jest.Mock;
  __commit: jest.Mock;
  __rollback: jest.Mock;
  __release: jest.Mock;
};

const { __beginTransaction: beginTransaction, __commit: commit, __rollback: rollback, __release: release } =
  jest.requireMock("../../src/db/pool") as {
    __beginTransaction: jest.Mock;
    __commit: jest.Mock;
    __rollback: jest.Mock;
    __release: jest.Mock;
  };

describe("runSeverityAutoEscalation", () => {
  beforeEach(() => {
    queryFn.mockReset();
    connQuery.mockReset();
    connExecute.mockReset();
    beginTransaction.mockReset();
    commit.mockReset();
    rollback.mockReset();
    release.mockReset();
    beginTransaction.mockResolvedValue(undefined);
    commit.mockResolvedValue(undefined);
    rollback.mockResolvedValue(undefined);
    connExecute.mockResolvedValue([{ affectedRows: 1 }, []]);
  });

  test("returns 0 when severity_rules are empty", async () => {
    queryFn.mockResolvedValueOnce([[{ config_value: "[]" }], []]);

    const n = await runSeverityAutoEscalation();
    expect(n).toBe(0);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  test("returns 0 when no incidents exceed escalate_after_hours", async () => {
    const recent = new Date();
    queryFn
      .mockResolvedValueOnce([
        [
          {
            config_value: JSON.stringify([
              { incident_type: "Injury", severity: "high", auto_escalate: true, escalate_after_hours: 999 },
            ]),
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ id: 1, type: "Injury", status: "New", created_at: recent }], []]);

    const n = await runSeverityAutoEscalation();
    expect(n).toBe(0);
    expect(beginTransaction).not.toHaveBeenCalled();
  });

  test("escalates an eligible incident and commits", async () => {
    const old = new Date(Date.now() - 5 * 3600 * 1000);
    queryFn
      .mockResolvedValueOnce([
        [
          {
            config_value: JSON.stringify([
              { incident_type: "Injury", severity: "high", auto_escalate: true, escalate_after_hours: 1 },
            ]),
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ id: 42, type: "Injury", status: "New", created_at: old }], []]);

    connQuery.mockResolvedValueOnce([[{ id: 42, type: "Injury", status: "New", created_at: old }], []]);

    const n = await runSeverityAutoEscalation();
    expect(n).toBe(1);
    expect(beginTransaction).toHaveBeenCalled();
    expect(connExecute).toHaveBeenCalledWith("UPDATE incidents SET status = 'Escalated' WHERE id = ?", [42]);
    expect(commit).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  test("skips transaction when FOR UPDATE row no longer matches", async () => {
    const old = new Date(Date.now() - 5 * 3600 * 1000);
    queryFn
      .mockResolvedValueOnce([
        [
          {
            config_value: JSON.stringify([
              { incident_type: "Injury", severity: "high", auto_escalate: true, escalate_after_hours: 1 },
            ]),
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ id: 7, type: "Injury", status: "New", created_at: old }], []]);

    connQuery.mockResolvedValueOnce([[{ id: 7, type: "Injury", status: "Closed", created_at: old }], []]);

    const n = await runSeverityAutoEscalation();
    expect(n).toBe(0);
    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
