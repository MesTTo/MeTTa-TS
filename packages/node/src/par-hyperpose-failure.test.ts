// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeWorkerBranchPayload,
  isWorkerQuiescenceError,
  type WorkerQuiescenceError,
} from "@metta-ts/core";

interface WorkerPlan {
  readonly constructorError?: Error;
  readonly terminateError?: Error;
  readonly terminateThrow?: Error;
  readonly terminateGate?: Promise<void>;
}

interface ControlledWorkerData {
  readonly sab: SharedArrayBuffer;
  readonly base: number;
  readonly cap: number;
}

const workerPlans: WorkerPlan[] = [];

class ControlledNodeWorker extends EventEmitter {
  static instances: ControlledNodeWorker[] = [];
  static constructorCalls = 0;

  readonly plan: WorkerPlan;
  readonly workerData: ControlledWorkerData | undefined;
  terminateCalls = 0;
  exited = false;

  constructor(_source?: unknown, options?: { readonly workerData?: ControlledWorkerData }) {
    super();
    ControlledNodeWorker.constructorCalls += 1;
    this.plan = workerPlans.shift() ?? {};
    if (this.plan.constructorError !== undefined) throw this.plan.constructorError;
    this.workerData = options?.workerData;
    ControlledNodeWorker.instances.push(this);
  }

  terminate(): Promise<number> {
    this.terminateCalls += 1;
    if (this.plan.terminateThrow !== undefined) throw this.plan.terminateThrow;
    if (this.plan.terminateError !== undefined) return Promise.reject(this.plan.terminateError);
    return Promise.resolve(this.plan.terminateGate).then(() => {
      this.emitExit();
      return 1;
    });
  }

  emitExit(code = 1): void {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code);
  }

  emitError(error: unknown): void {
    this.emit("error", error);
  }

  static reset(): void {
    ControlledNodeWorker.instances = [];
    ControlledNodeWorker.constructorCalls = 0;
    workerPlans.length = 0;
  }
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function countRetainedFailure(root: unknown, target: unknown): number {
  const pending = [root];
  const seen = new Set<unknown>();
  let count = 0;
  while (pending.length > 0) {
    const failure = pending.pop();
    if (seen.has(failure)) continue;
    seen.add(failure);
    if (Object.is(failure, target)) count += 1;
    if (failure instanceof AggregateError) pending.push(...failure.errors);
    if (isWorkerQuiescenceError(failure)) {
      pending.push(failure.cause, failure.quiescenceFailure);
    }
  }
  return count;
}

function sharedRegion(instance: ControlledNodeWorker): ControlledWorkerData {
  if (instance.workerData === undefined) throw new Error("worker data was not captured");
  return instance.workerData;
}

function writeResult(
  instance: ControlledNodeWorker,
  results: readonly string[],
  counterDelta = 0,
): void {
  const { sab, base, cap } = sharedRegion(instance);
  const payload = encodeWorkerBranchPayload({ results, counterDelta });
  if (payload.byteLength > cap) throw new Error("test payload exceeds the worker region");
  new Uint8Array(sab, base + 8, payload.byteLength).set(payload);
  const header = new Int32Array(sab, base, 2);
  Atomics.store(header, 1, payload.byteLength);
  Atomics.store(header, 0, 1);
}

function writeMalformedResult(instance: ControlledNodeWorker): void {
  const { sab, base } = sharedRegion(instance);
  new Uint8Array(sab, base + 8, 1)[0] = 0xff;
  const header = new Int32Array(sab, base, 2);
  Atomics.store(header, 1, 1);
  Atomics.store(header, 0, 1);
}

function expectFailedSecondWorkerJoinedOnce(
  failure: unknown,
  terminationError: Error,
  activeWorkerCount: () => number,
): void {
  expect(isWorkerQuiescenceError(failure)).toBe(true);
  expect(countRetainedFailure(failure, terminationError)).toBe(1);
  expect(ControlledNodeWorker.instances.map((worker) => worker.terminateCalls)).toEqual([0, 1]);
  expect(activeWorkerCount()).toBe(1);

  ControlledNodeWorker.instances[1]!.emitExit();
  expect(activeWorkerCount()).toBe(0);
}

