// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, atomEq, type ExprAtom, isErrorAtom, sym } from "../atom";
import { type Bindings, emptyBindings } from "../bindings";
import { pettaOpNames, type ReduceResult } from "../builtins";
import {
  aggregateCleanupFailures,
  cleanupFailureLeaves,
  combineInitiatingAndCleanupFailure,
} from "../cleanup-fault";
import {
  type CompiledRunResult,
  type CooperativeCompiledRunEvent,
  startCooperativeCompiledRun,
} from "../compile";
import {
  allocateStreamingIsolatedBranch,
  beginStreamingIsolatedBranches,
  cancellationReasonsEqual,
  closeGeneratorAsync,
  CompletedAsyncSearchCursor,
  completeMinimalCursorGenerator,
  consumeMinimalCursorSignal,
  type CursorAnswerMaterializer,
  type CursorDeliveryControl,
  cursorEffectAllowance,
  type InternalSearchAnswer,
  MapTerminalAsyncCursor,
  MINIMAL_CURSOR_CLOSED,
  minimalCancellation,
  minimalCursorLimit,
  minimalDrainEvent,
  newMinimalCursorStatus,
  prepareCursorRead,
  prepareMinimalCursorDrain,
  recordStreamingIsolatedTerminal,
  releaseStreamingIsolatedBranches,
  restoreAllocationAuthority,
  stableEvalCancellationReason,
  stoppedMinimalCursorEvent,
  takeDeliveryCursorSteps,
  terminalCursorAnswer,
} from "../eval/cursors";
import {
  type ContextualPair,
  type CursorEvalRes,
  type CursorMode,
  finishGeneratorAsync,
  flushCursorProgressG,
  type Gen,
  groundedCallContextWithSignal,
  isDriverEffect,
  isMinimalCursorSignal,
  LAZY_ARGS_OPS,
  LEATTA_EVAL_ARGS_OPS,
  NEVER_ABORTED_SIGNAL,
  recordCursorSteps,
  runGenAsync,
} from "../eval/geneval";
import {
  driverEffect,
  DualModeSearchCursor,
  errTextAtom,
  inst,
  type Item,
  type MinEnv,
  type MinimalGroundedV2Continuation,
  type MinimalMettaCallContinuation,
  type MinimalSearchAnswer,
  type St,
  type Stack,
  type World,
} from "../eval/machine";
import { checkApplication, errAtom, hasRuleFor } from "../eval/matchops";
import {
  applyReduceEffects,
  finishStreamingIsolatedBranches,
  mergeScheduledStates,
} from "../eval/mutate";
import { subTokens } from "../eval/par";
import {
  checkedGroundedLanguageError,
  checkGroundedEffectsScope,
  closeGroundedV2G,
  consumeGroundedPayloadResources,
  createGroundedV2Call,
  groundedEffectPolicy,
  groundedEffectRejected,
  groundedV2Fault,
  groundedV2For,
  instantiateReduceEffects,
  notReducibleA,
  prepareGroundedAnswer,
  pullGroundedV2G,
  queryOp,
  recordGroundedOperationEffects,
  reduceEffectAtoms,
  resolveStates,
  type SchedulerUnwindFailure,
  startGroundedV2G,
} from "../eval/query";
import { enforceDistinctLimit } from "../eval/tabling";
import { argMask, evalResult, finItem, isEmbeddedOp, queryVarsOf } from "../eval/terms";
import { isNormalForm, refreshEvaluationEnvironment, typeViewFor } from "../eval/typeops";
import { cancelWorldRuntime, consumeWorldResource, releaseWorldRuntime } from "../eval/world";
import { ExclusiveAsyncScope, GeneratorUnwindFailures } from "../generator-lifecycle";
import { type GroundedAnswerCursor, type GroundedOperationV2Registration } from "../grounded-v2";
import { type CancellationReason } from "../resources";
import {
  type AsyncSearchCursor,
  DEFAULT_SEARCH_QUANTUM,
  ParallelSourceOrderedAsyncCursor,
  type SearchBatchEvent,
  type SearchDrainResult,
  type SearchEvent,
  type SearchNextOptions,
  SourceOrderedAsyncCursor,
} from "../search-cursor";
import { isWorkerQuiescenceError } from "../worker-protocol";

export function* closeMinimalGroundedV2G(
  continuation: MinimalGroundedV2Continuation,
  initiating: SchedulerUnwindFailure = { active: false, error: undefined },
): Gen<void> {
  if (continuation.closed) return;
  continuation.closed = true;
  try {
    yield* closeGroundedV2G(
      continuation.answers,
      continuation.operation,
      continuation.call,
      continuation.subject,
      initiating,
    );
  } finally {
    releaseStreamingIsolatedBranches(continuation.isolation);
    continuation.call.close();
  }
}

export function* closeMinimalMettaCallG(
  continuation: MinimalMettaCallContinuation,
  initiating: SchedulerUnwindFailure = { active: false, error: undefined },
): Gen<void> {
  if (continuation.closed) return;
  continuation.closed = true;
  yield* closeScheduleG(
    continuation.schedule,
    { code: "parent-closed", message: `${continuation.operation} consumer closed` },
    initiating,
  );
}

