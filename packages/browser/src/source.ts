// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Browser source runners. They mirror the Node source runners without file-system capability: imports come
// from an in-memory VFS, async forms run through the core async driver, and browser hyperpose uses Web Workers
// when the host exposes them.
import {
  aggregateCleanupFailures,
  checkedWorkerPositiveInteger,
  checkedWorkerResultBytes,
  checkedWorkerSharedBufferLayout,
  checkedWorkerTimeout,
  combineInitiatingAndCleanupFailure,
  DEFAULT_FUEL,
  decodeWorkerBranchPayload,
  evalSequential,
  isWorkerQuiescenceError,
  parseAll,
  runProgramAsync,
  standardTokenizer,
  collectImports,
  type AsyncGroundFn,
  type Atom,
  type QueryResult,
  type StatefulParallelBranchHostResult,
  type RunOptions,
  WorkerProtocolError,
  WorkerQuiescenceError,
} from "@metta-ts/core";
import type { BranchWorkerRequest, BranchWorkerResponse } from "./hyperpose-protocol";

export interface BrowserParEvalOptions {
  readonly workerUrl?: string | URL;
  readonly maxWorkers?: number;
  readonly maxResultBytes?: number;
  readonly timeoutMs?: number;
  readonly hostEffects?: boolean;
}

const MAX_DEFAULT_WORKERS = 16;

function clampWorkerCount(value: number | undefined, branchCount: number): number {
  const reported = typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency;
  const hardware =
    typeof reported === "number" && Number.isSafeInteger(reported) && reported > 0 ? reported : 4;
  const defaultLimit = Math.min(hardware, MAX_DEFAULT_WORKERS);
  return Math.min(branchCount, checkedWorkerPositiveInteger(value, defaultLimit, "maxWorkers"));
}

/** Build an `import!` map from an in-memory file map (name -> MeTTa source). */
export function vfsImports(src: string, files: ReadonlyMap<string, string>): Map<string, Atom[]> {
  const m = new Map<string, Atom[]>();
  for (const name of collectImports(src)) {
    const text = files.get(name) ?? files.get(`${name}.metta`);
    if (text !== undefined)
      m.set(
        name,
        parseAll(text, standardTokenizer())
          .filter((t) => !t.bang)
          .map((t) => t.atom),
      );
  }
  return m;
}

function browserWorkerAvailable(): boolean {
  return typeof Worker !== "undefined";
}

function hyperposeWorkerUrl(options: BrowserParEvalOptions): string | URL {
  return options.workerUrl ?? new URL("./hyperpose-worker.js", import.meta.url);
}

interface BranchWorkerTask {
  readonly result: Promise<BranchWorkerCompletion>;
  cancel(): void;
}

type BranchWorkerCompletion =
  | { readonly kind: "result"; readonly value: StatefulParallelBranchHostResult }
  | { readonly kind: "fallback"; readonly error: unknown };

const workerFallback = (error: unknown): BranchWorkerCompletion => ({
  kind: "fallback",
  error,
});

