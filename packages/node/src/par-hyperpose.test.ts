// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { afterEach, describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import {
  format,
  MAX_WORKER_RESULT_BYTES,
  MAX_WORKER_TIMEOUT_MS,
  runProgramAsync,
  type QueryResult,
} from "@metta-ts/core";
import {
  activeHyperposeWorkerCount,
  evalBranchesParallel,
  evalBranchesParallelAsync,
  makeParEvalAsyncImpl,
  makeParEvalImpl,
} from "./par-hyperpose";
import { runSourceAsync } from "./source";

const shape = (rs: QueryResult[]): string[] =>
  rs.map((r) => "[" + r.results.map(format).join(", ") + "]");
const corePath = createRequire(import.meta.url).resolve("@metta-ts/core");

afterEach(() => {
  vi.unstubAllGlobals();
});

// All branches cheap, so the sequential fallback also finishes; only the result identity is under test.
// The `once` branches all evaluate to True: `(once (hyperpose …))` over a worker race returns the branch
// that finishes FIRST (time order, like PeTTa's forked threads), which only coincides with the sequential
// branch-0 result when every branch agrees. The collapsed calls below have one result per branch, so their
// source-ordered result bags are identical under the sequential and worker-backed evaluators.
const PROG = `
(= (find-divisor $n $test-divisor)
   (if (> (* $test-divisor $test-divisor) $n)
       $n
       (if (== 0 (% $n $test-divisor))
           $test-divisor
           (find-divisor $n (+ $test-divisor 1)))))
(= (prime? $n) (== $n (find-divisor $n 2)))
!(once (hyperpose ((prime? 7) (prime? 11) (prime? 13))))
!(collapse (hyperpose ((prime? 7) (prime? 8) (prime? 11))))
!(msort (collapse (let $xs (3 1 2) (hyperpose $xs))))
`;

