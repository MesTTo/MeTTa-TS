// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, sym } from "../atom";
import { type BindingRel, type Bindings } from "../bindings";
import {
  aggregateCleanupFailures,
  cleanupFailureLeaves,
  combineInitiatingAndCleanupFailure,
} from "../cleanup-fault";
import {
  type AnswerEmissionLifecycle,
  type ContextualPair,
  type CursorBudget,
  type CursorEvalRes,
  type CursorMode,
  type CursorModeKind,
  type EvalRes,
  type Gen,
  isDriverEffect,
  isMinimalCursorSignal,
  makeCursorMode,
  type MettaAnswerEmitter,
  type MinimalCursorAnswerSignal,
  type MinimalCursorSignal,
  pendingAsyncOpBox,
  runGenSync,
  takeCursorSteps,
} from "../eval/geneval";
import {
  AsyncInSyncError,
  DualModeSearchCursor,
  type GroundedContextIdentity,
  inst,
  type MinEnv,
  type MinimalSearchAnswer,
  type St,
  type StreamingIsolatedBranches,
  type World,
} from "../eval/machine";
import { captureWorldDelta, releaseChildWorldRuntimes } from "../eval/par";
import { makeExpr } from "../eval/query";
import { isNormalForm, refreshEvaluationEnvironment } from "../eval/typeops";
import {
  cancelWorldRuntime,
  cloneWorld,
  consumeWorldResource,
  forkWorldRuntime,
  forkWorldView,
  groundedContextIdentity,
  inheritWorldRuntime,
  nextWorldRuntimeBranch,
  releaseWorldRuntime,
  worldRuntimeContext,
  worldRuntimeContexts,
} from "../eval/world";
import {
  closeGeneratorAsync as closeDrivenGeneratorAsync,
  closeGeneratorSync as closeDrivenGeneratorSync,
  ExclusiveAsyncScope,
  GeneratorUnwindFailures,
} from "../generator-lifecycle";
import { type CancellationReason, normalizeCancellationReason } from "../resources";
import {
  type AsyncSearchCursor,
  drainAsyncCursor,
  type SearchDrainResult,
  type SearchEvent,
  type SearchNextOptions,
  type SyncSearchCursor,
} from "../search-cursor";
import { isWorkerQuiescenceError } from "../worker-protocol";

export const DEFAULT_FUEL = 2_000_000;

export interface MinimalInterpretOptions {
  readonly fuel?: number;
  readonly state?: St;
  readonly bindings?: Bindings;
  /** Disable compiled whole-call paths so every long reduction remains quota-preemptible. */
  readonly cooperative?: boolean;
}

export const MINIMAL_CURSOR_CLOSED: CancellationReason = Object.freeze({ code: "closed" });

export const MINIMAL_DRAIN_QUANTUM = 16_384;

export interface CursorDeliveryControl {
  streaming: boolean;
  readonly lifecycle: AnswerEmissionLifecycle;
  readonly budget: CursorBudget;
  /** Select legacy applicative ordering when an untouched public cursor is bulk-drained. */
  eagerDrain?: boolean;
  /** An untouched drain may drive the generator in one eager-compatible pass. */
  readonly directDrain?: boolean;
  /** An untouched bounded batch read reports progress, then materializes pairs at its terminal. */
  batchDrain?: boolean;
}

export const newCursorBudget = (): CursorBudget => ({
  active: false,
  remaining: 0,
  pendingSteps: 0,
});

export function mettaCursorMode(
  cooperative: boolean,
  delivery: CursorDeliveryControl,
): CursorMode | undefined {
  const cursorKind: CursorModeKind | undefined =
    delivery.directDrain === true && !delivery.streaming
      ? delivery.batchDrain === true
        ? "cooperative"
        : undefined
      : delivery.eagerDrain === true
        ? "answers"
        : cooperative
          ? "cooperative"
          : undefined;
  return cursorKind === undefined ? undefined : makeCursorMode(cursorKind, delivery.budget);
}

export function mettaCursorEmitter(
  delivery: CursorDeliveryControl,
  cursorMode: CursorMode | undefined,
): MettaAnswerEmitter | undefined {
  return delivery.streaming
    ? {
        emitted: new WeakSet(),
        emittedCount: 0,
        omittedReturnCount: 0,
        retainReturnedAnswers: false,
        lifecycle: delivery.lifecycle,
        ...(cursorMode === undefined ? {} : { cursor: cursorMode }),
      }
    : undefined;
}

export function minimalCursorLimit(options: SearchNextOptions): number {
  const value = options.maxSteps ?? MINIMAL_DRAIN_QUANTUM;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError("maxSteps must be a positive safe integer");
  return value;
}

export function prepareCursorRead(delivery: CursorDeliveryControl, maxSteps: number): void {
  if (delivery.budget.pendingSteps !== 0)
    throw new Error("cursor resumed with unreported interpreter steps");
  delivery.budget.remaining = maxSteps;
}

export function takeDeliveryCursorSteps(delivery: CursorDeliveryControl): number {
  return delivery.budget.active ? takeCursorSteps(delivery.budget) : 0;
}

export function cursorEffectAllowance(delivery: CursorDeliveryControl, fallback: number): number {
  return delivery.budget.active ? delivery.budget.remaining : fallback;
}

export function minimalCancellation(options: SearchNextOptions): CancellationReason | undefined {
  return options.signal?.aborted === true
    ? stableEvalCancellationReason(options.signal.reason)
    : undefined;
}

export const stableEvalCancellationReason = (reason: unknown): CancellationReason =>
  Object.freeze(normalizeCancellationReason(reason));

export function cancellationReasonsEqual(
  left: CancellationReason,
  right: CancellationReason,
): boolean {
  return left.code === right.code && left.message === right.message;
}

const emptySnapshotBindings: Bindings = Object.freeze([]);

export function snapshotBindings(bindings: Bindings): Bindings {
  if (bindings.length === 0) return emptySnapshotBindings;
  return Object.freeze(
    bindings.map(
      (binding): BindingRel =>
        Object.freeze(
          binding.tag === "val"
            ? { tag: "val", x: binding.x, a: binding.a, y: undefined }
            : { tag: "eq", x: binding.x, a: undefined, y: binding.y },
        ),
    ),
  );
}