async function loadWorkerHost(plans: readonly WorkerPlan[]) {
  ControlledNodeWorker.reset();
  workerPlans.push(...plans);
  vi.resetModules();
  vi.doMock("node:worker_threads", () => ({ Worker: ControlledNodeWorker }));
  return import("./par-hyperpose");
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("node:worker_threads");
  vi.resetModules();
  ControlledNodeWorker.reset();
});

describe("Node hyperpose worker launch failures", () => {
  it("terminates and joins the launched prefix when a later constructor throws", async () => {
    const constructorError = new Error("second worker constructor failed");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      {},
      { constructorError },
    ]);

    await expect(
      evalBranchesParallelAsync("unused-core", "", ["A", "B", "C"], false, 100, {
        maxWorkers: 3,
      }),
    ).resolves.toEqual([null, null, null]);

    expect(ControlledNodeWorker.constructorCalls).toBe(2);
    expect(ControlledNodeWorker.instances).toHaveLength(1);
    expect(ControlledNodeWorker.instances[0]!.terminateCalls).toBe(1);
    expect(ControlledNodeWorker.instances[0]!.exited).toBe(true);
    expect(activeHyperposeWorkerCount()).toBe(0);
  });

  it("retains a later constructor fault when prefix cleanup loses quiescence", async () => {
    const constructorError = new Error("second worker constructor failed");
    const terminationError = new Error("prefix worker termination failed");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      { terminateError: terminationError },
      { constructorError },
    ]);

    const failure = await evalBranchesParallelAsync("unused-core", "", ["A", "B"], false, 100, {
      maxWorkers: 2,
    }).catch((error: unknown) => error);

    expect(isWorkerQuiescenceError(failure)).toBe(true);
    expect(countRetainedFailure(failure, constructorError)).toBe(1);
    expect(countRetainedFailure(failure, terminationError)).toBe(1);
    expect(ControlledNodeWorker.instances[0]!.terminateCalls).toBe(1);
    expect(activeHyperposeWorkerCount()).toBe(1);

    ControlledNodeWorker.instances[0]!.emitExit();
    expect(activeHyperposeWorkerCount()).toBe(0);
  });

  it("joins delayed launch-failure cleanup before exposing an exact abort reason", async () => {
    const gate = deferred();
    const constructorError = new Error("second worker constructor failed");
    const controller = new AbortController();
    const reason = new Error("cancel during launch cleanup");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      { terminateGate: gate.promise },
      { constructorError },
    ]);
    let settled = false;
    const pending = evalBranchesParallelAsync(
      "unused-core",
      "",
      ["A", "B"],
      false,
      100,
      { maxWorkers: 2 },
      controller.signal,
    ).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(ControlledNodeWorker.instances[0]!.terminateCalls).toBe(1);
    controller.abort(reason);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(activeHyperposeWorkerCount()).toBe(1);

    gate.resolve();
    await expect(pending).rejects.toBe(reason);
    expect(ControlledNodeWorker.instances[0]!.terminateCalls).toBe(1);
    expect(activeHyperposeWorkerCount()).toBe(0);
  });

  it("rejects a valid payload from a worker that exits unsuccessfully", async () => {
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([{}]);
    const pending = evalBranchesParallelAsync("unused-core", "", ["A"], false, 100, {
      maxWorkers: 1,
    });
    const instance = ControlledNodeWorker.instances[0]!;
    writeResult(instance, ["A-result"], 3);

    instance.emitExit(2);

    await expect(pending).resolves.toEqual([null]);
    expect(instance.terminateCalls).toBe(0);
    expect(activeHyperposeWorkerCount()).toBe(0);
  });

  it("retains a nonzero exit fault when sibling cleanup loses quiescence", async () => {
    const terminationError = new Error("sibling worker termination failed");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      {},
      { terminateError: terminationError },
    ]);
    const pending = evalBranchesParallelAsync("unused-core", "", ["A", "B"], false, 100, {
      maxWorkers: 2,
    });
    const failed = ControlledNodeWorker.instances[0]!;
    writeResult(failed, ["must-not-be-accepted"]);

    failed.emitExit(2);

    const failure = await pending.catch((error: unknown) => error);
    expect(isWorkerQuiescenceError(failure)).toBe(true);
    expect((failure as WorkerQuiescenceError).cause).toMatchObject({
      message: expect.stringContaining("exit code 2"),
    });
    expectFailedSecondWorkerJoinedOnce(failure, terminationError, activeHyperposeWorkerCount);
  });

  it("retains a worker error when sibling cleanup loses quiescence", async () => {
    const operationError = new Error("worker operation failed");
    const terminationError = new Error("sibling worker termination failed");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      {},
      { terminateError: terminationError },
    ]);
    const pending = evalBranchesParallelAsync("unused-core", "", ["A", "B"], false, 100, {
      maxWorkers: 2,
    });

    ControlledNodeWorker.instances[0]!.emitError(operationError);
    ControlledNodeWorker.instances[0]!.emitExit(1);

    const failure = await pending.catch((error: unknown) => error);
    expect(countRetainedFailure(failure, operationError)).toBe(1);
    expectFailedSecondWorkerJoinedOnce(failure, terminationError, activeHyperposeWorkerCount);
  });

  it("retains a malformed-result fault when sibling cleanup loses quiescence", async () => {
    const terminationError = new Error("sibling worker termination failed");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      {},
      { terminateError: terminationError },
    ]);
    const pending = evalBranchesParallelAsync("unused-core", "", ["A", "B"], false, 100, {
      maxWorkers: 2,
    });
    const malformed = ControlledNodeWorker.instances[0]!;
    writeMalformedResult(malformed);

    malformed.emitExit(0);

    const failure = await pending.catch((error: unknown) => error);
    expect(isWorkerQuiescenceError(failure)).toBe(true);
    expect((failure as WorkerQuiescenceError).cause).toMatchObject({
      message: expect.stringContaining("malformed result payload"),
    });
    expectFailedSecondWorkerJoinedOnce(failure, terminationError, activeHyperposeWorkerCount);
  });

  it("does not repeat loser cleanup after a first-answer termination failure", async () => {
    const terminationError = new Error("losing worker termination failed");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      { terminateError: terminationError },
      {},
    ]);
    const pending = evalBranchesParallelAsync("unused-core", "", ["slow", "winner"], true, 100, {
      maxWorkers: 2,
    });
    const winner = ControlledNodeWorker.instances[1]!;
    writeResult(winner, ["winner-result"]);

    winner.emitExit(0);

    const failure = await pending.catch((error: unknown) => error);
    expect(isWorkerQuiescenceError(failure)).toBe(true);
    expect(countRetainedFailure(failure, terminationError)).toBe(1);
    expect(ControlledNodeWorker.instances.map((worker) => worker.terminateCalls)).toEqual([1, 0]);
    expect(activeHyperposeWorkerCount()).toBe(1);

    ControlledNodeWorker.instances[0]!.emitExit();
    expect(activeHyperposeWorkerCount()).toBe(0);
  });

  it("joins every terminable sibling and retains abort when one termination rejects", async () => {
    const terminationError = new Error("first worker termination failed");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      { terminateError: terminationError },
      {},
    ]);
    const controller = new AbortController();
    const reason = new Error("cancel worker batch");
    const pending = evalBranchesParallelAsync(
      "unused-core",
      "",
      ["A", "B"],
      false,
      100,
      { maxWorkers: 2 },
      controller.signal,
    );

    expect(ControlledNodeWorker.instances).toHaveLength(2);
    controller.abort(reason);

    const failure = await pending.catch((error: unknown) => error);
    expect(isWorkerQuiescenceError(failure)).toBe(true);
    expect((failure as WorkerQuiescenceError).cause).toBe(reason);
    const quiescenceFailure = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(isWorkerQuiescenceError(quiescenceFailure)).toBe(true);
    expect((quiescenceFailure as WorkerQuiescenceError).cause).toBe(terminationError);
    expect(ControlledNodeWorker.instances.map((worker) => worker.terminateCalls)).toEqual([1, 1]);
    expect(ControlledNodeWorker.instances[1]!.exited).toBe(true);
    expect(activeHyperposeWorkerCount()).toBe(1);

    ControlledNodeWorker.instances[0]!.emitExit();
    expect(activeHyperposeWorkerCount()).toBe(0);
  });

  it("surfaces a timeout termination failure as unknown worker quiescence", async () => {
    vi.useFakeTimers();
    const terminationError = new Error("timed-out worker termination failed");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      { terminateError: terminationError },
    ]);
    const pending = evalBranchesParallelAsync("unused-core", "", ["A"], false, 100, {
      maxWorkers: 1,
      timeoutMs: 25,
    });
    const outcome = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(25);

    const failure = await outcome;
    expect(isWorkerQuiescenceError(failure)).toBe(true);
    const initiatingFailure = (failure as WorkerQuiescenceError).cause;
    expect(initiatingFailure).toMatchObject({ message: "Node worker branch timed out" });
    const cleanupFailure = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(isWorkerQuiescenceError(cleanupFailure)).toBe(true);
    expect((cleanupFailure as WorkerQuiescenceError).cause).toBe(terminationError);
    expect(countRetainedFailure(failure, terminationError)).toBe(1);
    expect(ControlledNodeWorker.instances[0]!.terminateCalls).toBe(1);
    expect(activeHyperposeWorkerCount()).toBe(1);

    ControlledNodeWorker.instances[0]!.emitExit();
    expect(activeHyperposeWorkerCount()).toBe(0);
  });

  it("captures a synchronous timeout termination throw as unknown quiescence", async () => {
    vi.useFakeTimers();
    const terminationError = new Error("timed-out worker termination threw");
    const { activeHyperposeWorkerCount, evalBranchesParallelAsync } = await loadWorkerHost([
      { terminateThrow: terminationError },
    ]);
    const pending = evalBranchesParallelAsync("unused-core", "", ["A"], false, 100, {
      maxWorkers: 1,
      timeoutMs: 25,
    });
    const outcome = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(25);

    const failure = await outcome;
    expect(isWorkerQuiescenceError(failure)).toBe(true);
    expect(countRetainedFailure(failure, terminationError)).toBe(1);
    expect(ControlledNodeWorker.instances[0]!.terminateCalls).toBe(1);
    expect(activeHyperposeWorkerCount()).toBe(1);

    ControlledNodeWorker.instances[0]!.emitExit();
    expect(activeHyperposeWorkerCount()).toBe(0);
  });

  it("retains every failed worker termination under the initiating abort", async () => {
    const firstTermination = new Error("first worker termination failed");
    const secondTermination = new Error("second worker termination failed");
    const { evalBranchesParallelAsync } = await loadWorkerHost([
      { terminateError: firstTermination },
      { terminateError: secondTermination },
    ]);
    const controller = new AbortController();
    const reason = new Error("cancel worker batch");
    const pending = evalBranchesParallelAsync(
      "unused-core",
      "",
      ["A", "B"],
      false,
      100,
      { maxWorkers: 2 },
      controller.signal,
    );

    controller.abort(reason);
    const failure = await pending.catch((error: unknown) => error);
    expect(isWorkerQuiescenceError(failure)).toBe(true);
    expect((failure as WorkerQuiescenceError).cause).toBe(reason);
    const cleanup = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(isWorkerQuiescenceError(cleanup)).toBe(true);
    const retained = (cleanup as WorkerQuiescenceError).quiescenceFailure;
    expect(retained).toBeInstanceOf(AggregateError);
    expect(
      (retained as AggregateError).errors.map((error) => (error as WorkerQuiescenceError).cause),
    ).toEqual([firstTermination, secondTermination]);

    for (const instance of ControlledNodeWorker.instances) instance.emitExit();
  });
});
