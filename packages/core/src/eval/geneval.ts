// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom } from "../atom";
import { type Bindings } from "../bindings";
import {
  DEFAULT_GROUNDED_CALL_CONTEXT,
  type GroundedCallContext,
  type GroundedModuleInstallation,
  type GroundingTable,
  isContextIndependentGroundedOp,
  type ReduceResult,
} from "../builtins";
import { DEFAULT_RUNTIME_CAPABILITIES, rootEvaluationEnvironment } from "../eval/env";
import {
  type AsyncGroundFn,
  AsyncInSyncError,
  type CompleteGroundedCallContext,
  DRIVER_EFFECT,
  driverEffect,
  type DriverEffect,
  type MinEnv,
  type St,
  type TypeView,
  type World,
} from "../eval/machine";
import { typeViewFor } from "../eval/typeops";
import {
  type CandidateSource,
  checkWorldDeadline,
  groundedContextIdentity,
  worldRuntimeContext,
} from "../eval/world";
import {
  finishGeneratorAsync as finishDrivenGeneratorAsync,
  GeneratorUnwindFailures,
} from "../generator-lifecycle";
import { readonlyMapSnapshot, readonlySetSnapshot } from "../readonly-collection";
import { collectionRevision, RevisionSet } from "../revision-collection";

// A suspension is any Promise the async driver awaits; each yield site knows its resolved type. The
// grounded boundary yields a Promise<ReduceResult>; the concurrency primitives yield Promise<[pairs,St]>.
type Susp = Promise<unknown>;

export function isDriverEffect(value: GenYield): value is DriverEffect {
  return (
    typeof value === "object" &&
    value !== null &&
    "effect" in value &&
    value.effect === DRIVER_EFFECT
  );
}

const MINIMAL_CURSOR_SIGNAL = Symbol("minimal-cursor-signal");

interface MinimalCursorProgressSignal {
  readonly signal: typeof MINIMAL_CURSOR_SIGNAL;
  readonly kind: "progress";
  readonly state: St;
  readonly steps: number;
}

export interface MinimalCursorAnswerSignal {
  readonly signal: typeof MINIMAL_CURSOR_SIGNAL;
  readonly kind: "answer";
  readonly pair: ContextualPair;
  readonly state: St;
  readonly steps: number;
}

export type MinimalCursorSignal = MinimalCursorProgressSignal | MinimalCursorAnswerSignal;

export type CursorModeKind = "answers" | "progress" | "cooperative";

export interface CursorBudget {
  active: boolean;
  remaining: number;
  pendingSteps: number;
}

export interface CursorMode {
  readonly kind: CursorModeKind;
  readonly budget: CursorBudget;
  readonly nested: CursorMode;
}

export function makeCursorMode(kind: CursorModeKind, budget: CursorBudget): CursorMode {
  budget.active = true;
  const progress = { kind: "progress", budget } as CursorMode;
  (progress as { nested: CursorMode }).nested = progress;
  if (kind === "progress") return progress;
  const root = { kind, budget } as CursorMode;
  (root as { nested: CursorMode }).nested = kind === "cooperative" ? root : progress;
  return root;
}

export const nestedCursorMode = (cursor: CursorMode | undefined): CursorMode | undefined =>
  cursor?.nested;

type GenYield = Susp | MinimalCursorSignal | DriverEffect;

export type Gen<R> = Generator<GenYield, R, unknown>;

export type EvalRes = [Array<[Atom, Bindings]>, St];

export type ContextualPair = [Atom, Bindings, MinEnv?];

export type CursorEvalRes = [ContextualPair[], St];

export interface AnswerEmissionLifecycle {
  unwinding: boolean;
}

export interface MettaAnswerEmitter {
  readonly emitted: WeakSet<ContextualPair>;
  emittedCount: number;
  omittedReturnCount: number;
  /** Cursor delivery can discard answer bags after the same answers have crossed the pull boundary. */
  readonly retainReturnedAnswers?: boolean;
  readonly lifecycle: AnswerEmissionLifecycle;
  readonly cursor?: CursorMode;
  readonly accept?: (pair: ContextualPair, state: St) => Gen<St>;
}