/**
 * Pull one answer from a streamed `metta`/`metta-thread` call. Each answer's state is adopted
 * through its journal ancestry, so the world a continuation observes is the one that produced the
 * answer, and the exhausted terminal commits only the remaining suffix.
 */
export function* resumeMinimalMettaCallG(
  st: St,
  continuation: MinimalMettaCallContinuation,
  cursor?: CursorMode,
): Gen<[Item[], St]> {
  let handedOff = false;
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  try {
    for (;;) {
      const event = (yield continuation.schedule.nextEffect()) as SearchEvent<
        MinimalSearchAnswer,
        St
      >;
      yield* chargeSchedulerStepsG(cursor, st, event.steps);
      switch (event.kind) {
        case "answer": {
          const retained: Item = {
            stack: null,
            bnd: continuation.bnd,
            mettaCall: continuation,
          };
          handedOff = true;
          return [
            [...continuation.project(event.value), retained],
            restoreAllocationAuthority(st, event.value.state),
          ];
        }
        case "pending":
          break;
        case "exhausted":
          continuation.closed = true;
          return [[], restoreAllocationAuthority(st, event.terminal)];
        case "cancelled":
          throw schedulerCancellationError(continuation.operation, event.reason);
        case "fault":
          throw event.error;
      }
    }
  } catch (error) {
    unwind.active = true;
    unwind.error = error;
    throw error;
  } finally {
    if (!handedOff) yield* closeMinimalMettaCallG(continuation, unwind);
  }
}

export function* resumeMinimalGroundedV2G(
  env: MinEnv,
  st: St,
  continuation: MinimalGroundedV2Continuation,
  cursor?: CursorMode,
): Gen<[Item[], St]> {
  let handedOff = false;
  let current = st;
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  if (continuation.isolation !== undefined) {
    if (continuation.activeIsolatedAnswer) {
      recordStreamingIsolatedTerminal(continuation.isolation, st);
      continuation.activeIsolatedAnswer = false;
    }
    current = continuation.isolation.parent;
  }
  try {
    for (;;) {
      const event = yield* pullGroundedV2G(
        continuation.answers,
        current.world,
        continuation.operation,
        continuation.call,
        continuation.subject,
        cursor,
      );
      consumeWorldResource(current.world, "steps", event.steps, `${continuation.operation}-pull`);
      yield* chargeSchedulerStepsG(cursor, current, event.steps);
      if (event.kind === "pending") continue;
      if (event.kind === "exhausted") {
        if (continuation.isolation !== undefined)
          current = finishStreamingIsolatedBranches(env, continuation.isolation);
        return [[], current];
      }
      if (event.kind === "cancelled")
        throw {
          kind: "cancelled",
          reason: event.reason,
          bindings: continuation.call.frame,
          subject: continuation.subject,
          trace: continuation.call.trace,
        };
      if (event.kind === "fault")
        throw groundedV2Fault(
          "grounded-next",
          event.error,
          continuation.call,
          continuation.subject,
        );
      const prepared = prepareGroundedAnswer(
        env,
        event.value,
        continuation.call,
        continuation.context,
        continuation.subject,
      );
      if (prepared.kind === "conflict") continue;
      if (continuation.isolation !== undefined)
        current = allocateStreamingIsolatedBranch(continuation.isolation);
      consumeGroundedPayloadResources(
        current.world,
        continuation.operation,
        prepared.value.resourceAtoms,
        true,
      );
      const applied = applyReduceEffects(
        env,
        current,
        prepared.value.bindings,
        prepared.value.effects,
      );
      const answer =
        applied.tag === "error" ? errAtom(continuation.subject, applied.msg) : prepared.value.atom;
      if (applied.tag === "ok") current = applied.state;
      const retained: Item = {
        stack: null,
        bnd: prepared.value.bindings,
        groundedV2: continuation,
      };
      continuation.activeIsolatedAnswer = continuation.isolation !== undefined;
      handedOff = true;
      return [
        [
          evalResult(
            continuation.continuation,
            answer,
            prepared.value.bindings,
            continuation.subject,
          ),
          retained,
        ],
        current,
      ];
    }
  } catch (error) {
    unwind.active = true;
    unwind.error = error;
    throw error;
  } finally {
    if (!handedOff) yield* closeMinimalGroundedV2G(continuation, unwind);
  }
}

