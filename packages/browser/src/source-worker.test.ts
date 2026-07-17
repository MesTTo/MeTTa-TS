// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKER_RESULT_BYTES,
  encodeWorkerBranchPayload,
  MAX_WORKER_RESULT_BYTES,
  MAX_WORKER_TIMEOUT_MS,
  runProgramAsync,
  WorkerQuiescenceError,
} from "@metta-ts/core";
import type { BranchWorkerRequest, BranchWorkerResponse } from "./hyperpose-protocol";
import { evalBranchesInBrowserWorkers, makeBrowserParEvalImpl } from "./source";

interface WorkerPlan {
  readonly constructorError?: Error;
  readonly postMessageError?: Error;
  readonly terminateError?: Error;
}

const workerPlans: WorkerPlan[] = [];

/** Deterministic browser Worker double with observable ownership and manual completion. */
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  static activeCount = 0;
  static maxActiveCount = 0;

  onmessage: ((event: MessageEvent<BranchWorkerResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  request: BranchWorkerRequest | undefined;
  terminateCalls = 0;
  terminated = false;

  readonly plan: WorkerPlan;

  constructor(
    readonly url: string | URL,
    readonly options?: WorkerOptions,
  ) {
    this.plan = workerPlans.shift() ?? {};
    if (this.plan.constructorError !== undefined) throw this.plan.constructorError;
    ControlledWorker.instances.push(this);
    ControlledWorker.activeCount += 1;
    ControlledWorker.maxActiveCount = Math.max(
      ControlledWorker.maxActiveCount,
      ControlledWorker.activeCount,
    );
  }

  postMessage(message: unknown): void {
    this.request = message as BranchWorkerRequest;
    if (this.plan.postMessageError !== undefined) throw this.plan.postMessageError;
  }

  terminate(): void {
    this.terminateCalls += 1;
    if (this.plan.terminateError !== undefined) throw this.plan.terminateError;
    if (this.terminated) return;
    this.terminated = true;
    ControlledWorker.activeCount -= 1;
  }

  respond(response: BranchWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<BranchWorkerResponse>);
  }

  static reset(): void {
    ControlledWorker.instances = [];
    ControlledWorker.activeCount = 0;
    ControlledWorker.maxActiveCount = 0;
    workerPlans.length = 0;
  }
}

const worker = (index: number): ControlledWorker => {
  const instance = ControlledWorker.instances[index];
  if (instance === undefined) throw new Error(`worker ${index} was not started`);
  return instance;
};