export function recordCursorSteps(cursor: CursorMode, steps: number): void {
  if (steps === 0) return;
  if (!Number.isSafeInteger(steps) || steps < 0 || steps > cursor.budget.remaining)
    throw new RangeError(
      `cursor attempted to charge ${String(steps)} steps with ${String(cursor.budget.remaining)} remaining`,
    );
  cursor.budget.remaining -= steps;
  cursor.budget.pendingSteps += steps;
}

export function takeCursorSteps(budget: CursorBudget): number {
  const steps = budget.pendingSteps;
  budget.pendingSteps = 0;
  return steps;
}

export function* flushCursorProgressG(cursor: CursorMode, state: St): Gen<void> {
  if (cursor.budget.remaining !== 0 || cursor.budget.pendingSteps === 0) return;
  yield {
    signal: MINIMAL_CURSOR_SIGNAL,
    kind: "progress",
    state,
    steps: takeCursorSteps(cursor.budget),
  };
}

export function* emitCursorAnswerG(cursor: CursorMode, pair: ContextualPair, state: St): Gen<void> {
  yield {
    signal: MINIMAL_CURSOR_SIGNAL,
    kind: "answer",
    pair,
    state,
    steps: takeCursorSteps(cursor.budget),
  };
}

export interface PreEvaluatedApplication {
  readonly originalArgs: readonly Atom[];
  readonly queryVars: readonly string[];
  readonly signature: Atom[] | undefined;
}

export function* emitMettaAnswersG(
  emitter: MettaAnswerEmitter | undefined,
  pairs: readonly ContextualPair[],
  state: St,
): Gen<St> {
  if (emitter === undefined) return state;
  let current = state;
  for (const pair of pairs) {
    if (emitter.emitted.has(pair)) continue;
    emitter.emitted.add(pair);
    emitter.emittedCount += 1;
    if (emitter.accept !== undefined) {
      current = yield* emitter.accept(pair, current);
    } else {
      if (emitter.cursor === undefined) {
        yield {
          signal: MINIMAL_CURSOR_SIGNAL,
          kind: "answer",
          pair,
          state: current,
          steps: 0,
        };
      } else {
        yield* emitCursorAnswerG(emitter.cursor, pair, current);
      }
    }
  }
  return current;
}

export function* emitReturnedMettaAnswersG(
  emitter: MettaAnswerEmitter,
  pairs: readonly ContextualPair[],
  state: St,
  emittedAtStart = 0,
  omittedAtStart = 0,
): Gen<St> {
  if (emitter.lifecycle.unwinding) return state;
  const emittedDuringEvaluation =
    emitter.emittedCount - emittedAtStart - (emitter.omittedReturnCount - omittedAtStart);
  if (emittedDuringEvaluation < 0 || emittedDuringEvaluation > pairs.length)
    throw new Error("streamed MeTTa answers do not match the returned answer bag");
  return yield* emitMettaAnswersG(emitter, pairs.slice(emittedDuringEvaluation), state);
}

/**
 * Emit the un-streamed remainder of a returned bag, then record the whole bag as omitted when the
 * emitter discards returned answers. Callers that skip their own `out.push` under the same flag
 * keep `emittedCount - omittedReturnCount` consistent for every ancestor sharing this emitter.
 */
export function* forwardReturnedMettaAnswersG(
  emitter: MettaAnswerEmitter,
  pairs: readonly ContextualPair[],
  state: St,
  emittedAtStart: number,
  omittedAtStart: number,
): Gen<St> {
  const next = yield* emitReturnedMettaAnswersG(
    emitter,
    pairs,
    state,
    emittedAtStart,
    omittedAtStart,
  );
  if (emitter.retainReturnedAnswers === false) emitter.omittedReturnCount += pairs.length;
  return next;
}

