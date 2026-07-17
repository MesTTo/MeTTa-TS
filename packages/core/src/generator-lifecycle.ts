// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  aggregateCleanupFailures,
  cleanupFailureLeaves,
  combineInitiatingAndCleanupFailure,
} from "./cleanup-fault";

export type SyncGeneratorYieldDriver<Y> = (value: Y) => unknown;
export type AsyncGeneratorYieldDriver<Y> = (
  value: Y,
  signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Retain the first generator-driving failure and every distinct failure raised while its `finally`
 *  path is being driven. The tracker spans yielded finalizers, so a later failed yield cannot replace
 *  the error that started unwinding. */
export class GeneratorUnwindFailures {
  #initiatingFailure: unknown;
  #hasInitiatingFailure = false;
  readonly #cleanupFailures: unknown[] = [];
  #revision = 0;
  #cachedRevision = -1;
  #cachedFailure: unknown;

  get active(): boolean {
    return this.#hasInitiatingFailure;
  }

  record(error: unknown): void {
    for (const failure of cleanupFailureLeaves(error)) this.#recordLeaf(failure);
  }

  failure(message: string): unknown {
    if (!this.#hasInitiatingFailure)
      throw new Error("generator unwind failure requested before a failure was recorded");
    if (this.#cachedRevision === this.#revision) return this.#cachedFailure;
    this.#cachedFailure =
      this.#cleanupFailures.length === 0
        ? this.#initiatingFailure
        : combineInitiatingAndCleanupFailure(
            this.#initiatingFailure,
            aggregateCleanupFailures(
              this.#cleanupFailures,
              "multiple generator cleanup operations failed",
            ),
            message,
          );
    this.#cachedRevision = this.#revision;
    return this.#cachedFailure;
  }

  #recordLeaf(error: unknown): void {
    if (!this.#hasInitiatingFailure) {
      this.#initiatingFailure = error;
      this.#hasInitiatingFailure = true;
      this.#revision += 1;
      return;
    }
    if (
      !Object.is(error, this.#initiatingFailure) &&
      !this.#cleanupFailures.some((failure) => Object.is(failure, error))
    ) {
      this.#cleanupFailures.push(error);
      this.#revision += 1;
    }
  }
}

async function joinActiveAndCloseWork(
  active: Promise<unknown> | undefined,
  closeWork: Promise<void>,
): Promise<void> {
  if (active === undefined) return closeWork;
  const [activeResult, closeResult] = await Promise.allSettled([active, closeWork]);
  if (activeResult.status === "rejected" && closeResult.status === "rejected")
    throw combineInitiatingAndCleanupFailure(
      activeResult.reason,
      closeResult.reason,
      "active cursor work and cleanup both failed",
    );
  if (activeResult.status === "rejected") throw activeResult.reason;
  if (closeResult.status === "rejected") throw closeResult.reason;
}

function recordCleanupFailure(failures: unknown[], error: unknown): void {
  for (const failure of cleanupFailureLeaves(error))
    if (!failures.some((candidate) => Object.is(candidate, failure))) failures.push(failure);
}

function recordInjectedCleanupFailure(
  failures: unknown[],
  injectedError: unknown,
  terminalError: unknown,
): void {
  const terminalLeaves = cleanupFailureLeaves(terminalError);
  if (
    Object.is(terminalError, injectedError) ||
    terminalLeaves.some((failure) => Object.is(failure, injectedError))
  ) {
    recordCleanupFailure(failures, terminalError);
    return;
  }
  recordCleanupFailure(failures, injectedError);
  recordCleanupFailure(failures, terminalError);
}

interface DeferredPromise<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferredPromise<T>(): DeferredPromise<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Own one asynchronous cursor call at a time and join it with close work. */
export class ExclusiveAsyncScope {
  #active: Promise<unknown> | undefined;
  #closing: Promise<void> | undefined;

  get active(): Promise<unknown> | undefined {
    return this.#active;
  }

  run<T>(start: () => Promise<T>): Promise<T> {
    if (this.#active !== undefined)
      return Promise.reject(new Error("concurrent cursor.next calls are not allowed"));
    const reserved = deferredPromise<T>();
    const active = reserved.promise;
    this.#active = active;
    try {
      void Promise.resolve(start()).then(reserved.resolve, reserved.reject);
    } catch (error) {
      reserved.reject(error);
    }
    return active.finally(() => {
      if (this.#active === active) this.#active = undefined;
    });
  }

  close(startClose: () => Promise<void>, alreadyComplete = false): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    if (alreadyComplete) return Promise.resolve();
    const reserved = deferredPromise<void>();
    this.#closing = reserved.promise;
    let closeWork: Promise<void>;
    try {
      closeWork = Promise.resolve(startClose());
    } catch (error) {
      closeWork = Promise.reject(error);
    }
    void joinActiveAndCloseWork(this.#active, closeWork).then(reserved.resolve, reserved.reject);
    return reserved.promise;
  }
}

/** Finish a generator after return or an injected failure, preserving every cleanup error. */
export function finishGeneratorSync<Y, R>(
  generator: Generator<Y, R, unknown>,
  initial: IteratorResult<Y, R>,
  driveYield: SyncGeneratorYieldDriver<Y>,
): void {
  let result = initial;
  const failures: unknown[] = [];
  while (!result.done) {
    try {
      result = generator.next(driveYield(result.value));
    } catch (error) {
      try {
        result = generator.throw(error);
      } catch (terminalError) {
        recordInjectedCleanupFailure(failures, error, terminalError);
        break;
      }
      recordCleanupFailure(failures, error);
    }
  }
  if (failures.length > 0)
    throw aggregateCleanupFailures(failures, "multiple synchronous generator cleanups failed");
}

/** Finish a generator and await every yielded cleanup under the active cancellation signal. */
export async function finishGeneratorAsync<Y, R>(
  generator: Generator<Y, R, unknown>,
  initial: IteratorResult<Y, R>,
  signal: AbortSignal,
  driveYield: AsyncGeneratorYieldDriver<Y>,
): Promise<void> {
  let result = initial;
  const failures: unknown[] = [];
  while (!result.done) {
    try {
      result = generator.next(await driveYield(result.value, signal));
    } catch (error) {
      try {
        result = generator.throw(error);
      } catch (terminalError) {
        recordInjectedCleanupFailure(failures, error, terminalError);
        break;
      }
      recordCleanupFailure(failures, error);
    }
  }
  if (failures.length > 0)
    throw aggregateCleanupFailures(failures, "multiple asynchronous generator cleanups failed");
}

export function closeGeneratorSync<Y, R>(
  generator: Generator<Y, R, unknown>,
  value: R,
  driveYield: SyncGeneratorYieldDriver<Y>,
): void {
  finishGeneratorSync(generator, generator.return(value), driveYield);
}

export async function closeGeneratorAsync<Y, R>(
  generator: Generator<Y, R, unknown>,
  value: R,
  signal: AbortSignal,
  driveYield: AsyncGeneratorYieldDriver<Y>,
): Promise<void> {
  await finishGeneratorAsync(generator, generator.return(value), signal, driveYield);
}