const complete = (
  instance: ControlledWorker,
  results: readonly string[],
  counterDelta = 0,
): void => {
  const id = instance.request?.id;
  if (id === undefined) throw new Error("worker request was not posted");
  const encoded = encodeWorkerBranchPayload({ results, counterDelta });
  const payload = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(payload).set(encoded);
  instance.respond({ id, status: "result", payload });
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const expectJoinedWorkers = (count: number): void => {
  expect(ControlledWorker.instances).toHaveLength(count);
  expect(ControlledWorker.instances.every((instance) => instance.terminateCalls === 1)).toBe(true);
  expect(ControlledWorker.activeCount).toBe(0);
};

const expectWorkerQuiescenceFailure = (
  failure: unknown,
  operation: unknown,
  termination: unknown,
): void => {
  expect(failure).toBeInstanceOf(WorkerQuiescenceError);
  const quiescence = failure as WorkerQuiescenceError;
  expect(quiescence.cause).toBe(operation);
  expect(quiescence.quiescenceFailure).toBeInstanceOf(WorkerQuiescenceError);
  expect((quiescence.quiescenceFailure as WorkerQuiescenceError).cause).toBe(termination);
};

describe("browser hyperpose worker lifecycle", () => {
  beforeEach(() => {
    ControlledWorker.reset();
    vi.stubGlobal("Worker", ControlledWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    ControlledWorker.reset();
  });

  it("settles a branch when the Worker constructor throws", async () => {
    workerPlans.push({ constructorError: new Error("constructor failed") });

    await expect(
      evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
        workerUrl: "controlled-worker.js",
      }),
    ).resolves.toEqual([null]);
    expect(ControlledWorker.instances).toEqual([]);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("terminates and settles a branch when postMessage throws", async () => {
    workerPlans.push({ postMessageError: new Error("postMessage failed") });

    await expect(
      evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
        workerUrl: "controlled-worker.js",
      }),
    ).resolves.toEqual([null]);
    expect(worker(0).terminateCalls).toBe(1);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("retains the postMessage fault when its termination loses quiescence", async () => {
    const operation = new Error("postMessage failed");
    const termination = new Error("termination failed");
    workerPlans.push({ postMessageError: operation, terminateError: termination });

    const failure = await evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
    }).catch((error: unknown) => error);

    expectWorkerQuiescenceFailure(failure, operation, termination);
    expect(worker(0).terminateCalls).toBe(1);
  });

  it("retains a worker error event when its termination loses quiescence", async () => {
    const termination = new Error("termination failed");
    const operation = new Event("error");
    workerPlans.push({ terminateError: termination });
    const result = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
    });

    worker(0).onerror?.(operation);
    const failure = await result.catch((error: unknown) => error);

    expectWorkerQuiescenceFailure(failure, operation, termination);
    expect(worker(0).terminateCalls).toBe(1);
  });

  it("retains a fallback fault when sibling cleanup loses quiescence", async () => {
    const operation = new Error("postMessage failed");
    const termination = new Error("sibling termination failed");
    workerPlans.push({ postMessageError: operation }, { terminateError: termination });

    const failure = await evalBranchesInBrowserWorkers("", ["(failed)", "(sibling)"], false, 100, {
      workerUrl: "controlled-worker.js",
      maxWorkers: 2,
    }).catch((error: unknown) => error);

    expectWorkerQuiescenceFailure(failure, operation, termination);
    expect(ControlledWorker.instances.map((instance) => instance.terminateCalls)).toEqual([1, 1]);
  });

  it("rejects when browser termination cannot establish quiescence", async () => {
    workerPlans.push({ terminateError: new Error("terminate failed") });
    const result = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
    });

    complete(worker(0), ["answer"]);

    await expect(result).rejects.toBeInstanceOf(WorkerQuiescenceError);
    expect(worker(0).terminateCalls).toBe(1);
    expect(ControlledWorker.activeCount).toBe(1);
  });

  it("treats an explicit worker overflow as a local-fallback request", async () => {
    const result = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
    });
    const instance = worker(0);
    const id = instance.request?.id;
    if (id === undefined) throw new Error("worker request was not posted");
    instance.respond({ id, status: "overflow" });

    await expect(result).resolves.toEqual([null]);
    expect(instance.terminateCalls).toBe(1);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("rejects payloads larger than the host admission limit", async () => {
    const result = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
      maxResultBytes: 8,
    });
    complete(worker(0), ["a result that is larger than eight bytes"]);

    await expect(result).resolves.toEqual([null]);
    expectJoinedWorkers(1);
  });

  it.each([
    ["timeoutMs", { timeoutMs: 0 }],
    ["timeoutMs", { timeoutMs: MAX_WORKER_TIMEOUT_MS + 1 }],
    ["maxResultBytes", { maxResultBytes: Number.NaN }],
    ["maxResultBytes", { maxResultBytes: MAX_WORKER_RESULT_BYTES + 1 }],
    ["maxWorkers", { maxWorkers: 1.5 }],
  ])("rejects an invalid %s before constructing a worker", async (_name, options) => {
    await expect(
      evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
        workerUrl: "controlled-worker.js",
        ...options,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(ControlledWorker.instances).toEqual([]);
  });

  it("validates bounds before declining an oversized first-answer race", async () => {
    await expect(
      evalBranchesInBrowserWorkers("", ["A", "B"], true, 100, {
        workerUrl: "controlled-worker.js",
        maxWorkers: 1,
        timeoutMs: 0,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(ControlledWorker.instances).toEqual([]);
  });

  it("terminates promptly when a worker returns a malformed result bag", async () => {
    const result = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
      timeoutMs: 60_000,
    });
    const instance = worker(0);
    const id = instance.request?.id;
    if (id === undefined) throw new Error("worker request was not posted");
    instance.respond({
      id,
      status: "result",
      payload: "not-an-array-buffer",
    } as unknown as BranchWorkerResponse);

    await expect(result).resolves.toEqual([null]);
    expect(instance.terminateCalls).toBe(1);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("terminates promptly when a worker response cannot be deserialized", async () => {
    const result = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
      timeoutMs: 60_000,
    });
    const instance = worker(0);
    instance.onmessageerror?.({} as MessageEvent);

    await expect(result).resolves.toEqual([null]);
    expect(instance.terminateCalls).toBe(1);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("surfaces quiescence failure when message deserialization cleanup cannot terminate", async () => {
    const termination = new Error("messageerror termination failed");
    workerPlans.push({ terminateError: termination });
    const result = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
      timeoutMs: 60_000,
    });
    const instance = worker(0);
    const operation = {} as MessageEvent;
    instance.onmessageerror?.(operation);

    const failure = await result.catch((error: unknown) => error);
    expectWorkerQuiescenceFailure(failure, operation, termination);
    expect(instance.terminateCalls).toBe(1);
    expect(ControlledWorker.activeCount).toBe(1);
  });

  it("terminates immediately when a dedicated worker replies with the wrong request id", async () => {
    const result = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
      timeoutMs: 60_000,
    });
    const instance = worker(0);
    instance.respond({ id: 999, status: "overflow" });

    await expect(result).resolves.toEqual([null]);
    expect(instance.terminateCalls).toBe(1);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("accepts a payload at the byte limit and rejects the same payload one byte below it", async () => {
    const expected = { results: ["café 😀\n\\"], counterDelta: 3 };
    const payloadBytes = encodeWorkerBranchPayload(expected).byteLength;
    const accepted = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
      maxResultBytes: payloadBytes,
    });
    complete(worker(0), expected.results, expected.counterDelta);
    await expect(accepted).resolves.toEqual([expected]);

    const rejected = evalBranchesInBrowserWorkers("", ["(branch)"], false, 100, {
      workerUrl: "controlled-worker.js",
      maxResultBytes: payloadBytes - 1,
    });
    complete(worker(1), expected.results, expected.counterDelta);
    await expect(rejected).resolves.toEqual([null]);
    expectJoinedWorkers(2);
  });

  it("terminates an unresponsive worker when its branch times out", async () => {
    vi.useFakeTimers();
    const result = evalBranchesInBrowserWorkers("", ["(slow)"], false, 100, {
      workerUrl: "controlled-worker.js",
      timeoutMs: 25,
    });

    expect(ControlledWorker.activeCount).toBe(1);
    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toEqual([null]);
    expect(worker(0).terminateCalls).toBe(1);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("joins active workers before rejecting an aborted evaluation", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel active branches");
    const result = evalBranchesInBrowserWorkers(
      "",
      ["(slow-a)", "(slow-b)", "(not-started)"],
      false,
      100,
      { workerUrl: "controlled-worker.js", maxWorkers: 2 },
      controller.signal,
    );

    expect(ControlledWorker.instances).toHaveLength(2);
    expect(ControlledWorker.activeCount).toBe(2);
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expectJoinedWorkers(2);
  });

  it("reports joined cancellation through the owned core host contract", async () => {
    const controller = new AbortController();
    const reason = new Error("cancel owned browser workers");
    const result = runProgramAsync(
      `
        (= (slow-u6 $value) $value)
        !(once (hyperpose ((slow-u6 A) (slow-u6 B))))
      `,
      new Map(),
      100,
      new Map(),
      {
        signal: controller.signal,
        tabling: true,
        parEvalAsyncImpl: makeBrowserParEvalImpl(100, {
          workerUrl: "controlled-worker.js",
          maxWorkers: 2,
        }),
      },
    );
    await flushMicrotasks();
    expect(ControlledWorker.instances).toHaveLength(2);
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expectJoinedWorkers(2);
  });

  it("terminates every sibling and preserves abort when one termination fails", async () => {
    const termination = new Error("terminate first worker failed");
    workerPlans.push({ terminateError: termination }, {}, {});
    const controller = new AbortController();
    const reason = new Error("cancel all workers");
    const result = evalBranchesInBrowserWorkers(
      "",
      ["(slow-a)", "(slow-b)", "(slow-c)"],
      false,
      100,
      { workerUrl: "controlled-worker.js", maxWorkers: 3 },
      controller.signal,
    );

    controller.abort(reason);

    const failure = await result.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).cause).toBe(reason);
    const quiescenceFailure = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(quiescenceFailure).toBeInstanceOf(WorkerQuiescenceError);
    expect((quiescenceFailure as WorkerQuiescenceError).cause).toBe(termination);
    expect(ControlledWorker.instances.map((instance) => instance.terminateCalls)).toEqual([
      1, 1, 1,
    ]);
    expect(ControlledWorker.activeCount).toBe(1);
  });

  it("retains every failed browser-worker termination under the initiating abort", async () => {
    const firstTermination = new Error("terminate first worker failed");
    const secondTermination = new Error("terminate second worker failed");
    workerPlans.push({ terminateError: firstTermination }, { terminateError: secondTermination });
    const controller = new AbortController();
    const reason = new Error("cancel all workers");
    const result = evalBranchesInBrowserWorkers(
      "",
      ["(slow-a)", "(slow-b)"],
      false,
      100,
      { workerUrl: "controlled-worker.js", maxWorkers: 2 },
      controller.signal,
    );

    controller.abort(reason);
    const failure = await result.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).cause).toBe(reason);
    const cleanup = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(cleanup).toBeInstanceOf(WorkerQuiescenceError);
    const retained = (cleanup as WorkerQuiescenceError).quiescenceFailure;
    expect(retained).toBeInstanceOf(AggregateError);
    expect(
      (retained as AggregateError).errors.map((error) => (error as WorkerQuiescenceError).cause),
    ).toEqual([firstTermination, secondTermination]);
  });

  it("never exceeds maxWorkers while advancing the branch queue", async () => {
    const result = evalBranchesInBrowserWorkers("rules", ["A", "B", "C", "D"], false, 100, {
      workerUrl: "controlled-worker.js",
      maxWorkers: 2,
    });

    expect(ControlledWorker.instances).toHaveLength(2);
    complete(worker(0), ["A-result"], 1);
    await flushMicrotasks();
    expect(ControlledWorker.instances).toHaveLength(3);
    complete(worker(1), ["B-result"], 2);
    await flushMicrotasks();
    expect(ControlledWorker.instances).toHaveLength(4);
    complete(worker(2), ["C-result"], 3);
    complete(worker(3), ["D-result"], 4);

    await expect(result).resolves.toEqual([
      { results: ["A-result"], counterDelta: 1 },
      { results: ["B-result"], counterDelta: 2 },
      { results: ["C-result"], counterDelta: 3 },
      { results: ["D-result"], counterDelta: 4 },
    ]);
    expect(ControlledWorker.maxActiveCount).toBe(2);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("bounds default admission by reported browser parallelism", async () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 3 });
    const branches = Array.from({ length: 12 }, (_, index) => `branch-${index}`);
    const result = evalBranchesInBrowserWorkers("", branches, false, 100, {
      workerUrl: "controlled-worker.js",
    });

    expect(ControlledWorker.instances).toHaveLength(3);
    while (ControlledWorker.instances.length < branches.length) {
      const active = ControlledWorker.instances.filter((instance) => !instance.terminated);
      for (const instance of active) complete(instance, []);
      await flushMicrotasks();
    }
    for (const instance of ControlledWorker.instances.filter((entry) => !entry.terminated))
      complete(instance, []);

    await expect(result).resolves.toEqual(branches.map(() => ({ results: [], counterDelta: 0 })));
    expect(ControlledWorker.maxActiveCount).toBe(3);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("joins firstOnly losers and leaves no active worker after the winner", async () => {
    const result = evalBranchesInBrowserWorkers("rules", ["slow", "winner"], true, 100, {
      workerUrl: "controlled-worker.js",
      maxWorkers: 2,
    });

    expect(ControlledWorker.instances).toHaveLength(2);
    complete(worker(1), ["winner-result"], 7);

    await expect(result).resolves.toEqual([
      { results: [], counterDelta: 0 },
      { results: ["winner-result"], counterDelta: 7 },
    ]);
    expectJoinedWorkers(2);
  });

  it("declines an oversized first-answer race instead of starving queued branches", async () => {
    await expect(
      evalBranchesInBrowserWorkers("", ["loop-a", "loop-b", "ready"], true, 100, {
        workerUrl: "controlled-worker.js",
        maxWorkers: 2,
      }),
    ).resolves.toEqual([null, null, null]);
    expect(ControlledWorker.instances).toEqual([]);
    expect(ControlledWorker.activeCount).toBe(0);
  });

  it("cancels a nonresponding sibling as soon as one branch fails", async () => {
    const result = evalBranchesInBrowserWorkers("", ["failed", "never-responds"], false, 100, {
      workerUrl: "controlled-worker.js",
      maxWorkers: 2,
    });
    worker(0).onerror?.(new Event("error"));

    await expect(result).resolves.toEqual([null, null]);
    expectJoinedWorkers(2);
  });

  it("preserves stateful requests and response counter deltas", async () => {
    const responseResults = ["(answer 42)"];
    const result = evalBranchesInBrowserWorkers(
      "(= (answer) 42)",
      ["(answer)"],
      false,
      37,
      { workerUrl: "controlled-worker.js", maxWorkers: 1, hostEffects: false },
      undefined,
      41,
    );
    const instance = worker(0);

    expect(instance.url).toBe("controlled-worker.js");
    expect(instance.options).toEqual({ type: "module" });
    expect(instance.request).toEqual({
      id: 0,
      rulesSrc: "(= (answer) 42)",
      branchSrc: "(answer)",
      firstOnly: false,
      initialCounter: 41,
      fuel: 37,
      maxResultBytes: DEFAULT_WORKER_RESULT_BYTES,
      hostEffects: false,
    });
    complete(instance, responseResults, 9);
    responseResults[0] = "mutated after postMessage";

    await expect(result).resolves.toEqual([{ results: ["(answer 42)"], counterDelta: 9 }]);
    expect(ControlledWorker.activeCount).toBe(0);
  });
});