export function exactCandidateSource(atom: Atom, count: number, total: number): CandidateSource {
  return {
    counterPadding: total - count,
    synthetic: true,
    *[Symbol.iterator](): Iterator<Atom> {
      for (let i = 0; i < count; i++) yield atom;
    },
  };
}

export const candidateCounterPadding = (source: CandidateSource): number =>
  source.counterPadding ?? 0;

export const syntheticCandidateSource = (source: CandidateSource): boolean =>
  source.synthetic === true;

// TS-native concurrency primitives (async-only): par/race evaluate their argument expressions
// concurrently; with-mutex serialises a critical section across await points. Their arguments are NOT
// eagerly evaluated (the op drives them), and reaching them in the sync driver throws AsyncInSyncError.
export const LAZY_ARGS_OPS = new Set(["transaction", "par", "race", "once", "with-mutex"]);

export const LEATTA_EVAL_ARGS_OPS = new Set(["superpose", "hyperpose", "collapse-extract"]);

export const pendingAsyncOpBox = { op: "?" };

export const NEVER_ABORTED_SIGNAL: AbortSignal = new AbortController().signal;

export function runGenSync<R>(gen: Gen<R>): R {
  const failures = new GeneratorUnwindFailures();
  let result = gen.next();
  while (!result.done) {
    try {
      if (isDriverEffect(result.value)) {
        result = gen.next(result.value.runSync());
        continue;
      }
      if (isMinimalCursorSignal(result.value))
        throw new Error("minimal cursor signal reached the eager generator driver");
      throw new AsyncInSyncError(pendingAsyncOpBox.op);
    } catch (error) {
      failures.record(error);
      try {
        result = gen.throw(error);
      } catch (cleanupError) {
        failures.record(cleanupError);
        throw failures.failure("synchronous evaluation and generator unwind both failed");
      }
    }
  }
  if (failures.active)
    throw failures.failure("synchronous evaluation and generator unwind both failed");
  return result.value;
}

export async function finishGeneratorAsync<R>(
  generator: Gen<R>,
  initial: IteratorResult<GenYield, R>,
  signal: AbortSignal,
): Promise<void> {
  await finishDrivenGeneratorAsync(generator, initial, signal, async (value, activeSignal) => {
    if (isMinimalCursorSignal(value)) return undefined;
    return isDriverEffect(value) ? value.runAsync(activeSignal) : await value;
  });
}

/** Drive a generator asynchronously, awaiting each yielded Promise. An optional `signal` makes the
 *  evaluation cancellable: it is checked at every suspension point, so a losing `race` branch stops at
 *  its next await (cooperative cancellation; JS cannot preempt a running synchronous computation). */
export async function runGenAsync<R>(gen: Gen<R>, signal?: AbortSignal): Promise<R> {
  signal?.throwIfAborted();
  const failures = new GeneratorUnwindFailures();
  let r = gen.next();
  while (!r.done) {
    try {
      if (isMinimalCursorSignal(r.value))
        throw new Error("minimal cursor signal reached the eager generator driver");
      const v = isDriverEffect(r.value)
        ? await r.value.runAsync(signal ?? NEVER_ABORTED_SIGNAL)
        : await r.value;
      if (signal?.aborted === true) throw signal.reason;
      r = gen.next(v);
    } catch (error) {
      if (signal?.aborted === true) failures.record(signal.reason ?? error);
      failures.record(error);
      // Inject suspension failures into the generator so nested transaction and resource `finally`
      // blocks run before the failure reaches the caller.
      let injected: IteratorResult<GenYield, R>;
      try {
        injected = gen.throw(error);
      } catch (cleanupError) {
        failures.record(cleanupError);
        throw failures.failure("evaluation and generator unwind both failed");
      }
      if (signal?.aborted === true) {
        try {
          await finishGeneratorAsync(gen, injected, signal);
        } catch (cleanupError) {
          failures.record(cleanupError);
        }
        throw failures.failure("evaluation cancellation and generator cleanup both failed");
      }
      r = injected;
    }
  }
  if (failures.active) throw failures.failure("evaluation and generator unwind both failed");
  return r.value;
}

