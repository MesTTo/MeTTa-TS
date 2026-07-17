// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Parallel branch evaluation for `hyperpose` on Node `worker_threads`. PeTTa's `hyperpose` forks OS
// threads; cooperative concurrency (par/race) cannot, because a branch that compiles to a native loop runs
// synchronously and never yields. Each branch is a self-contained pure computation (the program's rules plus
// one branch expression), so it runs in its own worker. `firstOnly` (for `(once (hyperpose …))`) returns
// when one branch produces a result and cancels the rest, matching `once` over forked threads. Node-only:
// the browser has no worker_threads.
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import {
  aggregateCleanupFailures,
  checkedWorkerPositiveInteger,
  checkedWorkerResultBytes,
  checkedWorkerSharedBufferLayout,
  checkedWorkerTimeout,
  combineInitiatingAndCleanupFailure,
  decodeWorkerBranchPayload,
  isWorkerQuiescenceError,
  type StatefulParallelBranchHostResult,
  WorkerQuiescenceError,
} from "@metta-ts/core";

// The worker builds an env from the program's rule source, evaluates one branch, and writes its results
// (each atom formatted to source) into its slice of the shared buffer as a JSON string, then signals.
const WORKER_SRC = `
const { workerData } = require("node:worker_threads");
const { corePath, rulesSrc, branchSrc, sab, base, cap, fuel, hostEffects, firstOnly, initialCounter } = workerData;
const header = new Int32Array(sab, base, 2);
(async () => {
  try {
    const m = await import(corePath);
    if (hostEffects === false && typeof m.setHostEffectsEnabled === "function") {
      m.setHostEffectsEnabled(false);
    }
    const query = firstOnly ? "!(once " + branchSrc + ")" : "!" + branchSrc;
    const execution = m.runProgramWithState(
      rulesSrc + "\\n" + query,
      fuel,
      new Map(),
      {},
      initialCounter,
    );
    const last = execution.results[execution.results.length - 1];
    const results = [];
    for (const atom of last && last.results ? last.results : []) {
      const source = m.tryFormatTransportAtom(atom, "value");
      if (source === undefined) throw new Error("worker result is not transportable");
      results.push(source);
    }
    const out = m.encodeWorkerBranchPayload({
      results,
      counterDelta: execution.state.counter - initialCounter,
    });
    if (out.byteLength > cap) { Atomics.store(header, 0, -2); }
    else {
      new Uint8Array(sab, base + 8, out.byteLength).set(out);
      Atomics.store(header, 1, out.byteLength);
      Atomics.store(header, 0, 1);
    }
  } catch (e) {
    Atomics.store(header, 0, -1); // import failure, fuel exhaustion, anything: this branch bailed
  }
})();
`;

const MAX_DEFAULT_WORKERS = 16;
let activeWorkers = 0;

export interface ParEvalOptions {
  readonly hostEffects?: boolean;
  readonly maxWorkers?: number;
  readonly maxResultBytes?: number;
  readonly timeoutMs?: number;
}

function workerLimit(requested: number | undefined, branchCount: number): number {
  const defaultLimit = Math.min(availableParallelism(), MAX_DEFAULT_WORKERS);
  return Math.min(branchCount, checkedWorkerPositiveInteger(requested, defaultLimit, "maxWorkers"));
}

function startWorker(workerData: Record<string, unknown>): Worker {
  const worker = new Worker(WORKER_SRC, { eval: true, workerData });
  activeWorkers += 1;
  worker.once("exit", () => {
    activeWorkers -= 1;
  });
  return worker;
}

/** Number of branch workers whose `exit` event has not fired. Used by lifecycle diagnostics. */
export function activeHyperposeWorkerCount(): number {
  return activeWorkers;
}

/**
 * Legacy synchronous compatibility adapter. It starts no workers and declines every branch because Node
 * exposes worker termination as a Promise. Use `evalBranchesParallelAsync` for joined worker execution.
 *
 * @deprecated Use `evalBranchesParallelAsync`.
 */