function runBranchWorker(
  workerUrl: string | URL,
  request: BranchWorkerRequest,
  timeoutMs: number,
): BranchWorkerTask {
  let worker: Worker | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let resolveResult!: (value: BranchWorkerCompletion) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<BranchWorkerCompletion>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const finish = (completion: BranchWorkerCompletion): void => {
    if (settled) return;
    settled = true;
    if (timeout !== undefined) clearTimeout(timeout);
    if (worker !== undefined) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try {
        worker.terminate();
      } catch (cause) {
        const quiescence = new WorkerQuiescenceError("browser worker termination failed", {
          cause,
        });
        rejectResult(
          completion.kind === "fallback"
            ? combineInitiatingAndCleanupFailure(
                completion.error,
                quiescence,
                "browser worker operation and termination both failed",
              )
            : quiescence,
        );
        return;
      }
    }
    resolveResult(completion);
  };
  try {
    worker = new Worker(workerUrl, { type: "module" });
    timeout = setTimeout(
      () =>
        finish(
          workerFallback(new WorkerProtocolError(`browser worker timed out after ${timeoutMs}ms`)),
        ),
      timeoutMs,
    );
    worker.onmessage = (event: MessageEvent<BranchWorkerResponse>) => {
      try {
        const response = event.data;
        if (response.id !== request.id) {
          finish(workerFallback(new WorkerProtocolError("browser worker replied with wrong id")));
          return;
        }
        if (response.status !== "result") {
          finish(
            workerFallback(new WorkerProtocolError(`browser worker returned ${response.status}`)),
          );
          return;
        }
        if (
          !(response.payload instanceof ArrayBuffer) ||
          response.payload.byteLength > request.maxResultBytes
        ) {
          finish(
            workerFallback(new WorkerProtocolError("browser worker returned invalid payload")),
          );
          return;
        }
        const decoded = decodeWorkerBranchPayload(new Uint8Array(response.payload));
        finish(
          decoded === undefined
            ? workerFallback(new WorkerProtocolError("browser worker payload failed validation"))
            : { kind: "result", value: decoded },
        );
      } catch (error) {
        finish(workerFallback(error));
      }
    };
    worker.onerror = (event) => finish(workerFallback(event));
    worker.onmessageerror = (event) => finish(workerFallback(event));
    worker.postMessage(request);
  } catch (error) {
    finish(workerFallback(error));
  }
  return {
    result,
    cancel: () => finish({ kind: "result", value: { results: [], counterDelta: 0 } }),
  };
}

/** Evaluate hyperpose branches in browser Web Workers. Results are returned per branch in source order.
 *  Under `firstOnly`, workers are cancelled once the first non-empty branch result arrives. */