export function isMinimalCursorSignal(value: GenYield): value is MinimalCursorSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    "signal" in value &&
    value.signal === MINIMAL_CURSOR_SIGNAL
  );
}

export interface SignalledGroundedCallContext extends CompleteGroundedCallContext {
  readonly signal: AbortSignal;
}

interface SignalledGroundedContext {
  readonly signal: AbortSignal;
  readonly context: SignalledGroundedCallContext;
}

const signalledGroundedContexts = new WeakMap<
  CompleteGroundedCallContext,
  SignalledGroundedContext
>();

export function groundedRuntimeSignal(world: World, driverSignal: AbortSignal): AbortSignal {
  if (driverSignal !== NEVER_ABORTED_SIGNAL) return driverSignal;
  const scope = worldRuntimeContext(world).cancellation;
  return scope.linked ? scope.signal : driverSignal;
}

interface CachedGroundingEnvironment {
  readonly syncRegistry: GroundingTable;
  readonly asyncRegistry: Map<string, AsyncGroundFn>;
  readonly syncSize: number;
  readonly asyncSize: number;
  readonly groundingVersion: number;
  readonly syncRevision: number | undefined;
  readonly asyncRevision: number | undefined;
  readonly value: NonNullable<GroundedCallContext["groundingEnvironment"]>;
}

const groundingEnvironmentCache = new WeakMap<MinEnv, CachedGroundingEnvironment>();

interface CachedImmutableAtomLists {
  readonly revision: number;
  readonly value: ReadonlyMap<string, readonly Atom[]>;
}

const immutableAtomListsCache = new WeakMap<object, CachedImmutableAtomLists>();

function immutableAtomLists(
  source: ReadonlyMap<string, readonly Atom[]>,
  revision?: number,
): ReadonlyMap<string, readonly Atom[]> {
  const cached = immutableAtomListsCache.get(source);
  if (revision !== undefined && cached?.revision === revision) return cached.value;
  const value = readonlyMapSnapshot(
    new Map([...source].map(([name, atoms]) => [name, Object.freeze(atoms.slice())] as const)),
  );
  if (revision !== undefined) immutableAtomListsCache.set(source, { revision, value });
  return value;
}

const moduleInstallationsCache = new WeakMap<
  readonly GroundedModuleInstallation[],
  readonly GroundedModuleInstallation[]
>();

interface CachedTypeEnvironment {
  readonly programVersion: number;
  readonly value: NonNullable<GroundedCallContext["typeEnvironment"]>;
}

const immutableTypeEnvironmentCache = new WeakMap<TypeView, CachedTypeEnvironment>();

interface CachedImmutableCapabilities {
  readonly revision: number;
  readonly value: ReadonlySet<string>;
}

const immutableCapabilitiesCache = new WeakMap<object, CachedImmutableCapabilities>();

function immutableCapabilities(
  source: ReadonlySet<string>,
  revision?: number,
): ReadonlySet<string> {
  const cached = immutableCapabilitiesCache.get(source);
  if (revision !== undefined && cached?.revision === revision) return cached.value;
  const value = readonlySetSnapshot(source);
  if (revision !== undefined) immutableCapabilitiesCache.set(source, { revision, value });
  return value;
}

function memoizedValue<T>(compute: () => T): () => T {
  let initialized = false;
  let value: T;
  return () => {
    if (!initialized) {
      value = compute();
      initialized = true;
    }
    return value!;
  };
}

function immutableTypeEnvironment(
  types: TypeView,
  programVersion: number,
): NonNullable<GroundedCallContext["typeEnvironment"]> {
  const cached = immutableTypeEnvironmentCache.get(types);
  if (cached?.programVersion === programVersion) return cached.value;
  const value = Object.freeze({
    signatures: immutableAtomLists(types.sigs),
    declaredTypes: immutableAtomLists(types.types),
    expressionTypes: Object.freeze(
      types.exprTypes.map(([subject, type]) => Object.freeze([subject, type] as const)),
    ),
  });
  immutableTypeEnvironmentCache.set(types, { programVersion, value });
  return value;
}