export function evalBranchesParallel(
  _corePath: string,
  _rulesSrc: string,
  branchSrcs: readonly string[],
  _firstOnly: boolean,
  _fuel: number,
  options: ParEvalOptions = {},
): (StatefulParallelBranchHostResult | null)[] {
  checkedWorkerResultBytes(options.maxResultBytes);
  checkedWorkerTimeout(options.timeoutMs);
  workerLimit(options.maxWorkers, branchSrcs.length);
  return new Array(branchSrcs.length).fill(null);
}

interface CompletedBranch {
  readonly index: number;
  readonly slot: number;
  readonly result: StatefulParallelBranchHostResult | null;
  readonly failure?: WorkerOperationFailure;
}

interface WorkerOperationFailure {
  readonly error: unknown;
}

interface WorkerReadResult {
  readonly result: StatefulParallelBranchHostResult | null;
  readonly failure?: WorkerOperationFailure;
}

function operationFailure(error: unknown): WorkerOperationFailure {
  return { error };
}

function aggregateWorkerOperationFailures(
  failures: readonly unknown[],
): WorkerOperationFailure | undefined {
  if (failures.length === 0) return undefined;
  return operationFailure(
    failures.length === 1
      ? failures[0]
      : new AggregateError(failures.slice(), "multiple Node worker operations failed"),
  );
}

