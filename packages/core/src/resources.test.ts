// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  RESOURCE_KINDS,
  ResourceLedger,
  cancellationFromSignal,
  normalizeCancellationReason,
  resourceUsageDelta,
} from "./resources";

describe("evaluation resource ledger", () => {
  it("rejects an over-limit debit without changing any counter", () => {
    const ledger = new ResourceLedger({ limits: { steps: 3, branches: 2 }, startedAtMs: 10 });
    expect(ledger.tryConsumeMany({ steps: 2, branches: 1 }, "root")).toBeUndefined();
    expect(ledger.tryConsumeMany({ steps: 1, branches: 2 }, "fork")).toEqual({
      kind: "resource-limit",
      resource: "branches",
      limit: 2,
      consumed: 1,
      requested: 2,
      operation: "fork",
    });
    expect(ledger.used("steps")).toBe(2);
    expect(ledger.used("branches")).toBe(1);
  });

  it("shares aggregate consumption across nested leases", () => {
    const ledger = new ResourceLedger({ limits: { steps: 4 } });
    const root = ledger.lease("root");
    const nested = root.fork("collapse");
    expect(root.tryConsume("steps", 2)).toBeUndefined();
    expect(nested.tryConsume("steps", 2)).toBeUndefined();
    expect(nested.tryConsume("steps", 1)).toMatchObject({
      kind: "resource-limit",
      consumed: 4,
      requested: 1,
    });
    expect(() => root.fork("")).toThrow("must not be empty");
    nested.close();
    expect(() => nested.tryConsume("steps")).toThrow("is closed");
  });

  it("accounts elapsed time once and reports snapshot deltas", () => {
    const ledger = new ResourceLedger({ limits: { "wall-time-ms": 10 }, startedAtMs: 100 });
    const before = ledger.snapshot();
    expect(ledger.checkTime(107)).toBeUndefined();
    expect(ledger.checkTime(108)).toBeUndefined();
    const after = ledger.snapshot();
    expect(after.used["wall-time-ms"]).toBe(8);
    expect(resourceUsageDelta(before, after)["wall-time-ms"]).toBe(8);
    expect(ledger.checkTime(111, "deadline")).toMatchObject({
      resource: "wall-time-ms",
      limit: 10,
      consumed: 8,
      requested: 3,
      operation: "deadline",
    });
  });

  it("normalizes AbortSignal reasons without retaining host objects", () => {
    const controller = new AbortController();
    expect(cancellationFromSignal(controller.signal)).toBeUndefined();
    controller.abort({ code: "winner-found", message: "tail pruned" });
    expect(cancellationFromSignal(controller.signal, "once")).toEqual({
      kind: "cancelled",
      reason: { code: "winner-found", message: "tail pruned" },
      operation: "once",
    });
    expect(normalizeCancellationReason(new Error("boom"))).toMatchObject({ message: "boom" });
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "code", {
      get(): never {
        throw new Error("hostile cancellation getter");
      },
    });
    expect(normalizeCancellationReason(hostile)).toEqual({ code: "aborted" });
  });

  it("never advances past a generated limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000 }),
        fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 100 }),
        (limit, debits) => {
          const ledger = new ResourceLedger({ limits: { results: limit } });
          let accepted = 0;
          for (const debit of debits) {
            const fault = ledger.tryConsume("results", debit);
            if (fault === undefined) accepted += debit;
            else if (ledger.used("results") !== accepted) return false;
          }
          return accepted <= limit && ledger.used("results") === accepted;
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("starts every resource counter at zero", () => {
    const snapshot = new ResourceLedger().snapshot();
    for (const kind of RESOURCE_KINDS) expect(snapshot.used[kind]).toBe(0);
  });
});