function immutableModuleInstallations(
  source: readonly GroundedModuleInstallation[],
): readonly GroundedModuleInstallation[] {
  const cached = moduleInstallationsCache.get(source);
  if (cached !== undefined) return cached;
  const value = Object.freeze(
    source.map((installation) =>
      Object.freeze({
        ...installation,
        worldDelta: Object.freeze({
          addedAtoms: Object.freeze(
            installation.worldDelta.addedAtoms.map((delta) => Object.freeze({ ...delta })),
          ),
          removedAtoms: Object.freeze(
            installation.worldDelta.removedAtoms.map((delta) => Object.freeze({ ...delta })),
          ),
          boundTokens: Object.freeze(
            installation.worldDelta.boundTokens.map((delta) => Object.freeze({ ...delta })),
          ),
        }),
      }),
    ),
  );
  moduleInstallationsCache.set(source, value);
  return value;
}

function groundingEnvironmentFor(
  env: MinEnv,
): NonNullable<GroundedCallContext["groundingEnvironment"]> {
  const groundingVersion = env.groundingVersion ?? 0;
  const syncRevision = collectionRevision(env.gt);
  const asyncRevision = collectionRevision(env.agt);
  const cached = groundingEnvironmentCache.get(env);
  if (
    cached !== undefined &&
    cached.syncRegistry === env.gt &&
    cached.asyncRegistry === env.agt &&
    cached.syncSize === env.gt.size &&
    cached.asyncSize === env.agt.size &&
    cached.groundingVersion === groundingVersion &&
    syncRevision !== undefined &&
    asyncRevision !== undefined &&
    cached.syncRevision === syncRevision &&
    cached.asyncRevision === asyncRevision
  )
    return cached.value;
  const value = Object.freeze({
    synchronous: readonlySetSnapshot(new Set(env.gt.keys())),
    asynchronous: readonlySetSnapshot(new Set(env.agt.keys())),
  });
  groundingEnvironmentCache.set(env, {
    syncRegistry: env.gt,
    asyncRegistry: env.agt,
    syncSize: env.gt.size,
    asyncSize: env.agt.size,
    groundingVersion,
    syncRevision,
    asyncRevision,
    value,
  });
  return value;
}