describe("worker-thread hyperpose", () => {
  it("is byte-identical to the local scheduler and joins every worker", async () => {
    const baseline = activeHyperposeWorkerCount();
    const seq = await runProgramAsync(PROG, new Map(), 1_000_000);
    const par = await runProgramAsync(PROG, new Map(), 1_000_000, new Map(), {
      tabling: true,
      parEvalAsyncImpl: makeParEvalAsyncImpl(1_000_000),
    });
    expect(shape(par)).toEqual(shape(seq));
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("races branches so a cheap branch wins before an expensive one finishes", async () => {
    // The first branch burns enough recursive steps to keep its worker occupied while the second branch
    // can publish its first answer immediately.
    const prog = `
(= (burn 0 $value) $value)
(= (burn $n $value) (burn (- $n 1) $value))
(= (fast) ready)
!(once (hyperpose ((burn 500000 slow) (fast))))
`;
    const baseline = activeHyperposeWorkerCount();
    const par = await runSourceAsync(prog, new Map(), 1_000_000);
    expect(shape(par)).toEqual(["[ready]"]);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  }, 30_000);

  it("reports a branch's first answer without draining its long tail", async () => {
    const baseline = activeHyperposeWorkerCount();
    const results = await runSourceAsync(
      `
        (= (burn 0 $value) $value)
        (= (burn $n $value) (burn (- $n 1) $value))
        (= (branch-a) A0)
        (= (branch-a) (burn 20000 A1))
        (= (branch-b) (burn 2000 B))
        !(once (hyperpose ((branch-a) (branch-b))))
      `,
      new Map(),
      1_000_000,
    );

    expect(shape(results)).toEqual(["[A0]"]);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("falls back locally when a worker result carries scoped variables", async () => {
    const baseline = activeHyperposeWorkerCount();
    const results = await runSourceAsync(
      `
        (= (free-u6) $x)
        !(once (hyperpose ((free-u6))))
      `,
      new Map(),
      100_000,
    );
    const result = results[0]!.results[0];

    expect(result?.kind).toBe("var");
    expect(result === undefined ? undefined : format(result)).toMatch(/^\$x#/);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("declines an oversized race so a later finite branch cannot starve", async () => {
    const baseline = activeHyperposeWorkerCount();
    const result = await runProgramAsync(
      `
        (= (loop $x) (loop (S $x)))
        !(once (hyperpose ((loop A) (loop B) ready)))
      `,
      new Map(),
      10_000,
      new Map(),
      {
        tabling: true,
        parEvalAsyncImpl: makeParEvalAsyncImpl(10_000, { maxWorkers: 2 }),
      },
    );
    expect(shape(result)).toEqual(["[ready]"]);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  }, 30_000);

  it("turns result overflow into a joined local-fallback request", async () => {
    const baseline = activeHyperposeWorkerCount();
    const result = await evalBranchesParallelAsync(
      corePath,
      '(= (large-u6) "abcdefghijklmnopqrstuvwxyz")',
      ["(large-u6)"],
      false,
      10_000,
      { maxResultBytes: 8 },
    );

    expect(result).toEqual([null]);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("replays an overflowing branch locally without losing its answer", async () => {
    const source = `
      (= (large-u6) "abcdefghijklmnopqrstuvwxyz")
      !(once (hyperpose ((large-u6))))
    `;
    const baseline = activeHyperposeWorkerCount();
    const local = await runProgramAsync(source, new Map(), 10_000, new Map(), { tabling: true });
    const workerBacked = await runSourceAsync(source, new Map(), 10_000, new Map(), undefined, {
      maxResultBytes: 8,
    });

    expect(shape(workerBacked)).toEqual(shape(local));
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("terminates and joins a branch at its deadline", async () => {
    const baseline = activeHyperposeWorkerCount();
    const result = await evalBranchesParallelAsync(
      corePath,
      "(= (loop-u6 $value) (loop-u6 (S $value)))",
      ["(loop-u6 Z)"],
      false,
      1_000_000_000,
      { timeoutMs: 10 },
    );

    expect(result).toEqual([null]);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("terminates and joins every branch before exposing abort", async () => {
    const baseline = activeHyperposeWorkerCount();
    const controller = new AbortController();
    const reason = new Error("cancel Node workers");
    const result = evalBranchesParallelAsync(
      corePath,
      "(= (loop-u6 $value) (loop-u6 (S $value)))",
      ["(loop-u6 A)", "(loop-u6 B)"],
      false,
      1_000_000_000,
      { timeoutMs: 60_000 },
      controller.signal,
    );
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("reports joined cancellation through the owned core host contract", async () => {
    const baseline = activeHyperposeWorkerCount();
    const controller = new AbortController();
    const reason = new Error("cancel owned Node workers");
    const result = runProgramAsync(
      `
        (= (loop-u6 $value) (loop-u6 (S $value)))
        !(once (hyperpose ((loop-u6 A) (loop-u6 B))))
      `,
      new Map(),
      1_000_000_000,
      new Map(),
      {
        signal: controller.signal,
        tabling: true,
        parEvalAsyncImpl: makeParEvalAsyncImpl(1_000_000_000, { timeoutMs: 60_000 }),
      },
    );
    for (let attempt = 0; attempt < 100 && activeHyperposeWorkerCount() === baseline; attempt += 1)
      await new Promise<void>((resolve) => setImmediate(resolve));
    expect(activeHyperposeWorkerCount()).toBeGreaterThan(baseline);
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it.each([
    { timeoutMs: 0 },
    { timeoutMs: MAX_WORKER_TIMEOUT_MS + 1 },
    { maxResultBytes: Number.NaN },
    { maxResultBytes: MAX_WORKER_RESULT_BYTES + 1 },
    { maxWorkers: 1.5 },
  ])("rejects invalid worker bounds", async (options) => {
    await expect(
      evalBranchesParallelAsync(corePath, "", ["A"], false, 100, options),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("validates bounds before declining an oversized first-answer race", async () => {
    await expect(
      evalBranchesParallelAsync(corePath, "", ["A", "B"], true, 100, {
        maxWorkers: 1,
        timeoutMs: 0,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("falls back before starting workers when the shared result buffer cannot be allocated", async () => {
    const baseline = activeHyperposeWorkerCount();
    vi.stubGlobal(
      "SharedArrayBuffer",
      class {
        constructor() {
          throw new RangeError("allocation refused");
        }
      },
    );

    await expect(evalBranchesParallelAsync(corePath, "", ["A", "B"], false, 100)).resolves.toEqual([
      null,
      null,
    ]);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("never starts workers from the synchronous adapter", () => {
    const baseline = activeHyperposeWorkerCount();
    expect(evalBranchesParallel(corePath, "", ["A", "B"], true, 100)).toEqual([null, null]);
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("exposes the synchronous compatibility hook as a typed pre-acceptance decline", () => {
    const baseline = activeHyperposeWorkerCount();
    const decline = makeParEvalImpl(100)("", ["A", "B"], true);

    expect(decline).toEqual({ status: "declined" });
    expect(activeHyperposeWorkerCount()).toBe(baseline);
  });

  it("validates synchronous adapter options before declining workers", () => {
    expect(() => evalBranchesParallel(corePath, "", ["A"], false, 100, { timeoutMs: 0 })).toThrow(
      RangeError,
    );
  });
});