export function* startMinimalGroundedV2G(
  registration: GroundedOperationV2Registration,
  env: MinEnv,
  st: St,
  previous: Stack,
  subject: ExprAtom,
  operation: string,
  originalArgs: readonly Atom[],
  args: readonly Atom[],
  bindings: Bindings,
  cursor?: CursorMode,
): Gen<[Item[], St]> {
  const call = createGroundedV2Call(env, st.world, operation, originalArgs, bindings);
  let answers: GroundedAnswerCursor | undefined;
  let handedOff = false;
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  try {
    const context = call.context(NEVER_ABORTED_SIGNAL);
    const start = yield* startGroundedV2G(registration, st.world, operation, args, call, subject);
    recordGroundedOperationEffects(st.world, operation, registration.options.effects, []);
    if (start.tag === "host-fault") throw start.fault;
    if (start.tag === "language-error") {
      const error = checkedGroundedLanguageError(start.error, call, context, subject);
      consumeGroundedPayloadResources(st.world, operation, [error], true);
      return [[finItem(previous, error, bindings)], st];
    }
    if (start.tag === "stuck") return queryOp(env, st, previous, subject, bindings);
    answers = start.answers;
    if (answers.mode !== registration.options.mode)
      throw groundedV2Fault(
        "grounded-start",
        new TypeError(
          `${operation}: ${registration.options.mode} operation returned ${answers.mode} cursor`,
        ),
        call,
        subject,
      );
    checkGroundedEffectsScope(start.preEffects, call, context, subject);
    const instantiatedPreEffects = instantiateReduceEffects(call.frame, start.preEffects);
    consumeGroundedPayloadResources(
      st.world,
      operation,
      reduceEffectAtoms(instantiatedPreEffects),
      false,
    );
    const preEffects = applyReduceEffects(env, st, bindings, instantiatedPreEffects);
    if (preEffects.tag === "error")
      return [[finItem(previous, errAtom(subject, preEffects.msg), bindings)], st];
    const isolation = beginStreamingIsolatedBranches(preEffects.state, false);
    const continuation: MinimalGroundedV2Continuation = {
      operation,
      subject,
      continuation: previous,
      call,
      context,
      answers,
      ...(isolation === undefined ? {} : { isolation }),
      activeIsolatedAnswer: false,
      closed: false,
    };
    handedOff = true;
    return yield* resumeMinimalGroundedV2G(env, preEffects.state, continuation, cursor);
  } catch (error) {
    unwind.active = true;
    unwind.error = error;
    throw error;
  } finally {
    if (!handedOff) {
      try {
        if (answers !== undefined)
          yield* closeGroundedV2G(answers, operation, call, subject, unwind);
      } finally {
        call.close();
      }
    }
  }
}

class SchedulerCancellationError extends Error {
  readonly reason: CancellationReason;

  constructor(operation: string, reason: CancellationReason) {
    super(`${operation} cancelled: ${reason.message ?? reason.code}`);
    this.name = "SchedulerCancellationError";
    this.reason = reason;
  }
}

export function schedulerCancellationError(
  operation: string,
  reason: CancellationReason,
): SchedulerCancellationError {
  return new SchedulerCancellationError(operation, reason);
}

export function* closeScheduleG<T, R>(
  schedule: DualModeSearchCursor<T, R>,
  reason: CancellationReason,
  initiating: SchedulerUnwindFailure,
): Gen<void> {
  try {
    yield schedule.closeEffect(reason);
  } catch (cleanupError) {
    if (!initiating.active) throw cleanupError;
    throw Object.is(cleanupError, initiating.error)
      ? initiating.error
      : combineInitiatingAndCleanupFailure(
          initiating.error,
          cleanupError,
          "scheduler operation and cleanup both failed",
        );
  }
}

export function* chargeSchedulerStepsG(
  cursor: CursorMode | undefined,
  state: St,
  steps: number,
): Gen<void> {
  if (cursor === undefined) return;
  recordCursorSteps(cursor, steps);
  yield* flushCursorProgressG(cursor, state);
}

export function* takeFirstScheduledAnswerG(
  operation: "race" | "once",
  schedule: DualModeSearchCursor<MinimalSearchAnswer, St>,
  continuation: Stack,
  state: St,
  cursor: CursorMode | undefined,
): Gen<[Item[], St]> {
  let finished = false;
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  try {
    for (;;) {
      const event = (yield schedule.nextEffect()) as SearchEvent<MinimalSearchAnswer, St>;
      yield* chargeSchedulerStepsG(cursor, state, event.steps);
      switch (event.kind) {
        case "answer":
          finished = true;
          return [
            [finItem(continuation, event.value.atom, event.value.bindings)],
            restoreAllocationAuthority(state, event.value.state),
          ];
        case "pending":
          break;
        case "exhausted":
          finished = true;
          return [[], event.terminal];
        case "cancelled":
          throw schedulerCancellationError(operation, event.reason);
        case "fault":
          throw event.error;
      }
    }
  } catch (error) {
    unwind.active = true;
    unwind.error = error;
    throw error;
  } finally {
    if (!finished)
      yield* closeScheduleG(
        schedule,
        {
          code: "parent-closed",
          message: `${operation} tail closed`,
        },
        unwind,
      );
  }
}

export function* runCompiledCooperativelyG(
  env: MinEnv,
  op: string,
  args: readonly Atom[],
  state: St,
  cursor: CursorMode,
): Gen<
  | { readonly kind: "done"; readonly result: CompiledRunResult }
  | { readonly kind: "bail"; readonly residualArgs: readonly Atom[] }
  | undefined