function snapshotCursorState(state: St): St {
  return { counter: state.counter, world: cloneWorld(state.world) };
}

export function contextualCursorAnswer(pair: ContextualPair, state: St): MinimalSearchAnswer {
  return {
    atom: pair[0],
    bindings: snapshotBindings(pair[1]),
    state: snapshotCursorState(state),
  };
}

export interface InternalSearchAnswer {
  readonly atom: Atom;
  readonly bindings: Bindings;
}

export type CursorAnswerMaterializer<T extends InternalSearchAnswer> = (
  pair: ContextualPair,
  state: St,
) => T;

/** Project an answer for an internal collector whose result comes from the terminal state. */
export function terminalCursorAnswer(pair: ContextualPair): InternalSearchAnswer {
  return {
    atom: pair[0],
    bindings: snapshotBindings(pair[1]),
  };
}

function cursorAnswer<T extends InternalSearchAnswer>(
  signal: MinimalCursorAnswerSignal,
  materialize: CursorAnswerMaterializer<T>,
): T {
  return materialize(signal.pair, signal.state);
}

export function minimalDrainEvent<T, R>(
  values: T[],
  event: SearchEvent<T, R>,
): SearchDrainResult<T, R> | undefined {
  switch (event.kind) {
    case "answer":
    case "pending":
      return undefined;
    case "exhausted":
      return { kind: "exhausted", values, terminal: event.terminal };
    case "cancelled":
      return { kind: "cancelled", values, reason: event.reason };
    case "fault":
      return { kind: "fault", values, error: event.error };
  }
}

interface PreparedMinimalDrain<T> {
  readonly values: T[];
  readonly stopped: SearchDrainResult<T, St> | undefined;
  readonly terminalPairs: boolean;
}

interface MinimalCursorStatus {
  started: boolean;
  terminal: St | undefined;
  fault: unknown;
  hasFault: boolean;
  closedReason: CancellationReason | undefined;
}

export function newMinimalCursorStatus(): MinimalCursorStatus {
  return {
    started: false,
    terminal: undefined,
    fault: undefined,
    hasFault: false,
    closedReason: undefined,
  };
}

export function prepareMinimalCursorDrain<T>(
  options: SearchNextOptions,
  delivery: CursorDeliveryControl,
  status: MinimalCursorStatus,
): PreparedMinimalDrain<T> {
  minimalCursorLimit(options);
  const values: T[] = [];
  const stopped = stoppedMinimalCursorEvent<T>(
    status.closedReason,
    status.terminal,
    status.hasFault,
    status.fault,
  );
  const terminalPairs = !status.started;
  if (stopped === undefined && terminalPairs) {
    if (delivery.directDrain === true) delivery.streaming = false;
    else delivery.eagerDrain = true;
  }
  if (stopped === undefined) status.started = true;
  return {
    values,
    stopped: stopped === undefined ? undefined : minimalDrainEvent(values, stopped)!,
    terminalPairs,
  };
}

export function completeMinimalCursorGenerator<T extends InternalSearchAnswer>(
  result: CursorEvalRes,
  delivery: CursorDeliveryControl,
  unwindFailures: GeneratorUnwindFailures,
  unwindMessage: string,
  terminalPairs: boolean,
  values: T[] | undefined,
  materialize: CursorAnswerMaterializer<T>,
  steps: number,
): { readonly terminal: St; readonly steps: number } {
  const completedSteps = steps + takeDeliveryCursorSteps(delivery);
  if (unwindFailures.active) throw unwindFailures.failure(unwindMessage);
  const terminal = result[1];
  if (terminalPairs && !delivery.streaming)
    for (const pair of result[0]) values!.push(materialize(pair, terminal));
  return { terminal, steps: completedSteps };
}

function terminalDrainWithoutValues<T, R>(
  terminal: Extract<SearchEvent<T, R>, { kind: "exhausted" | "cancelled" | "fault" }>,
): SearchDrainResult<T, R> {
  return minimalDrainEvent([], terminal)!;
}

export function consumeMinimalCursorSignal<T extends InternalSearchAnswer>(
  signal: MinimalCursorSignal,
  values: T[] | undefined,
  materialize: CursorAnswerMaterializer<T>,
): T | undefined {
  if (signal.kind === "progress") return undefined;
  const answer = cursorAnswer(signal, materialize);
  if (values === undefined) return answer;
  values.push(answer);
  return undefined;
}

export function stoppedMinimalCursorEvent<T>(
  closedReason: CancellationReason | undefined,
  terminal: St | undefined,
  hasFault: boolean,
  fault: unknown,
): SearchEvent<T, St> | undefined {
  if (hasFault && isWorkerQuiescenceError(fault)) return { kind: "fault", error: fault, steps: 0 };
  if (closedReason !== undefined) return { kind: "cancelled", reason: closedReason, steps: 0 };
  if (terminal !== undefined) return { kind: "exhausted", terminal, steps: 0 };
  return hasFault ? { kind: "fault", error: fault, steps: 0 } : undefined;
}

function closeGeneratorSync(generator: Gen<CursorEvalRes>, state: St): void {
  closeDrivenGeneratorSync(generator, [[], state], (value) => {
    if (isDriverEffect(value)) return value.runSync();
    if (isMinimalCursorSignal(value)) return undefined;
    throw new AsyncInSyncError(pendingAsyncOpBox.op);
  });
}

export async function closeGeneratorAsync(
  generator: Gen<CursorEvalRes>,
  state: St,
  signal: AbortSignal,
): Promise<void> {
  await closeDrivenGeneratorAsync(generator, [[], state], signal, async (value, activeSignal) => {
    if (isMinimalCursorSignal(value)) return undefined;
    return isDriverEffect(value) ? value.runAsync(activeSignal) : await value;
  });
}

export class GeneratorSyncSearchCursor<T extends InternalSearchAnswer> implements SyncSearchCursor<
  T,
  St