/** Evaluate a worker race without returning until every losing worker has exited. */
export async function evalBranchesParallelAsync(
  corePath: string,
  rulesSrc: string,
  branchSrcs: readonly string[],
  firstOnly: boolean,
  fuel: number,
  options: ParEvalOptions = {},
  signal?: AbortSignal,
  initialCounter = 0,
): Promise<(StatefulParallelBranchHostResult | null)[]> {
  signal?.throwIfAborted();
  const n = branchSrcs.length;
  const maxResultBytes = checkedWorkerResultBytes(options.maxResultBytes);
  const timeoutMs = checkedWorkerTimeout(options.timeoutMs);
  const maxWorkers = workerLimit(options.maxWorkers, n);
  if (n === 0) return [];
  if (firstOnly && n > maxWorkers) return new Array(n).fill(null);
  const { regionBytes: region, totalBytes } = checkedWorkerSharedBufferLayout(
    maxWorkers,
    maxResultBytes,
  );
  let sab: SharedArrayBuffer;
  try {
    sab = new SharedArrayBuffer(totalBytes);
  } catch {
    return new Array(n).fill(null);
  }
  const workers: Array<Worker | undefined> = new Array(n);
  const completed = new Map<number, Promise<CompletedBranch>>();
  const workerOperationFailures = new Map<number, unknown[]>();
  const cleanupStarted = new Set<number>();
  const results: (StatefulParallelBranchHostResult | null)[] = new Array(n).fill(null);
  const freeSlots = Array.from({ length: maxWorkers }, (_, index) => index);
  let next = 0;
  let launchFailure: WorkerOperationFailure | undefined;

  const recordWorkerOperationFailure = (index: number, error: unknown): void => {
    const failures = workerOperationFailures.get(index);
    if (failures === undefined) {
      workerOperationFailures.set(index, [error]);
      return;
    }
    if (!failures.some((failure) => Object.is(failure, error))) failures.push(error);
  };
  const combinedWorkerOperationFailure = (index: number): WorkerOperationFailure | undefined =>
    aggregateWorkerOperationFailures(workerOperationFailures.get(index) ?? []);
  const read = (slot: number): WorkerReadResult => {
    try {
      const base = slot * region;
      const header = new Int32Array(sab, base, 2);
      const status = Atomics.load(header, 0);
      if (status !== 1) {
        const message =
          status === -1
            ? "Node worker branch evaluation failed"
            : status === -2
              ? "Node worker result exceeded maxResultBytes"
              : "Node worker exited without a result";
        return { result: null, failure: operationFailure(new Error(message)) };
      }
      const length = Atomics.load(header, 1);
      if (!Number.isSafeInteger(length) || length < 0 || length > maxResultBytes)
        return {
          result: null,
          failure: operationFailure(new Error("Node worker returned an invalid result length")),
        };
      const result = decodeWorkerBranchPayload(new Uint8Array(sab, base + 8, length));
      return result === undefined
        ? {
            result: null,
            failure: operationFailure(new Error("Node worker returned a malformed result payload")),
          }
        : { result };
    } catch (error) {
      return { result: null, failure: operationFailure(error) };
    }
  };
  const terminateAndJoin = async (indices: Iterable<number>): Promise<void> => {
    const selected = [...new Set(indices)].filter((index) => {
      if (cleanupStarted.has(index)) return false;
      cleanupStarted.add(index);
      return true;
    });
    if (selected.length === 0) return;
    const termination = await Promise.allSettled(
      selected.map((index) => Promise.resolve().then(() => workers[index]?.terminate())),
    );
    // Join every worker whose termination request completed even when a sibling's request failed. The failed
    // worker still makes local replay unsafe, but it must not prevent known siblings from reaching quiescence.
    const joinable = selected.filter((_, offset) => termination[offset]?.status === "fulfilled");
    const exits = await Promise.allSettled(
      joinable.flatMap((index) => {
        const exit = completed.get(index);
        return exit === undefined ? [] : [exit];
      }),
    );
    const failures: unknown[] = termination.flatMap((result) =>
      result.status === "rejected"
        ? [
            new WorkerQuiescenceError("Node worker termination failed", {
              cause: result.reason,
            }),
          ]
        : [],
    );
    for (const result of exits) if (result.status === "rejected") failures.push(result.reason);
    if (failures.length > 0) {
      const cleanupFailure = aggregateCleanupFailures(
        failures,
        "multiple Node worker cleanups failed",
      );
      const operationFailures = aggregateWorkerOperationFailures(
        selected.flatMap((index) => workerOperationFailures.get(index) ?? []),
      );
      throw operationFailures === undefined
        ? cleanupFailure
        : combineInitiatingAndCleanupFailure(
            operationFailures.error,
            cleanupFailure,
            "Node worker operation and cleanup both failed",
          );
    }
  };
  const joinForReplay = async (
    indices: Iterable<number>,
    failure: WorkerOperationFailure | undefined,
  ): Promise<void> => {
    try {
      await terminateAndJoin(indices);
    } catch (cleanupError) {
      throw failure === undefined
        ? cleanupError
        : combineInitiatingAndCleanupFailure(
            failure.error,
            cleanupError,
            "Node worker operation and cleanup both failed",
          );
    }
  };
  const launch = (): void => {
    while (launchFailure === undefined && next < n && freeSlots.length > 0) {
      const index = next++;
      const slot = freeSlots.shift()!;
      const base = slot * region;
      const header = new Int32Array(sab, base, 2);
      Atomics.store(header, 0, 0);
      Atomics.store(header, 1, 0);
      try {
        const worker = startWorker({
          corePath,
          rulesSrc,
          branchSrc: branchSrcs[index]!,
          sab,
          base,
          cap: maxResultBytes,
          fuel,
          hostEffects: options.hostEffects,
          firstOnly,
          initialCounter,
        });
        workers[index] = worker;
        completed.set(
          index,
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              if (cleanupStarted.has(index)) return;
              const timeoutFailure = new Error("Node worker branch timed out");
              recordWorkerOperationFailure(index, timeoutFailure);
              cleanupStarted.add(index);
              void Promise.resolve()
                .then(() => worker.terminate())
                .catch((cause: unknown) => {
                  const quiescence = new WorkerQuiescenceError(
                    "timed-out Node worker did not terminate",
                    { cause },
                  );
                  reject(
                    combineInitiatingAndCleanupFailure(
                      combinedWorkerOperationFailure(index)!.error,
                      quiescence,
                      "Node worker timeout and termination both failed",
                    ),
                  );
                });
            }, timeoutMs);
            worker.once("error", (error: unknown) => {
              recordWorkerOperationFailure(index, error);
            });
            worker.once("exit", (exitCode: number) => {
              clearTimeout(timeout);
              if (!cleanupStarted.has(index) && exitCode !== 0)
                recordWorkerOperationFailure(
                  index,
                  new Error(`Node worker exited with exit code ${exitCode}`),
                );
              const failure = combinedWorkerOperationFailure(index);
              if (failure !== undefined) {
                resolve({ index, slot, result: null, failure });
                return;
              }
              resolve({ index, slot, ...read(slot) });
            });
          }),
        );
      } catch (error) {
        results[index] = null;
        freeSlots.push(slot);
        launchFailure = operationFailure(error);
      }
    }
  };

  const abortedToken = Symbol("Node worker evaluation aborted");
  let abort!: () => void;
  let abortedFlag = false;
  let abortReason: unknown;
  let abortSelected = false;
  const aborted = new Promise<typeof abortedToken>((resolve) => {
    abort = (): void => {
      if (abortedFlag) return;
      abortedFlag = true;
      abortReason = signal?.reason;
      resolve(abortedToken);
    };
  });
  const throwIfAborted = (): void => {
    if (!abortedFlag) return;
    abortSelected = true;
    throw abortReason;
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted === true) abort();
  try {
    launch();
    if (launchFailure !== undefined) {
      await joinForReplay(completed.keys(), launchFailure);
      throwIfAborted();
      return results;
    }
    while (completed.size > 0) {
      const settled = await Promise.race([...completed.values(), aborted]);
      if (settled === abortedToken) {
        abortSelected = true;
        throw abortReason;
      }
      const branch = settled;
      completed.delete(branch.index);
      freeSlots.push(branch.slot);
      results[branch.index] = branch.result;
      if (branch.result === null) {
        await joinForReplay(completed.keys(), branch.failure);
        throwIfAborted();
        return results;
      }
      if (firstOnly && branch.result !== null && branch.result.results.length > 0) {
        const losers = [...completed.keys()];
        for (const index of losers) results[index] = { results: [], counterDelta: 0 };
        for (let index = next; index < n; index++)
          results[index] = { results: [], counterDelta: 0 };
        await joinForReplay(losers, undefined);
        throwIfAborted();
        return results;
      }
      launch();
      if (launchFailure !== undefined) {
        await joinForReplay(completed.keys(), launchFailure);
        throwIfAborted();
        return results;
      }
    }
    throwIfAborted();
    return results;
  } catch (error) {
    let failure = error;
    try {
      await terminateAndJoin(completed.keys());
    } catch (cleanupError) {
      failure = combineInitiatingAndCleanupFailure(
        failure,
        cleanupError,
        "Node worker evaluation and cleanup both failed",
      );
    }
    if (abortedFlag && !abortSelected)
      failure = combineInitiatingAndCleanupFailure(
        abortReason,
        failure,
        "Node worker cancellation and evaluation both failed",
      );
    throw failure;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Build a legacy synchronous hook that explicitly declines before accepting any worker task.
 *
 * @deprecated Use `makeParEvalAsyncImpl` with an async runner.
 */
export function makeParEvalImpl(
  fuel: number,
  options: ParEvalOptions = {},
): (
  rulesSrc: string,
  branchSrcs: string[],
  firstOnly: boolean,
  remainingFuel?: number,
  initialCounter?: number,
) => { readonly status: "declined" } {
  const corePath = createRequire(import.meta.url).resolve("@metta-ts/core");
  return (rulesSrc, branchSrcs, firstOnly, remainingFuel) => {
    evalBranchesParallel(
      corePath,
      rulesSrc,
      branchSrcs,
      firstOnly,
      Math.min(fuel, remainingFuel ?? fuel),
      options,
    );
    return { status: "declined" };
  };
}

/** Build the cancellable async worker hook used by normal Node source and CLI runs. */
export function makeParEvalAsyncImpl(
  fuel: number,
  options: ParEvalOptions = {},
): (
  rulesSrc: string,
  branchSrcs: string[],
  firstOnly: boolean,
  signal?: AbortSignal,
  remainingFuel?: number,
  initialCounter?: number,
) => Promise<
  | {
      readonly status: "completed";
      readonly branches: readonly (StatefulParallelBranchHostResult | null)[];
    }
  | {
      readonly status: "failed";
      readonly error: unknown;
    }
> {
  const corePath = createRequire(import.meta.url).resolve("@metta-ts/core");
  return async (rulesSrc, branchSrcs, firstOnly, signal, remainingFuel, initialCounter) => {
    try {
      return {
        status: "completed",
        branches: await evalBranchesParallelAsync(
          corePath,
          rulesSrc,
          branchSrcs,
          firstOnly,
          Math.min(fuel, remainingFuel ?? fuel),
          options,
          signal,
          initialCounter,
        ),
      };
    } catch (error) {
      if (isWorkerQuiescenceError(error)) throw error;
      return { status: "failed", error };
    }
  };
}