> {
  const run = startCooperativeCompiledRun(env, op, args);
  if (run === undefined) return undefined;
  for (;;) {
    const event = (yield driverEffect(
      `compiled:${op}`,
      (maxSteps) => run.next(maxSteps ?? DEFAULT_SEARCH_QUANTUM),
      async (signal, maxSteps) => {
        signal.throwIfAborted();
        const result = run.next(maxSteps ?? DEFAULT_SEARCH_QUANTUM);
        signal.throwIfAborted();
        return result;
      },
    )) as CooperativeCompiledRunEvent;
    yield* chargeSchedulerStepsG(cursor, state, event.steps);
    if (event.kind === "pending") continue;
    return event.kind === "done"
      ? { kind: "done", result: event.result }
      : { kind: "bail", residualArgs: event.residualArgs };
  }
}

export interface DirectAsyncGroundedApplication {
  readonly application: ExprAtom;
  readonly op: string;
  readonly args: readonly Atom[];
  readonly queryVars: readonly string[];
  readonly opReturnsAtom: boolean;
}

export function directAsyncGroundedApplication(
  env: MinEnv,
  state: St,
  input: Atom,
): DirectAsyncGroundedApplication | undefined {
  if (input.kind !== "expr" || input.items[0]?.kind !== "sym") return undefined;
  const op = input.items[0].name;
  if (!env.agt.has(op) || groundedV2For(env, op) !== undefined) return undefined;
  if (pettaOpNames.has(op) && hasRuleFor(env, state.world, state.counter, input)) return undefined;
  const args = input.items.slice(1);
  const signature = typeViewFor(env, state.world).sigs.get(op);
  if (checkApplication(env, state.world, op, args, signature) !== null) return undefined;
  const mask = LAZY_ARGS_OPS.has(op)
    ? args.map(() => false)
    : LEATTA_EVAL_ARGS_OPS.has(op)
      ? args.map(() => true)
      : argMask(signature, args.length);
  if (
    !args.every(
      (argument, index) =>
        mask[index] !== true || (argument.ground && isNormalForm(env, state.world, argument)),
    )
  )
    return undefined;
  return {
    application: input,
    op,
    args,
    queryVars: queryVarsOf(args),
    opReturnsAtom:
      signature !== undefined &&
      signature.length > 0 &&
      atomEq(signature[signature.length - 1]!, sym("Atom")),
  };
}

function isCancellationFailure(error: unknown, reason: CancellationReason): boolean {
  if (error === reason) return true;
  if (error instanceof SchedulerCancellationError)
    return cancellationReasonsEqual(error.reason, reason);
  if (typeof error !== "object" || error === null) return false;
  try {
    const candidate = error as { readonly name?: unknown; readonly cause?: unknown };
    return candidate.name === "AbortError" && candidate.cause === reason;
  } catch {
    return false;
  }
}

export class GeneratorAsyncSearchCursor<
  T extends InternalSearchAnswer,
