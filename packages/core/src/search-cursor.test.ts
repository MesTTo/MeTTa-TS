// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CancellationReason } from "./resources";
import { WorkerQuiescenceError } from "./worker-protocol";
import {
  FairAsyncCursor,
  FairSyncCursor,
  OnceAsyncCursor,
  OnceSyncCursor,
  ParallelSourceOrderedAsyncCursor,
  SourceOrderedAsyncCursor,
  SourceOrderedSyncCursor,
  drainAsyncCursor,
  drainParallelTasksSourceOrdered,
  drainSyncCursor,
  raceAsyncCursors,
  type AsyncSearchCursor,
  type BatchAsyncSearchCursor,
  type SearchBatchEvent,
  type SearchDrainResult,
  type SearchEvent,
  type SearchNextOptions,
  type SyncSearchCursor,
} from "./search-cursor";

function countRetainedFailure(root: unknown, target: unknown): number {
  let count = Object.is(root, target) ? 1 : 0;
  if (root instanceof AggregateError)
    for (const error of root.errors) count += countRetainedFailure(error, target);
  if (root instanceof WorkerQuiescenceError) {
    count += countRetainedFailure(root.cause, target);
    count += countRetainedFailure(root.quiescenceFailure, target);
  }
  return count;
}

function expectAggregateFailureWithCause(failure: unknown, errors: readonly unknown[]): void {
  expect(failure).toBeInstanceOf(AggregateError);
  const aggregate = failure as AggregateError;
  expect(aggregate.errors).toEqual(errors);
  expect(aggregate.cause).toBe(errors[0]);
}

function expectPromotedQuiescenceFailure(
  failure: unknown,
  cause: unknown,
  errors: readonly unknown[],
): void {
  expect(failure).toBeInstanceOf(WorkerQuiescenceError);
  expect((failure as WorkerQuiescenceError).cause).toEqual(cause);
  const cleanup = (failure as WorkerQuiescenceError).quiescenceFailure;
  expect(cleanup).toBeInstanceOf(WorkerQuiescenceError);
  const retained = (cleanup as WorkerQuiescenceError).quiescenceFailure;
  expect(retained).toBeInstanceOf(AggregateError);
  expect((retained as AggregateError).errors).toEqual(errors);
}

class StepSyncCursor<T> implements SyncSearchCursor<T, string> {
  readonly #values: readonly T[];
  readonly #stepsPerAnswer: number;
  readonly #terminal: string;
  #index = 0;
  #remaining: number;
  #closedReason: CancellationReason | undefined;
  closeCalls = 0;