export function groundedCallContext(env: MinEnv, world: World): CompleteGroundedCallContext {
  const identity = groundedContextIdentity(world);
  let byEnvironment = identity.contexts;
  if (byEnvironment === undefined) {
    byEnvironment = new WeakMap();
    identity.contexts = byEnvironment;
  }
  const cached = byEnvironment.get(env);
  const typeProgramVersion = env.typeProgramVersion ?? 0;
  const syncRevision = collectionRevision(env.gt);
  const asyncRevision = collectionRevision(env.agt);
  const importRevision = collectionRevision(env.imports);
  const capabilityRevision =
    env.capabilities === undefined ? 0 : collectionRevision(env.capabilities);
  const base = env.evaluationContext ?? DEFAULT_GROUNDED_CALL_CONTEXT;
  if (
    cached !== undefined &&
    cached.syncRegistry === env.gt &&
    cached.asyncRegistry === env.agt &&
    cached.typeProgramVersion === typeProgramVersion &&
    syncRevision !== undefined &&
    asyncRevision !== undefined &&
    importRevision !== undefined &&
    capabilityRevision !== undefined &&
    cached.syncRevision === syncRevision &&
    cached.asyncRevision === asyncRevision &&
    cached.imports === env.imports &&
    cached.importRevision === importRevision &&
    cached.capabilities === env.capabilities &&
    cached.capabilityRevision === capabilityRevision &&
    cached.evaluationContext === base
  )
    return cached.context;

  // Most built-ins ignore host metadata. Capture the stable program/world references now, then materialize
  // their immutable public views only if the grounded operation reads them. Async evaluations pin the
  // referenced registries and static indexes, so a getter first read after an await still observes call-time
  // state rather than a later host mutation.
  const owner = rootEvaluationEnvironment(env);
  const typeEnvironment = memoizedValue(() =>
    immutableTypeEnvironment(typeViewFor(env, world), owner.typeProgramVersion ?? 0),
  );
  const groundingEnvironment = memoizedValue(() => groundingEnvironmentFor(env));
  const imports = memoizedValue(() => immutableAtomLists(env.imports, importRevision));
  const moduleInstallations = memoizedValue(() =>
    immutableModuleInstallations(world.moduleInstallations),
  );
  const capabilities = memoizedValue(() =>
    immutableCapabilities(
      env.capabilities ?? new RevisionSet(DEFAULT_RUNTIME_CAPABILITIES),
      capabilityRevision,
    ),
  );
  const context: CompleteGroundedCallContext = Object.freeze({
    currentSpace: base.currentSpace,
    visibleSpaces: Object.freeze(base.visibleSpaces.slice()),
    expectedType: base.expectedType,
    generation: world.generation,
    get typeEnvironment() {
      return typeEnvironment();
    },
    get groundingEnvironment() {
      return groundingEnvironment();
    },
    get imports() {
      return imports();
    },
    get moduleInstallations() {
      return moduleInstallations();
    },
    get capabilities() {
      return capabilities();
    },
  });
  byEnvironment.set(env, {
    syncRegistry: env.gt,
    asyncRegistry: env.agt,
    typeProgramVersion,
    syncRevision,
    asyncRevision,
    imports: env.imports,
    importRevision,
    capabilities: env.capabilities,
    capabilityRevision,
    evaluationContext: base,
    context,
  });
  return context;
}

export function groundedCallContextWithSignal(
  env: MinEnv,
  world: World,
  signal: AbortSignal,
): SignalledGroundedCallContext {
  signal = groundedRuntimeSignal(world, signal);
  const base = groundedCallContext(env, world);
  const cached = signalledGroundedContexts.get(base);
  if (cached?.signal === signal) return cached.context;
  // Keep this object literal fixed-shape. Reflecting and replaying every property descriptor here made a
  // short async grounded call spend more time constructing its context than running the operation. The
  // accessors retain the base context's lazy snapshots while every public field remains an enumerable own
  // property, including `signal`.
  const context: SignalledGroundedCallContext = Object.freeze({
    currentSpace: base.currentSpace,
    visibleSpaces: base.visibleSpaces,
    expectedType: base.expectedType,
    generation: world.generation,
    get typeEnvironment() {
      return base.typeEnvironment;
    },
    get groundingEnvironment() {
      return base.groundingEnvironment;
    },
    get imports() {
      return base.imports;
    },
    get moduleInstallations() {
      return base.moduleInstallations;
    },
    get capabilities() {
      return base.capabilities;
    },
    signal,
  });
  signalledGroundedContexts.set(base, { signal, context });
  return context;
}

export function* callGroundedG(
  env: MinEnv,
  world: World,
  op: string,
  args: readonly Atom[],
): Gen<ReduceResult> {
  checkWorldDeadline(world, op);
  const af = env.agt.get(op);
  if (af !== undefined) {
    pendingAsyncOpBox.op = op;
    return (yield driverEffect(
      op,
      () => {
        throw new AsyncInSyncError(op);
      },
      async (signal) => {
        const result = await af(args, groundedCallContextWithSignal(env, world, signal));
        checkWorldDeadline(world, op);
        return result;
      },
    )) as ReduceResult;
  }
  const sf = env.gt.get(op);
  if (sf === undefined) return { tag: "noReduce" };
  const result = sf(
    args,
    isContextIndependentGroundedOp(sf)
      ? DEFAULT_GROUNDED_CALL_CONTEXT
      : groundedCallContext(env, world),
  );
  checkWorldDeadline(world, op);
  return result;
}

export function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown }).then === "function";
}