> implements AsyncSearchCursor<T, St> {
  readonly #generator: Gen<[ContextualPair[], St]>;
  readonly #controller = new AbortController();
  readonly #driverSignal: AbortSignal | undefined;
  readonly #scope = new ExclusiveAsyncScope();
  readonly #releaseSnapshot: () => void;
  readonly #delivery: CursorDeliveryControl;
  readonly #materializeAnswer: CursorAnswerMaterializer<T>;
  readonly #runtimeWorld: World | undefined;
  readonly #unwindFailures = new GeneratorUnwindFailures();
  readonly #status = newMinimalCursorStatus();
  #state: St;
  readonly #cleanupFaults: unknown[] = [];
  #cleanupFailure: unknown;
  #hasCleanupFailure = false;
  #closing: Promise<void> | undefined;
  #generatorFinished = false;
  #released = false;

  constructor(
    generator: Gen<CursorEvalRes>,
    state: St,
    releaseSnapshot: () => void,
    delivery: CursorDeliveryControl,
    materializeAnswer: CursorAnswerMaterializer<T>,
    driverSignal?: AbortSignal,
    runtimeWorld?: World,
  ) {
    this.#state = state;
    this.#driverSignal = driverSignal;
    this.#releaseSnapshot = releaseSnapshot;
    this.#generator = generator;
    this.#delivery = delivery;
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

  next(options: SearchNextOptions = {}): Promise<SearchEvent<T, St>> {
    return this.#scope.run(async () => {
      minimalCursorLimit(options);
      this.#status.started = true;
      return await this.#drive(options);
    });
  }

  nextBatch(options: SearchNextOptions = {}): Promise<SearchBatchEvent<T, St>> {
    return this.#scope.run(async () => {
      minimalCursorLimit(options);
      if (!this.#status.started && this.#delivery.directDrain === true) {
        this.#delivery.batchDrain = true;
        this.#delivery.streaming = false;
      }
      this.#status.started = true;
      const values: T[] = [];
      const event = await this.#drive(options, values, this.#delivery.batchDrain === true);
      switch (event.kind) {
        case "answer":
          values.push(event.value);
          return { kind: "pending", values, steps: event.steps };
        case "pending":
          return { ...event, values };
        case "exhausted":
          return { ...event, values };
        case "cancelled":
          return { ...event, values };
        case "fault":
          return { ...event, values };
      }
    });
  }

  drain(options: SearchNextOptions = {}): Promise<SearchDrainResult<T, St>> {
    return this.#scope.run(() => this.#drain(options));
  }

  close(reason: CancellationReason = MINIMAL_CURSOR_CLOSED): Promise<void> {
    // Publish the public close promise before cleanup can re-enter this cursor. Active code may already have
    // started owned cleanup without joining itself, so this boundary joins both cleanup and the active read.
    return this.#scope.close(() => {
      this.#beginClose(reason);
      return this.#closing!;
    });
  }

  async #drain(options: SearchNextOptions): Promise<SearchDrainResult<T, St>> {
    const prepared = prepareMinimalCursorDrain<T>(options, this.#delivery, this.#status);
    if (prepared.stopped !== undefined) return prepared.stopped;
    if (prepared.terminalPairs && this.#delivery.directDrain === true)
      return this.#drainDirect(options, prepared.values);
    for (;;) {
      const event = await this.#drive(options, prepared.values, prepared.terminalPairs);
      const terminal = minimalDrainEvent(prepared.values, event);
      if (terminal !== undefined) return terminal;
    }
  }

  async #drainDirect(options: SearchNextOptions, values: T[]): Promise<SearchDrainResult<T, St>> {
    const cancellation = minimalCancellation(options);
    if (cancellation !== undefined) {
      this.#beginClose(cancellation, false);
      try {
        await this.#closing;
      } catch (error) {
        this.#recordCleanupFault(error);
        this.#status.fault = isWorkerQuiescenceError(this.#status.fault)
          ? this.#status.fault
          : combineInitiatingAndCleanupFailure(
              cancellation,
              this.#cleanupFailure,
              "evaluation cancellation and cleanup both failed",
            );
        this.#status.hasFault = true;
        return { kind: "fault", values, error: this.#status.fault };
      }
      return { kind: "cancelled", values, reason: cancellation };
    }
    // An owned scheduler child already receives this exact signal as its driver signal. The parent aborts
    // the group and calls child.close in one close operation, so a second per-read listener only duplicates
    // propagation and doubles EventTarget churn across every answer boundary.
    const readSignal = options.signal === this.#driverSignal ? undefined : options.signal;
    const onAbort = (): void => {
      this.#beginClose(readSignal?.reason);
    };
    readSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      const [pairs, terminal] = await runGenAsync(this.#generator, this.#controller.signal);
      this.#status.terminal = terminal;
      this.#state = terminal;
      for (const pair of pairs) values.push(this.#materializeAnswer(pair, terminal));
      this.#release();
      return { kind: "exhausted", values, terminal };
    } catch (error) {
      const cancelled = this.#status.closedReason ?? minimalCancellation(options);
      if (cancelled !== undefined) {
        if (!isCancellationFailure(error, cancelled)) {
          this.#recordCleanupFault(error);
          this.#status.fault = isWorkerQuiescenceError(this.#status.fault)
            ? this.#status.fault
            : combineInitiatingAndCleanupFailure(
                cancelled,
                this.#cleanupFailure,
                "evaluation cancellation and cleanup both failed",
              );
          this.#status.hasFault = true;
        }
        this.#status.closedReason = cancelled;
        if (this.#status.hasFault) return { kind: "fault", values, error: this.#status.fault };
        return { kind: "cancelled", values, reason: cancelled };
      }
      this.#status.fault = error;
      this.#status.hasFault = true;
      this.#release();
      return { kind: "fault", values, error };
    } finally {
      this.#generatorFinished = true;
      readSignal?.removeEventListener("abort", onAbort);
    }
  }

  async #drive(
    options: SearchNextOptions,
    values?: T[],
    terminalPairs = false,
  ): Promise<SearchEvent<T, St>> {
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
      this.#beginClose(cancellation, false);
      try {
        await this.#closing;
      } catch (error) {
        this.#recordCleanupFault(error);
        if (isWorkerQuiescenceError(this.#status.fault))
          return { kind: "fault", error: this.#status.fault, steps: 0 };
        // `close()` exposes ordinary cleanup failure. Cancellation remains the first visible terminal.
      }
      return { kind: "cancelled", reason: cancellation, steps: 0 };
    }

    // The owning scheduler propagates its driver signal through child.close. Keep a per-read listener only
    // for a distinct caller signal, such as a public cursor read made outside that scheduler.
    const readSignal = options.signal === this.#driverSignal ? undefined : options.signal;
    const onAbort = (): void => {
      this.#beginClose(readSignal?.reason);
    };
    readSignal?.addEventListener("abort", onAbort, { once: true });
    prepareCursorRead(this.#delivery, maxSteps);
    let steps = 0;
    const driverSignal = this.#driverSignal ?? this.#controller.signal;
    try {
      let result = this.#generator.next();
      for (;;) {
        if (this.#status.closedReason !== undefined) {
          steps += takeDeliveryCursorSteps(this.#delivery);
          return this.#finishCancelledRead(steps);
        }
        if (result.done) {
          const completed = completeMinimalCursorGenerator(
            result.value,
            this.#delivery,
            this.#unwindFailures,
            "asynchronous effect and generator unwind both failed",
            terminalPairs,
            values,
            this.#materializeAnswer,
            steps,
          );
          this.#generatorFinished = true;
          this.#status.terminal = completed.terminal;
          this.#state = this.#status.terminal;
          this.#release();
          return {
            kind: "exhausted",
            terminal: this.#status.terminal,
            steps: completed.steps,
          };
        }
        if (isMinimalCursorSignal(result.value)) {
          this.#state = result.value.state;
          steps += result.value.steps;
          const answer = this.#unwindFailures.active
            ? undefined
            : consumeMinimalCursorSignal(result.value, values, this.#materializeAnswer);
          if (answer !== undefined) return { kind: "answer", value: answer, steps };
          if (steps >= maxSteps) return { kind: "pending", steps };
          result = this.#generator.next();
          continue;
        }
        steps += takeDeliveryCursorSteps(this.#delivery);
        try {
          driverSignal.throwIfAborted();
          const value = isDriverEffect(result.value)
            ? await result.value.runAsync(
                driverSignal,
                cursorEffectAllowance(this.#delivery, maxSteps - steps),
              )
            : await result.value;
          driverSignal.throwIfAborted();
          result = this.#generator.next(value);
        } catch (error) {
          if (
            this.#status.closedReason === undefined ||
            !isCancellationFailure(error, this.#status.closedReason)
          )
            this.#unwindFailures.record(error);
          try {
            result = this.#generator.throw(error);
          } catch (unwindError) {
            this.#generatorFinished = true;
            if (
              this.#status.closedReason === undefined ||
              !isCancellationFailure(unwindError, this.#status.closedReason)
            )
              this.#unwindFailures.record(unwindError);
            if (this.#status.closedReason === undefined)
              throw this.#unwindFailures.active
                ? this.#unwindFailures.failure(
                    "asynchronous effect and generator unwind both failed",
                  )
                : unwindError;
            if (this.#unwindFailures.active)
              this.#recordCleanupFault(
                this.#unwindFailures.failure(
                  "asynchronous effect and generator unwind both failed",
                ),
              );
            steps += takeDeliveryCursorSteps(this.#delivery);
            return this.#finishCancelledRead(steps);
          }
          if (this.#status.closedReason !== undefined) {
            try {
              await finishGeneratorAsync(this.#generator, result, this.#controller.signal);
            } catch (cleanupError) {
              if (!isCancellationFailure(cleanupError, this.#status.closedReason))
                this.#unwindFailures.record(cleanupError);
            } finally {
              this.#generatorFinished = true;
            }
            if (this.#unwindFailures.active)
              this.#recordCleanupFault(
                this.#unwindFailures.failure(
                  "asynchronous effect and generator unwind both failed",
                ),
              );
            steps += takeDeliveryCursorSteps(this.#delivery);
            return this.#finishCancelledRead(steps);
          }
        }
      }
    } catch (error) {
      steps += takeDeliveryCursorSteps(this.#delivery);
      if (this.#status.closedReason !== undefined) {
        if (!isCancellationFailure(error, this.#status.closedReason))
          this.#recordCleanupFault(error);
        if (this.#status.hasFault && isWorkerQuiescenceError(this.#status.fault))
          return { kind: "fault", error: this.#status.fault, steps };
        return { kind: "cancelled", reason: this.#status.closedReason, steps };
      }
      this.#status.fault = error;
      this.#status.hasFault = true;
      try {
        await this.#finishGenerator();
      } catch (cleanupError) {
        this.#status.fault = combineInitiatingAndCleanupFailure(
          error,
          cleanupError,
          "evaluation and asynchronous generator cleanup both failed",
        );
      }
      this.#release();
      return { kind: "fault", error: this.#status.fault, steps };
    } finally {
      readSignal?.removeEventListener("abort", onAbort);
    }
  }

  #beginClose(reason: unknown, joinActive = true): void {
    if (
      this.#closing !== undefined ||
      this.#status.terminal !== undefined ||
      this.#status.hasFault
    ) {
      this.#closing ??= Promise.resolve();
      return;
    }
    this.#status.closedReason = this.#stableCancellationReason(reason);
    this.#delivery.lifecycle.unwinding = true;
    if (this.#runtimeWorld !== undefined)
      cancelWorldRuntime(this.#runtimeWorld, this.#status.closedReason);
    this.#controller.abort(this.#status.closedReason);
    const active = joinActive ? this.#scope.active : undefined;
    if (active === undefined) {
      // Defer generator cleanup by one microtask so #closing is assigned before a finalizer can re-enter.
      this.#closing = Promise.resolve()
        .then(() => this.#finishGenerator())
        .finally(() => this.#release());
      void this.#closing.catch(() => undefined);
      return;
    }
    this.#closing = active
      .then(
        () => this.#finishGenerator(),
        async (error: unknown) => {
          await this.#finishGenerator();
          if (!isCancellationFailure(error, this.#status.closedReason!)) throw error;
        },
      )
      .finally(() => this.#release());
    void this.#closing.catch(() => undefined);
  }

  async #finishCancelledRead(steps: number): Promise<SearchEvent<T, St>> {
    try {
      await this.#finishGenerator();
    } catch {
      // #finishGenerator records cleanup failures. Ordinary failures remain on close's second channel.
    }
    if (this.#unwindFailures.active) {
      const failure = this.#unwindFailures.failure(
        "asynchronous effect and generator unwind both failed",
      );
      if (!isCancellationFailure(failure, this.#status.closedReason!))
        this.#recordCleanupFault(failure);
    }
    this.#release();
    if (this.#status.hasFault && isWorkerQuiescenceError(this.#status.fault))
      return { kind: "fault", error: this.#status.fault, steps };
    return { kind: "cancelled", reason: this.#status.closedReason!, steps };
  }

  async #finishGenerator(): Promise<void> {
    if (!this.#generatorFinished) {
      this.#delivery.lifecycle.unwinding = true;
      try {
        await closeGeneratorAsync(this.#generator, this.#state, this.#controller.signal);
      } catch (error) {
        if (
          this.#status.closedReason === undefined ||
          !isCancellationFailure(error, this.#status.closedReason)
        )
          this.#recordCleanupFault(error);
      } finally {
        this.#generatorFinished = true;
      }
    }
    if (this.#hasCleanupFailure)
      throw this.#status.hasFault && isWorkerQuiescenceError(this.#status.fault)
        ? this.#status.fault
        : this.#cleanupFailure;
  }

  #recordCleanupFault(error: unknown): void {
    for (const failure of cleanupFailureLeaves(error)) {
      if (
        this.#status.closedReason !== undefined &&
        isCancellationFailure(failure, this.#status.closedReason)
      )
        continue;
      this.#recordCleanupFailureLeaf(failure);
    }
  }

  #recordCleanupFailureLeaf(error: unknown): void {
    if (
      this.#status.hasFault &&
      isWorkerQuiescenceError(this.#status.fault) &&
      Object.is(error, this.#status.fault)
    )
      return;
    if (this.#hasCleanupFailure && Object.is(error, this.#cleanupFailure)) return;
    this.#cleanupFaults.push(error);
    this.#cleanupFailure = aggregateCleanupFailures(
      this.#cleanupFaults,
      "multiple asynchronous evaluation cleanups failed",
    );
    this.#hasCleanupFailure = true;
    if (isWorkerQuiescenceError(this.#cleanupFailure)) {
      this.#status.fault =
        this.#status.closedReason === undefined
          ? this.#cleanupFailure
          : combineInitiatingAndCleanupFailure(
              this.#status.closedReason,
              this.#cleanupFailure,
              "evaluation cancellation and worker cleanup both failed",
            );
      this.#status.hasFault = true;
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

  #stableCancellationReason(reason: unknown): CancellationReason {
    if (
      this.#driverSignal?.aborted === true &&
      Object.is(reason, this.#driverSignal.reason) &&
      typeof reason === "object" &&
      reason !== null &&
      Object.isFrozen(reason)
    )
      return reason as CancellationReason;
    return stableEvalCancellationReason(reason);
  }
}

export interface DirectParBranch {
  readonly env: MinEnv;
  readonly state: St;
  readonly direct: DirectAsyncGroundedApplication;
}

interface SettledDirectParBranch extends DirectParBranch {
  readonly result: ReduceResult;
  readonly effectsApplied?: boolean;
}

export interface PrefetchedDirectParBranch {
  readonly branch: SettledDirectParBranch;
  readonly event: Extract<
    SearchBatchEvent<InternalSearchAnswer, St>,
    { readonly kind: "pending" | "exhausted" }
  >;
  readonly cursor?: AsyncSearchCursor<InternalSearchAnswer, St>;
  /** True when the settled host result required an interpreter continuation. */
  readonly evaluated: boolean;
}

export function directParApplications(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  branches: readonly Atom[],
):
  | readonly { readonly env: MinEnv; readonly direct: DirectAsyncGroundedApplication }[]
  | undefined {
  if (fuel <= 0 || branches.length === 0) return undefined;
  const applications: Array<{
    readonly env: MinEnv;
    readonly direct: DirectAsyncGroundedApplication;
  }> = [];
  for (const branch of branches) {
    const selected = refreshEvaluationEnvironment(env, state.world);
    const input = inst(selected, bindings, branch);
    if (!input.ground || (input.kind === "expr" && selected.evaluatedAtoms.has(input)))
      return undefined;
    const direct = directAsyncGroundedApplication(selected, state, input);
    if (direct === undefined) return undefined;
    applications.push({ env: selected, direct });
  }
  return applications;
}

export async function invokeDirectParBranch(
  branch: DirectParBranch,
  signal: AbortSignal,
  context = groundedCallContextWithSignal(branch.env, branch.state.world, signal),
): Promise<ReduceResult> {
  const effectPolicy = groundedEffectPolicy(branch.env, branch.direct.op);
  if (groundedEffectRejected(branch.state.world, effectPolicy))
    return {
      tag: "incorrectArgument",
      msg: `${branch.direct.op}: irreversible effect is not allowed in an isolated branch`,
    };
  const grounded = branch.env.agt.get(branch.direct.op);
  if (grounded === undefined)
    throw new Error(`async grounded operation '${branch.direct.op}' disappeared during par`);
  const args = branch.direct.args.map((argument) =>
    resolveStates(branch.state.world, subTokens(branch.state.world, argument, branch.env.intern)),
  );
  const result = await grounded(args, context);
  signal.throwIfAborted();
  if (result.tag === "ok")
    recordGroundedOperationEffects(
      branch.state.world,
      branch.direct.op,
      effectPolicy,
      result.results,
    );
  return result;
}

export function completedDirectParBranch(
  branch: SettledDirectParBranch,
): readonly InternalSearchAnswer[] | undefined {
  let atoms: readonly Atom[];
  switch (branch.result.tag) {
    case "ok":
      if (branch.result.effects !== undefined && branch.result.effects.length > 0) return undefined;
      atoms = branch.result.results;
      break;
    case "runtimeError":
      atoms = [errAtom(branch.direct.application, branch.result.msg)];
      break;
    case "incorrectArgument":
      atoms = [errTextAtom(branch.direct.application, branch.result.msg)];
      break;
    case "noReduce":
      return undefined;
  }

  const answers: InternalSearchAnswer[] = [];
  for (const atom of atoms) {
    let value: Atom;
    if (atomEq(atom, notReducibleA) || atomEq(atom, branch.direct.application)) {
      value = branch.direct.application;
    } else if (branch.direct.opReturnsAtom && !isEmbeddedOp(atom)) {
      value = atom;
    } else if (isErrorAtom(atom) || isNormalForm(branch.env, branch.state.world, atom)) {
      value = atom;
    } else {
      return undefined;
    }
    answers.push(terminalCursorAnswer([value, emptyBindings]));
    enforceDistinctLimit(branch.env, answers.length);
  }
  return answers;
}

export function applySettledDirectParEffects(
  branch: SettledDirectParBranch,
  bindings: Bindings,
): SettledDirectParBranch {
  if (
    branch.result.tag !== "ok" ||
    branch.result.effects === undefined ||
    branch.result.effects.length === 0
  )
    return branch;
  const applied = applyReduceEffects(branch.env, branch.state, bindings, branch.result.effects);
  return applied.tag === "error"
    ? {
        ...branch,
        result: { tag: "runtimeError", msg: applied.msg },
        effectsApplied: true,
      }
    : {
        ...branch,
        state: applied.state,
        result: { tag: "ok", results: branch.result.results },
        effectsApplied: true,
      };
}

function prefetchedDirectParCursor(
  branch: PrefetchedDirectParBranch,
): AsyncSearchCursor<InternalSearchAnswer, St> {
  if (branch.event.kind === "exhausted") {
    const terminal = branch.event.terminal;
    return new CompletedAsyncSearchCursor(
      branch.event.values,
      () => terminal,
      () => releaseWorldRuntime(terminal.world),
    );
  }
  if (branch.cursor === undefined)
    throw new Error("pending direct par branch lost its continuation cursor");
  const prefix = new CompletedAsyncSearchCursor<InternalSearchAnswer, St | undefined>(
    branch.event.values,
    () => undefined,
  );
  const source = new SourceOrderedAsyncCursor<InternalSearchAnswer, St | undefined>([
    prefix,
    branch.cursor,
  ]);
  return new MapTerminalAsyncCursor(source, (terminals) => {
    const terminal = terminals[1];
    if (terminal === undefined)
      throw new Error("direct par continuation exhausted without a terminal state");
    return terminal;
  });
}

export function prefetchedDirectParSchedule(
  env: MinEnv,
  parentState: St,
  branches: readonly PrefetchedDirectParBranch[],
  controller: AbortController,
): DualModeSearchCursor<InternalSearchAnswer, St> {
  const asyncFactory = (): AsyncSearchCursor<InternalSearchAnswer, St> => {
    const source = new ParallelSourceOrderedAsyncCursor(
      branches.map(prefetchedDirectParCursor),
      controller,
    );
    return new MapTerminalAsyncCursor(source, (terminals) =>
      mergeScheduledStates(env, parentState, terminals),
    );
  };
  return new DualModeSearchCursor("par", undefined, asyncFactory);
}