  constructor(values: readonly T[], terminal: string, stepsPerAnswer = 1) {
    this.#values = values;
    this.#terminal = terminal;
    this.#stepsPerAnswer = stepsPerAnswer;
    this.#remaining = stepsPerAnswer;
  }

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(options: SearchNextOptions = {}): SearchEvent<T, string> {
    const maxSteps = options.maxSteps ?? 256;
    if (this.#closedReason !== undefined)
      return { kind: "cancelled", reason: this.#closedReason, steps: 0 };
    if (this.#index === this.#values.length)
      return { kind: "exhausted", terminal: this.#terminal, steps: 0 };
    const used = Math.min(maxSteps, this.#remaining);
    this.#remaining -= used;
    if (this.#remaining > 0) return { kind: "pending", steps: used };
    const value = this.#values[this.#index++]!;
    this.#remaining = this.#stepsPerAnswer;
    return { kind: "answer", value, steps: used };
  }

  close(reason: CancellationReason = { code: "closed" }): void {
    if (this.#closedReason !== undefined) return;
    this.closeCalls += 1;
    this.#closedReason = reason;
  }
}

class DivergentSyncCursor<T> implements SyncSearchCursor<T, string> {
  #closedReason: CancellationReason | undefined;
  steps = 0;

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(options: SearchNextOptions = {}): SearchEvent<T, string> {
    if (this.#closedReason !== undefined)
      return { kind: "cancelled", reason: this.#closedReason, steps: 0 };
    const used = options.maxSteps ?? 256;
    this.steps += used;
    return { kind: "pending", steps: used };
  }

  close(reason: CancellationReason = { code: "closed" }): void {
    this.#closedReason ??= reason;
  }
}

class FaultSyncCursor<T> implements SyncSearchCursor<T, string> {
  readonly error = new Error("branch fault");
  #closedReason: CancellationReason | undefined;
  closeCalls = 0;

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(): SearchEvent<T, string> {
    return { kind: "fault", error: this.error, steps: 1 };
  }

  close(reason: CancellationReason = { code: "closed" }): void {
    if (this.#closedReason !== undefined) return;
    this.#closedReason = reason;
    this.closeCalls += 1;
  }
}

class ThrowingSyncCursor<T> implements SyncSearchCursor<T, string> {
  readonly error = new Error("thrown branch read");
  closeCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): SearchEvent<T, string> {
    throw this.error;
  }

  close(): void {
    this.closeCalls += 1;
  }
}

class ThrowingCloseSyncCursor<T> implements SyncSearchCursor<T, string> {
  readonly error: Error;
  closeCalls = 0;

  constructor(error: Error = new Error("sync cleanup failed")) {
    this.error = error;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): SearchEvent<T, string> {
    return { kind: "pending", steps: 1 };
  }

  close(): void {
    this.closeCalls += 1;
    throw this.error;
  }
}

class InvalidStepSyncCursor<T> implements SyncSearchCursor<T, string> {
  closeCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): SearchEvent<T, string> {
    return { kind: "pending", steps: -1 };
  }

  close(): void {
    this.closeCalls += 1;
  }
}

class MalformedSyncCursor<T> implements SyncSearchCursor<T, string> {
  readonly #event: unknown;
  closeCalls = 0;

  constructor(event: unknown) {
    this.#event = event;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): SearchEvent<T, string> {
    return this.#event as SearchEvent<T, string>;
  }

  close(): void {
    this.closeCalls += 1;
  }
}

class RawThenExhaustedSyncCursor<T> implements SyncSearchCursor<T, string> {
  readonly #event: unknown;
  #read = false;
  closeCalls = 0;

  constructor(event: unknown) {
    this.#event = event;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): SearchEvent<T, string> {
    if (!this.#read) {
      this.#read = true;
      return this.#event as SearchEvent<T, string>;
    }
    return { kind: "exhausted", terminal: "done", steps: 0 };
  }

  close(): void {
    this.closeCalls += 1;
  }
}

class RawDrainSyncCursor<T> implements SyncSearchCursor<T, string> {
  readonly #result: unknown;
  closeCalls = 0;

  constructor(result: unknown) {
    this.#result = result;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): SearchEvent<T, string> {
    throw new Error("next must not run when drain is available");
  }

  drain(): SearchDrainResult<T, string> {
    return this.#result as SearchDrainResult<T, string>;
  }

  close(): void {
    this.closeCalls += 1;
  }
}

interface AsyncItem<T> {
  readonly delayMs: number;
  readonly value: T;
}

class TimedAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly #items: readonly AsyncItem<T>[];
  readonly #terminal: string;
  #index = 0;
  #closedReason: CancellationReason | undefined;
  #cancelWait: (() => void) | undefined;
  closeCalls = 0;
  active = false;

  constructor(items: readonly AsyncItem<T>[], terminal: string) {
    this.#items = items;
    this.#terminal = terminal;
  }

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  async next(): Promise<SearchEvent<T, string>> {
    if (this.#closedReason !== undefined)
      return { kind: "cancelled", reason: this.#closedReason, steps: 0 };
    const item = this.#items[this.#index];
    if (item === undefined) return { kind: "exhausted", terminal: this.#terminal, steps: 0 };
    this.active = true;
    const completed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.#cancelWait = undefined;
        resolve(true);
      }, item.delayMs);
      this.#cancelWait = () => {
        clearTimeout(timer);
        this.#cancelWait = undefined;
        resolve(false);
      };
    });
    this.active = false;
    if (!completed) {
      const reason = this.#closedReason ?? { code: "closed" };
      return { kind: "cancelled", reason, steps: 0 };
    }
    this.#index += 1;
    return { kind: "answer", value: item.value, steps: 1 };
  }

  async close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    if (this.#closedReason !== undefined) return;
    this.closeCalls += 1;
    this.#closedReason = reason;
    this.#cancelWait?.();
    while (this.active) await Promise.resolve();
  }
}

class CloseDrivenAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  #closedReason: CancellationReason | undefined;
  #finish: (() => void) | undefined;
  closeCalls = 0;
  nextCalls = 0;
  active = false;

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(): Promise<SearchEvent<T, string>> {
    this.nextCalls += 1;
    this.active = true;
    return new Promise((resolve) => {
      this.#finish = (): void => {
        this.active = false;
        resolve({
          kind: "cancelled",
          reason: this.#closedReason ?? { code: "closed" },
          steps: 0,
        });
      };
    });
  }

  async close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    if (this.#closedReason !== undefined) return;
    this.#closedReason = reason;
    this.closeCalls += 1;
    this.#finish?.();
    while (this.active) await Promise.resolve();
  }
}

class DeferredAnswerAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  #resolve: ((event: SearchEvent<T, string>) => void) | undefined;
  closeCalls = 0;
  nextCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    this.nextCalls += 1;
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  resolveAnswer(value: T): void {
    this.#resolve?.({ kind: "answer", value, steps: 1 });
    this.#resolve = undefined;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class DeferredFaultAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly #closeError: unknown;
  #resolve: ((event: SearchEvent<T, string>) => void) | undefined;
  closeCalls = 0;

  constructor(closeError?: unknown) {
    this.#closeError = closeError;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  resolveFault(error: unknown): void {
    this.#resolve?.({ kind: "fault", error, steps: 1 });
    this.#resolve = undefined;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return this.#closeError === undefined ? Promise.resolve() : Promise.reject(this.#closeError);
  }
}

class DeferredRejectingReadAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly error = new Error("late rejected child read");
  #reject: ((error: unknown) => void) | undefined;
  closeCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    return new Promise((_, reject) => {
      this.#reject = reject;
    });
  }

  rejectRead(): void {
    this.#reject?.(this.error);
    this.#reject = undefined;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class QuotaAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly #source: StepSyncCursor<T>;

  constructor(values: readonly T[], terminal: string, stepsPerAnswer: number) {
    this.#source = new StepSyncCursor(values, terminal, stepsPerAnswer);
  }

  get closed(): boolean {
    return this.#source.closed;
  }

  next(options: SearchNextOptions = {}): Promise<SearchEvent<T, string>> {
    return Promise.resolve(this.#source.next(options));
  }

  close(reason?: CancellationReason): Promise<void> {
    this.#source.close(reason);
    return Promise.resolve();
  }
}

class BatchThenAsyncCursor<T> implements BatchAsyncSearchCursor<T, string> {
  readonly #batch: SearchBatchEvent<T, string>;
  readonly #tail: readonly SearchEvent<T, string>[];
  batchAllowances: number[] = [];
  nextCalls = 0;
  closeCalls = 0;
  #tailIndex = 0;
  #closedReason: CancellationReason | undefined;

  constructor(batch: SearchBatchEvent<T, string>, tail: readonly SearchEvent<T, string>[] = []) {
    this.#batch = batch;
    this.#tail = tail;
  }

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(): Promise<SearchEvent<T, string>> {
    this.nextCalls += 1;
    if (this.#closedReason !== undefined)
      return Promise.resolve({ kind: "cancelled", reason: this.#closedReason, steps: 0 });
    return Promise.resolve(
      this.#tail[this.#tailIndex++] ?? { kind: "exhausted", terminal: "done", steps: 0 },
    );
  }

  nextBatch(options: SearchNextOptions = {}): Promise<SearchBatchEvent<T, string>> {
    this.batchAllowances.push(options.maxSteps ?? 256);
    return Promise.resolve(this.#batch);
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    if (this.#closedReason === undefined) {
      this.#closedReason = reason;
      this.closeCalls += 1;
    }
    return Promise.resolve();
  }
}

class DeferredBatchFaultCursor<T> implements BatchAsyncSearchCursor<T, string> {
  #resolve: ((event: SearchBatchEvent<T, string>) => void) | undefined;
  closeCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    throw new Error("ordinary next must not run before the deferred batch settles");
  }

  nextBatch(): Promise<SearchBatchEvent<T, string>> {
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  resolveFault(error: unknown): void {
    this.#resolve?.({ kind: "fault", values: [], error, steps: 1 });
    this.#resolve = undefined;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

interface DeferredFaultBranch extends AsyncSearchCursor<string, string> {
  readonly closeCalls: number;
  resolveFault(error: unknown): void;
}

async function expectParallelFaults(
  first: DeferredFaultBranch,
  second: DeferredFaultBranch,
  firstError: Error,
  secondError: Error,
): Promise<void> {
  const cursor = new ParallelSourceOrderedAsyncCursor([first, second]);
  const draining = cursor.drain({ maxSteps: 2 });
  await Promise.resolve();

  first.resolveFault(firstError);
  second.resolveFault(secondError);
  const result = await draining;

  expect(result.kind).toBe("fault");
  if (result.kind === "fault")
    expectAggregateFailureWithCause(result.error, [firstError, secondError]);
  expect(first.closeCalls).toBe(1);
  expect(second.closeCalls).toBe(1);
}

class CountingPendingAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  steps = 0;
  #closedReason: CancellationReason | undefined;

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(options: SearchNextOptions = {}): Promise<SearchEvent<T, string>> {
    if (this.#closedReason !== undefined)
      return Promise.resolve({ kind: "cancelled", reason: this.#closedReason, steps: 0 });
    const steps = options.maxSteps ?? 256;
    this.steps += steps;
    return Promise.resolve({ kind: "pending", steps });
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    this.#closedReason ??= reason;
    return Promise.resolve();
  }
}

class PendingThenAnswerAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly #value: T;
  calls = 0;
  #closedReason: CancellationReason | undefined;

  constructor(value: T) {
    this.#value = value;
  }

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(): Promise<SearchEvent<T, string>> {
    this.calls += 1;
    return Promise.resolve(
      this.calls === 1
        ? { kind: "pending", steps: 1 }
        : { kind: "answer", value: this.#value, steps: 1 },
    );
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    this.#closedReason ??= reason;
    return Promise.resolve();
  }
}

class ZeroPendingAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  calls = 0;
  #closedReason: CancellationReason | undefined;

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(): Promise<SearchEvent<T, string>> {
    this.calls += 1;
    if (this.#closedReason !== undefined)
      return Promise.resolve({ kind: "cancelled", reason: this.#closedReason, steps: 0 });
    return Promise.resolve({ kind: "pending", steps: 0 });
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    this.#closedReason ??= reason;
    return Promise.resolve();
  }
}

class FaultAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  closeCalls = 0;
  #closedReason: CancellationReason | undefined;

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(): Promise<SearchEvent<T, string>> {
    return Promise.resolve({ kind: "fault", error: new Error("branch fault"), steps: 1 });
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    if (this.#closedReason === undefined) {
      this.#closedReason = reason;
      this.closeCalls += 1;
    }
    return Promise.resolve();
  }
}

class RejectedAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  closeCalls = 0;
  #closedReason: CancellationReason | undefined;

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  next(): Promise<SearchEvent<T, string>> {
    return Promise.reject(new Error("rejected branch read"));
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    if (this.#closedReason === undefined) {
      this.#closedReason = reason;
      this.closeCalls += 1;
    }
    return Promise.resolve();
  }
}

class SyncThrowingAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly error = new Error("synchronous async-cursor throw");
  closeCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    throw this.error;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class ThrowingCloseAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly error: Error;
  closeCalls = 0;

  constructor(error: Error = new Error("synchronous async cleanup throw")) {
    this.error = error;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    return Promise.resolve({ kind: "pending", steps: 1 });
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    throw this.error;
  }
}

class CachedRejectingCloseAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly error = new Error("cached async cleanup failure");
  closeCalls = 0;
  #closing: Promise<void> | undefined;

  get closed(): boolean {
    return this.#closing !== undefined;
  }

  next(): Promise<SearchEvent<T, string>> {
    throw new Error("a child returned after cancellation must not be read");
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return (this.#closing ??= Promise.reject(this.error));
  }
}

class DeferredRejectingCloseAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly error = new Error("deferred async cleanup failure");
  #reject: ((error: unknown) => void) | undefined;

  get closed(): boolean {
    return this.#reject !== undefined;
  }

  next(): Promise<SearchEvent<T, string>> {
    return Promise.resolve({ kind: "pending", steps: 0 });
  }

  close(): Promise<void> {
    return new Promise((_, reject) => {
      this.#reject = reject;
    });
  }

  rejectClose(): void {
    this.#reject?.(this.error);
    this.#reject = undefined;
  }
}

class DeferredCloseAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  #resolve: (() => void) | undefined;
  closeCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    throw new Error("a construction prefix must be closed before it is read");
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  finishClose(): void {
    this.#resolve?.();
    this.#resolve = undefined;
  }
}

class InvalidStepAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  closeCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    return Promise.resolve({ kind: "pending", steps: 2 });
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class MalformedAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly #event: unknown;
  closeCalls = 0;

  constructor(event: unknown) {
    this.#event = event;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    return Promise.resolve(this.#event as SearchEvent<T, string>);
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class RawThenExhaustedAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly #event: unknown;
  #read = false;
  closeCalls = 0;

  constructor(event: unknown) {
    this.#event = event;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    if (!this.#read) {
      this.#read = true;
      return Promise.resolve(this.#event as SearchEvent<T, string>);
    }
    return Promise.resolve({ kind: "exhausted", terminal: "done", steps: 0 });
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class RawDrainAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  readonly #result: unknown;
  closeCalls = 0;

  constructor(result: unknown) {
    this.#result = result;
  }

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    return Promise.reject(new Error("next must not run when drain is available"));
  }

  drain(): Promise<SearchDrainResult<T, string>> {
    return Promise.resolve(this.#result as SearchDrainResult<T, string>);
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class ThrowingThenAsyncCursor<T> implements AsyncSearchCursor<T, string> {
  closeCalls = 0;

  get closed(): boolean {
    return this.closeCalls > 0;
  }

  next(): Promise<SearchEvent<T, string>> {
    return {
      then(): never {
        throw new Error("hostile thenable");
      },
    } as unknown as Promise<SearchEvent<T, string>>;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

type SingleAsyncWrapper = (
  source: AsyncSearchCursor<string, string>,
) => AsyncSearchCursor<string, unknown>;

const singleAsyncWrappers: readonly (readonly [string, SingleAsyncWrapper])[] = [
  ["source order", (source) => new SourceOrderedAsyncCursor([source])],
  ["fair completion", (source) => new FairAsyncCursor([source], 1)],
  ["parallel source order", (source) => new ParallelSourceOrderedAsyncCursor([source])],
  ["once", (source) => new OnceAsyncCursor(source)],
];

const malformedDrainCases = (message: string): readonly (readonly [string, unknown])[] => [
  ["unknown kind", { kind: "mystery", values: [] }],
  ["missing values", { kind: "fault", error: new Error("bad") }],
  [
    "throwing kind getter",
    Object.defineProperty({ values: [] }, "kind", {
      get(): never {
        throw new Error(message);
      },
    }),
  ],
];

const malformedEventCases = (message: string): readonly (readonly [string, unknown])[] => [
  ["unknown kind", { kind: "mystery", steps: 1 }],
  ["missing answer", { kind: "answer", steps: 1 }],
  [
    "throwing getter",
    Object.defineProperty({ steps: 1 }, "kind", {
      get(): never {
        throw new Error(message);
      },
    }),
  ],
];

function expectFaultDrain(
  result: SearchDrainResult<unknown, unknown>,
  source: { readonly closeCalls: number },
): void {
  expect(result.kind).toBe("fault");
  expect(result.values).toEqual([]);
  expect(source.closeCalls).toBe(1);
}

describe("synchronous search scheduling", () => {
  it.each(malformedDrainCases("custom sync drain getter failed"))(
    "normalizes and closes a malformed custom sync drain with %s",
    (_name, malformed) => {
      const source = new RawDrainSyncCursor<string>(malformed);
      const result = drainSyncCursor(source, { maxSteps: 1 });

      expectFaultDrain(result, source);
    },
  );

  it.each(malformedEventCases("direct drain getter failed"))(
    "normalizes and closes a direct sync drain with %s",
    (_name, malformed) => {
      const source = new RawThenExhaustedSyncCursor<string>(malformed);
      const result = drainSyncCursor(source, { maxSteps: 1 });

      expectFaultDrain(result, source);
    },
  );

  it("keeps source order and exact answer multiplicity", () => {
    const cursor = new SourceOrderedSyncCursor([
      new StepSyncCursor(["a", "a"], "left"),
      new StepSyncCursor(["b"], "right"),
    ]);
    expect(drainSyncCursor(cursor, { maxSteps: 1 })).toEqual({
      kind: "exhausted",
      values: ["a", "a", "b"],
      terminal: ["left", "right"],
    });
  });

  it("gives a finite right branch turns beside a divergent left branch", () => {
    const left = new DivergentSyncCursor<string>();
    const cursor = new FairSyncCursor([left, new StepSyncCursor(["right"], "right")], 2);
    expect(cursor.next({ maxSteps: 4 })).toEqual({ kind: "answer", value: "right", steps: 3 });
    expect(left.steps).toBe(2);
  });

  it("keeps strict source order blocked behind a divergent first branch", () => {
    const right = new StepSyncCursor(["right"], "right");
    const cursor = new SourceOrderedSyncCursor([new DivergentSyncCursor<string>(), right]);
    expect(cursor.next({ maxSteps: 3 })).toEqual({ kind: "pending", steps: 3 });
    expect(right.next({ maxSteps: 1 })).toEqual({ kind: "answer", value: "right", steps: 1 });
  });

  it("once closes the unvisited tail exactly once", () => {
    const source = new StepSyncCursor(["first", "second"], "done");
    const cursor = new OnceSyncCursor(source);
    expect(cursor.next({ maxSteps: 1 })).toEqual({ kind: "answer", value: "first", steps: 1 });
    expect(source.closeCalls).toBe(1);
    cursor.close();
    cursor.close();
    expect(source.closeCalls).toBe(1);
    expect(cursor.next()).toEqual({ kind: "exhausted", terminal: undefined, steps: 0 });
  });

  it("once rejects a pre-aborted pull before reading its source", () => {
    const source = new StepSyncCursor(["ignored"], "done");
    const cursor = new OnceSyncCursor(source);
    const controller = new AbortController();
    controller.abort({ code: "already-aborted" });

    expect(cursor.next({ signal: controller.signal })).toEqual({
      kind: "cancelled",
      reason: { code: "already-aborted" },
      steps: 0,
    });
    expect(source.closeCalls).toBe(1);
  });

  it.each([
    [
      "source order",
      (branches: readonly SyncSearchCursor<string, string>[]) =>
        new SourceOrderedSyncCursor(branches),
    ],
    [
      "fair order",
      (branches: readonly SyncSearchCursor<string, string>[]) => new FairSyncCursor(branches, 1),
    ],
  ])("makes natural exhaustion sticky for %s scheduling", (_name, makeCursor) => {
    const branch = new StepSyncCursor(["answer"], "done");
    const cursor = makeCursor([branch]);
    expect(drainSyncCursor(cursor)).toEqual({
      kind: "exhausted",
      values: ["answer"],
      terminal: ["done"],
    });
    expect(cursor.closed).toBe(true);
    expect(cursor.next()).toEqual({ kind: "exhausted", terminal: ["done"], steps: 0 });
    cursor.close({ code: "late-close" });
    expect(branch.closeCalls).toBe(0);
    expect(cursor.next()).toEqual({ kind: "exhausted", terminal: ["done"], steps: 0 });
  });

  it("keeps the first cancellation reason and closes children once", () => {
    const branch = new StepSyncCursor(["late"], "done");
    const cursor = new SourceOrderedSyncCursor([branch]);
    cursor.close({ code: "first-close" });
    cursor.close({ code: "second-close" });
    expect(cursor.closed).toBe(true);
    expect(cursor.next()).toEqual({
      kind: "cancelled",
      reason: { code: "first-close" },
      steps: 0,
    });
    expect(branch.closeCalls).toBe(1);
  });

  it("copies and freezes a direct cancellation reason", () => {
    const branch = new StepSyncCursor(["late"], "done");
    const cursor = new SourceOrderedSyncCursor([branch]);
    const reason = { code: "original", message: "stable" };
    cursor.close(reason);
    reason.code = "mutated";
    reason.message = "changed";
    const event = cursor.next();
    expect(event).toEqual({
      kind: "cancelled",
      reason: { code: "original", message: "stable" },
      steps: 0,
    });
    if (event.kind === "cancelled") expect(Object.isFrozen(event.reason)).toBe(true);
  });

  it.each([
    ["unknown kind", { kind: "mystery", steps: 1 }],
    ["missing payload", { kind: "answer", steps: 1 }],
    [
      "throwing getter",
      Object.defineProperty({ steps: 1 }, "kind", {
        get(): never {
          throw new Error("kind getter failed");
        },
      }),
    ],
  ])("normalizes a malformed sync child with %s", (_name, malformed) => {
    const child = new MalformedSyncCursor<string>(malformed);
    const cursor = new FairSyncCursor([child], 1);
    const event = cursor.next({ maxSteps: 1 });
    expect(event.kind).toBe("fault");
    expect(event.steps).toBe(1);
    expect(child.closeCalls).toBe(1);
  });

  it("keeps a fault distinct from the cleanup cancellation", () => {
    const branch = new FaultSyncCursor<string>();
    const cursor = new FairSyncCursor([branch], 1);
    expect(cursor.next({ maxSteps: 1 })).toEqual({
      kind: "fault",
      error: branch.error,
      steps: 1,
    });
    expect(cursor.closed).toBe(true);
    expect(cursor.next()).toEqual({ kind: "fault", error: branch.error, steps: 0 });
    expect(branch.closeCalls).toBe(1);
  });

  it("turns a thrown sync read into a fault and closes its branch", () => {
    const branch = new ThrowingSyncCursor<string>();
    const cursor = new SourceOrderedSyncCursor([branch]);
    expect(cursor.next({ maxSteps: 1 })).toEqual({
      kind: "fault",
      error: branch.error,
      steps: 1,
    });
    expect(branch.closeCalls).toBe(1);
  });

  it("closes every sync sibling when one cleanup fails", () => {
    const fault = new FaultSyncCursor<string>();
    const badCleanup = new ThrowingCloseSyncCursor<string>();
    const later = new StepSyncCursor(["late"], "done");
    const cursor = new FairSyncCursor([fault, badCleanup, later], 1);
    const event = cursor.next({ maxSteps: 1 });
    expect(event).toMatchObject({ kind: "fault", steps: 1 });
    if (event.kind === "fault") {
      expect(event.error).toBeInstanceOf(AggregateError);
      expect((event.error as AggregateError).errors).toEqual([fault.error, badCleanup.error]);
    }
    expect(fault.closeCalls).toBe(1);
    expect(badCleanup.closeCalls).toBe(1);
    expect(later.closeCalls).toBe(1);
  });

  it("makes a direct synchronous cleanup failure sticky", () => {
    const badCleanup = new ThrowingCloseSyncCursor<string>();
    const later = new StepSyncCursor(["late"], "done");
    const cursor = new SourceOrderedSyncCursor([badCleanup, later]);

    expect(() => cursor.close({ code: "test-close" })).toThrow(badCleanup.error);
    expect(badCleanup.closeCalls).toBe(1);
    expect(later.closeCalls).toBe(1);
    expect(cursor.next()).toEqual({ kind: "fault", error: badCleanup.error, steps: 0 });
  });

  it("retains every sync cleanup failure and promotes later quiescence", () => {
    const first = new ThrowingCloseSyncCursor<string>();
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const second = new ThrowingCloseSyncCursor<string>(quiescence);
    const cursor = new FairSyncCursor([first, second], 1);

    let failure: unknown;
    try {
      cursor.close({ code: "test-close" });
    } catch (error) {
      failure = error;
    }
    expectPromotedQuiescenceFailure(failure, { code: "test-close" }, [first.error, quiescence]);
    expect(first.closeCalls).toBe(1);
    expect(second.closeCalls).toBe(1);
  });

  it("returns a fault when a cancelled sync drain cleanup fails", () => {
    const cleanupError = new Error("sync drain cleanup failed");
    const cursor: SyncSearchCursor<string, string> = {
      closed: false,
      next: () => ({ kind: "pending", steps: 0 }),
      drain: () => ({ kind: "cancelled", values: ["partial"], reason: { code: "stop" } }),
      close: () => {
        throw cleanupError;
      },
    };

    const result = drainSyncCursor(cursor);
    expect(result).toMatchObject({ kind: "fault", values: ["partial"] });
    if (result.kind === "fault") {
      expect(result.error).toBeInstanceOf(AggregateError);
      expect((result.error as AggregateError).errors).toEqual([{ code: "stop" }, cleanupError]);
    }
  });

  it("does not duplicate one sync quiescence fault returned by drain and close", () => {
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const cursor: SyncSearchCursor<string, string> = {
      closed: false,
      next: () => ({ kind: "fault", error: quiescence, steps: 0 }),
      drain: () => ({ kind: "fault", values: [], error: quiescence }),
      close: () => {
        throw quiescence;
      },
    };

    const result = drainSyncCursor(cursor);
    expect(result.kind).toBe("fault");
    if (result.kind === "fault") {
      expect(result.error).toBe(quiescence);
      expect(countRetainedFailure(result.error, quiescence)).toBe(1);
    }
  });

  it("does not duplicate one async quiescence fault returned by drain and close", async () => {
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const cursor: AsyncSearchCursor<string, string> = {
      closed: false,
      next: async () => ({ kind: "fault", error: quiescence, steps: 0 }),
      drain: async () => ({ kind: "fault", values: [], error: quiescence }),
      close: async () => {
        throw quiescence;
      },
    };

    const result = await drainAsyncCursor(cursor);
    expect(result.kind).toBe("fault");
    if (result.kind === "fault") {
      expect(result.error).toBe(quiescence);
      expect(countRetainedFailure(result.error, quiescence)).toBe(1);
    }
  });

  it("faults and closes a child that violates its synchronous step allowance", () => {
    const invalid = new InvalidStepSyncCursor<string>();
    const cursor = new SourceOrderedSyncCursor([invalid]);
    const event = cursor.next({ maxSteps: 1 });

    expect(event.kind).toBe("fault");
    if (event.kind === "fault") expect(event.error).toBeInstanceOf(RangeError);
    expect(invalid.closeCalls).toBe(1);
  });

  it("preserves the stream when a source-ordered cursor is split and drained", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer(), { maxLength: 6 }), { maxLength: 5 }),
        fc.nat(20),
        fc.integer({ min: 1, max: 5 }),
        (branches, prefixLength, stepsPerAnswer) => {
          const makeCursor = (): SourceOrderedSyncCursor<number, string> =>
            new SourceOrderedSyncCursor(
              branches.map(
                (values, index) => new StepSyncCursor(values, String(index), stepsPerAnswer),
              ),
            );
          const expected = drainSyncCursor(makeCursor(), { maxSteps: 1 });
          expect(expected.kind).toBe("exhausted");
          if (expected.kind !== "exhausted") return;

          const split = makeCursor();
          const prefix: number[] = [];
          while (prefix.length < prefixLength) {
            const event = split.next({ maxSteps: 1 });
            expect(event.steps).toBeLessThanOrEqual(1);
            if (event.kind === "answer") prefix.push(event.value);
            if (event.kind === "exhausted") break;
            expect(event.kind === "cancelled" || event.kind === "fault").toBe(false);
          }
          const tail = drainSyncCursor(split, { maxSteps: 1 });
          expect(tail.kind).toBe("exhausted");
          if (tail.kind !== "exhausted") return;
          expect([...prefix, ...tail.values]).toEqual(expected.values);
          expect(tail.terminal).toEqual(expected.terminal);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects invalid quotas even after reaching a terminal state", () => {
    const cursor = new SourceOrderedSyncCursor<number, string>([]);
    expect(cursor.next()).toEqual({ kind: "exhausted", terminal: [], steps: 0 });
    expect(() => cursor.next({ maxSteps: 0 })).toThrow(RangeError);
    expect(() => cursor.next({ maxSteps: Number.MAX_SAFE_INTEGER + 1 })).toThrow(RangeError);
  });
});

describe("asynchronous search scheduling", () => {
  it.each(malformedDrainCases("custom async drain getter failed"))(
    "normalizes and closes a malformed custom async drain with %s",
    async (_name, malformed) => {
      const source = new RawDrainAsyncCursor<string>(malformed);
      const result = await drainAsyncCursor(source, { maxSteps: 1 });

      expectFaultDrain(result, source);
    },
  );

  it.each(malformedEventCases("direct async drain getter failed"))(
    "normalizes and closes a direct async drain with %s",
    async (_name, malformed) => {
      const source = new RawThenExhaustedAsyncCursor<string>(malformed);
      const result = await drainAsyncCursor(source, { maxSteps: 1 });

      expectFaultDrain(result, source);
    },
  );

  it("normalizes a rejected direct async drain read and closes its source", async () => {
    const source = new RejectedAsyncCursor<string>();
    const result = await drainAsyncCursor(source, { maxSteps: 1 });

    expect(result.kind).toBe("fault");
    expect(result.values).toEqual([]);
    expect(source.closeCalls).toBe(1);
  });

  it("resumes a branch across bounded pending events", async () => {
    const cursor = new FairAsyncCursor([new QuotaAsyncCursor(["ready"], "done", 3)], 1);
    expect(await cursor.next({ maxSteps: 3 })).toEqual({
      kind: "answer",
      value: "ready",
      steps: 3,
    });
  });

  it("never reports more work than the requested async quota", async () => {
    const cursor = new FairAsyncCursor([new QuotaAsyncCursor(["ready"], "done", 3)]);
    expect(await cursor.next({ maxSteps: 1 })).toEqual({ kind: "pending", steps: 1 });
    expect(await cursor.next({ maxSteps: 1 })).toEqual({ kind: "pending", steps: 1 });
    expect(await cursor.next({ maxSteps: 1 })).toEqual({
      kind: "answer",
      value: "ready",
      steps: 1,
    });
  });

  it("bounds aggregate fair branch launches by the requested quota", async () => {
    const left = new CountingPendingAsyncCursor<string>();
    const right = new CountingPendingAsyncCursor<string>();
    const cursor = new FairAsyncCursor([left, right]);

    expect(await cursor.next({ maxSteps: 1 })).toEqual({ kind: "pending", steps: 1 });
    expect(left.steps + right.steps).toBe(1);
    expect(await cursor.next({ maxSteps: 1 })).toEqual({ kind: "pending", steps: 1 });
    expect([left.steps, right.steps].sort()).toEqual([1, 1]);
    await cursor.close();
  });

  it("does not regrant permits while a sibling reservation is outstanding", async () => {
    const eager = new PendingThenAnswerAsyncCursor("eager");
    const delayed = new TimedAsyncCursor([{ delayMs: 3, value: "delayed" }], "done");
    const cursor = new FairAsyncCursor([eager, delayed], 1);

    expect(await cursor.next({ maxSteps: 2 })).toEqual({
      kind: "answer",
      value: "delayed",
      steps: 2,
    });
    expect(eager.calls).toBe(1);
    await cursor.close();
  });

  it("admits a later branch after a suspended prefix consumes the first pull", async () => {
    const suspended = new DeferredAnswerAsyncCursor<string>();
    const cursor = new FairAsyncCursor([suspended, new QuotaAsyncCursor(["ready"], "done", 1)], 1);

    expect(await cursor.next({ maxSteps: 1 })).toEqual({ kind: "pending", steps: 1 });
    expect(await cursor.next({ maxSteps: 1 })).toEqual({
      kind: "answer",
      value: "ready",
      steps: 1,
    });
    const closing = cursor.close();
    suspended.resolveAnswer("late");
    await closing;
  });

  it("does not let a zero-progress branch starve an active sibling", async () => {
    const stalled = new ZeroPendingAsyncCursor<string>();
    const cursor = new FairAsyncCursor(
      [stalled, new TimedAsyncCursor([{ delayMs: 1, value: "ready" }], "done")],
      1,
    );

    expect(await cursor.next({ maxSteps: 2 })).toEqual({
      kind: "answer",
      value: "ready",
      steps: 1,
    });
    expect(stalled.calls).toBe(1);
    await cursor.close();
  });

  it("charges all concurrent reservations to the pull that launches them", async () => {
    const cursor = new FairAsyncCursor(
      [
        new TimedAsyncCursor([{ delayMs: 1, value: "first" }], "left"),
        new TimedAsyncCursor([{ delayMs: 8, value: "second" }], "right"),
      ],
      2,
    );

    expect(await cursor.next({ maxSteps: 4 })).toEqual({
      kind: "answer",
      value: "first",
      steps: 3,
    });
    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(await cursor.next({ maxSteps: 4 })).toEqual({
      kind: "answer",
      value: "second",
      steps: 0,
    });
    await cursor.close();
  });

  it("emits completion order while preserving every duplicate", async () => {
    const cursor = new FairAsyncCursor([
      new TimedAsyncCursor(
        [
          { delayMs: 20, value: "slow" },
          { delayMs: 1, value: "slow-2" },
        ],
        "left",
      ),
      new TimedAsyncCursor(
        [
          { delayMs: 1, value: "fast" },
          { delayMs: 1, value: "fast" },
        ],
        "right",
      ),
    ]);
    const drained = await drainAsyncCursor(cursor, { maxSteps: 8 });
    expect(drained.kind).toBe("exhausted");
    if (drained.kind !== "exhausted") return;
    expect(drained.values).toEqual(["fast", "fast", "slow", "slow-2"]);
    expect(drained.terminal).toEqual(["left", "right"]);
  });

  it("does not let a completed empty branch win a race", async () => {
    const empty = new TimedAsyncCursor<string>([], "empty");
    const answer = new TimedAsyncCursor([{ delayMs: 3, value: "answer" }], "answer");
    const cursor = raceAsyncCursors([empty, answer], 1);
    expect(await cursor.next({ maxSteps: 4 })).toEqual({
      kind: "answer",
      value: "answer",
      steps: 1,
    });
    expect(empty.closeCalls).toBe(1);
    expect(answer.closeCalls).toBe(1);
  });

  it("joins losing branch cleanup before returning the winner", async () => {
    const slow = new TimedAsyncCursor([{ delayMs: 50, value: "slow" }], "slow");
    const fast = new TimedAsyncCursor([{ delayMs: 1, value: "fast" }], "fast");
    const cursor = new OnceAsyncCursor(new FairAsyncCursor([slow, fast], 1));
    expect(await cursor.next({ maxSteps: 4 })).toEqual({
      kind: "answer",
      value: "fast",
      steps: 2,
    });
    expect(slow.active).toBe(false);
    expect(slow.closeCalls).toBe(1);
    expect(fast.closeCalls).toBe(1);
  });

  it("propagates a branch fault and closes every sibling", async () => {
    const fault = new FaultAsyncCursor<string>();
    const sibling = new TimedAsyncCursor([{ delayMs: 50, value: "late" }], "late");
    const cursor = new FairAsyncCursor([fault, sibling], 1);
    const event = await cursor.next({ maxSteps: 2 });
    expect(event.kind).toBe("fault");
    if (event.kind === "fault") expect(event.error).toEqual(new Error("branch fault"));
    expect(fault.closeCalls).toBe(1);
    expect(sibling.closeCalls).toBe(1);
    expect(sibling.active).toBe(false);
    expect(cursor.closed).toBe(true);
    const repeated = await cursor.next();
    expect(repeated.kind).toBe("fault");
    if (repeated.kind === "fault") {
      expect(repeated.error).toEqual(new Error("branch fault"));
      expect(repeated.steps).toBe(0);
    }
  });

  it("turns a synchronous throw from an async child into a joined fault", async () => {
    const thrown = new SyncThrowingAsyncCursor<string>();
    const sibling = new TimedAsyncCursor([{ delayMs: 50, value: "late" }], "late");
    const cursor = new FairAsyncCursor([thrown, sibling], 1);

    const event = await cursor.next({ maxSteps: 2 });
    expect(event).toEqual({ kind: "fault", error: thrown.error, steps: 2 });
    expect(thrown.closeCalls).toBe(1);
    expect(sibling.closeCalls).toBe(1);
    expect(sibling.active).toBe(false);
  });

  it.each([
    ["unknown kind", { kind: "mystery", steps: 1 }],
    ["missing payload", { kind: "exhausted", steps: 1 }],
    [
      "throwing getter",
      Object.defineProperty({ steps: 1 }, "kind", {
        get(): never {
          throw new Error("kind getter failed");
        },
      }),
    ],
  ])("normalizes and joins a malformed async child with %s", async (_name, malformed) => {
    const child = new MalformedAsyncCursor<string>(malformed);
    const cursor = new FairAsyncCursor([child], 1);
    const event = await cursor.next({ maxSteps: 1 });
    expect(event.kind).toBe("fault");
    expect(event.steps).toBe(1);
    expect(child.closeCalls).toBe(1);
  });

  it("normalizes a hostile async thenable into a joined fault", async () => {
    const child = new ThrowingThenAsyncCursor<string>();
    const cursor = new FairAsyncCursor([child], 1);
    const event = await cursor.next({ maxSteps: 1 });
    expect(event.kind).toBe("fault");
    expect(event.steps).toBe(1);
    expect(child.closeCalls).toBe(1);
  });

  it.each(singleAsyncWrappers)(
    "keeps pre-abort visible when %s cleanup throws",
    async (_name, makeCursor) => {
      const source = new ThrowingCloseAsyncCursor<string>();
      const cursor = makeCursor(source);
      const controller = new AbortController();
      controller.abort({ code: "pre-aborted" });

      expect(await cursor.next({ maxSteps: 1, signal: controller.signal })).toEqual({
        kind: "cancelled",
        reason: { code: "pre-aborted" },
        steps: 0,
      });
      expect(source.closeCalls).toBe(1);
    },
  );

  it("charges rejected and synchronously thrown fair reads to their permits", async () => {
    const rejected = new RejectedAsyncCursor<string>();
    const thrown = new SyncThrowingAsyncCursor<string>();

    const rejectedEvent = await new FairAsyncCursor([rejected], 1).next({ maxSteps: 1 });
    const thrownEvent = await new FairAsyncCursor([thrown], 1).next({ maxSteps: 1 });

    expect(rejectedEvent).toMatchObject({ kind: "fault", steps: 1 });
    expect(thrownEvent).toMatchObject({ kind: "fault", steps: 1 });
    expect(rejected.closeCalls).toBe(1);
    expect(thrown.closeCalls).toBe(1);
  });

  it("rejects a missing parallel answer payload before indexing it", async () => {
    const source = new MalformedAsyncCursor<string>({ kind: "answer", steps: 1 });
    const cursor = new ParallelSourceOrderedAsyncCursor([source]);

    const event = await cursor.next({ maxSteps: 1 });
    expect(event).toMatchObject({ kind: "fault", steps: 1 });
    expect(source.closeCalls).toBe(1);
  });

  it("turns an external abort into joined cursor cancellation", async () => {
    const branch = new TimedAsyncCursor([{ delayMs: 50, value: "late" }], "done");
    const cursor = new FairAsyncCursor([branch], 1);
    const controller = new AbortController();
    const pending = cursor.next({ signal: controller.signal });
    await Promise.resolve();
    controller.abort({ code: "test-abort" });
    expect(await pending).toEqual({
      kind: "cancelled",
      reason: { code: "test-abort" },
      steps: 1,
    });
    expect(branch.closeCalls).toBe(1);
    expect(branch.active).toBe(false);
  });

  it("once rejects a pre-aborted async pull before reading its source", async () => {
    const source = new QuotaAsyncCursor(["ignored"], "done", 1);
    const cursor = new OnceAsyncCursor(source);
    const controller = new AbortController();
    controller.abort({ code: "already-aborted" });

    expect(await cursor.next({ signal: controller.signal })).toEqual({
      kind: "cancelled",
      reason: { code: "already-aborted" },
      steps: 0,
    });
    expect(source.closed).toBe(true);
  });

  it("normalizes hostile cancellation objects before installing sticky terminals", async () => {
    const hostile = Object.create(null) as CancellationReason;
    Object.defineProperty(hostile, "code", {
      get(): never {
        throw new Error("hostile cancellation getter");
      },
    });

    const sync = new OnceSyncCursor(new StepSyncCursor(["ignored"], "done", 1));
    expect(() => sync.close(hostile)).not.toThrow();
    expect(sync.next()).toEqual({
      kind: "cancelled",
      reason: { code: "aborted" },
      steps: 0,
    });

    const source = new QuotaAsyncCursor(["ignored"], "done", 1);
    const asyncCursor = new OnceAsyncCursor(source);
    const controller = new AbortController();
    controller.abort(hostile);
    expect(await asyncCursor.next({ signal: controller.signal })).toEqual({
      kind: "cancelled",
      reason: { code: "aborted" },
      steps: 0,
    });
    expect(source.closed).toBe(true);
  });

  it("keeps a suspended async drain parked in one read until cancellation", async () => {
    const source = new CloseDrivenAsyncCursor<string>();
    const draining = drainAsyncCursor(source);
    await Promise.resolve();
    await Promise.resolve();
    expect(source.nextCalls).toBe(1);

    await source.close({ code: "cancel-drain" });
    expect(await draining).toEqual({
      kind: "cancelled",
      values: [],
      reason: { code: "cancel-drain" },
    });
    expect(source.nextCalls).toBe(1);
  });

  it("keeps async source ordering even when a later branch is faster", async () => {
    const cursor = new SourceOrderedAsyncCursor([
      new TimedAsyncCursor([{ delayMs: 8, value: "first" }], "left"),
      new TimedAsyncCursor([{ delayMs: 1, value: "second" }], "right"),
    ]);
    const drained = await drainAsyncCursor(cursor);
    expect(drained).toEqual({
      kind: "exhausted",
      values: ["first", "second"],
      terminal: ["left", "right"],
    });
  });

  it("rejects overlapping reads on stateful async cursor wrappers", async () => {
    const assertExclusive = async (cursor: AsyncSearchCursor<string, unknown>): Promise<void> => {
      const first = cursor.next();
      await Promise.resolve();
      await expect(cursor.next()).rejects.toThrow("concurrent cursor.next calls are not allowed");
      await cursor.close({ code: "test-finished" });
      expect((await first).kind).toBe("cancelled");
    };

    await assertExclusive(
      new SourceOrderedAsyncCursor([
        new TimedAsyncCursor([{ delayMs: 20, value: "late" }], "done"),
      ]),
    );
    await assertExclusive(
      new OnceAsyncCursor(new TimedAsyncCursor([{ delayMs: 20, value: "late" }], "done")),
    );
  });

  it("runs par branches together but presents their complete bags in source order", async () => {
    const first = new TimedAsyncCursor(
      [
        { delayMs: 8, value: "a1" },
        { delayMs: 1, value: "a2" },
      ],
      "left",
    );
    const second = new TimedAsyncCursor([{ delayMs: 2, value: "b" }], "right");
    const cursor = new ParallelSourceOrderedAsyncCursor([first, second]);
    const initial = cursor.next({ maxSteps: 2 });
    await Promise.resolve();
    expect(first.active).toBe(true);
    expect(second.active).toBe(true);
    expect(await initial).toEqual({ kind: "pending", steps: 2 });

    const drained = await drainAsyncCursor(cursor, { maxSteps: 2 });
    expect(drained).toEqual({
      kind: "exhausted",
      values: ["a1", "a2", "b"],
      terminal: ["left", "right"],
    });
  });

  it("bulk-drains par through the bounded event coordinator", async () => {
    const first = new TimedAsyncCursor(
      [
        { delayMs: 8, value: "a1" },
        { delayMs: 1, value: "a2" },
      ],
      "left",
    );
    const second = new TimedAsyncCursor([{ delayMs: 2, value: "b" }], "right");
    const cursor = new ParallelSourceOrderedAsyncCursor([first, second]);
    const draining = cursor.drain({ maxSteps: 2 });
    await Promise.resolve();

    expect(first.active).toBe(true);
    expect(second.active).toBe(true);
    await expect(draining).resolves.toEqual({
      kind: "exhausted",
      values: ["a1", "a2", "b"],
      terminal: ["left", "right"],
    });
  });

  it("shares one bulk quantum across batch-capable par branches", async () => {
    const first = new BatchThenAsyncCursor<string>({
      kind: "exhausted",
      values: ["a1", "a2"],
      terminal: "left",
      steps: 1,
    });
    const second = new BatchThenAsyncCursor<string>({
      kind: "exhausted",
      values: ["b"],
      terminal: "right",
      steps: 1,
    });
    const cursor = new ParallelSourceOrderedAsyncCursor([first, second]);

    await expect(cursor.drain({ maxSteps: 2 })).resolves.toEqual({
      kind: "exhausted",
      values: ["a1", "a2", "b"],
      terminal: ["left", "right"],
    });
    expect(first.batchAllowances).toEqual([1]);
    expect(second.batchAllowances).toEqual([1]);
    expect(first.nextCalls).toBe(0);
    expect(second.nextCalls).toBe(0);
  });

  it("falls back from a zero-progress batch without replaying the child", async () => {
    const source = new BatchThenAsyncCursor<string>({ kind: "pending", values: [], steps: 0 }, [
      { kind: "answer", value: "answer", steps: 1 },
      { kind: "exhausted", terminal: "done", steps: 0 },
    ]);
    const cursor = new ParallelSourceOrderedAsyncCursor([source]);

    await expect(cursor.drain({ maxSteps: 1 })).resolves.toEqual({
      kind: "exhausted",
      values: ["answer"],
      terminal: ["done"],
    });
    expect(source.batchAllowances).toEqual([1]);
    expect(source.nextCalls).toBe(2);
  });

  it("retains simultaneous batch faults and joins every branch", async () => {
    const first = new DeferredBatchFaultCursor<string>();
    const second = new DeferredBatchFaultCursor<string>();
    const firstError = new Error("first batch branch failed");
    const secondError = new Error("second batch branch failed");
    await expectParallelFaults(first, second, firstError, secondError);
  });

  it("retains simultaneous par cursor faults with the first as cause", async () => {
    const first = new DeferredFaultAsyncCursor<string>();
    const second = new DeferredFaultAsyncCursor<string>();
    const firstError = new Error("first cursor branch failed");
    const secondError = new Error("second cursor branch failed");
    await expectParallelFaults(first, second, firstError, secondError);
  });

  it("owns a direct parallel child once and exposes its late rejection on close", async () => {
    const source = new DeferredRejectingReadAsyncCursor<string>();
    const cursor = new ParallelSourceOrderedAsyncCursor([source]);
    const controller = new AbortController();
    const reason = { code: "stop-direct-parallel" } as const;
    const draining = cursor.drain({ maxSteps: 1, signal: controller.signal });
    await Promise.resolve();

    controller.abort(reason);
    await Promise.resolve();
    source.rejectRead();

    await expect(draining).resolves.toEqual({
      kind: "cancelled",
      values: [],
      reason,
    });
    await expect(cursor.close()).rejects.toBe(source.error);
    expect(source.closeCalls).toBe(1);
    await expect(cursor.next()).resolves.toEqual({ kind: "cancelled", reason, steps: 0 });
  });

  it("collects structured parallel tasks in source order after out-of-order completion", async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const result = drainParallelTasksSourceOrdered<string, string>([
      () =>
        new Promise<{ values: string[]; terminal: string }>((resolve) => {
          finishFirst = () => resolve({ values: ["a1", "a2"], terminal: "left" });
        }),
      () =>
        new Promise<{ values: string[]; terminal: string }>((resolve) => {
          finishSecond = () => resolve({ values: ["b"], terminal: "right" });
        }),
    ]);

    finishSecond();
    finishFirst();
    await expect(result).resolves.toEqual({
      kind: "exhausted",
      values: ["a1", "a2", "b"],
      terminal: ["left", "right"],
    });
  });

  it("retains every simultaneous structured task fault with the first as cause", async () => {
    const first = new Error("first branch failed");
    const second = new Error("second branch failed");
    const result = await drainParallelTasksSourceOrdered<string, string>([
      () => Promise.reject(first),
      () => Promise.reject(second),
    ]);

    expect(result.kind).toBe("fault");
    if (result.kind === "fault") {
      expect(result.error).toBeInstanceOf(AggregateError);
      expect((result.error as AggregateError).errors).toEqual([first, second]);
      expect((result.error as AggregateError).cause).toBe(first);
    }
  });

  it("aborts and joins a structured task prefix after synchronous construction failure", async () => {
    const constructionError = new Error("second task construction failed");
    let finishPrefix!: () => void;
    let prefixAborted = false;
    let prefixSettled = false;
    let suffixStarted = false;
    const draining = drainParallelTasksSourceOrdered<string, string>([
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              prefixAborted = true;
              finishPrefix = () => {
                prefixSettled = true;
                reject(signal.reason);
              };
            },
            { once: true },
          );
        }),
      () => {
        throw constructionError;
      },
      () => {
        suffixStarted = true;
        return { values: ["unused"], terminal: "unused" };
      },
    ]);
    let published = false;
    void draining.then(() => {
      published = true;
    });

    expect(prefixAborted).toBe(true);
    expect(suffixStarted).toBe(false);
    await Promise.resolve();
    expect(published).toBe(false);
    finishPrefix();

    await expect(draining).resolves.toEqual({
      kind: "fault",
      values: [],
      error: constructionError,
    });
    expect(prefixSettled).toBe(true);
  });

  it("does not mask a critical cleanup fault with external task-group cancellation", async () => {
    const controller = new AbortController();
    const reason = { code: "external-stop" };
    const critical = new Error("task cleanup did not quiesce");
    const draining = drainParallelTasksSourceOrdered<string, string>(
      [
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(critical), { once: true });
          }),
      ],
      {
        signal: controller.signal,
        selectCriticalFault: (faults) => faults.find((fault) => fault === critical),
      },
    );

    controller.abort(reason);
    await expect(draining).resolves.toEqual({ kind: "fault", values: [], error: critical });
  });

  it("joins a constructed par prefix before reporting a later factory fault", async () => {
    const prefix = new DeferredCloseAsyncCursor<string>();
    const constructionError = new Error("second branch construction failed");
    let suffixConstructed = false;
    const cursor = ParallelSourceOrderedAsyncCursor.fromFactories<string, string>([
      () => prefix,
      () => {
        throw constructionError;
      },
      () => {
        suffixConstructed = true;
        return new QuotaAsyncCursor([], "unused", 1);
      },
    ]);

    let settled = false;
    const reading = cursor.next().then((event) => {
      settled = true;
      return event;
    });
    await Promise.resolve();

    expect(prefix.closeCalls).toBe(1);
    expect(suffixConstructed).toBe(false);
    expect(settled).toBe(false);
    prefix.finishClose();

    expect(await reading).toEqual({ kind: "fault", error: constructionError, steps: 0 });
    expect(cursor.closed).toBe(true);
  });

  it("keeps cancellation sticky when close lands during construction-fault cleanup", async () => {
    const prefix = new DeferredCloseAsyncCursor<string>();
    const constructionError = new Error("branch construction failed before cancellation");
    const reason = { code: "close-during-construction-cleanup" } as const;
    const cursor = ParallelSourceOrderedAsyncCursor.fromFactories<string, string>([
      () => prefix,
      () => {
        throw constructionError;
      },
    ]);
    const reading = cursor.next();
    await Promise.resolve();
    expect(prefix.closeCalls).toBe(1);

    const closing = cursor.close(reason);
    prefix.finishClose();

    await expect(reading).resolves.toEqual({ kind: "cancelled", reason, steps: 0 });
    await expect(closing).rejects.toBe(constructionError);
    await expect(cursor.next()).resolves.toEqual({ kind: "cancelled", reason, steps: 0 });
  });

  it("closes a child created during re-entrant par cancellation before returning", async () => {
    const child = new DeferredAnswerAsyncCursor<string>();
    const reason = { code: "reentrant-close" } as const;
    let suffixConstructed = false;
    let closing!: Promise<void>;
    const cursor = ParallelSourceOrderedAsyncCursor.fromFactories<string, string>([
      () => {
        closing = cursor.close(reason);
        return child;
      },
      () => {
        suffixConstructed = true;
        return new DeferredAnswerAsyncCursor<string>();
      },
    ]);

    await expect(cursor.next({ maxSteps: 1 })).resolves.toEqual({
      kind: "cancelled",
      reason,
      steps: 0,
    });
    await closing;
    expect(child.nextCalls).toBe(0);
    expect(child.closeCalls).toBe(1);
    expect(suffixConstructed).toBe(false);
  });

  it("does not publish a par scheduler after queued cancellation during initialization", async () => {
    const child = new DeferredAnswerAsyncCursor<string>();
    const reason = { code: "queued-initialization-close" } as const;
    let closing!: Promise<void>;
    const cursor = ParallelSourceOrderedAsyncCursor.fromFactories([
      () => {
        queueMicrotask(() => {
          closing = cursor.close(reason);
        });
        return child;
      },
    ]);

    await expect(cursor.next({ maxSteps: 1 })).resolves.toEqual({
      kind: "cancelled",
      reason,
      steps: 0,
    });
    await closing;
    expect(child.nextCalls).toBe(0);
    expect(child.closeCalls).toBe(1);
    await expect(cursor.next()).resolves.toEqual({ kind: "cancelled", reason, steps: 0 });
  });

  it("keeps re-entrant cancellation cleanup distinct from branch construction", async () => {
    const child = new CachedRejectingCloseAsyncCursor<string>();
    const reason = { code: "reentrant-cleanup-failure" } as const;
    let closing!: Promise<void>;
    const cursor = ParallelSourceOrderedAsyncCursor.fromFactories([
      () => {
        closing = cursor.close(reason);
        return child;
      },
    ]);

    await expect(cursor.next()).resolves.toEqual({ kind: "cancelled", reason, steps: 0 });
    await expect(closing).rejects.toBe(child.error);
    expect(child.closeCalls).toBe(1);
    await expect(cursor.next()).resolves.toEqual({ kind: "cancelled", reason, steps: 0 });
  });

  it("reports a re-entrant factory fault before prefix cleanup failure exactly once", async () => {
    const prefix = new CachedRejectingCloseAsyncCursor<string>();
    const constructionError = new Error("factory failed after re-entrant close");
    const reason = { code: "reentrant-factory-failure" } as const;
    let closing!: Promise<void>;
    const cursor = ParallelSourceOrderedAsyncCursor.fromFactories<string, string>([
      () => prefix,
      () => {
        closing = cursor.close(reason);
        throw constructionError;
      },
    ]);

    await expect(cursor.next()).resolves.toEqual({ kind: "cancelled", reason, steps: 0 });
    const failure = await closing.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([constructionError, prefix.error]);
    expect(prefix.closeCalls).toBe(1);
    await expect(cursor.next()).resolves.toEqual({ kind: "cancelled", reason, steps: 0 });
  });

  it("reports both par construction and prefix-cleanup faults", async () => {
    const prefix = new ThrowingCloseAsyncCursor<string>();
    const constructionError = new Error("branch construction failed");
    const cursor = ParallelSourceOrderedAsyncCursor.fromFactories<string, string>([
      () => prefix,
      () => {
        throw constructionError;
      },
    ]);

    const event = await cursor.next();
    expect(event.kind).toBe("fault");
    if (event.kind === "fault") {
      expect(event.error).toBeInstanceOf(AggregateError);
      expect((event.error as AggregateError).errors).toEqual([constructionError, prefix.error]);
    }
    expect(prefix.closeCalls).toBe(1);
  });

  it("bounds aggregate par work by the caller's quota", async () => {
    const cursor = new ParallelSourceOrderedAsyncCursor([
      new QuotaAsyncCursor(["left"], "left", 3),
      new QuotaAsyncCursor(["right"], "right", 3),
    ]);
    expect(await cursor.next({ maxSteps: 2 })).toEqual({ kind: "pending", steps: 2 });
    expect(await cursor.next({ maxSteps: 2 })).toEqual({ kind: "pending", steps: 2 });
  });

  it("turns a rejected par read into a typed fault after joining siblings", async () => {
    const rejected = new RejectedAsyncCursor<string>();
    const sibling = new TimedAsyncCursor([{ delayMs: 50, value: "late" }], "late");
    const cursor = new ParallelSourceOrderedAsyncCursor([rejected, sibling]);
    const event = await cursor.next({ maxSteps: 2 });
    expect(event.kind).toBe("fault");
    if (event.kind === "fault") expect(event.error).toEqual(new Error("rejected branch read"));
    expect(rejected.closeCalls).toBe(1);
    expect(sibling.closeCalls).toBe(1);
    expect(sibling.active).toBe(false);
  });

  it("charges every completed par reservation before publishing a terminal fault", async () => {
    const first = new FaultAsyncCursor<string>();
    const second = new FaultAsyncCursor<string>();
    const cursor = new ParallelSourceOrderedAsyncCursor([first, second]);

    const event = await cursor.next({ maxSteps: 2 });
    expect(event.kind).toBe("fault");
    expect(event.steps).toBe(2);
    expect(first.closeCalls).toBe(1);
    expect(second.closeCalls).toBe(1);
  });

  it.each(singleAsyncWrappers)(
    "faults and closes a child that exceeds its %s allowance",
    async (_name, makeCursor) => {
      const invalid = new InvalidStepAsyncCursor<string>();
      const cursor = makeCursor(invalid);
      const event = await cursor.next({ maxSteps: 1 });

      expect(event.kind).toBe("fault");
      if (event.kind === "fault") expect(event.error).toBeInstanceOf(RangeError);
      expect(invalid.closeCalls).toBe(1);
    },
  );

  it("recovers after an invalid parallel quota instead of retaining the read lock", async () => {
    const nextCursor = new ParallelSourceOrderedAsyncCursor([
      new QuotaAsyncCursor(["answer"], "done", 1),
    ]);
    await expect(nextCursor.next({ maxSteps: 0 })).rejects.toBeInstanceOf(RangeError);
    expect((await nextCursor.next({ maxSteps: 1 })).kind).toBe("pending");
    expect(await nextCursor.next({ maxSteps: 1 })).toEqual({
      kind: "answer",
      value: "answer",
      steps: 0,
    });

    const drainCursor = new ParallelSourceOrderedAsyncCursor([
      new QuotaAsyncCursor(["answer"], "done", 1),
    ]);
    await expect(drainCursor.drain({ maxSteps: 0 })).rejects.toBeInstanceOf(RangeError);
    expect(await drainCursor.drain({ maxSteps: 1 })).toEqual({
      kind: "exhausted",
      values: ["answer"],
      terminal: ["done"],
    });
  });

  it("cancels a bulk-drain sibling as soon as another branch faults", async () => {
    const fault = new FaultAsyncCursor<string>();
    const sibling = new CloseDrivenAsyncCursor<string>();
    const cursor = new ParallelSourceOrderedAsyncCursor([fault, sibling]);

    const result = await cursor.drain({ maxSteps: 2 });
    expect(result.kind).toBe("fault");
    expect(fault.closeCalls).toBe(1);
    expect(sibling.closeCalls).toBe(1);
    expect(sibling.active).toBe(false);
  });

  it("makes close idempotent and wakes an active read", async () => {
    const source = new TimedAsyncCursor([{ delayMs: 50, value: "late" }], "done");
    const cursor = new FairAsyncCursor([source], 1);
    const pending = cursor.next();
    await Promise.resolve();
    await Promise.all([cursor.close({ code: "test-close" }), cursor.close()]);
    expect(await pending).toEqual({
      kind: "cancelled",
      reason: { code: "test-close" },
      steps: 1,
    });
    expect(source.closeCalls).toBe(1);
  });

  it.each(singleAsyncWrappers)(
    "joins an active parent read and suppresses its post-close answer for %s",
    async (_name, make) => {
      const source = new DeferredAnswerAsyncCursor<string>();
      const cursor = make(source);
      const reading = cursor.next({ maxSteps: 1 });
      await Promise.resolve();

      let closeSettled = false;
      const closing = cursor.close({ code: "stop-active" }).then(() => {
        closeSettled = true;
      });
      await Promise.resolve();
      expect(closeSettled).toBe(false);

      source.resolveAnswer("must-not-escape");
      expect(await reading).toEqual({
        kind: "cancelled",
        reason: { code: "stop-active" },
        steps: 1,
      });
      await closing;
      expect(closeSettled).toBe(true);
      expect(source.closeCalls).toBe(1);
    },
  );

  it.each([
    [
      "source-ordered",
      (source: AsyncSearchCursor<string, string>) => new SourceOrderedAsyncCursor([source]),
    ],
    ["once", (source: AsyncSearchCursor<string, string>) => new OnceAsyncCursor(source)],
  ] as const)(
    "owns signal cancellation when a %s child ignores the signal",
    async (_name, make) => {
      const source = new CloseDrivenAsyncCursor<string>();
      const cursor = make(source);
      const controller = new AbortController();
      const reading = cursor.next({ maxSteps: 1, signal: controller.signal });
      while (!source.active) await Promise.resolve();

      controller.abort({ code: "parent-signal-stop" });

      await expect(reading).resolves.toMatchObject({
        kind: "cancelled",
        reason: { code: "parent-signal-stop" },
      });
      expect(source.active).toBe(false);
      expect(source.closeCalls).toBe(1);
      await cursor.close();
    },
  );

  it("keeps once cancellation visible and exposes a later child fault on close", async () => {
    const source = new DeferredFaultAsyncCursor<string>();
    const cursor = new OnceAsyncCursor(source);
    const reading = cursor.next({ maxSteps: 1 });
    await Promise.resolve();

    const closing = cursor.close({ code: "stop-before-fault" });
    const lateFault = new Error("late child fault");
    source.resolveFault(lateFault);

    expect(await reading).toEqual({
      kind: "cancelled",
      reason: { code: "stop-before-fault" },
      steps: 1,
    });
    await expect(closing).rejects.toBe(lateFault);
    expect(await cursor.next()).toEqual({
      kind: "cancelled",
      reason: { code: "stop-before-fault" },
      steps: 0,
    });
    expect(source.closeCalls).toBe(1);
  });

  it("keeps source-order cancellation visible and exposes a later rejection on close", async () => {
    const source = new DeferredRejectingReadAsyncCursor<string>();
    const cursor = new SourceOrderedAsyncCursor([source]);
    const reading = cursor.next({ maxSteps: 1 });
    await Promise.resolve();

    const closing = cursor.close({ code: "stop-before-rejection" });
    source.rejectRead();

    expect(await reading).toEqual({
      kind: "cancelled",
      reason: { code: "stop-before-rejection" },
      steps: 1,
    });
    await expect(closing).rejects.toBe(source.error);
    expect(await cursor.next()).toEqual({
      kind: "cancelled",
      reason: { code: "stop-before-rejection" },
      steps: 0,
    });
    expect(source.closeCalls).toBe(1);
  });

  it("keeps fair cancellation visible and exposes a later rejection on close", async () => {
    const source = new DeferredRejectingReadAsyncCursor<string>();
    const cursor = new FairAsyncCursor([source], 1);
    const reading = cursor.next({ maxSteps: 1 });
    await Promise.resolve();

    const closing = cursor.close({ code: "stop-fair-before-rejection" });
    source.rejectRead();

    expect(await reading).toEqual({
      kind: "cancelled",
      reason: { code: "stop-fair-before-rejection" },
      steps: 1,
    });
    await expect(closing).rejects.toBe(source.error);
    expect(await cursor.next()).toEqual({
      kind: "cancelled",
      reason: { code: "stop-fair-before-rejection" },
      steps: 0,
    });
    expect(source.closeCalls).toBe(1);
  });

  it("deduplicates quiescence exposed by both an active read and its cleanup", async () => {
    const quiescence = new WorkerQuiescenceError("the same worker may still be running");
    const source = new DeferredFaultAsyncCursor<string>(quiescence);
    const cursor = new OnceAsyncCursor(source);
    const reading = cursor.next({ maxSteps: 1 });
    await Promise.resolve();

    const closing = cursor.close({ code: "stop-same-quiescence" });
    source.resolveFault(quiescence);
    const event = await reading;

    expect(event.kind).toBe("fault");
    if (event.kind !== "fault") throw new Error("expected worker-quiescence fault");
    expect(event.error).toBeInstanceOf(WorkerQuiescenceError);
    expect(countRetainedFailure(event.error, quiescence)).toBe(1);
    const closeFailure = await closing.catch((error: unknown) => error);
    expect(closeFailure).toBe(event.error);
    expect(await cursor.next()).toEqual({ kind: "fault", error: event.error, steps: 0 });
  });

  it("deduplicates fair quiescence exposed by both a child event and cleanup", async () => {
    const quiescence = new WorkerQuiescenceError("the same fair worker may still be running");
    const source = new DeferredFaultAsyncCursor<string>(quiescence);
    const cursor = new FairAsyncCursor([source], 1);
    const reading = cursor.next({ maxSteps: 1 });
    await Promise.resolve();

    source.resolveFault(quiescence);
    const event = await reading;

    expect(event.kind).toBe("fault");
    if (event.kind !== "fault") throw new Error("expected worker-quiescence fault");
    expect(event.error).toBeInstanceOf(WorkerQuiescenceError);
    expect(countRetainedFailure(event.error, quiescence)).toBe(1);
    const closeFailure = await cursor.close().catch((error: unknown) => error);
    expect(closeFailure).toBe(event.error);
    expect(await cursor.next()).toEqual({ kind: "fault", error: event.error, steps: 0 });
    expect(source.closeCalls).toBe(1);
  });

  it("deduplicates fair quiescence when close wins the child-event race", async () => {
    const quiescence = new WorkerQuiescenceError("the same closing worker may still be running");
    const source = new DeferredFaultAsyncCursor<string>(quiescence);
    const cursor = new FairAsyncCursor([source], 1);
    const reading = cursor.next({ maxSteps: 1 });
    await Promise.resolve();

    const closing = cursor.close({ code: "stop-before-fair-quiescence" });
    source.resolveFault(quiescence);
    const event = await reading;

    expect(event.kind).toBe("fault");
    if (event.kind !== "fault") throw new Error("expected worker-quiescence fault");
    expect(countRetainedFailure(event.error, quiescence)).toBe(1);
    const closeFailure = await closing.catch((error: unknown) => error);
    expect(closeFailure).toBe(event.error);
    expect(countRetainedFailure(closeFailure, quiescence)).toBe(1);
    expect(await cursor.next()).toEqual({ kind: "fault", error: event.error, steps: 0 });
    expect(source.closeCalls).toBe(1);
  });

  it.each(singleAsyncWrappers)(
    "retains a late ordinary %s read fault before cleanup quiescence",
    async (_name, makeCursor) => {
      const readFailure = new Error("late ordinary read fault");
      const quiescence = new WorkerQuiescenceError("cleanup worker may still be running");
      const source = new DeferredFaultAsyncCursor<string>(quiescence);
      const cursor = makeCursor(source);
      const reading = cursor.next({ maxSteps: 1 });
      await Promise.resolve();

      const closing = cursor.close({ code: "stop-before-cleanup-quiescence" });
      source.resolveFault(readFailure);
      const event = await reading;

      expect(event.kind).toBe("fault");
      if (event.kind !== "fault") throw new Error("expected worker-quiescence fault");
      expect(event.error).toBeInstanceOf(WorkerQuiescenceError);
      expect(countRetainedFailure(event.error, readFailure)).toBe(1);
      expect(countRetainedFailure(event.error, quiescence)).toBe(1);
      const closeFailure = await closing.catch((error: unknown) => error);
      expect(closeFailure).toBe(event.error);
      expect(await cursor.next()).toEqual({ kind: "fault", error: event.error, steps: 0 });
    },
  );

  it("attempts every async cleanup while keeping cancellation sticky", async () => {
    const badCleanup = new ThrowingCloseAsyncCursor<string>();
    const later = new TimedAsyncCursor([{ delayMs: 20, value: "late" }], "done");
    const cursor = new FairAsyncCursor([badCleanup, later], 1);

    await expect(cursor.close({ code: "test-close" })).rejects.toBe(badCleanup.error);
    expect(badCleanup.closeCalls).toBe(1);
    expect(later.closeCalls).toBe(1);
    expect(await cursor.next()).toEqual({
      kind: "cancelled",
      reason: { code: "test-close" },
      steps: 0,
    });
  });

  it("retains every async cleanup failure and promotes later quiescence", async () => {
    const first = new ThrowingCloseAsyncCursor<string>();
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const second = new ThrowingCloseAsyncCursor<string>(quiescence);
    const cursor = new FairAsyncCursor([first, second], 1);

    const failure = await cursor.close({ code: "test-close" }).catch((error: unknown) => error);
    expectPromotedQuiescenceFailure(failure, { code: "test-close" }, [first.error, quiescence]);
    expect(first.closeCalls).toBe(1);
    expect(second.closeCalls).toBe(1);
    expect(await cursor.next()).toEqual({ kind: "fault", error: failure, steps: 0 });
  });

  it("keeps cancelled next visible while close exposes ordinary cleanup failure", async () => {
    const source = new ThrowingCloseAsyncCursor<string>();
    const cursor = new SourceOrderedAsyncCursor([source]);
    const controller = new AbortController();
    controller.abort({ code: "pre-aborted" });

    await expect(cursor.next({ signal: controller.signal })).resolves.toEqual({
      kind: "cancelled",
      reason: { code: "pre-aborted" },
      steps: 0,
    });
    await expect(cursor.close()).rejects.toBe(source.error);
  });

  it("keeps a pre-abort parallel cleanup quiescence fault sticky", async () => {
    const quiescence = new WorkerQuiescenceError("parallel worker may still be running");
    const source = new ThrowingCloseAsyncCursor<string>(quiescence);
    const cursor = new ParallelSourceOrderedAsyncCursor([source]);
    const controller = new AbortController();
    controller.abort({ code: "pre-aborted-parallel" });

    const first = await cursor.next({ signal: controller.signal });
    expect(first.kind).toBe("fault");
    if (first.kind !== "fault") throw new Error("expected worker-quiescence fault");
    expect(first.error).toBeInstanceOf(WorkerQuiescenceError);
    expect((first.error as WorkerQuiescenceError).cause).toEqual({
      code: "pre-aborted-parallel",
    });
    expect(await cursor.next()).toEqual({ kind: "fault", error: first.error, steps: 0 });
    await expect(cursor.close()).rejects.toBe(first.error);
  });

  it("returns a fault when a cancelled async drain cleanup fails", async () => {
    const cleanupError = new Error("async drain cleanup failed");
    const cursor: AsyncSearchCursor<string, string> = {
      closed: false,
      next: () => Promise.resolve({ kind: "pending", steps: 0 }),
      drain: () =>
        Promise.resolve({
          kind: "cancelled",
          values: ["partial"],
          reason: { code: "stop" },
        }),
      close: () => Promise.reject(cleanupError),
    };

    const result = await drainAsyncCursor(cursor);
    expect(result).toMatchObject({ kind: "fault", values: ["partial"] });
    if (result.kind === "fault") {
      expect(result.error).toBeInstanceOf(AggregateError);
      expect((result.error as AggregateError).errors).toEqual([{ code: "stop" }, cleanupError]);
    }
  });

  it("does not change a visible cancellation after deferred cleanup rejects", async () => {
    const source = new DeferredRejectingCloseAsyncCursor<string>();
    const cursor = new SourceOrderedAsyncCursor([source]);
    const closing = cursor.close({ code: "cancel-before-cleanup" });

    expect(await cursor.next()).toEqual({
      kind: "cancelled",
      reason: { code: "cancel-before-cleanup" },
      steps: 0,
    });
    source.rejectClose();
    await expect(closing).rejects.toBe(source.error);
    expect(await cursor.next()).toEqual({
      kind: "cancelled",
      reason: { code: "cancel-before-cleanup" },
      steps: 0,
    });
  });

  it.each([
    [
      "source order",
      (branches: readonly AsyncSearchCursor<string, string>[]) =>
        new SourceOrderedAsyncCursor(branches),
    ],
    [
      "fair completion",
      (branches: readonly AsyncSearchCursor<string, string>[]) => new FairAsyncCursor(branches, 1),
    ],
    [
      "parallel source order",
      (branches: readonly AsyncSearchCursor<string, string>[]) =>
        new ParallelSourceOrderedAsyncCursor(branches),
    ],
  ])("makes natural exhaustion sticky for %s scheduling", async (_name, makeCursor) => {
    const branch = new TimedAsyncCursor([{ delayMs: 0, value: "answer" }], "done");
    const cursor = makeCursor([branch]);
    expect(await drainAsyncCursor(cursor)).toEqual({
      kind: "exhausted",
      values: ["answer"],
      terminal: ["done"],
    });
    expect(cursor.closed).toBe(true);
    expect(await cursor.next()).toEqual({
      kind: "exhausted",
      terminal: ["done"],
      steps: 0,
    });
    await cursor.close({ code: "late-close" });
    expect(branch.closeCalls).toBe(0);
  });
});