> {
  readonly #generator: Gen<[ContextualPair[], St]>;
  readonly #delivery: CursorDeliveryControl;
  readonly #releaseSnapshot: () => void;
  readonly #materializeAnswer: CursorAnswerMaterializer<T>;
  readonly #runtimeWorld: World | undefined;
  readonly #unwindFailures = new GeneratorUnwindFailures();
  readonly #status = newMinimalCursorStatus();
  #state: St;
  #released = false;

  constructor(
    generator: Gen<CursorEvalRes>,
    state: St,
    delivery: CursorDeliveryControl,
    releaseSnapshot: () => void = () => undefined,
    materializeAnswer: CursorAnswerMaterializer<T>,
    runtimeWorld?: World,
  ) {
    this.#state = state;
    this.#generator = generator;
    this.#delivery = delivery;
    this.#releaseSnapshot = releaseSnapshot;
    this.#materializeAnswer = materializeAnswer;
    this.#runtimeWorld = runtimeWorld;
  }

  get closed(): boolean {
    return (
      this.#status.closedReason !== undefined ||
      this.#status.terminal !== undefined ||
      this.#status.hasFault
    );
  }

  next(options: SearchNextOptions = {}): SearchEvent<T, St> {
    minimalCursorLimit(options);
    this.#status.started = true;
    return this.#drive(options);
  }

  drain(options: SearchNextOptions = {}): SearchDrainResult<T, St> {
    const prepared = prepareMinimalCursorDrain<T>(options, this.#delivery, this.#status);
    if (prepared.stopped !== undefined) return prepared.stopped;
    if (prepared.terminalPairs && this.#delivery.directDrain === true)
      return this.#drainDirect(options, prepared.values);
    for (;;) {
      const event = this.#drive(options, prepared.values, prepared.terminalPairs);
      const terminal = minimalDrainEvent(prepared.values, event);
      if (terminal !== undefined) return terminal;
    }
  }

  #drainDirect(options: SearchNextOptions, values: T[]): SearchDrainResult<T, St> {
    const cancellation = minimalCancellation(options);
    if (cancellation !== undefined) {
      try {
        this.close(cancellation);
      } catch (error) {
        return { kind: "fault", values, error };
      }
      return { kind: "cancelled", values, reason: cancellation };
    }
    try {
      const [pairs, terminal] = runGenSync(this.#generator);
      this.#status.terminal = terminal;
      this.#state = terminal;
      for (const pair of pairs) values.push(this.#materializeAnswer(pair, terminal));
      this.#release();
      return { kind: "exhausted", values, terminal };
    } catch (error) {
      this.#stopWithFault(error);
      return { kind: "fault", values, error: this.#status.fault };
    }
  }

  #drive(options: SearchNextOptions, values?: T[], terminalPairs = false): SearchEvent<T, St> {
    const maxSteps = minimalCursorLimit(options);
    const stopped = stoppedMinimalCursorEvent<T>(
      this.#status.closedReason,
      this.#status.terminal,
      this.#status.hasFault,
      this.#status.fault,
    );
    if (stopped !== undefined) return stopped;
    const cancellation = minimalCancellation(options);
    if (cancellation !== undefined) {
      this.close(cancellation);
      return { kind: "cancelled", reason: cancellation, steps: 0 };
    }

    prepareCursorRead(this.#delivery, maxSteps);
    let steps = 0;
    try {
      let result = this.#generator.next();
      for (;;) {
        if (result.done) {
          const completed = completeMinimalCursorGenerator(
            result.value,
            this.#delivery,
            this.#unwindFailures,
            "synchronous effect and generator unwind both failed",
            terminalPairs,
            values,
            this.#materializeAnswer,
            steps,
          );
          this.#status.terminal = completed.terminal;
          this.#state = this.#status.terminal;
          this.#release();
          return {
            kind: "exhausted",
            terminal: this.#status.terminal,
            steps: completed.steps,
          };
        }
        if (isDriverEffect(result.value)) {
          steps += takeDeliveryCursorSteps(this.#delivery);
          try {
            result = this.#generator.next(
              result.value.runSync(cursorEffectAllowance(this.#delivery, maxSteps - steps)),
            );
          } catch (error) {
            this.#unwindFailures.record(error);
            try {
              result = this.#generator.throw(error);
            } catch (unwindError) {
              this.#unwindFailures.record(unwindError);
              throw this.#unwindFailures.failure(
                "synchronous effect and generator unwind both failed",
              );
            }
          }
          continue;
        }
        if (!isMinimalCursorSignal(result.value)) {
          steps += takeDeliveryCursorSteps(this.#delivery);
          const error = new AsyncInSyncError(pendingAsyncOpBox.op);
          this.#stopWithFault(error);
          return { kind: "fault", error: this.#status.fault, steps };
        }
        this.#state = result.value.state;
        steps += result.value.steps;
        const answer = consumeMinimalCursorSignal(result.value, values, this.#materializeAnswer);
        if (answer !== undefined) return { kind: "answer", value: answer, steps };
        if (steps >= maxSteps) return { kind: "pending", steps };
        result = this.#generator.next();
      }
    } catch (error) {
      steps += takeDeliveryCursorSteps(this.#delivery);
      this.#stopWithFault(error);
      return { kind: "fault", error: this.#status.fault, steps };
    }
  }

  close(reason: CancellationReason = MINIMAL_CURSOR_CLOSED): void {
    if (this.closed) return;
    this.#status.closedReason = stableEvalCancellationReason(reason);
    this.#delivery.lifecycle.unwinding = true;
    if (this.#runtimeWorld !== undefined)
      cancelWorldRuntime(this.#runtimeWorld, this.#status.closedReason);
    try {
      closeGeneratorSync(this.#generator, this.#state);
    } catch (cleanupError) {
      if (isWorkerQuiescenceError(cleanupError)) {
        this.#status.fault = combineInitiatingAndCleanupFailure(
          this.#status.closedReason,
          cleanupError,
          "evaluation cancellation and worker cleanup both failed",
        );
        this.#status.hasFault = true;
        throw this.#status.fault;
      }
      throw cleanupError;
    } finally {
      this.#release();
    }
  }

  #stopWithFault(error: unknown): void {
    this.#status.fault = error;
    this.#status.hasFault = true;
    this.#delivery.lifecycle.unwinding = true;
    try {
      closeGeneratorSync(this.#generator, this.#state);
    } catch (cleanupError) {
      this.#status.fault = combineInitiatingAndCleanupFailure(
        error,
        cleanupError,
        "evaluation and synchronous generator cleanup both failed",
      );
    } finally {
      this.#release();
    }
  }

  #release(): void {
    if (this.#released) return;
    this.#released = true;
    try {
      this.#releaseSnapshot();
    } finally {
      if (this.#runtimeWorld !== undefined) releaseWorldRuntime(this.#runtimeWorld);
    }
  }
}

export interface PinnedCursorSource {
  readonly generator: Gen<CursorEvalRes>;
  readonly state: St;
  readonly delivery: CursorDeliveryControl;
  readonly release: () => void;
}

function combineCancellationAndActiveFault(
  reason: CancellationReason,
  activeFault: unknown,
  cleanupFailed: boolean,
  cleanupFault: unknown,
  operation: string,
): unknown {
  let failure = combineInitiatingAndCleanupFailure(
    reason,
    activeFault,
    `${operation} cancellation and active work both failed`,
  );
  if (cleanupFailed)
    failure = combineInitiatingAndCleanupFailure(
      failure,
      cleanupFault,
      `${operation} active work and cleanup both failed`,
    );
  return failure;
}

function mapCursorTerminal<T, A, B>(
  event: SearchEvent<T, A>,
  mapTerminal: (terminal: A) => B,
): SearchEvent<T, B> {
  switch (event.kind) {
    case "exhausted":
      return {
        kind: "exhausted",
        terminal: mapTerminal(event.terminal),
        steps: event.steps,
      };
    case "cancelled":
      return {
        kind: "cancelled",
        reason: stableEvalCancellationReason(event.reason),
        steps: event.steps,
      };
    case "fault":
    case "answer":
    case "pending":
      return event;
  }
}

function mapAndRecordCursorTerminal<T, A, B>(
  event: SearchEvent<T, A>,
  mapTerminal: (terminal: A) => B,
  recordTerminal: (
    terminal: Extract<SearchEvent<T, B>, { kind: "exhausted" | "cancelled" | "fault" }>,
  ) => void,
  recordCancellation: (reason: CancellationReason) => void,
): SearchEvent<T, B> {
  const mapped = mapCursorTerminal(event, mapTerminal);
  if (mapped.kind === "cancelled") recordCancellation(mapped.reason);
  if (mapped.kind === "exhausted" || mapped.kind === "cancelled" || mapped.kind === "fault")
    recordTerminal(mapped);
  return mapped;
}

function finishMappedCursorRead<T, A, B>(
  event: SearchEvent<T, A>,
  stopped: Extract<SearchEvent<T, B>, { kind: "exhausted" | "cancelled" | "fault" }> | undefined,
  mapTerminal: (terminal: A) => B,
  recordTerminal: (
    terminal: Extract<SearchEvent<T, B>, { kind: "exhausted" | "cancelled" | "fault" }>,
  ) => void,
  recordCancellation: (reason: CancellationReason) => void,
): SearchEvent<T, B> {
  if (stopped !== undefined) return { ...stopped, steps: event.steps };
  return mapAndRecordCursorTerminal(event, mapTerminal, recordTerminal, recordCancellation);
}

export class MapTerminalSyncCursor<T, A, B> implements SyncSearchCursor<T, B> {
  #closedReason: CancellationReason | undefined;
  #terminal: Extract<SearchEvent<T, B>, { kind: "exhausted" | "cancelled" | "fault" }> | undefined;

  constructor(
    readonly source: SyncSearchCursor<T, A>,
    readonly mapTerminal: (terminal: A) => B,
  ) {}

  get closed(): boolean {
    return this.#terminal !== undefined || this.source.closed;
  }

  next(options: SearchNextOptions = {}): SearchEvent<T, B> {
    minimalCursorLimit(options);
    if (this.#terminal !== undefined) return { ...this.#terminal, steps: 0 };
    const cancellation = minimalCancellation(options) ?? this.#closedReason;
    if (cancellation !== undefined) {
      try {
        this.close(cancellation);
      } catch (cleanupError) {
        const terminal = {
          kind: "fault" as const,
          error: combineInitiatingAndCleanupFailure(
            cancellation,
            cleanupError,
            "terminal mapping cancellation and cleanup both failed",
          ),
          steps: 0,
        };
        this.#terminal = terminal;
        return terminal;
      }
      return this.#terminal!;
    }
    let event: SearchEvent<T, A>;
    let steps = 0;
    try {
      event = this.source.next(options);
      steps = event.steps;
      return finishMappedCursorRead(
        event,
        this.#terminal,
        this.mapTerminal,
        (terminal) => (this.#terminal = terminal),
        (reason) => (this.#closedReason = reason),
      );
    } catch (error) {
      try {
        this.source.close({ code: "fault" });
      } catch (cleanupError) {
        const terminal = {
          kind: "fault" as const,
          error: combineInitiatingAndCleanupFailure(
            error,
            cleanupError,
            "terminal mapping and cleanup both failed",
          ),
          steps,
        };
        this.#terminal = terminal;
        return terminal;
      }
      const terminal = { kind: "fault" as const, error, steps };
      this.#terminal = terminal;
      return terminal;
    }
  }

  close(reason: CancellationReason = { code: "closed" }): void {
    if (this.#terminal !== undefined && this.#closedReason === undefined) return;
    this.#closedReason ??= stableEvalCancellationReason(reason);
    this.#terminal ??= { kind: "cancelled", reason: this.#closedReason, steps: 0 };
    try {
      this.source.close(this.#closedReason);
    } catch (cleanupError) {
      if (isWorkerQuiescenceError(cleanupError))
        throw combineInitiatingAndCleanupFailure(
          this.#closedReason,
          cleanupError,
          "terminal mapping cancellation and worker cleanup both failed",
        );
      throw cleanupError;
    }
  }
}

export class MapTerminalAsyncCursor<T, A, B> implements AsyncSearchCursor<T, B> {
  readonly #scope = new ExclusiveAsyncScope();
  #closedReason: CancellationReason | undefined;
  #closeWork: Promise<void> | undefined;
  #terminal: Extract<SearchEvent<T, B>, { kind: "exhausted" | "cancelled" | "fault" }> | undefined;

  constructor(
    readonly source: AsyncSearchCursor<T, A>,
    readonly mapTerminal: (terminal: A) => B,
  ) {}

  get closed(): boolean {
    return this.#terminal !== undefined || this.source.closed;
  }

  next(options: SearchNextOptions = {}): Promise<SearchEvent<T, B>> {
    return this.#scope.run(() => this.#next(options));
  }

  drain(options: SearchNextOptions = {}): Promise<SearchDrainResult<T, B>> {
    return this.#scope.run(() => this.#drain(options));
  }

  async #next(options: SearchNextOptions): Promise<SearchEvent<T, B>> {
    minimalCursorLimit(options);
    if (this.#terminal !== undefined) return { ...this.#terminal, steps: 0 };
    const cancellation = minimalCancellation(options) ?? this.#closedReason;
    if (cancellation !== undefined) {
      try {
        await this.#beginClose(cancellation);
      } catch (cleanupError) {
        if (isWorkerQuiescenceError(cleanupError)) {
          const error = combineInitiatingAndCleanupFailure(
            cancellation,
            cleanupError,
            "terminal mapping cancellation and cleanup both failed",
          );
          return (this.#terminal = { kind: "fault", error, steps: 0 });
        }
        // `close()` exposes cleanup failure. Cancellation remains the first visible terminal.
      }
      return this.#terminal!;
    }
    let event: SearchEvent<T, A>;
    let steps = 0;
    try {
      event = await this.source.next(options);
      steps = event.steps;
      if (
        this.#closedReason !== undefined &&
        event.kind === "fault" &&
        isWorkerQuiescenceError(event.error)
      ) {
        const terminal = {
          kind: "fault" as const,
          error: combineCancellationAndActiveFault(
            this.#closedReason,
            event.error,
            false,
            undefined,
            "terminal mapping",
          ),
          steps,
        };
        this.#terminal = terminal;
        return terminal;
      }
      return finishMappedCursorRead(
        event,
        this.#terminal,
        this.mapTerminal,
        (terminal) => (this.#terminal = terminal),
        (reason) => (this.#closedReason = reason),
      );
    } catch (error) {
      if (this.#closedReason !== undefined) {
        if (isWorkerQuiescenceError(error)) {
          const terminal = {
            kind: "fault" as const,
            error: combineCancellationAndActiveFault(
              this.#closedReason,
              error,
              false,
              undefined,
              "terminal mapping",
            ),
            steps,
          };
          this.#terminal = terminal;
          return terminal;
        }
        return { kind: "cancelled", reason: this.#closedReason, steps };
      }
      let cleanupError: unknown;
      let cleanupFailed = false;
      try {
        await this.#closeSource({ code: "fault" });
      } catch (caught) {
        cleanupError = caught;
        cleanupFailed = true;
      }
      if (this.#closedReason !== undefined) {
        if (
          isWorkerQuiescenceError(error) ||
          (cleanupFailed && isWorkerQuiescenceError(cleanupError))
        ) {
          const terminal = {
            kind: "fault" as const,
            error: combineCancellationAndActiveFault(
              this.#closedReason,
              error,
              cleanupFailed,
              cleanupError,
              "terminal mapping",
            ),
            steps,
          };
          this.#terminal = terminal;
          return terminal;
        }
        return { kind: "cancelled", reason: this.#closedReason, steps };
      }
      const terminal = {
        kind: "fault" as const,
        error: cleanupFailed
          ? combineInitiatingAndCleanupFailure(
              error,
              cleanupError,
              "terminal mapping and cleanup both failed",
            )
          : error,
        steps,
      };
      this.#terminal = terminal;
      return terminal;
    }
  }

  async #drain(options: SearchNextOptions): Promise<SearchDrainResult<T, B>> {
    minimalCursorLimit(options);
    if (this.#terminal !== undefined) return this.#terminalDrain();
    const cancellation = minimalCancellation(options) ?? this.#closedReason;
    if (cancellation !== undefined) {
      try {
        await this.#beginClose(cancellation);
      } catch (cleanupError) {
        const error = combineInitiatingAndCleanupFailure(
          cancellation,
          cleanupError,
          "terminal mapping cancellation and cleanup both failed",
        );
        this.#terminal = { kind: "fault", error, steps: 0 };
        return { kind: "fault", values: [], error };
      }
      return this.#terminalDrain();
    }

    let result: SearchDrainResult<T, A>;
    try {
      result = await drainAsyncCursor(this.source, options);
    } catch (error) {
      if (this.#closedReason !== undefined) {
        if (isWorkerQuiescenceError(error)) {
          const fault = combineCancellationAndActiveFault(
            this.#closedReason,
            error,
            false,
            undefined,
            "terminal mapping drain",
          );
          this.#terminal = { kind: "fault", error: fault, steps: 0 };
          return { kind: "fault", values: [], error: fault };
        }
        return this.#terminalDrain();
      }
      let fault = error;
      try {
        await this.#closeSource({ code: "fault" });
      } catch (cleanupError) {
        fault = combineInitiatingAndCleanupFailure(
          error,
          cleanupError,
          "terminal mapping drain and cleanup both failed",
        );
      }
      if (this.#closedReason !== undefined) {
        if (fault !== error) {
          fault = combineInitiatingAndCleanupFailure(
            this.#closedReason,
            fault,
            "terminal mapping cancellation and cleanup both failed",
          );
          this.#terminal = { kind: "fault", error: fault, steps: 0 };
          return { kind: "fault", values: [], error: fault };
        }
        return this.#terminalDrain();
      }
      this.#terminal = { kind: "fault", error: fault, steps: 0 };
      return { kind: "fault", values: [], error: fault };
    }
    if (this.#terminal !== undefined) {
      if (
        this.#closedReason !== undefined &&
        result.kind === "fault" &&
        isWorkerQuiescenceError(result.error)
      ) {
        const error = combineCancellationAndActiveFault(
          this.#closedReason,
          result.error,
          false,
          undefined,
          "terminal mapping drain",
        );
        this.#terminal = { kind: "fault", error, steps: 0 };
        return { kind: "fault", values: result.values, error };
      }
      return this.#terminalDrain();
    }

    switch (result.kind) {
      case "exhausted":
        try {
          const terminal = this.mapTerminal(result.terminal);
          this.#terminal = { kind: "exhausted", terminal, steps: 0 };
          return { kind: "exhausted", values: result.values, terminal };
        } catch (error) {
          this.#terminal = { kind: "fault", error, steps: 0 };
          return { kind: "fault", values: result.values, error };
        }
      case "cancelled": {
        const reason = stableEvalCancellationReason(result.reason);
        this.#closedReason = reason;
        this.#terminal = { kind: "cancelled", reason, steps: 0 };
        return { kind: "cancelled", values: result.values, reason };
      }
      case "fault":
        this.#terminal = { kind: "fault", error: result.error, steps: 0 };
        return result;
    }
  }

  #terminalDrain(): SearchDrainResult<T, B> {
    return terminalDrainWithoutValues(this.#terminal!);
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    return this.#scope.close(
      () => this.#beginClose(reason),
      this.#terminal !== undefined && this.#closedReason === undefined,
    );
  }

  #beginClose(reason: CancellationReason): Promise<void> {
    this.#closedReason ??= stableEvalCancellationReason(reason);
    this.#terminal ??= { kind: "cancelled", reason: this.#closedReason, steps: 0 };
    return this.#closeSource(this.#closedReason);
  }

  #closeSource(reason: CancellationReason): Promise<void> {
    if (this.#closeWork !== undefined) return this.#closeWork;
    try {
      this.#closeWork = Promise.resolve(this.source.close(reason)).catch(
        (cleanupError: unknown) => {
          if (isWorkerQuiescenceError(cleanupError))
            throw combineInitiatingAndCleanupFailure(
              reason,
              cleanupError,
              "terminal mapping cancellation and worker cleanup both failed",
            );
          throw cleanupError;
        },
      );
    } catch (error) {
      this.#closeWork = Promise.reject(error);
    }
    return this.#closeWork;
  }
}

/** A stream whose values and terminal state have already been computed. The microtask boundary keeps an
 *  immediate external abort observable before the completed bag is published. */
export class CompletedAsyncSearchCursor<T, R> implements AsyncSearchCursor<T, R> {
  readonly #scope = new ExclusiveAsyncScope();
  readonly #values: readonly T[];
  readonly #terminalFactory: () => R;
  readonly #finalize: (() => void) | undefined;
  #index = 0;
  #resultTerminal: R | undefined;
  #hasResultTerminal = false;
  #closedReason: CancellationReason | undefined;
  #terminal: Extract<SearchEvent<T, R>, { kind: "exhausted" | "cancelled" | "fault" }> | undefined;
  #finalized = false;

  constructor(values: readonly T[], terminalFactory: () => R, finalize?: () => void) {
    this.#values = values.slice();
    this.#terminalFactory = terminalFactory;
    this.#finalize = finalize;
  }

  get closed(): boolean {
    return this.#terminal !== undefined;
  }

  next(options: SearchNextOptions = {}): Promise<SearchEvent<T, R>> {
    return this.#scope.run(() => this.#next(options));
  }

  drain(options: SearchNextOptions = {}): Promise<SearchDrainResult<T, R>> {
    return this.#scope.run(() => this.#drain(options));
  }

  async #next(options: SearchNextOptions): Promise<SearchEvent<T, R>> {
    minimalCursorLimit(options);
    const stopped = this.#repeatTerminal();
    if (stopped !== undefined) return stopped;
    const initialCancellation = minimalCancellation(options) ?? this.#closedReason;
    if (initialCancellation !== undefined) return this.#cancel(initialCancellation);

    await Promise.resolve();
    const stoppedAfterYield = this.#repeatTerminal();
    if (stoppedAfterYield !== undefined) return stoppedAfterYield;
    const cancellation = minimalCancellation(options) ?? this.#closedReason;
    if (cancellation !== undefined) return this.#cancel(cancellation);
    const fault = this.#settle();
    if (fault !== undefined) return fault;
    if (this.#index < this.#values.length)
      return { kind: "answer", value: this.#values[this.#index++]!, steps: 0 };
    return this.#exhausted();
  }

  async #drain(options: SearchNextOptions): Promise<SearchDrainResult<T, R>> {
    minimalCursorLimit(options);
    if (this.#terminal !== undefined) return this.#terminalDrain();
    const initialCancellation = minimalCancellation(options) ?? this.#closedReason;
    if (initialCancellation !== undefined) {
      const terminal = this.#cancel(initialCancellation);
      return { kind: "cancelled", values: [], reason: terminal.reason };
    }

    await Promise.resolve();
    if (this.#terminal !== undefined) return this.#terminalDrain();
    const cancellation = minimalCancellation(options) ?? this.#closedReason;
    if (cancellation !== undefined) {
      const terminal = this.#cancel(cancellation);
      return { kind: "cancelled", values: [], reason: terminal.reason };
    }
    const fault = this.#settle();
    if (fault !== undefined) return { kind: "fault", values: [], error: fault.error };
    const values = this.#values.slice(this.#index);
    this.#index = this.#values.length;
    const terminal = this.#exhausted();
    return { kind: "exhausted", values, terminal: terminal.terminal };
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    return this.#scope.close(
      () => {
        if (this.#terminal === undefined) this.#cancel(reason);
        return Promise.resolve();
      },
      this.#terminal !== undefined && this.#closedReason === undefined,
    );
  }

  #settle(): Extract<SearchEvent<T, R>, { kind: "fault" }> | undefined {
    if (this.#hasResultTerminal) return undefined;
    try {
      this.#resultTerminal = this.#terminalFactory();
      this.#hasResultTerminal = true;
      return undefined;
    } catch (error) {
      const terminal = { kind: "fault" as const, error, steps: 0 };
      this.#terminal = terminal;
      this.#finish();
      return terminal;
    }
  }

  #cancel(reason: CancellationReason): Extract<SearchEvent<T, R>, { kind: "cancelled" }> {
    this.#closedReason ??= stableEvalCancellationReason(reason);
    const terminal = { kind: "cancelled" as const, reason: this.#closedReason, steps: 0 };
    this.#terminal = terminal;
    this.#finish();
    return terminal;
  }

  #exhausted(): Extract<SearchEvent<T, R>, { kind: "exhausted" }> {
    const terminal = {
      kind: "exhausted" as const,
      terminal: this.#resultTerminal as R,
      steps: 0,
    };
    this.#terminal = terminal;
    this.#finish();
    return terminal;
  }

  #finish(): void {
    if (this.#finalized) return;
    this.#finalized = true;
    this.#finalize?.();
  }

  #terminalDrain(): SearchDrainResult<T, R> {
    return terminalDrainWithoutValues(this.#terminal!);
  }

  #repeatTerminal(): SearchEvent<T, R> | undefined {
    const terminal = this.#terminal;
    return terminal === undefined ? undefined : { ...terminal, steps: 0 };
  }
}

interface IsolatedBranchSet {
  /** Parent state after reserving every child lane. */
  readonly parent: St;
  readonly branches: readonly St[];
}

interface ReservedBranchGroup {
  readonly parent: St;
  readonly contextIdentity: GroundedContextIdentity | undefined;
  readonly sequence: number | undefined;
}

export function isolateAnswerContinuation(state: St, index: number, counter: number): St {
  const world = forkWorldView(
    state.world,
    {
      ids: state.world.allocation.ids.fork(`continuation-${index}`),
      branchScoped: true,
    },
    groundedContextIdentity(state.world),
  );
  forkWorldRuntime(
    state.world,
    world,
    nextWorldRuntimeBranch(state.world, `continuation-${index}`),
  );
  return { counter, world };
}

function reserveBranchGroup(state: St, count: number): ReservedBranchGroup {
  if (count === 0) return { parent: state, contextIdentity: undefined, sequence: undefined };
  const contextIdentity = groundedContextIdentity(state.world);
  const parentWorld = forkWorldView(
    state.world,
    {
      ids: state.world.allocation.ids.clone(),
      branchScoped: state.world.allocation.branchScoped,
    },
    contextIdentity,
  );
  const authority = parentWorld.allocation.ids;
  const sequence = authority.reserveSequence("branch");
  return {
    parent: { counter: state.counter, world: parentWorld },
    contextIdentity,
    sequence,
  };
}

export function isolatedBranchStates(state: St, count: number): IsolatedBranchSet {
  const reserved = reserveBranchGroup(state, count);
  if (count === 0) return { parent: reserved.parent, branches: [] };
  const contextIdentity = reserved.contextIdentity!;
  const parentWorld = reserved.parent.world;
  const authority = parentWorld.allocation.ids;
  const groupSequence = reserved.sequence!;
  consumeWorldResource(parentWorld, "branches", count, `fanout-${groupSequence}`);
  const branches = Array.from({ length: count }, (_, index) => {
    const world = forkWorldView(
      parentWorld,
      {
        ids: authority.fork(`fanout-${groupSequence}-${index}`),
        branchScoped: true,
      },
      contextIdentity,
    );
    forkWorldRuntime(
      parentWorld,
      world,
      nextWorldRuntimeBranch(parentWorld, `fanout-${groupSequence}-${index}`),
      "isolated-branches",
      "reject",
      false,
    );
    return { counter: state.counter, world };
  });
  return {
    parent: reserved.parent,
    branches,
  };
}

export function beginStreamingIsolatedBranches(
  state: St,
  acceptedDownstream: boolean,
): StreamingIsolatedBranches | undefined {
  if (worldRuntimeContext(state.world).policy !== "isolated-branches") return undefined;
  const reserved = reserveBranchGroup(state, 1);
  return {
    parent: reserved.parent,
    contextIdentity: reserved.contextIdentity!,
    sequence: reserved.sequence!,
    acceptedDownstream,
    nextIndex: 0,
    activeBranch: undefined,
    terminalDeltas: [],
    maxTerminalCounter: reserved.parent.counter,
    finished: false,
  };
}

export function allocateStreamingIsolatedBranch(owner: StreamingIsolatedBranches): St {
  if (owner.activeBranch !== undefined)
    throw new Error("streaming isolated branch allocated before the previous terminal");
  const index = owner.nextIndex++;
  const parentWorld = owner.parent.world;
  const label = `fanout-${owner.sequence}-${index}`;
  consumeWorldResource(parentWorld, "branches", 1, label);
  const world = forkWorldView(
    parentWorld,
    {
      ids: parentWorld.allocation.ids.fork(label),
      branchScoped: true,
    },
    owner.contextIdentity,
  );
  forkWorldRuntime(
    parentWorld,
    world,
    nextWorldRuntimeBranch(parentWorld, label),
    "isolated-branches",
    "reject",
    false,
  );
  const branch = { counter: owner.parent.counter, world };
  owner.activeBranch = branch;
  return branch;
}

/**
 * Fold one finished per-answer branch into the group and release its runtime immediately.
 * Accepted-downstream groups discard the terminal; merge groups keep only its journal delta, so
 * live state stays bounded by the answers' real effects instead of one world per answer.
 */
export function recordStreamingIsolatedTerminal(
  owner: StreamingIsolatedBranches,
  terminal: St,
): void {
  owner.maxTerminalCounter = Math.max(owner.maxTerminalCounter, terminal.counter);
  owner.activeBranch = undefined;
  if (!owner.acceptedDownstream) {
    const delta = captureWorldDelta(owner.parent.world, terminal.world);
    if (delta.kind !== "journal")
      throw new Error(
        "streaming isolated branch lost its journal ancestry before its terminal was recorded",
      );
    if (delta.effects.length > 0 || delta.generationDelta > 0) owner.terminalDeltas.push(delta);
  }
  releaseChildWorldRuntimes(owner.parent.world, [terminal.world]);
}

export function releaseStreamingIsolatedBranches(
  owner: StreamingIsolatedBranches | undefined,
): void {
  if (owner === undefined || owner.finished) return;
  owner.finished = true;
  if (owner.activeBranch !== undefined)
    releaseChildWorldRuntimes(owner.parent.world, [owner.activeBranch.world]);
  owner.activeBranch = undefined;
}

export function restoreAllocationAuthority(base: St, branch: St): St {
  const targetNamespace = base.world.allocation.ids.namespace;
  let ids = branch.world.allocation.ids.clone();
  while (ids.namespace !== targetNamespace) {
    const parent = ids.parentAuthority();
    if (parent === undefined)
      throw new Error(
        `branch allocation authority '${ids.namespace}' is not descended from '${targetNamespace}'`,
      );
    ids = parent;
  }
  const world = forkWorldView(branch.world, {
    ids,
    branchScoped: base.world.allocation.branchScoped,
  });
  const parentRuntime = worldRuntimeContext(base.world);
  const branchRuntime = worldRuntimeContext(branch.world);
  if (branchRuntime.resources !== parentRuntime.resources) {
    const effects = branchRuntime.journal.since(parentRuntime.journal);
    const committed =
      parentRuntime.policy === "sequential-commit"
        ? {
            audit: parentRuntime.audit.commit(effects),
            journal: parentRuntime.journal,
          }
        : {
            audit: parentRuntime.audit,
            journal: parentRuntime.journal.commit(effects),
          };
    worldRuntimeContexts.set(world, {
      ...parentRuntime,
      ...committed,
    });
    releaseWorldRuntime(branch.world);
  } else {
    inheritWorldRuntime(branch.world, world);
  }
  return { counter: branch.counter, world };
}

export type DirectParEvaluation =
  | {
      readonly kind: "complete";
      readonly answers: readonly InternalSearchAnswer[];
      readonly state: St;
    }
  | {
      readonly kind: "resume";
      readonly schedule: DualModeSearchCursor<InternalSearchAnswer, St>;
    };

export function directParAllowances(count: number, maxSteps: number): readonly number[] {
  if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0)
    throw new RangeError("direct par maxSteps must be a positive safe integer");
  if (count <= 0) return [];
  const selected = Math.min(count, maxSteps);
  const base = Math.floor(maxSteps / selected);
  let remainder = maxSteps % selected;
  return Array.from({ length: count }, (_value, index) => {
    if (index >= selected) return 0;
    const allowance = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return allowance;
  });
}

export async function closeDirectParCursors(
  cursors: readonly (AsyncSearchCursor<InternalSearchAnswer, St> | undefined)[],
  reason: CancellationReason,
): Promise<unknown | undefined> {
  const settled = await Promise.allSettled(
    cursors.map((cursor) =>
      cursor === undefined ? Promise.resolve() : Promise.resolve().then(() => cursor.close(reason)),
    ),
  );
  const failures = settled.flatMap((result) =>
    result.status === "rejected" ? cleanupFailureLeaves(result.reason) : [],
  );
  return failures.length === 0
    ? undefined
    : aggregateCleanupFailures(failures, "multiple direct par continuations failed to close");
}

interface CompletedParCandidate {
  readonly answers: readonly InternalSearchAnswer[];
  readonly commitCaches: () => void;
}

/** Recognize branches for which evaluation is already a completed exit. Catch-all equations are excluded
 *  because they can reduce an otherwise constructor-shaped atom. */
export function completedParCandidate(
  env: MinEnv,
  fuel: number,
  bindings: Bindings,
  branches: readonly Atom[],
  branchStates: readonly St[],
): CompletedParCandidate | undefined {
  if (fuel <= 0) return undefined;
  const completed: Array<{ readonly env: MinEnv; readonly atom: Atom }> = [];
  for (let index = 0; index < branches.length; index++) {
    const state = branchStates[index]!;
    const selected = refreshEvaluationEnvironment(env, state.world);
    if (selected.varRulesVar.length !== 0 || state.world.selfVarRules.length !== 0)
      return undefined;
    const atom = inst(selected, bindings, branches[index]!);
    if (!isNormalForm(selected, state.world, atom)) return undefined;
    completed.push({ env: selected, atom });
  }
  return {
    answers: completed.map(({ atom }) => terminalCursorAnswer([atom, bindings])),
    commitCaches: () => {
      for (const item of completed)
        if (item.atom.kind === "expr" && item.atom.ground) item.env.evaluatedAtoms.add(item.atom);
    },
  };
}

export function minimalDrainResult(
  result: SearchDrainResult<InternalSearchAnswer, St>,
  cancellationCause?: unknown,
): EvalRes {
  switch (result.kind) {
    case "exhausted":
      return [result.values.map((answer) => [answer.atom, answer.bindings]), result.terminal];
    case "fault":
      throw result.error;
    case "cancelled":
      if (cancellationCause !== undefined) throw cancellationCause;
      throw new Error(result.reason.message ?? result.reason.code);
  }
}

/** Type-directed evaluation of `a` (the sync driver: throws `AsyncInSyncError` if it reaches an async
 *  grounded op). This is the public synchronous entry point with the original signature. */
/** A native V8 stack overflow (`RangeError: Maximum call stack size exceeded`). The machine threads its
 *  own stack as a cons-list, but nested sub-evaluations still recurse through `yield*`, so a deeply
 *  recursive object program can exhaust the JS call stack before `fuel` runs out. The reference
 *  interpreter, being iterative, reports a `StackOverflow` error atom for runaway recursion rather than
 *  aborting; we match that by degrading the native overflow to the same error the fuel limit emits. */
export function isNativeStackOverflow(e: unknown): boolean {
  return e instanceof RangeError && /call stack/i.test(e.message);
}

export function stackOverflowResult(
  env: MinEnv,
  st: St,
  bnd: Bindings,
  a: Atom,
): [Array<[Atom, Bindings]>, St] {
  return [[[makeExpr(env, [sym("Error"), inst(env, bnd, a), sym("StackOverflow")]), bnd]], st];
}