export async function evalBranchesInBrowserWorkers(
  rulesSrc: string,
  branchSrcs: readonly string[],
  firstOnly: boolean,
  fuel: number,
  options: BrowserParEvalOptions = {},
  signal?: AbortSignal,
  initialCounter = 0,
): Promise<(StatefulParallelBranchHostResult | null)[]> {
  signal?.throwIfAborted();
  const timeoutMs = checkedWorkerTimeout(options.timeoutMs);
  const maxResultBytes = checkedWorkerResultBytes(options.maxResultBytes);
  const maxWorkers = clampWorkerCount(options.maxWorkers, branchSrcs.length);
  if (branchSrcs.length === 0) return [];
  // Browser workers transfer separate buffers, but their aggregate admitted result capacity uses the same
  // deterministic ceiling as Node's shared result pool.
  checkedWorkerSharedBufferLayout(maxWorkers, maxResultBytes);
  if (!browserWorkerAvailable()) return new Array(branchSrcs.length).fill(null);
  if (firstOnly && branchSrcs.length > maxWorkers) return new Array(branchSrcs.length).fill(null);
  const workerUrl = hyperposeWorkerUrl(options);
  const results: (StatefulParallelBranchHostResult | null)[] = new Array(branchSrcs.length).fill(
    null,
  );
  let next = 0;
  let settled = 0;
  let finished = false;
  const active = new Map<number, BranchWorkerTask>();
  const completed = new Set<number>();

  return new Promise((resolve, reject) => {
    const removeAbortListener = (): void => signal?.removeEventListener("abort", onAbort);
    const joinActive = async (): Promise<void> => {
      const tasks = [...active.values()];
      for (const task of tasks) task.cancel();
      const settledTasks = await Promise.allSettled(tasks.map((task) => task.result));
      const failures = settledTasks.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw aggregateCleanupFailures(failures, "multiple browser worker cleanups failed");
    };
    const finish = async (
      outcome:
        | {
            readonly kind: "results";
            readonly emptyUnfinished: boolean;
            readonly fallback?: { readonly error: unknown };
          }
        | { readonly kind: "failure"; readonly error: unknown },
    ): Promise<void> => {
      if (finished) return;
      finished = true;
      if (outcome.kind === "results" && outcome.emptyUnfinished)
        for (let index = 0; index < results.length; index++)
          if (!completed.has(index)) results[index] = { results: [], counterDelta: 0 };
      try {
        await joinActive();
      } catch (cleanupError) {
        removeAbortListener();
        const initiating = outcome.kind === "failure" ? { error: outcome.error } : outcome.fallback;
        reject(
          initiating !== undefined
            ? combineInitiatingAndCleanupFailure(
                initiating.error,
                cleanupError,
                "browser worker evaluation and cleanup both failed",
              )
            : cleanupError,
        );
        return;
      }
      removeAbortListener();
      if (outcome.kind === "failure") reject(outcome.error);
      else resolve(results);
    };
    const onAbort = (): void => {
      void finish({
        kind: "failure",
        error: signal?.reason ?? new Error("parallel evaluation cancelled"),
      });
    };
    const maybeResolve = (): void => {
      if (finished) return;
      if (settled >= branchSrcs.length) void finish({ kind: "results", emptyUnfinished: false });
    };
    const launch = (): void => {
      while (!finished && active.size < maxWorkers && next < branchSrcs.length) {
        const id = next;
        const branchSrc = branchSrcs[id]!;
        next += 1;
        const task = runBranchWorker(
          workerUrl,
          {
            id,
            rulesSrc,
            branchSrc,
            firstOnly,
            initialCounter,
            fuel,
            maxResultBytes,
            ...(options.hostEffects !== undefined ? { hostEffects: options.hostEffects } : {}),
          },
          timeoutMs,
        );
        active.set(id, task);
        void task.result.then(
          (completion) => {
            if (finished) return;
            active.delete(id);
            completed.add(id);
            settled += 1;
            if (completion.kind === "fallback") {
              results[id] = null;
              void finish({
                kind: "results",
                emptyUnfinished: false,
                fallback: { error: completion.error },
              });
              return;
            }
            const result = completion.value;
            results[id] = result;
            if (firstOnly && result.results.length > 0) {
              void finish({ kind: "results", emptyUnfinished: true });
              return;
            }
            launch();
            maybeResolve();
          },
          (error: unknown) => {
            active.delete(id);
            void finish({ kind: "failure", error });
          },
        );
      }
      maybeResolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    launch();
  });
}

/** Build a browser Web Worker `parEvalAsyncImpl` hook for `(once (hyperpose ...))`. */
export function makeBrowserParEvalImpl(
  fuel: number,
  options: BrowserParEvalOptions = {},
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
  return async (rulesSrc, branchSrcs, firstOnly, signal, remainingFuel, initialCounter) => {
    try {
      return {
        status: "completed",
        branches: await evalBranchesInBrowserWorkers(
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

function withDefaultOptions(
  fuel: number,
  opts: RunOptions | undefined,
  parOptions?: BrowserParEvalOptions,
): RunOptions {
  const base = opts ?? {};
  if (base.parEvalImpl !== undefined || base.parEvalAsyncImpl !== undefined)
    return { ...base, tabling: base.tabling ?? true };
  const experimental = base.experimental;
  const workerPolicyCompatible =
    (base.tabling ?? true) === true &&
    experimental?.hashCons !== true &&
    experimental?.trail !== true &&
    experimental?.flatAtomspace !== false;
  const parEvalAsyncImpl =
    workerPolicyCompatible && browserWorkerAvailable()
      ? makeBrowserParEvalImpl(fuel, parOptions)
      : undefined;
  const defaults: RunOptions = {
    ...base,
    tabling: base.tabling ?? true,
  };
  return parEvalAsyncImpl === undefined ? defaults : { ...defaults, parEvalAsyncImpl };
}

/** Run a MeTTa source string in the browser with an in-memory import map. */
export function runSource(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts?: RunOptions,
): QueryResult[] {
  return evalSequential(parseAll(src, standardTokenizer()), fuel, imports, {
    ...opts,
    tabling: opts?.tabling ?? true,
  });
}

/** Async source runner for browser hosts that register async grounded operations. */
export function runSourceAsync(
  src: string,
  asyncOps: Map<string, AsyncGroundFn> = new Map(),
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts?: RunOptions,
  parOptions?: BrowserParEvalOptions,
): Promise<QueryResult[]> {
  return runProgramAsync(src, asyncOps, fuel, imports, withDefaultOptions(fuel, opts, parOptions));
}

/** Run a MeTTa program against an in-memory browser VFS. */
export function run(
  src: string,
  files: ReadonlyMap<string, string> = new Map(),
  fuel?: number,
): QueryResult[] {
  return runSource(src, fuel, vfsImports(src, files));
}
