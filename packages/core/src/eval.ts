// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { canonicalize } from "./alpha";
import {
  type Atom,
  atomEq,
  atomVars,
  emptyExpr,
  expr,
  type ExprAtom,
  gint,
  isErrorAtom,
  metaType,
  sym,
  variable,
} from "./atom";
import { dedupAlphaStable } from "./atom-set";
import {
  emptyLog,
  idxCount,
  logFromArray,
  logGroundIdx,
  logNonGround,
  logSize,
  logToArray,
} from "./atomlog";
import { bindingFrameFromLegacy, bindingFrameToLegacy, emptyBindingFrame } from "./binding-frame";
import {
  type Bindings,
  emptyBindings,
  eqRelations,
  hasLoop,
  lookupVal,
  size,
  valEntries,
} from "./bindings";
import {
  isSingleResultGroundedOp,
  isTableSafeGroundedOp,
  pettaOpNames,
  type ReduceResult,
} from "./builtins";
import { runChoicePlan, runDistinctChoicePlan, runDistinctChoicePlanBound } from "./choice-plan";
import {
  aggregateCleanupFailures,
  cleanupFailureLeaves,
  combineInitiatingAndCleanupFailure,
  selectWorkerQuiescenceFailure,
} from "./cleanup-fault";
import {
  type CompiledImpureOps,
  type CompiledRunResult,
  type CooperativeCompiledRunEvent,
  runCompiled,
  runCompiledEffectCount,
  startCooperativeCompiledRun,
} from "./compile";
import { runDistinctIntRelation } from "./distinct-int";
import { readEnv } from "./env";
import {
  allocateStreamingIsolatedBranch,
  beginStreamingIsolatedBranches,
  cancellationReasonsEqual,
  closeDirectParCursors,
  closeGeneratorAsync,
  CompletedAsyncSearchCursor,
  completedParCandidate,
  completeMinimalCursorGenerator,
  consumeMinimalCursorSignal,
  contextualCursorAnswer,
  type CursorAnswerMaterializer,
  type CursorDeliveryControl,
  cursorEffectAllowance,
  DEFAULT_FUEL,
  directParAllowances,
  type DirectParEvaluation,
  GeneratorSyncSearchCursor,
  type InternalSearchAnswer,
  isNativeStackOverflow,
  isolateAnswerContinuation,
  isolatedBranchStates,
  MapTerminalAsyncCursor,
  MapTerminalSyncCursor,
  mettaCursorEmitter,
  mettaCursorMode,
  MINIMAL_CURSOR_CLOSED,
  MINIMAL_DRAIN_QUANTUM,
  minimalCancellation,
  minimalCursorLimit,
  minimalDrainEvent,
  minimalDrainResult,
  type MinimalInterpretOptions,
  newCursorBudget,
  newMinimalCursorStatus,
  type PinnedCursorSource,
  prepareCursorRead,
  prepareMinimalCursorDrain,
  recordStreamingIsolatedTerminal,
  releaseStreamingIsolatedBranches,
  restoreAllocationAuthority,
  snapshotBindings,
  stableEvalCancellationReason,
  stackOverflowResult,
  stoppedMinimalCursorEvent,
  takeDeliveryCursorSteps,
  terminalCursorAnswer,
} from "./eval/cursors";
import {
  activeSpaceAtom,
  activeSpaceName,
  argKey,
  bindingPacketRegistry,
  evaluationCacheEnvironment,
  KEY_SEP,
  nestedArgHead,
  orderedIndexedAtoms,
  rootEvaluationEnvironment,
} from "./eval/env";
import {
  callGroundedG,
  candidateCounterPadding,
  type ContextualPair,
  type CursorEvalRes,
  type CursorMode,
  type CursorModeKind,
  emitCursorAnswerG,
  emitMettaAnswersG,
  emitReturnedMettaAnswersG,
  type EvalRes,
  finishGeneratorAsync,
  flushCursorProgressG,
  forwardReturnedMettaAnswersG,
  type Gen,
  groundedCallContext,
  groundedCallContextWithSignal,
  isDriverEffect,
  isMinimalCursorSignal,
  isPromiseLike,
  LAZY_ARGS_OPS,
  LEATTA_EVAL_ARGS_OPS,
  makeCursorMode,
  type MettaAnswerEmitter,
  nestedCursorMode,
  NEVER_ABORTED_SIGNAL,
  pendingAsyncOpBox,
  type PreEvaluatedApplication,
  recordCursorSteps,
  runGenAsync,
  runGenSync,
  syntheticCandidateSource,
} from "./eval/geneval";
import {
  AsyncInSyncError,
  cons,
  driverEffect,
  DualModeSearchCursor,
  errTextAtom,
  type EvaluationScope,
  frame,
  type GroundedEffectPolicy,
  inst,
  type Item,
  type MinEnv,
  type MinimalGroundedV2Continuation,
  type MinimalMettaCallContinuation,
  type MinimalSearchAnswer,
  type St,
  type Stack,
  type StreamingIsolatedBranches,
  type TypeView,
  type World,
} from "./eval/machine";
import {
  allocateSpaceName,
  allocateStateCell,
  appendSpace,
  awaitWithSignal,
  type BranchStateDelta,
  captureBranchStateDelta,
  captureWorldDelta,
  freshenRule,
  mutexKey,
  releaseChildWorldRuntimes,
  stateHandle,
  stateId,
  subTokens,
  typePrep,
  worldDeltasEqual,
} from "./eval/par";
import {
  bindChainAnswer,
  branchVariableNamespace,
  candidatesW,
  canMatchShallow,
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
  makeExpr,
  mergeRestrict,
  notReducibleA,
  prepareGroundedAnswer,
  pullGroundedV2G,
  queryOp,
  recordGroundedOperationEffects,
  reduceEffectAtoms,
  resolveAll,
  resolveStates,
  restrictBnd,
  runtimeCandidates,
  type SchedulerUnwindFailure,
  startGroundedV2G,
  unifyOp,
  worldFreshVariableSuffix,
} from "./eval/query";
import {
  disableTabling,
  ensureCompiled,
  hasVisibleStaticRuleHead,
  restoreEnvironmentMutations,
  selfAtoms,
  snapshotEnvironmentMutations,
  staticAtomRemoved,
  staticRulesChangedFor,
  staticRuleSetChanged,
  visibleStaticAtoms,
  visibleStaticRulesForHead,
} from "./eval/specializer";
import {
  canRunChoicePlan,
  choiceBranchesParallelSafe,
  choicePlanConstructor,
  choicePlanDataExpression,
  type CollapseRoute,
  collapseRouteEnabled,
  type CompletedTableKey,
  conjCountEnabled,
  containsImpureHead,
  countAggregateEnabled,
  countOnlyMatch,
  dedupGroundPairs,
  DISTINCT_RESOURCE_LIMIT,
  distinctGroundEnabled,
  DONE_UNIT,
  enforceDistinctLimit,
  freshenModedResult,
  groundTableVersionIfAdmissible,
  hasAnyAtomVar,
  isClosedChoiceValue,
  rememberGroundTable,
  rememberModedTable,
  runtimeFunctorPureModed,
  runtimeFunctorTableWorth,
  splitVoidBuild,
  staticCustomMatcherCache,
  tailMatchBuild,
  voidBuildEnabled,
} from "./eval/tabling";
import {
  admitAtom,
  argMask,
  bindingPacketVisibleVariables,
  chainLiveVars,
  collapseBindDiscardsBindings,
  evalResult,
  finItem,
  headKey,
  isEmbeddedOp,
  isFinal,
  legacyHyperposeEffect,
  malformedCoreInstructionAtom,
  opOf,
  queryVarsOf,
  scopeVars,
  skipApplicationCheck,
  strictArityError,
} from "./eval/terms";
import {
  functionArity,
  getTypesWithView,
  headOr,
  isDefinedHead,
  isNormalForm,
  isNormalFormAssumingVars,
  matchType,
  refreshEvaluationEnvironment,
  returnsAtom,
  selectEvaluationEnvironment,
  selectPinnedProgramEnvironment,
  typeViewFor,
} from "./eval/typeops";
import {
  acquirePinnedProgram,
  type AsyncEvaluationSession,
  cancelWorldRuntime,
  type CandidateSource,
  checkWorldCancellation,
  checkWorldDeadline,
  cloneWorld,
  consumeWorldResource,
  contextualSpaceAtom,
  contextualSpaceName,
  forkWorldRuntime,
  initSt,
  namedSpaceAtoms,
  nextWorldGeneration,
  nextWorldRuntimeBranch,
  recordWorldMutation,
  releaseWorldRuntime,
  UNDEF,
  withWorldRuntimePolicy,
  worldRuntimeContext,
} from "./eval/world";
import { ExclusiveAsyncScope, GeneratorUnwindFailures } from "./generator-lifecycle";
import {
  type GroundedAnswerCursor,
  type GroundedOperationV2Registration,
  groundedV2Registration,
} from "./grounded-v2";
import { addVarBinding, matchAtoms, matchAtomsScoped, merge } from "./match";
import { applyConsAtom, applyDeconsAtom } from "./minimal-instruction";
import { addInt, type IntVal, subInt } from "./number";
import { type CancellationReason, ResourceLimitError } from "./resources";
import {
  type AsyncSearchCursor,
  DEFAULT_SEARCH_QUANTUM,
  drainAsyncCursor,
  drainSyncCursor,
  FairAsyncCursor,
  FairSyncCursor,
  OnceAsyncCursor,
  OnceSyncCursor,
  ParallelSourceOrderedAsyncCursor,
  type SearchBatchEvent,
  type SearchDrainResult,
  type SearchEvent,
  type SearchNextOptions,
  SourceOrderedAsyncCursor,
  type SyncSearchCursor,
} from "./search-cursor";
import { stdlibDocAtoms } from "./stdlib";
import { runStructuredTaskGroup } from "./structured-task-group";
import { type ActiveTableEntry } from "./table-space";
import { keyWellFormed, MODED_IMPURE_OPS } from "./tabling";
import { Trail, unifyTrail } from "./trail";
import { type Relation, wcoJoin, wcoJoinFold } from "./wcojoin";
import { isWorkerQuiescenceError } from "./worker-protocol";
import {
  applyBranchStateDelta,
  applyReduceEffects,
  applyWorldDelta,
  callHostImportG,
  compiledAddAtom,
  compiledAddIfAbsent,
  eraseSpace,
  finishStreamingIsolatedBranches,
  importModuleName,
  mergeScheduledStates,
  moduleContentHash,
  namedSpaceCandidateGetter,
  pinAsyncEvaluation,
  recordModuleInstallation,
} from "./eval/mutate";
export {
  registerAsyncGroundedOperation,
  registerGroundedOperation,
  registerGroundedOperationV2,
} from "./eval/mutate";
export { type MinimalInterpretOptions } from "./eval/cursors";
export { WorldConflictError, freshenRule } from "./eval/par";
export { getTypes } from "./eval/typeops";
export { addAtomToEnv, buildEnv } from "./eval/specializer";
export {
  type AsyncEvaluationSession,
  type BranchEffectSnapshot,
  type BranchRuntimeOptions,
  type BranchRuntimeSnapshot,
  type IrreversibleEffectPolicy,
  type WorldCommitPolicy,
  branchRuntimeSnapshot,
  initSt,
} from "./eval/world";
export {
  emptyEnv,
  groundedExecutableV2,
  groundedHostImportV2,
  groundedMatcherV2,
} from "./eval/env";
export {
  type AsyncGroundFn,
  AsyncInSyncError,
  type EvaluationContext,
  type Frame,
  type GroundedEffectPolicy,
  type HostImportFn,
  type Item,
  type MachineControl,
  type MinEnv,
  type MinimalSearchAnswer,
  type Ret,
  type St,
  type Stack,
  type StackCons,
  type World,
} from "./eval/machine";
// The minimal MeTTa interpreter and type-directed evaluator: a faithful port of LeaTTa
// `MettaHyperonFull/Minimal/Interpreter.lean` (itself a port of Hyperon `interpreter.rs`).
// A CPS nondeterministic stack machine over the minimal instructions, with `mettaEval` (the
// type-directed metta-call loop) on top. The driver is iterative to keep the JS stack shallow.

// Constructor / normal-form short-circuit, on by default. `METTA_CTOR_SC=0` disables it for A/B measurement.
const CTOR_SC = readEnv("METTA_CTOR_SC") !== "0";
// Internal A/B gate for the `(case (match ...) cases)` streaming path. Default on; `0` restores the
// materializing stdlib expansion in one binary.
const STREAM_CASE = readEnv("METTA_STREAM_CASE") !== "0";

// ---------- generator-based evaluation (sync core, optional async) ----------

// ---------- machine types ----------
interface ItemSource {
  readonly endState: St;
  foldItems(): Iterable<Item>;
}
type ItemBatch = Item[] | ItemSource;
function isItemSource(work: Item[] | ItemSource): work is ItemSource {
  return !Array.isArray(work);
}

const emptyA = sym("Empty");
const collapsedEmptyA = expr([sym(",")]);
const collapsedEmptySpellings: readonly Atom[] = [emptyExpr, collapsedEmptyA];
const unitA = emptyExpr;
const errAtom = (a: Atom, msg: string): Atom => expr([sym("Error"), a, sym(msg)]);

// ---------- atom destructuring helpers ----------

// ---------- control admission ----------

// ---------- env (MinEnv) ----------

// ---------- higher-order specialization (after PeTTa's src/specializer.pl) ----------

// ---------- world + state ----------

export function createAsyncEvaluationSession(env: MinEnv): AsyncEvaluationSession {
  const root = rootEvaluationEnvironment(env);
  let program = acquirePinnedProgram(root);
  let closed = false;

  const refresh = (): void => {
    if (program.isCurrent()) return;
    program.release();
    program = acquirePinnedProgram(root);
  };

  const evaluate = (
    fuel: number,
    state: St,
    bindings: Bindings,
    atom: Atom,
    signal: AbortSignal | undefined,
    copyWorld: boolean,
  ): Promise<[Array<[Atom, Bindings]>, St]> => {
    if (closed) return Promise.reject(new Error("async evaluation session is closed"));
    ensureCompiled(root, atom);
    refresh();
    const pinnedState = copyWorld
      ? { counter: state.counter, world: cloneWorld(state.world) }
      : state;
    const selected = selectPinnedProgramEnvironment(env, root, program.env, pinnedState.world);
    return runGenAsync(mettaEvalG(selected, fuel, pinnedState, bindings, atom), signal).catch(
      (error: unknown) => {
        if (isNativeStackOverflow(error))
          return stackOverflowResult(selected, pinnedState, bindings, atom);
        throw error;
      },
    );
  };

  return {
    evaluate: (fuel, state, bindings, atom, signal) =>
      evaluate(fuel, state, bindings, atom, signal, true),
    evaluateOwned: (fuel, state, bindings, atom, signal) =>
      evaluate(fuel, state, bindings, atom, signal, false),
    isCurrent: () => !closed && program.isCurrent(),
    close: () => {
      if (closed) return;
      closed = true;
      program.release();
    },
  };
}

// ---------- concurrent world merge (for `par`) ----------

async function runWithMutexAsync(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  name: string,
  body: Atom,
  signal: AbortSignal,
): Promise<EvalRes> {
  const prior = env.mutexes.get(name) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // A lock node never rejects. A cancelled waiter resolves its node without entering the body, so later
  // waiters still remain behind the current holder and the queue cannot become poisoned.
  const chained = prior.then(
    () => held,
    () => held,
  );
  env.mutexes.set(name, chained);
  try {
    await awaitWithSignal(prior, signal);
    signal.throwIfAborted();
    return await mettaEvalAsyncOwned(env, fuel, state, bindings, body, signal);
  } finally {
    release();
    void chained.then(() => {
      if (env.mutexes.get(name) === chained) env.mutexes.delete(name);
    });
  }
}

// ---------- query + eval ops ----------

// Does any `=` rule in scope reduce `a`? Used to let a program's own definition win over a PeTTa-compat
// grounded op of the same name (those ops are a fallback, not an override).
function hasRuleFor(env: MinEnv, w: World, counter: number, a: Atom): boolean {
  for (const [lhs, rhs] of candidatesW(env, w, a)) {
    const [fl] = freshenRule(counter, lhs, rhs, branchVariableNamespace(w));
    if (matchAtoms(fl, a).length > 0) return true;
  }
  return false;
}

function* closeMinimalGroundedV2G(
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

function mettaCallSchedule(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  atom: Atom,
): DualModeSearchCursor<MinimalSearchAnswer, St> {
  return new DualModeSearchCursor(
    "metta",
    () => createMettaSearchCursor(env, atom, { fuel, state, bindings }),
    () =>
      ownedAsyncSearchCursor("metta", env, atom, { fuel, state, bindings }, contextualCursorAnswer),
  );
}

function* closeMinimalMettaCallG(
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
function* resumeMinimalMettaCallG(
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

function* resumeMinimalGroundedV2G(
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

function* startMinimalGroundedV2G(
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

function* reduceGroundedV2ApplicationG(
  registration: GroundedOperationV2Registration,
  env: MinEnv,
  fuel: number,
  st: St,
  partB: Bindings,
  callBindings: Bindings,
  wApp: ExprAtom,
  operation: string,
  originalArgs: readonly Atom[],
  groundedArgs: readonly Atom[],
  queryVars: readonly string[],
  opReturnsAtom: boolean,
  cursor?: CursorMode,
  emitter?: MettaAnswerEmitter,
): Gen<[Array<[Atom, Bindings]>, St]> {
  const policy = registration.options.effects;
  if (groundedEffectRejected(st.world, policy))
    return [
      [
        [
          errTextAtom(
            wApp,
            `${operation}: irreversible effect is not allowed in an isolated branch`,
          ),
          partB,
        ],
      ],
      st,
    ];
  const call = createGroundedV2Call(env, st.world, operation, originalArgs, callBindings);
  let answers: GroundedAnswerCursor | undefined;
  let isolation: StreamingIsolatedBranches | undefined;
  let current = st;
  const out: Array<[Atom, Bindings]> = [];
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  try {
    const context = call.context(NEVER_ABORTED_SIGNAL);
    const start = yield* startGroundedV2G(
      registration,
      st.world,
      operation,
      groundedArgs,
      call,
      wApp,
    );
    recordGroundedOperationEffects(st.world, operation, policy, []);
    if (start.tag === "host-fault") throw start.fault;
    if (start.tag === "language-error") {
      const error = checkedGroundedLanguageError(start.error, call, context, wApp);
      consumeGroundedPayloadResources(current.world, operation, [error], true);
      return [[[error, partB]], current];
    }
    if (start.tag === "stuck")
      return yield* finishDirectGroundedApplicationG(
        env,
        fuel,
        current,
        partB,
        wApp,
        queryVars,
        opReturnsAtom,
        { tag: "noReduce" },
        cursor,
        emitter,
      );
    answers = start.answers;
    if (answers.mode !== registration.options.mode)
      throw groundedV2Fault(
        "grounded-start",
        new TypeError(
          `${operation}: ${registration.options.mode} operation returned ${answers.mode} cursor`,
        ),
        call,
        wApp,
      );
    checkGroundedEffectsScope(start.preEffects, call, context, wApp);
    const instantiatedPreEffects = instantiateReduceEffects(call.frame, start.preEffects);
    consumeGroundedPayloadResources(
      current.world,
      operation,
      reduceEffectAtoms(instantiatedPreEffects),
      false,
    );
    const preEffects = applyReduceEffects(env, current, partB, instantiatedPreEffects);
    if (preEffects.tag === "error") return [[[errAtom(wApp, preEffects.msg), partB]], current];
    current = preEffects.state;
    isolation = beginStreamingIsolatedBranches(current, emitter?.accept !== undefined);
    if (isolation !== undefined) current = isolation.parent;

    for (;;) {
      const event = yield* pullGroundedV2G(answers, current.world, operation, call, wApp, cursor);
      consumeWorldResource(current.world, "steps", event.steps, `${operation}-pull`);
      yield* chargeSchedulerStepsG(cursor, current, event.steps);
      if (event.kind === "pending") continue;
      if (event.kind === "exhausted") {
        if (isolation !== undefined) current = finishStreamingIsolatedBranches(env, isolation);
        return [out, current];
      }
      if (event.kind === "cancelled")
        throw {
          kind: "cancelled",
          reason: event.reason,
          bindings: call.frame,
          subject: wApp,
          trace: call.trace,
        };
      if (event.kind === "fault") throw groundedV2Fault("grounded-next", event.error, call, wApp);

      const prepared = prepareGroundedAnswer(env, event.value, call, context, wApp, queryVars);
      if (prepared.kind === "conflict") continue;
      const resultAtom = prepared.value.atom;
      consumeGroundedPayloadResources(current.world, operation, prepared.value.resourceAtoms, true);
      if (isolation !== undefined) current = allocateStreamingIsolatedBranch(isolation);
      const answerBindings = prepared.value.bindings;
      const applied = applyReduceEffects(env, current, answerBindings, prepared.value.effects);
      const emittedAtStart = emitter?.emittedCount ?? 0;
      const omittedAtStart = emitter?.omittedReturnCount ?? 0;
      let reduced: Array<[Atom, Bindings]>;
      if (applied.tag === "error") {
        reduced = [[errAtom(wApp, applied.msg), answerBindings]];
      } else if (opReturnsAtom && !isEmbeddedOp(resultAtom)) {
        current = applied.state;
        reduced = [[resultAtom, answerBindings]];
      } else if (isErrorAtom(resultAtom)) {
        current = applied.state;
        reduced = [[resultAtom, answerBindings]];
      } else {
        current = applied.state;
        [reduced, current] = yield* mettaEvalG(
          env,
          fuel - 1,
          current,
          answerBindings,
          resultAtom,
          cursor,
          emitter,
        );
      }
      const returned = reduced.map((pair): [Atom, Bindings] => [
        pair[0],
        mergeRestrict(env, queryVars, answerBindings, pair[1]),
      ]);
      if (emitter?.retainReturnedAnswers !== false) out.push(...returned);
      if (emitter !== undefined)
        current = yield* forwardReturnedMettaAnswersG(
          emitter,
          returned,
          current,
          emittedAtStart,
          omittedAtStart,
        );
      if (isolation !== undefined) {
        recordStreamingIsolatedTerminal(isolation, current);
        current = isolation.parent;
      }
    }
  } catch (error) {
    unwind.active = true;
    unwind.error = error;
    throw error;
  } finally {
    try {
      if (answers !== undefined) yield* closeGroundedV2G(answers, operation, call, wApp, unwind);
    } finally {
      releaseStreamingIsolatedBranches(isolation);
      call.close();
    }
  }
}

function* evalOpG(
  env: MinEnv,
  st: St,
  prev: Stack,
  x: Atom,
  b: Bindings,
  cursor?: CursorMode,
): Gen<[Item[], St]> {
  const x2 = inst(env, b, x);
  const op = opOf(x2);
  if (op === "collapse" && x2.kind === "expr" && x2.items.length === 2) {
    const match = matchInsideOnce(x2.items[1]!);
    if (match !== undefined) {
      const namedMatch = tryFastNamedOnceMatch(env, st, match, b);
      if (namedMatch !== undefined) {
        const items = namedMatch.value === undefined ? [] : [namedMatch.value];
        return [[evalResult(prev, expr([sym(","), ...items]), b)], namedMatch.state];
      }
    }
  }
  if (op === "if" && x2.kind === "expr" && x2.items.length === 4) {
    const added = tryFastNamedAddIfAbsent(env, st, x2, b);
    if (added !== undefined) {
      const out = added.added ? [finItem(prev, emptyExpr, b)] : [];
      return [out, added.state];
    }
  }
  // A PeTTa-compat grounded op (length, sort, append, …) defers to a user `=` rule of the same head, so the
  // stdlib never shadows a program's own definition; every other grounded op applies eagerly as before.
  const useGrounded =
    op !== undefined &&
    x2.kind === "expr" &&
    !(pettaOpNames.has(op) && hasRuleFor(env, st.world, st.counter, x2));
  if (useGrounded) {
    let args = x2.items
      .slice(1)
      .map((a) => resolveStates(st.world, subTokens(st.world, a, env.intern)));
    if (op === "repr" && args.length === 1)
      args = [partialApplicationView(env, st.world, args[0]!)];
    const effectPolicy = groundedEffectPolicy(env, op!);
    if (groundedEffectRejected(st.world, effectPolicy))
      return [
        [
          finItem(
            prev,
            errTextAtom(x2, `${op}: irreversible effect is not allowed in an isolated branch`),
            b,
          ),
        ],
        st,
      ];
    const groundedV2 = groundedV2For(env, op!);
    if (groundedV2 !== undefined)
      return yield* startMinimalGroundedV2G(
        groundedV2,
        env,
        st,
        prev,
        x2,
        op!,
        x.kind === "expr" ? x.items.slice(1) : x2.items.slice(1),
        args,
        b,
        cursor,
      );
    const r = yield* callGroundedG(env, st.world, op!, args);
    if (r.tag === "ok") {
      recordGroundedOperationEffects(st.world, op!, effectPolicy, r.results);
      const effects = applyReduceEffects(env, st, b, r.effects);
      if (effects.tag === "error") return [[finItem(prev, errAtom(x2, effects.msg), b)], st];
      return [r.results.map((res) => evalResult(prev, res, b, x2)), effects.state];
    }
    if (r.tag === "runtimeError") return [[finItem(prev, errAtom(x2, r.msg), b)], st];
    if (r.tag === "incorrectArgument") return [[finItem(prev, errTextAtom(x2, r.msg), b)], st];
    // noReduce
  }
  // Executable grounded-atom head: `(<gnd-with-exec> arg...)`. This is what makes a grounded operation
  // produced at runtime (e.g. `(bind! abs (op-atom ...))` then `(abs -5)`, or the js-* interop) callable
  // in-language, the TS-native analogue of Python's py-atom/OperationAtom. The interpreter dispatches
  // built-in ops by symbol; this dispatches by the head atom's own `exec`.
  if (x2.kind === "expr" && x2.items.length > 0) {
    const head = x2.items[0]!;
    if (head.kind === "gnd" && head.exec !== undefined) {
      const groundedV2 = groundedV2Registration(head.exec);
      const effectPolicy: GroundedEffectPolicy = groundedV2?.options.effects ?? {
        classes: ["host-io"],
        speculative: false,
      };
      if (groundedEffectRejected(st.world, effectPolicy))
        return [
          [
            finItem(
              prev,
              errTextAtom(
                x2,
                "<grounded-exec>: irreversible effect is not allowed in an isolated branch",
              ),
              b,
            ),
          ],
          st,
        ];
      const args = x2.items
        .slice(1)
        .map((a) => resolveStates(st.world, subTokens(st.world, a, env.intern)));
      if (groundedV2 !== undefined)
        return yield* startMinimalGroundedV2G(
          groundedV2,
          env,
          st,
          prev,
          x2,
          "<grounded-exec>",
          x.kind === "expr" ? x.items.slice(1) : x2.items.slice(1),
          args,
          b,
          cursor,
        );
      pendingAsyncOpBox.op = "<grounded-exec>";
      type GroundedExecResult =
        | { readonly tag: "ok"; readonly results: readonly Atom[] }
        | { readonly tag: "error"; readonly message: string };
      const settled = (yield driverEffect(
        "<grounded-exec>",
        (): GroundedExecResult => {
          let results: readonly Atom[] | Promise<readonly Atom[]>;
          try {
            results = head.exec!(args, groundedCallContext(env, st.world));
          } catch (error) {
            if (isWorkerQuiescenceError(error)) throw error;
            return {
              tag: "error",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          if (isPromiseLike(results)) throw new AsyncInSyncError("<grounded-exec>");
          return { tag: "ok", results };
        },
        async (signal): Promise<GroundedExecResult> => {
          try {
            const results = await head.exec!(
              args,
              signal === NEVER_ABORTED_SIGNAL
                ? groundedCallContext(env, st.world)
                : groundedCallContextWithSignal(env, st.world, signal),
            );
            signal.throwIfAborted();
            return { tag: "ok", results };
          } catch (error) {
            if (isWorkerQuiescenceError(error)) throw error;
            signal.throwIfAborted();
            return {
              tag: "error",
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
      )) as GroundedExecResult;
      if (settled.tag === "error") return [[finItem(prev, errAtom(x2, settled.message), b)], st];
      recordGroundedOperationEffects(st.world, "<grounded-exec>", effectPolicy, settled.results);
      return [settled.results.map((res) => evalResult(prev, res, b, x2)), st];
    }
  }
  if (isEmbeddedOp(x2)) return [[{ stack: admitAtom(x2, prev), bnd: b }], st];
  return queryOp(env, st, prev, x2, b);
}

// ---------- final-item helpers ----------
function finalPair(env: MinEnv, it: Item): ContextualPair {
  const f = it.stack;
  const selected = it.evaluationScope?.env;
  const active = selected ?? env;
  return f === null
    ? selected === undefined
      ? [emptyA, []]
      : [emptyA, [], selected]
    : selected === undefined
      ? [inst(active, it.bnd, f.head.atom), it.bnd]
      : [inst(active, it.bnd, f.head.atom), it.bnd, selected];
}
function exhaustedPair(env: MinEnv, it: Item): ContextualPair {
  const f = it.stack;
  const selected = it.evaluationScope?.env;
  const active = selected ?? env;
  const atom =
    f === null
      ? emptyA
      : makeExpr(active, [sym("Error"), inst(active, it.bnd, f.head.atom), sym("StackOverflow")]);
  return selected === undefined ? [atom, it.bnd] : [atom, it.bnd, selected];
}

function partialApplicationView(env: MinEnv, w: World, atom: Atom): Atom {
  if (atom.kind !== "expr" || atom.items.length < 2) return atom;
  const head = atom.items[0]!;
  if (head.kind !== "sym") return atom;
  const args = atom.items.slice(1);
  const arity = functionArity(env, w, head.name);
  if (arity === undefined || args.length >= arity) return atom;
  return makeExpr(env, [sym("partial"), head, makeExpr(env, args)]);
}

// ---------- types ----------

/** The type(s) reported by the user-facing `get-type` op. Same as `getTypes`, but with hyperon's tuple
 *  case: when an expression's head is not a function, the whole expression is a tuple and its type is the
 *  tuple of its elements' types, e.g. `(a b)` with `a:A`, `b:B` is `(A B)`. When an element has SEVERAL
 *  types the result is the cartesian product, one tuple type per combination (hyperon types.rs:
 *  `get_atom_types((a b))` is `[(A B), (B B)]` when `a:{A,B}`). This is kept out of `getTypes` itself
 *  because that drives type-directed argument evaluation, which must stay conservative (%Undefined%) for an
 *  ordinary tuple expression rather than invent a tuple type. */
function getTypesForQuery(env: MinEnv, w: World, a: Atom): Atom[] {
  return getTypesForQueryWithView(env, w, typeViewFor(env, w), a);
}

function getTypesForQueryWithView(env: MinEnv, w: World, view: TypeView, a: Atom): Atom[] {
  const base = getTypesWithView(env, view, a);
  if (a.kind !== "expr" || a.items.length === 0) return base;
  if (base.length > 0 && !base.every((t) => atomEq(t, UNDEF))) return base;
  const f = a.items[0]!;
  if (f.kind === "sym" && isDefinedHead(env, w, f.name)) return base;
  if (getTypesWithView(env, view, f).some((t) => opOf(t) === "->")) return base;
  // Cartesian product of each element's type list, building one tuple type per combination.
  let combos: Atom[][] = [[]];
  for (const x of a.items) {
    const ts = getTypesForQueryWithView(env, w, view, x);
    const opts = ts.length > 0 ? ts : [UNDEF];
    const next: Atom[][] = [];
    for (const combo of combos) for (const t of opts) next.push([...combo, t]);
    combos = next;
  }
  return combos.map((c) => makeExpr(env, c));
}

function typeCheckArgs(
  env: MinEnv,
  w: World,
  argTypes: readonly Atom[],
  i: number,
  tb: Bindings,
  argsLeft: readonly Atom[],
  view: TypeView = typeViewFor(env, w),
): [number, Atom, Atom] | undefined {
  if (argsLeft.length === 0) return undefined;
  const ti0 = argTypes[i];
  if (ti0 === undefined) return undefined;
  const ti = inst(env, tb, ti0);
  // A top parameter type (`Atom`/`%Undefined%`) accepts any argument, so the argument is well-typed
  // without inferring its type. Checking this by name first skips both `typePrep` and `getTypes`, each an
  // O(term-size) walk, on the very common case (e.g. `add-atom`'s `Atom` parameter). Without it, adding
  // deeply-nested terms re-walks each one every time and turns add-heavy programs quadratic.
  if (ti.kind === "sym" && (ti.name === "Atom" || ti.name === "%Undefined%"))
    return typeCheckArgs(env, w, argTypes, i + 1, tb, argsLeft.slice(1), view);
  const ai = argsLeft[0]!;
  const prepped = typePrep(env, w, ai);
  // Hyperon `check_arg_types` (types.rs): an argument satisfies a parameter whose type names the
  // argument's meta-type (`meta.contains(expected)`), checked before any declared/inferred type. So a
  // computed expression like `(+ 5 5)` (inferred value-type Number, meta-type Expression) satisfies an
  // `Expression` parameter. Without this, ops with meta-typed parameters (lib_he's `evalc`/`noreduce-eq`,
  // `map-atom`) wrongly raise BadArgType on unevaluated expression arguments.
  if (ti.kind === "sym" && ti.name === metaType(prepped))
    return typeCheckArgs(env, w, argTypes, i + 1, tb, argsLeft.slice(1), view);
  const actuals = getTypesWithView(env, view, prepped);
  for (const act of actuals) {
    const tb2 = matchType(tb, ti, act);
    if (tb2 !== undefined)
      return typeCheckArgs(env, w, argTypes, i + 1, tb2, argsLeft.slice(1), view);
  }
  return [i + 1, ti, headOr(actuals, UNDEF)];
}
function typeMismatch(
  env: MinEnv,
  w: World,
  op: string,
  args: readonly Atom[],
  ts?: Atom[],
): [number, Atom, Atom] | undefined {
  const view = typeViewFor(env, w);
  if (arguments.length < 5) ts = view.sigs.get(op);
  if (ts === undefined) return undefined;
  return typeCheckArgs(env, w, ts.slice(0, -1), 0, [], args, view);
}

export function checkApplication(
  env: MinEnv,
  w: World,
  op: string,
  args: readonly Atom[],
  opSig?: Atom[],
): Atom | null {
  const view = typeViewFor(env, w);
  if (arguments.length < 5) opSig = view.sigs.get(op);
  if (skipApplicationCheck(op, args)) return null;
  const strictErr = strictArityError(op, args);
  if (strictErr !== null) return strictErr;
  // Hyperon `interpret_expression`/`check_if_function_type_is_applicable` (interpreter.rs): when the
  // operator's only types are function types and none applies because the argument count differs from
  // the parameter count, the call reduces to `(Error <call> IncorrectNumberOfArguments)`. Confirmed by
  // Hyperon's own tests: `(foo b c)` and `(add-reducts k1)` both yield it. The reference LeaTTa binary
  // lacks this check (it leaves such calls unreduced); Hyperon is the authority here. A signature
  // `[param1 ... paramN, return]` has `length - 1` parameters. Skip when the operator also has a
  // non-function (tuple) type, matching Hyperon's `has_tuple_type` fallback. The eval loop passes a
  // precomputed `opSig` it then reuses for partial application, so the signature is looked up once per
  // application.
  if (opSig !== undefined && opSig.length >= 1 && args.length !== opSig.length - 1) {
    const hasTupleType = (view.types.get(op) ?? []).some((t) => opOf(t) !== "->");
    // PeTTa-style partial application is allowed for grounded ops. User-declared typed functions keep
    // Hyperon's strict arity errors.
    const underAppliedPartial =
      env.gt.has(op) && args.length >= 1 && args.length < opSig.length - 1;
    if (!hasTupleType && !underAppliedPartial)
      return expr([sym("Error"), expr([sym(op), ...args]), sym("IncorrectNumberOfArguments")]);
  }
  const mm = typeMismatch(env, w, op, args, opSig);
  if (mm !== undefined) {
    const [pos, expected, actual] = mm;
    return expr([
      sym("Error"),
      expr([sym(op), ...args]),
      expr([sym("BadArgType"), gint(pos), expected, actual]),
    ]);
  }
  return null;
}

// ---------- conjunctive match ----------
/** Candidate `&self` atoms that could match a (instantiated) pattern, using the functor index. A
 *  functor-headed pattern only scans atoms with that head key plus the variable-headed atoms (which can
 *  unify with any functor); a variable-headed pattern must scan everything. State atoms are resolved
 *  only when the world actually holds state. This is what turns a linear `match` into an indexed one. */
function matchCandidates(
  env: MinEnv,
  w: World,
  pInst: Atom,
  allowNested: boolean,
): CandidateSource {
  const k = headKey(pInst);
  if (k === undefined) {
    return {
      *[Symbol.iterator](): Iterator<Atom> {
        // A variable-headed pattern must consider everything.
        for (const atom of resolveAll(w, visibleStaticAtoms(w, env.atoms))) yield atom;
        yield* runtimeCandidates(w, undefined);
      },
    };
  }
  const headCandidates = env.factIndex.get(k) ?? [];
  const nestedMatchIndex = env.nestedMatchIndex;
  // Skipping a failed non-ground candidate changes the suffix used to freshen later facts. Restrict nested
  // indexing to a ground, state-free candidate domain and restore the skipped attempts through counterPadding.
  // Leaf indexing keeps its established admission and counter behavior.
  const nestedIndexSafe =
    allowNested &&
    nestedMatchIndex !== undefined &&
    !nestedMatchIndex.nonGroundFactHeads.has(k) &&
    env.varHeadedFacts.length === 0 &&
    w.removedStatic === null &&
    w.store.size === 0 &&
    w.selfExtra === null &&
    (w.flatSelfExtra?.size ?? 0) === 0;
  // Pick the most selective eligible argument position. Nested buckets include custom grounded matchers
  // from the residual bucket, then merge by source occurrence id.
  let bestKey: string | undefined;
  let bestPosKey: string | undefined;
  let bestIsNested = false;
  let bestSize = Infinity;
  const hasLeafConstraint =
    pInst.kind === "expr" &&
    pInst.items.slice(1).some((argument) => argKey(argument) !== undefined);
  if (pInst.kind === "expr")
    for (let i = 1; i < pInst.items.length; i++) {
      const argument = pInst.items[i]!;
      const posKey = k + KEY_SEP + i;
      const ak = argKey(argument);
      if (ak !== undefined) {
        const ik = k + KEY_SEP + i + KEY_SEP + ak;
        const size =
          (env.argIndex.get(ik)?.length ?? 0) + (env.nonGroundAtPos.get(posKey)?.length ?? 0);
        if (size < bestSize) {
          bestSize = size;
          bestKey = ik;
          bestPosKey = posKey;
          bestIsNested = false;
        }
      }

      // The established leaf source yields exact values before residual custom matchers. Keep that source
      // whenever a leaf constraint exists so adding a nested constraint cannot reorder successful matches.
      const nestedHead =
        nestedIndexSafe && !hasLeafConstraint ? nestedArgHead(argument) : undefined;
      if (nestedHead !== undefined) {
        const ik = k + KEY_SEP + i + KEY_SEP + nestedHead;
        const size =
          (nestedMatchIndex!.byHead.get(ik)?.length ?? 0) +
          (nestedMatchIndex!.wildcardAtPos.get(posKey)?.length ?? 0);
        if (size < bestSize && size < headCandidates.length) {
          bestSize = size;
          bestKey = ik;
          bestPosKey = posKey;
          bestIsNested = true;
        }
      }
    }
  let cands: Atom[];
  let counterPadding = 0;
  if (bestKey !== undefined) {
    if (bestIsNested) {
      cands = orderedIndexedAtoms(
        env,
        nestedMatchIndex!.byHead.get(bestKey) ?? [],
        nestedMatchIndex!.wildcardAtPos.get(bestPosKey!) ?? [],
      );
      counterPadding = headCandidates.length - cands.length;
    } else {
      // Retain the established leaf-index order: exact candidates, then the residual bucket.
      cands = [
        ...(env.argIndex.get(bestKey) ?? []),
        ...(env.nonGroundAtPos.get(bestPosKey!) ?? []),
      ];
    }
  } else {
    // no bound argument position: the whole functor bucket.
    cands = headCandidates.slice();
  }
  cands.push(...env.varHeadedFacts);
  if (w.removedStatic !== null) cands = cands.filter((a) => !staticAtomRemoved(w, a));
  const iterate = function* (): Iterator<Atom> {
    // A ground pattern over a ground runtime log is an exact-membership query. The pattern itself is the
    // only runtime atom that can match, so yield that many copies instead of scanning the log.
    if (
      pInst.ground &&
      logNonGround(w.selfExtra) === 0 &&
      (w.flatSelfExtra?.nonGroundCount ?? 0) === 0 &&
      w.store.size === 0
    ) {
      const c = w.selfExtra === null ? 0 : idxCount(logGroundIdx(w.selfExtra), pInst);
      for (const atom of cands) yield atom;
      const flatCount = w.flatSelfExtra?.exactCount(pInst) ?? 0;
      for (let i = 0; i < c + flatCount; i++) yield pInst;
      return;
    }
    for (const atom of resolveAll(w, cands)) yield atom;
    yield* runtimeCandidates(w, k, pInst);
  };
  return counterPadding === 0
    ? { [Symbol.iterator]: iterate }
    : { counterPadding, [Symbol.iterator]: iterate };
}

function matchConj(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  sols: Bindings[],
): [Bindings[], St] {
  let cur = sols;
  let counter = st.counter;
  for (const p of patterns) {
    const next: Bindings[] = [];
    for (const b of cur) {
      const pInst = inst(env, b, p);
      const source = getCandidates(pInst);
      for (const atom of source) {
        const atom2 = freshenRule(counter, atom, atom, branchVariableNamespace(st.world))[0];
        counter += 1;
        for (const mb of matchAtoms(pInst, atom2))
          for (const m of merge(b, mb)) if (!hasLoop(m)) next.push(m);
      }
      counter += candidateCounterPadding(source);
    }
    cur = next;
  }
  return [cur, { counter, world: st.world }];
}

// Conjunctive `match` via a worst-case-optimal join. A conjunct whose every candidate match binds all
// its variables to ground terms (e.g. the `(N != M)` constraint facts) becomes a relation joined by
// `wcoJoin`, which is AGM-bounded and avoids the nested loop's intermediate cross-product blowup (a
// triangle of `!=` constraints is N^1.5, not N^2, the difference between finishing and not on the
// permutations benchmark). Conjuncts whose matches bind variables to variables (templates like
// `(E $a ... $state)`) are threaded by the nested loop over each WCO solution, where the join variables
// are already ground. Degrades to the plain nested loop when no conjunct is ground-relational, so it is
// only used for `(, ...)` with two or more goals (single-pattern match keeps its scan order).
// Split the conjunction goals into ground-relational factors (joined AGM-optimally by wcoJoin) and the
// non-ground tail, advancing the freshening counter. Shared by matchConjJoin (which materializes the join)
// and matchConjCount (which folds it), so neither duplicates the wcoJoin setup.
function splitConjGoals(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
  perPositionAdmit: boolean,
): {
  groundRels: Array<Relation<Atom>>;
  otherPatterns: Atom[];
  counter: number;
} {
  let counter = st.counter;
  const insts = patterns.map((p) => inst(env, b0, p));
  const pvarsList = insts.map((pInst) => atomVars(pInst));
  // Join variables: a query var shared by two or more goals (the leapfrog's intersection keys). Under the
  // unify-capable per-position admission, a schematic fact binding a join variable to a non-ground term is
  // the one case a column-wise leapfrog fabricates answers (the mork-uni-join witness), so it declines; a
  // non-ground binding at a non-join position is a free output column the join just enumerates, so it rides
  // the fast path. Without per-position routing (the result path, where answer order is observable), any
  // non-ground value declines, keeping the conservative split byte-identical.
  let joinVars: Set<string> | undefined;
  if (perPositionAdmit) {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const pvars of pvarsList)
      for (const v of new Set(pvars)) (seen.has(v) ? shared : seen).add(v);
    joinVars = shared;
  }
  const groundRels: Array<Relation<Atom>> = [];
  const otherPatterns: Atom[] = [];
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i]!;
    const pvars = pvarsList[i]!;
    if (pvars.length === 0) {
      otherPatterns.push(p); // fully-ground existence check: cheap, leave to the nested loop
      continue;
    }
    const pInst = insts[i]!;
    const tuples: Array<Map<string, Atom>> = [];
    let relational = true;
    const source = getCandidates(pInst);
    for (const atom of source) {
      const fresh = freshenRule(counter, atom, atom, branchVariableNamespace(st.world))[0];
      counter += 1;
      for (const mb of matchAtoms(pInst, fresh)) {
        const t = new Map<string, Atom>();
        for (const v of pvars) {
          const val = lookupVal(mb, v) ?? variable(v);
          t.set(v, val);
          if (!val.ground && (joinVars === undefined || joinVars.has(v))) relational = false;
        }
        tuples.push(t);
      }
    }
    counter += candidateCounterPadding(source);
    if (relational) groundRels.push({ vars: pvars, tuples });
    else otherPatterns.push(p);
  }
  return { groundRels, otherPatterns, counter };
}

// The join phase for matchConjJoin: split the goals, then materialize the wcoJoin solutions as binding sets.
function conjJoinPartials(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): { partials: Bindings[]; otherPatterns: Atom[]; counter: number } {
  const { groundRels, otherPatterns, counter } = splitConjGoals(
    env,
    getCandidates,
    patterns,
    st,
    b0,
    // Result path: admit schematic facts at non-join positions to the leapfrog only when the fast matcher is
    // on. The leapfrog reorders results and freshens differently, so an admitted schematic goal makes the
    // answer alpha-equivalent (not byte-identical) to the coupled path; the default (trail off) keeps the
    // conservative all-ground gate, so the byte-identical reference order holds and the oracle is unaffected.
    env.useTrail === true,
  );
  let partials: Bindings[];
  if (groundRels.length > 0) {
    partials = [];
    for (const sol of wcoJoin(groundRels, mutexKey)) {
      let bs: Bindings[] = [b0];
      for (const [v, val] of sol) {
        const nb: Bindings[] = [];
        for (const b of bs) nb.push(...addVarBinding(b, v, val));
        bs = nb;
      }
      for (const b of bs) if (!hasLoop(b)) partials.push(b);
    }
  } else {
    partials = [b0];
  }
  return { partials, otherPatterns, counter };
}

function matchConjJoin(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): [Bindings[], St] {
  const {
    partials,
    otherPatterns,
    counter: c0,
  } = conjJoinPartials(env, getCandidates, patterns, st, b0);
  let cur = partials;
  let counter = c0;
  for (const p of otherPatterns) {
    const next: Bindings[] = [];
    // The same candidate facts are matched against every WCO solution; a fact's freshened copies differ
    // only in their fresh variable names, which each match binds independently inside its own result. So
    // freshen each fact once and reuse it across solutions. Freshening (a full term copy for a
    // template-shaped fact) is the allocation-heavy part of the emit and was being redone per result. The
    // cache is per-conjunct, so distinct conjuncts that match the same fact still get distinct fresh vars.
    const freshCache = new Map<Atom, Atom>();
    for (const b of cur) {
      const pInst = inst(env, b, p);
      const source = getCandidates(pInst);
      const cache = syntheticCandidateSource(source) ? undefined : freshCache;
      for (const atom of source) {
        let fresh = cache?.get(atom);
        if (fresh === undefined) {
          fresh = freshenRule(counter, atom, atom, branchVariableNamespace(st.world))[0];
          counter += 1;
          cache?.set(atom, fresh);
        }
        for (const mb of matchAtoms(pInst, fresh))
          for (const m of merge(b, mb)) if (!hasLoop(m)) next.push(m);
      }
      counter += candidateCounterPadding(source);
    }
    cur = next;
  }
  return [cur, { counter, world: st.world }];
}

// Count a multi-goal conjunctive `match` without materializing its answers: run wcoJoin for the
// ground-relational goals (its partials are far fewer than the final answer set, ~40k vs ~360k for
// permutations), then count the remaining non-ground goals per partial on the zero-allocation trail. The
// count is name-independent, so it is byte-identical to counting matchConjJoin's solutions. Returns
// undefined to fall back when the trail tail declines (a custom grounded matcher, or the node budget).
function matchConjCount(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): { count: number; counter: number } | undefined {
  const {
    groundRels,
    otherPatterns,
    counter: c0,
    // Match the result path's admission gate (conjJoinPartials) so the fold and the materializing count split
    // goals identically and advance the gensym counter in lockstep: the conservative all-ground split by
    // default (byte-identical, the reference the corpus pins), the per-position unify-capable admission only
    // under experimental.trail (where the result path also admits, so both stay consistent).
  } = splitConjGoals(env, getCandidates, patterns, st, b0, env.useTrail === true);
  // No ground-relational goal: there is no join to fold, so count the whole (non-ground) conjunction on a
  // single trail seeded from b0.
  if (groundRels.length === 0) {
    for (const p of patterns) if (atomHasCustomGrounded(p)) return undefined;
    return countTrailDFS(
      seededTrail(b0),
      getCandidates,
      patterns,
      c0,
      branchVariableNamespace(st.world),
    );
  }
  for (const p of otherPatterns) if (atomHasCustomGrounded(p)) return undefined;
  // One trail, synced to the wcoJoin descent: each join variable binds in place on the way down and undoes
  // on the way back up, so at every leaf the join's assignment is already on the trail and the non-ground
  // tail counts with zero per-leaf allocation (MORK's trie_join_count: aggregate without materializing).
  const tr = seededTrail(b0);
  // One freshen cache per tail goal, each shared across all join leaves: a tail candidate freshens once per
  // goal, but two goals matching the same stored fact get distinct fresh variables (see countTrailDFS).
  const tailFreshCaches = otherPatterns.map(() => new Map<Atom, Atom>());
  let counter = c0;
  let count = 0;
  let bailed = false;
  const marks: number[] = [];
  wcoJoinFold(groundRels, mutexKey, {
    onDescend: (v, val) => {
      marks.push(tr.mark());
      tr.bind(v, val);
    },
    onAscend: () => tr.undo(marks.pop()!),
    onLeaf: () => {
      if (bailed) return;
      if (otherPatterns.length === 0) {
        count += 1;
        return;
      }
      const tc = countTrailDFS(
        tr,
        getCandidates,
        otherPatterns,
        counter,
        branchVariableNamespace(st.world),
        tailFreshCaches,
      );
      if (tc === undefined) {
        bailed = true;
        return;
      }
      count += tc.count;
      counter = tc.counter;
    },
  });
  return bailed ? undefined : { count, counter };
}

// ---------- get-doc ----------
function getDocOf(env: MinEnv, w: World, atom: Atom): Atom {
  const atoms = selfAtoms(env, w);
  const view = typeViewFor(env, w);
  const ty =
    atom.kind === "sym"
      ? headOr(view.types.get(atom.name) ?? [], UNDEF)
      : (view.exprTypes.find((p) => atomEq(p[0], atom))?.[1] ?? UNDEF);
  const matchesDoc = (a: Atom): boolean =>
    opOf(a) === "@doc" && a.kind === "expr" && a.items.length >= 2 && atomEq(a.items[1]!, atom);
  // A program's own @doc (in its space) wins; the stdlib's @doc is kept out of the eval env and consulted
  // here as a fallback, so documentation never bloats a program's space.
  const doc = atoms.find(matchesDoc) ?? stdlibDocAtoms().find(matchesDoc);
  if (doc === undefined || doc.kind !== "expr") return sym("Empty");
  if (doc.items.length === 5) {
    const desc = doc.items[2]!;
    const paramsWrap = doc.items[3]!;
    const retWrap = doc.items[4]!;
    const params = paramsWrap.kind === "expr" ? paramsWrap.items[1] : undefined;
    const paramList = params && params.kind === "expr" ? params.items : [];
    const retDesc = retWrap.kind === "expr" ? retWrap.items[1]! : UNDEF;
    const n = paramList.length;
    let paramTys: Atom[];
    let retTy: Atom;
    if (opOf(ty) === "->" && ty.kind === "expr" && ty.items.length - 1 === n + 1) {
      const rest = ty.items.slice(1);
      paramTys = rest.slice(0, -1);
      retTy = rest[rest.length - 1]!;
    } else {
      paramTys = Array<Atom>(n).fill(UNDEF);
      retTy = UNDEF;
    }
    const params2 = paramList.map((pp, i) => {
      if (opOf(pp) === "@param" && pp.kind === "expr" && pp.items.length === 2)
        return expr([
          sym("@param"),
          expr([sym("@type"), paramTys[i] ?? UNDEF]),
          expr([sym("@desc"), pp.items[1]!]),
        ]);
      return pp;
    });
    return expr([
      sym("@doc-formal"),
      expr([sym("@item"), atom]),
      expr([sym("@kind"), sym("function")]),
      expr([sym("@type"), ty]),
      desc,
      expr([sym("@params"), expr(params2)]),
      expr([sym("@return"), expr([sym("@type"), retTy]), expr([sym("@desc"), retDesc])]),
    ]);
  }
  if (doc.items.length === 3) {
    return expr([
      sym("@doc-formal"),
      expr([sym("@item"), atom]),
      expr([sym("@kind"), sym("atom")]),
      expr([sym("@type"), ty]),
      doc.items[2]!,
    ]);
  }
  return sym("Empty");
}

// ---------- the step function ----------
function* interpretStack1G(
  env: MinEnv,
  fuel: number,
  st: St,
  it: Item,
  cursor?: CursorMode,
): Gen<[ItemBatch, St]> {
  env = refreshEvaluationEnvironment(env, st.world);
  if (it.groundedV2 !== undefined)
    return yield* resumeMinimalGroundedV2G(env, st, it.groundedV2, cursor);
  if (it.mettaCall !== undefined) return yield* resumeMinimalMettaCallG(st, it.mettaCall, cursor);
  if (it.stack === null) return [[], st];
  const top = it.stack.head;
  const prev = it.stack.tail;
  if (top.fin) {
    if (prev === null) return [[it], st];
    const pf = prev.head;
    const pprev = prev.tail;
    const res = inst(env, it.bnd, top.atom);
    if (pf.ret === "chain") {
      if (opOf(pf.atom) === "chain" && pf.atom.kind === "expr" && pf.atom.items.length === 4) {
        const v = pf.atom.items[2]!;
        const templ = pf.atom.items[3]!;
        const nf = frame(makeExpr(env, [sym("chain"), res, v, templ]), pf.ret, pf.vars, "execute");
        return [[{ stack: cons(nf, pprev), bnd: it.bnd }], st];
      }
      return [[finItem(pprev, errAtom(pf.atom, "chain: corrupt frame"), it.bnd)], st];
    }
    if (pf.ret === "function") {
      if (opOf(res) === "return" && res.kind === "expr" && res.items.length === 2)
        return [[finItem(pprev, res.items[1]!, it.bnd)], st];
      if (isEmbeddedOp(res)) return [[{ stack: admitAtom(res, cons(pf, pprev)), bnd: it.bnd }], st];
      const target = pf.callAtom ?? pf.atom;
      return [[finItem(pprev, errAtom(target, "NoReturn"), it.bnd)], st];
    }
    return [[], st]; // Ret.none on a finished non-top frame
  }
  const a = top.atom;
  const op = opOf(a);
  const it2 = a.kind === "expr" ? a.items : [];
  switch (op) {
    case "eval":
      if (it2.length === 2) return yield* evalOpG(env, st, prev, it2[1]!, it.bnd, cursor);
      break;
    case "evalc":
      if (it2.length === 3) {
        const requested = inst(env, it.bnd, it2[2]!);
        const selected = selectEvaluationEnvironment(env, st.world, requested, UNDEF);
        if (selected === undefined)
          return [[finItem(prev, errAtom(inst(env, it.bnd, a), "evalc: not a space"), it.bnd)], st];
        const [entered, next] = yield* evalOpG(selected, st, prev, it2[1]!, it.bnd, cursor);
        const evaluationScope: EvaluationScope = {
          env: selected,
          boundary: prev,
          ...(it.evaluationScope === undefined ? {} : { parent: it.evaluationScope }),
        };
        return [entered.map((item) => ({ ...item, evaluationScope })), next];
      }
      break;
    case "chain":
      if (it2.length === 4 && it2[2]!.kind === "var") {
        const continuations: Item[] = [];
        for (const cont of bindChainAnswer(it2[2]!, it2[1]!, it2[3]!)) {
          // The first-arg evaluation that produced it2[1] is finished, so its internal variables can no longer
          // be observed by anything but the continuation `cont` and the pending frames. Pruning the carried
          // binding to those keeps a deep `chain` tail-recursion (minimal-MeTTa `div` is the worst case) from
          // accumulating an O(n) binding that every later instantiate/merge re-scans. That cost made
          // `(div 350000 5 0)` quadratic. The full stack is visible here (unlike inside a reduce-loop arg
          // sub-evaluation), so the live set is complete; restrictBnd resolves transitively, so a value still
          // reachable through a dropped variable is flattened into what is kept rather than lost.
          const bnd = restrictBnd(env, chainLiveVars(cont, prev), it.bnd);
          continuations.push({ stack: admitAtom(cont, prev), bnd });
        }
        return [continuations, st];
      }
      break;
    case "unify":
      if (it2.length === 5)
        return [unifyOp(env, prev, it2[1]!, it2[2]!, it2[3]!, it2[4]!, it.bnd), st];
      break;
    case "cons-atom":
    case "decons-atom": {
      const result =
        op === "cons-atom" ? applyConsAtom(it2.slice(1)) : applyDeconsAtom(it2.slice(1));
      return [
        [finItem(prev, result.ok ? result.atom : errTextAtom(a, result.fault.message), it.bnd)],
        st,
      ];
    }
    case "context-space":
      if (it2.length === 1) return [[finItem(prev, activeSpaceAtom(env), it.bnd)], st];
      break;
    case "metta":
    case "metta-thread": {
      if (it2.length !== 4) break;
      const atom = it2[1]!;
      const expectedType = inst(env, it.bnd, it2[2]!);
      const requested = inst(env, it.bnd, it2[3]!);
      const selected = selectEvaluationEnvironment(env, st.world, requested, expectedType);
      if (selected === undefined)
        return [[finItem(prev, errAtom(inst(env, it.bnd, a), `${op}: not a space`), it.bnd)], st];
      // The `%Undefined%` form streams one answer per pull so a nested consumer such as `once`
      // can close the unvisited tail. A typed expected result stays on the batch path because its
      // check reads the world at completion time.
      if (
        cursor?.kind === "cooperative" &&
        atomEq(expectedType, UNDEF) &&
        !mettaReturnsInputForExpectedType(inst(selected, it.bnd, atom), expectedType)
      ) {
        const callerBnd = it.bnd;
        const scoped = op === "metta-thread" ? scopeVars(env, callerBnd, prev) : undefined;
        const project = (answer: MinimalSearchAnswer): Item[] => {
          if (scoped === undefined) return [finItem(prev, answer.atom, callerBnd)];
          const items: Item[] = [];
          for (const m of merge(callerBnd, restrictBnd(env, scoped, answer.bindings)))
            items.push(finItem(prev, answer.atom, m));
          return items;
        };
        const continuation: MinimalMettaCallContinuation = {
          operation: op,
          bnd: callerBnd,
          schedule: mettaCallSchedule(selected, fuel, st, callerBnd, atom),
          project,
          closed: false,
        };
        return yield* resumeMinimalMettaCallG(st, continuation, cursor);
      }
      const [pairs, st2] = yield* mettaEvalExpectedG(
        selected,
        fuel,
        st,
        it.bnd,
        atom,
        expectedType,
        nestedCursorMode(cursor),
      );
      if (op === "metta-thread") {
        const out: Item[] = [];
        const scoped = scopeVars(env, it.bnd, prev);
        for (const p of pairs)
          for (const m of merge(it.bnd, restrictBnd(env, scoped, p[1])))
            out.push(finItem(prev, p[0], m));
        return [out, st2];
      }
      return [pairs.map((p) => finItem(prev, p[0], it.bnd)), st2];
    }
    case "capture": {
      if (it2.length !== 2) break;
      const [pairs, st2] = yield* mettaEvalG(
        env,
        fuel,
        st,
        it.bnd,
        it2[1]!,
        nestedCursorMode(cursor),
      );
      return [pairs.map((p) => finItem(prev, p[0], it.bnd)), st2];
    }
    case "get-type":
    case "get-type-space": {
      // get-type uses &self; get-type-space looks up types in the named space's declarations.
      if ((op === "get-type" && it2.length !== 2) || (op === "get-type-space" && it2.length !== 3))
        break;
      let typeEnv = env;
      if (op === "get-type-space") {
        const selected = selectEvaluationEnvironment(
          env,
          st.world,
          inst(env, it.bnd, it2[1]!),
          UNDEF,
        );
        if (selected === undefined)
          return [
            [finItem(prev, errAtom(inst(env, it.bnd, a), "get-type-space: not a space"), it.bnd)],
            st,
          ];
        typeEnv = selected;
      }
      const x = op === "get-type-space" ? it2[2]! : it2[1]!;
      return yield* getTypeOpG(
        typeEnv,
        fuel,
        st,
        prev,
        inst(typeEnv, it.bnd, x),
        it.bnd,
        nestedCursorMode(cursor),
      );
    }
    case "check-types":
      if (it2.length === 2) {
        const t = inst(env, it.bnd, it2[1]!);
        let checked: Atom = emptyExpr;
        if (t.kind === "expr" && t.items.length > 0) {
          const head = t.items[0]!;
          if (head.kind === "sym")
            checked = checkApplication(env, st.world, head.name, t.items.slice(1)) ?? emptyExpr;
        }
        return [[finItem(prev, checked, it.bnd)], st];
      }
      break;
    case "get-doc":
      if (it2.length === 2)
        return [[finItem(prev, getDocOf(env, st.world, inst(env, it.bnd, it2[1]!)), it.bnd)], st];
      break;
    case "match":
      if (it2.length === 4) {
        if (!STREAM_CASE) return matchOp(env, st, prev, it2[1]!, it2[2]!, it2[3]!, it.bnd);
        return [matchItemSource(env, st, prev, it2[1]!, it2[2]!, it2[3]!, it.bnd), st];
      }
      break;
    case "superpose-bind":
      if (it2.length === 2 && it2[1]!.kind === "expr") {
        const registry = bindingPacketRegistry(env);
        const output: Item[] = [];
        for (const pair of it2[1]!.items) {
          if (pair.kind !== "expr" || pair.items.length !== 2) {
            output.push(
              finItem(
                prev,
                errTextAtom(a, "superpose-bind: expected an (atom bindings) pair"),
                it.bnd,
              ),
            );
            continue;
          }
          const [atom, packetAtom] = pair.items;
          if (atomEq(packetAtom!, unitA)) {
            output.push(finItem(prev, atom!, it.bnd));
            continue;
          }
          const read = registry.read(packetAtom!);
          if (!read.ok) {
            output.push(finItem(prev, errTextAtom(a, `superpose-bind: ${read.message}`), it.bnd));
            continue;
          }
          const incoming = bindingFrameFromLegacy(it.bnd);
          if (!incoming.ok) {
            output.push(
              finItem(prev, errTextAtom(a, `superpose-bind: ${incoming.fault.message}`), it.bnd),
            );
            continue;
          }
          const replay = registry.prepareReplay(read.packet);
          if (!replay.ok) {
            output.push(
              finItem(prev, errTextAtom(a, `superpose-bind: ${replay.fault.message}`), it.bnd),
            );
            continue;
          }
          const merged = incoming.value.merge(replay.value);
          if (!merged.ok) {
            if (merged.fault.code === "conflict" || merged.fault.code === "occurs-check") continue;
            output.push(
              finItem(prev, errTextAtom(a, `superpose-bind: ${merged.fault.message}`), it.bnd),
            );
            continue;
          }
          output.push(finItem(prev, atom!, bindingFrameToLegacy(merged.value)));
        }
        return [output, st];
      }
      return [
        [finItem(prev, errTextAtom(a, "superpose-bind: expected an expression"), it.bnd)],
        st,
      ];
    case "collapse-bind": {
      if (it2.length !== 2) break;
      let atoms: ContextualPair[];
      let st2: St;
      if (cursor === undefined) {
        [atoms, st2] = yield* interpretLoopG(env, fuel, st, [
          { stack: admitAtom(it2[1]!, null), bnd: it.bnd },
        ]);
      } else {
        const [answers, terminal] = yield* drainMinimalScheduleG(
          env,
          fuel,
          st,
          it.bnd,
          it2[1]!,
          cursor,
        );
        atoms = answers.map((answer) => [answer.atom, answer.bindings]);
        st2 = terminal;
      }
      if (collapseBindDiscardsBindings(prev)) {
        const pairs = atoms.map((pair) => makeExpr(env, [pair[0], unitA]));
        return [[finItem(prev, makeExpr(env, pairs), it.bnd)], st2];
      }
      const registry = bindingPacketRegistry(env);
      const captured = atoms.map((pair, alternative) => {
        const decoded = bindingFrameFromLegacy(pair[1]);
        const visible = bindingPacketVisibleVariables(it2[1]!, pair[0], prev);
        const projected = decoded.ok ? decoded.value.project(visible) : decoded;
        const frame = projected.ok ? projected.value : emptyBindingFrame;
        const atom = projected.ok
          ? pair[0]
          : errTextAtom(a, `collapse-bind: ${projected.fault.message}`);
        const packet = registry.capture(frame, visible, {
          operation: "collapse-bind",
          source: it2[1]!,
          alternative,
        });
        return makeExpr(env, [atom, packet]);
      });
      return [[finItem(prev, makeExpr(env, captured), it.bnd)], st2];
    }
    // TS-native extension. `(transaction <body>)` evaluates the body and atomically commits its
    // space mutations only if the body succeeds. Because the world is threaded copy-on-write
    // (cloneWorld -> new St), commit/rollback is snapshot-and-restore: keep the body's world on
    // success, restore the pre-body world otherwise. Rollback trigger (spec A2.1): the body throws
    // (an Error atom result) for every result, or produces zero results. The gensym counter always
    // advances (never reused after rollback).
    case "transaction": {
      if (it2.length !== 2) break;
      const snapshotWorld = st.world;
      const mutationEnv = evaluationCacheEnvironment(env);
      const snapshotEnv = snapshotEnvironmentMutations(mutationEnv);
      const entered = cloneWorld(snapshotWorld);
      forkWorldRuntime(
        snapshotWorld,
        entered,
        nextWorldRuntimeBranch(snapshotWorld, "transaction"),
      );
      entered.transactionDepth += 1;
      let committed = false;
      let environmentRestored = false;
      const answerPaths: Array<{ readonly pair: ContextualPair; readonly state: St }> = [];
      try {
        const transactionEmitter: MettaAnswerEmitter = {
          emitted: new WeakSet(),
          emittedCount: 0,
          omittedReturnCount: 0,
          lifecycle: { unwinding: false },
          accept: function* (pair, answerState): Gen<St> {
            answerPaths.push({ pair, state: answerState });
            return answerState;
          },
        };
        const [pairs, evaluated] = yield* mettaEvalG(
          env,
          fuel,
          { counter: st.counter, world: entered },
          it.bnd,
          it2[1]!,
          nestedCursorMode(cursor),
          transactionEmitter,
        );
        const st2 = yield* emitReturnedMettaAnswersG(transactionEmitter, pairs, evaluated);
        const successful = answerPaths.filter(({ pair }) => !isErrorAtom(pair[0]));
        if (successful.length === 0)
          return [
            pairs.map((p) => finItem(prev, p[0], it.bnd)),
            { counter: st2.counter, world: snapshotWorld },
          ];

        const deltas = successful.map(({ state }) => captureWorldDelta(entered, state.world));
        const selected = deltas[0]!;
        if (deltas.some((delta) => !worldDeltasEqual(selected, delta)))
          return [
            [finItem(prev, errTextAtom(a, "transaction: answer effects conflict"), it.bnd)],
            { counter: st2.counter, world: snapshotWorld },
          ];

        restoreEnvironmentMutations(mutationEnv, snapshotEnv);
        environmentRestored = true;
        const world = applyWorldDelta(env, snapshotWorld, selected);
        world.transactionDepth = snapshotWorld.transactionDepth;
        committed = true;
        return [pairs.map((p) => finItem(prev, p[0], it.bnd)), { counter: st2.counter, world }];
      } finally {
        if (!committed && !environmentRestored)
          restoreEnvironmentMutations(mutationEnv, snapshotEnv);
        releaseChildWorldRuntimes(
          entered,
          answerPaths.map(({ state }) => state.world),
        );
        releaseWorldRuntime(entered);
      }
    }
    // TS-native concurrency (async-only; see docs/.../concurrency-primitives.md).
    case "par": {
      const branches = it2.slice(1);
      const direct =
        cursor === undefined ? yield* tryDirectParG(env, fuel, st, it.bnd, branches) : undefined;
      if (direct?.kind === "complete")
        return [
          direct.answers.map((answer) => finItem(prev, answer.atom, answer.bindings)),
          direct.state,
        ];
      const schedule =
        direct?.kind === "resume"
          ? direct.schedule
          : parSchedule(env, fuel, st, it.bnd, branches, direct === undefined);
      if (cursor === undefined) {
        const result = (yield schedule.drainEffect()) as SearchDrainResult<
          InternalSearchAnswer,
          St
        >;
        switch (result.kind) {
          case "exhausted":
            return [
              result.values.map((answer) => finItem(prev, answer.atom, answer.bindings)),
              result.terminal,
            ];
          case "cancelled":
            throw schedulerCancellationError("par", result.reason);
          case "fault":
            throw result.error;
        }
      }
      const out: Item[] = [];
      let exhausted = false;
      const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
      try {
        for (;;) {
          const event = (yield schedule.nextEffect()) as SearchEvent<InternalSearchAnswer, St>;
          yield* chargeSchedulerStepsG(cursor, st, event.steps);
          switch (event.kind) {
            case "answer":
              out.push(finItem(prev, event.value.atom, event.value.bindings));
              break;
            case "pending":
              break;
            case "exhausted":
              exhausted = true;
              return [out, event.terminal];
            case "cancelled":
              throw schedulerCancellationError("par", event.reason);
            case "fault":
              throw event.error;
          }
        }
      } catch (error) {
        unwind.active = true;
        unwind.error = error;
        throw error;
      } finally {
        if (!exhausted)
          yield* closeScheduleG(
            schedule,
            { code: "parent-closed", message: "par tail closed" },
            unwind,
          );
      }
    }
    case "race": {
      const branches = it2.slice(1);
      const schedule = raceSchedule(env, fuel, st, it.bnd, branches);
      return yield* takeFirstScheduledAnswerG("race", schedule, prev, st, cursor);
    }
    case "once": {
      if (it2.length !== 2) break;
      // Keep the host's batch worker callback usable until the streamed worker ABI replaces it. The local
      // scheduler is used whenever the callback is absent or the branch set is not proven pure and ground.
      const legacyWorker =
        cursor === undefined ? legacyHyperposeEffect(env, st, fuel, it.bnd, it2[1]!) : undefined;
      if (legacyWorker !== undefined) {
        const result = (yield legacyWorker) as
          | { readonly atoms: Atom[]; readonly counterDelta: number }
          | undefined;
        if (result !== undefined) {
          const first = result.atoms[0];
          const workerState = { counter: st.counter + result.counterDelta, world: st.world };
          return [first === undefined ? [] : [finItem(prev, first, it.bnd)], workerState];
        }
      }
      const namedMatch = tryFastNamedOnceMatch(env, st, it2[1]!, it.bnd);
      if (namedMatch !== undefined) {
        const first =
          namedMatch.value === undefined ? [] : [finItem(prev, namedMatch.value, it.bnd)];
        return [first, namedMatch.state];
      }
      const schedule = onceSchedule(env, fuel, st, it.bnd, it2[1]!);
      return yield* takeFirstScheduledAnswerG("once", schedule, prev, st, cursor);
    }
    case "with-mutex": {
      if (it2.length !== 3) break;
      const name = mutexKey(inst(env, it.bnd, it2[1]!));
      const body = it2[2]!;
      const outerRuntime = worldRuntimeContext(st.world);
      const enteredWorld = cloneWorld(st.world);
      withWorldRuntimePolicy(st.world, enteredWorld, outerRuntime.policy, "allow");
      pendingAsyncOpBox.op = "with-mutex";
      const result = (yield driverEffect(
        "with-mutex",
        () => {
          throw new AsyncInSyncError("with-mutex");
        },
        (signal) =>
          runWithMutexAsync(
            env,
            fuel,
            { counter: st.counter, world: enteredWorld },
            it.bnd,
            name,
            body,
            signal,
          ),
      )) as EvalRes;
      const restoredWorld = cloneWorld(result[1].world);
      withWorldRuntimePolicy(
        result[1].world,
        restoredWorld,
        outerRuntime.policy,
        outerRuntime.irreversibleEffects,
      );
      return [
        result[0].map((p) => finItem(prev, p[0], it.bnd)),
        { counter: result[1].counter, world: restoredWorld },
      ];
    }
    case "new-state": {
      if (it2.length !== 2) break;
      const w = cloneWorld(st.world);
      const allocation = allocateStateCell({ counter: st.counter, world: w });
      const id = allocation.value;
      const value = inst(env, it.bnd, it2[1]!);
      w.store.set(id, value);
      w.generation = nextWorldGeneration(st.world);
      recordWorldMutation(w, "new-state", {
        kind: "set-state",
        key: id,
        introduced: true,
        value,
      });
      return [
        [finItem(prev, stateHandle(id), it.bnd)],
        { counter: allocation.nextCounter, world: w },
      ];
    }
    case "get-state": {
      if (it2.length !== 2) break;
      const id = stateId(st.world, inst(env, it.bnd, it2[1]!));
      if (id !== undefined) return [[finItem(prev, st.world.store.get(id) ?? emptyA, it.bnd)], st];
      return [
        [finItem(prev, errAtom(inst(env, it.bnd, it2[1]!), "get-state: not a state"), it.bnd)],
        st,
      ];
    }
    case "change-state!": {
      if (it2.length !== 3) break;
      const id = stateId(st.world, inst(env, it.bnd, it2[1]!));
      if (id !== undefined) {
        const w = cloneWorld(st.world);
        const value = inst(env, it.bnd, it2[2]!);
        const introduced = !st.world.store.has(id);
        w.store.set(id, value);
        w.generation = nextWorldGeneration(st.world);
        recordWorldMutation(w, "change-state!", {
          kind: "set-state",
          key: id,
          introduced,
          value,
        });
        return [[finItem(prev, stateHandle(id), it.bnd)], { counter: st.counter, world: w }];
      }
      return [
        [finItem(prev, errAtom(inst(env, it.bnd, it2[1]!), "change-state!: not a state"), it.bnd)],
        st,
      ];
    }
    case "new-space":
    case "new-mork-space": {
      const w = cloneWorld(st.world);
      const allocation = allocateSpaceName({ counter: st.counter, world: w });
      const name = allocation.value;
      w.spaces.set(name, emptyLog);
      w.generation = nextWorldGeneration(st.world);
      recordWorldMutation(w, op!, { kind: "create-space", name, atoms: [] });
      return [[finItem(prev, sym(name), it.bnd)], { counter: allocation.nextCounter, world: w }];
    }
    case "fork-space": {
      if (it2.length !== 2) break;
      const src = contextualSpaceName(env, st.world, inst(env, it.bnd, it2[1]!));
      if (src === undefined)
        return [
          [finItem(prev, errAtom(inst(env, it.bnd, it2[1]!), "fork-space: not a space"), it.bnd)],
          st,
        ];
      const srcAtoms =
        src === "&self" ? selfAtoms(env, st.world) : namedSpaceAtoms(st.world.spaces.get(src));
      const w = cloneWorld(st.world);
      const allocation = allocateSpaceName({ counter: st.counter, world: w });
      const name = allocation.value;
      w.spaces.set(name, logFromArray(srcAtoms));
      w.generation = nextWorldGeneration(st.world);
      recordWorldMutation(w, "fork-space", { kind: "create-space", name, atoms: srcAtoms });
      return [[finItem(prev, sym(name), it.bnd)], { counter: allocation.nextCounter, world: w }];
    }
    case "add-atom":
      if (it2.length === 3) {
        const added = inst(env, it.bnd, it2[2]!);
        if (opOf(added) === "=") disableTabling(evaluationCacheEnvironment(env));
        return spaceMutate(env, st, prev, it2[1]!, it.bnd, (w, name) =>
          appendSpace(env, w, name, [added]),
        );
      }
      break;
    case "remove-atom":
      if (it2.length === 3) {
        const removed = inst(env, it.bnd, it2[2]!);
        if (opOf(removed) === "=") disableTabling(evaluationCacheEnvironment(env));
        return spaceMutate(env, st, prev, it2[1]!, it.bnd, (w, name) =>
          eraseSpace(env, w, name, removed),
        );
      }
      break;
    case "get-atoms": {
      if (it2.length !== 2) break;
      const name = contextualSpaceName(env, st.world, inst(env, it.bnd, it2[1]!));
      if (name === undefined)
        return [
          [finItem(prev, errAtom(inst(env, it.bnd, it2[1]!), "get-atoms: not a space"), it.bnd)],
          st,
        ];
      const list =
        name === "&self" ? selfAtoms(env, st.world) : namedSpaceAtoms(st.world.spaces.get(name));
      return [list.map((x) => finItem(prev, x, it.bnd)), st];
    }
    case "pragma!": {
      // `(pragma! <key> <value>)` writes an interpreter setting (Hyperon's pragma!) and returns unit.
      // `max-stack-depth` is the one setting that changes interpretation: it must be an unsigned integer
      // (negative or non-integer -> the same `UnsignedIntegerIsExpected` error Hyperon emits), and 0 means
      // unlimited. Any other key is accepted and ignored, matching Hyperon storing arbitrary keys. A pragma
      // only ever tightens the in-language depth bound; it cannot touch the host's step budget.
      if (it2.length !== 3) break;
      const key = inst(env, it.bnd, it2[1]!);
      if (key.kind === "sym" && key.name === "max-stack-depth") {
        const val = inst(env, it.bnd, it2[2]!);
        const n = val.kind === "gnd" && val.value.g === "int" ? val.value.n : undefined;
        if (n === undefined || n < 0 || (typeof n === "number" && !Number.isInteger(n)))
          return [[finItem(prev, errAtom(a, "UnsignedIntegerIsExpected"), it.bnd)], st];
        const w = cloneWorld(st.world);
        w.maxStackDepth = Number(n);
        w.generation = nextWorldGeneration(st.world);
        recordWorldMutation(w, "pragma!", {
          kind: "set-max-stack-depth",
          value: Number(n),
        });
        return [[finItem(prev, emptyExpr, it.bnd)], { counter: st.counter, world: w }];
      }
      return [[finItem(prev, emptyExpr, it.bnd)], st];
    }
    case "bind!": {
      if (it2.length !== 3) break;
      const tok = inst(env, it.bnd, it2[1]!);
      if (tok.kind === "sym") {
        const w = cloneWorld(st.world);
        const value = inst(env, it.bnd, it2[2]!);
        w.tokens.set(tok.name, value);
        w.generation = nextWorldGeneration(st.world);
        recordWorldMutation(w, "bind!", { kind: "set-token", name: tok.name, value });
        return [[finItem(prev, emptyExpr, it.bnd)], { counter: st.counter, world: w }];
      }
      return [[finItem(prev, errAtom(tok, "bind!: token must be a symbol"), it.bnd)], st];
    }
    case "import!": {
      if (it2.length !== 3) break;
      const requestedSpace = inst(env, it.bnd, it2[1]!);
      const spaceAtom = contextualSpaceAtom(env, st.world, requestedSpace);
      const fileAtom = inst(env, it.bnd, it2[2]!);
      const moduleName = importModuleName(fileAtom);
      const catalogAtoms = moduleName === undefined ? undefined : env.imports.get(moduleName);
      const hostImportRejected =
        catalogAtoms === undefined &&
        env.hostImport !== undefined &&
        (st.world.transactionDepth > 0 ||
          worldRuntimeContext(st.world).irreversibleEffects === "reject");
      if (hostImportRejected)
        return [
          [
            finItem(
              prev,
              errAtom(
                inst(env, it.bnd, a),
                st.world.transactionDepth > 0
                  ? "import!: host imports are not transactional"
                  : "import!: host imports are not allowed in an isolated branch",
              ),
              it.bnd,
            ),
          ],
          st,
        ];
      const hostResult =
        catalogAtoms === undefined && !hostImportRejected && st.world.transactionDepth === 0
          ? yield* callHostImportG(env, st.world, spaceAtom, fileAtom, it.bnd)
          : undefined;
      if (hostResult !== undefined && hostResult.tag !== "noReduce") {
        if (hostResult.tag === "ok") {
          const effects = applyReduceEffects(env, st, it.bnd, hostResult.effects);
          if (effects.tag === "error")
            return [[finItem(prev, errAtom(inst(env, it.bnd, a), effects.msg), it.bnd)], st];
          const targetName = contextualSpaceName(env, st.world, spaceAtom);
          if (targetName === undefined)
            return [[finItem(prev, errAtom(spaceAtom, "import!: not a space"), it.bnd)], st];
          const installed = recordModuleInstallation(
            env,
            st.world,
            effects.state.world,
            fileAtom,
            "host",
            targetName,
          );
          return [
            hostResult.results.map((result) => finItem(prev, result, it.bnd)),
            { counter: effects.state.counter, world: installed },
          ];
        }
        if (hostResult.tag === "runtimeError")
          return [[finItem(prev, errAtom(inst(env, it.bnd, a), hostResult.msg), it.bnd)], st];
        return [[finItem(prev, errTextAtom(inst(env, it.bnd, a), hostResult.msg), it.bnd)], st];
      }
      const fileAtoms = catalogAtoms ?? [];
      const targetName = contextualSpaceName(env, st.world, spaceAtom);
      // Only an import that actually brings in equations can invalidate tabling/compilation (those run off
      // the static rule index). A no-op import, a missing or unresolved module reference, or a data-only one,
      // leaves the compiled core valid, so it must not be switched off.
      if (targetName === activeSpaceName(env) && fileAtoms.some((a) => opOf(a) === "="))
        disableTabling(evaluationCacheEnvironment(env));
      return spaceMutate(env, st, prev, it2[1]!, it.bnd, (w, name) => {
        const appended = appendSpace(env, w, name, fileAtoms);
        return moduleName === undefined || catalogAtoms === undefined
          ? appended
          : recordModuleInstallation(
              env,
              w,
              appended,
              fileAtom,
              "catalog",
              name,
              moduleName,
              moduleContentHash(fileAtoms),
            );
      });
    }
    default:
      break;
  }
  if (isEmbeddedOp(a)) {
    const malformed = op === undefined ? undefined : malformedCoreInstructionAtom(a, op);
    return [[finItem(prev, malformed ?? errAtom(a, "unsupported minimal op"), it.bnd)], st];
  }
  return [
    [
      {
        stack: cons(frame(top.atom, top.ret, top.vars, "deliver", top.callAtom), prev),
        bnd: it.bnd,
      },
    ],
    st,
  ];
}

function spaceMutate(
  env: MinEnv,
  st: St,
  prev: Stack,
  s: Atom,
  b: Bindings,
  f: (w: World, name: string) => World,
): [Item[], St] {
  const name = contextualSpaceName(env, st.world, inst(env, b, s));
  if (name === undefined) return [[finItem(prev, errAtom(inst(env, b, s), "not a space"), b)], st];
  return [[finItem(prev, emptyExpr, b)], { counter: st.counter, world: f(st.world, name) }];
}

/** The `(match space pattern template)` solutions a compiled nondet body consumes: the same
 *  candidate source, per-candidate freshening, and counter accounting as the interpreted match
 *  (matchSetup + matchSingleSolutions/EndState), returning each instantiated template with its
 *  solution bindings. Undefined when the pattern splits into a conjunction (outside the compiled
 *  subset; the holder bails to the interpreter). */
function compiledMatchSolutions(
  env: MinEnv,
  st: St,
  space: Atom,
  pattern: Atom,
  template: Atom,
): { pairs: ReadonlyArray<readonly [Atom, Bindings]>; counterDelta: number } | undefined {
  const { getCandidates, patterns } = matchSetup(env, st, space, pattern, emptyBindings);
  if (patterns.length !== 1) return undefined;
  const pat = patterns[0]!;
  const { endState } = matchSingleEndState(env, getCandidates, pat, template, st, emptyBindings);
  const pairs: Array<readonly [Atom, Bindings]> = [];
  for (const m of matchSingleSolutions(env, getCandidates, pat, st, emptyBindings))
    pairs.push([inst(env, m, template), m]);
  return { pairs, counterDelta: endState.counter - st.counter };
}

const COMPILED_IMPURE_OPS: CompiledImpureOps = {
  addAtom: compiledAddAtom,
  matchSolutions: compiledMatchSolutions,
  addIfAbsent: compiledAddIfAbsent,
};

function* getTypeOpG(
  env: MinEnv,
  fuel: number,
  st: St,
  prev: Stack,
  xi: Atom,
  b: Bindings,
  cursor?: CursorMode,
): Gen<[Item[], St]> {
  const emit = function* (st0: St): Gen<[Item[], St]> {
    let acc: Item[] = [];
    let cur = st0;
    for (const t of getTypesForQuery(env, st.world, typePrep(env, st.world, xi))) {
      const [rs, st2] = yield* mettaEvalG(env, fuel, cur, b, t, cursor);
      acc = [...acc, ...rs.map((p) => finItem(prev, p[0], b))];
      cur = st2;
    }
    return [acc, cur];
  };
  if (xi.kind === "expr" && xi.items.length > 0) {
    const head = xi.items[0]!;
    const args = xi.items.slice(1);
    if (head.kind === "sym") {
      if (typeMismatch(env, st.world, head.name, args) !== undefined) return [[], st];
      return yield* emit(st);
    }
    const view = typeViewFor(env, st.world);
    const illTyped = getTypesWithView(env, view, typePrep(env, st.world, head)).some((ft) => {
      if (opOf(ft) === "->" && ft.kind === "expr")
        return typeCheckArgs(env, st.world, ft.items.slice(1, -1), 0, [], args) !== undefined;
      return false;
    });
    return illTyped ? [[], st] : yield* emit(st);
  }
  return yield* emit(st);
}

// Shared setup for `match`: resolve the queried space, normalize a `(, ...)` conjunction into its goal
// patterns, and build the candidate-fact generator (&self's functor index, or a named space's atoms).
// Factored out of matchOp so the trail counter reuses the exact same candidate semantics (no second copy).
function matchSetup(
  env: MinEnv,
  st: St,
  space: Atom,
  pattern: Atom,
  b: Bindings,
): { getCandidates: (pInst: Atom) => CandidateSource; patterns: Atom[] } {
  const sn = contextualSpaceName(env, st.world, inst(env, b, space));
  const subbed = subTokens(st.world, pattern, env.intern);
  const patterns =
    opOf(subbed) === "," && subbed.kind === "expr"
      ? subbed.items.slice(1).map((p) => resolveStates(st.world, p))
      : [resolveStates(st.world, subbed)];
  // &self uses the functor index. Named spaces use the same exact-ground log index when it is sound,
  // otherwise they scan in insertion order.
  if (sn === undefined || sn === "&self") {
    return {
      getCandidates: (pInst) => matchCandidates(env, st.world, pInst, patterns.length === 1),
      patterns,
    };
  }
  return {
    getCandidates: namedSpaceCandidateGetter(st.world, st.world.spaces.get(sn)),
    patterns,
  };
}

function matchInsideOnce(a: Atom): ExprAtom | undefined {
  if (a.kind !== "expr" || opOf(a) !== "once" || a.items.length !== 2) return undefined;
  const inner = a.items[1]!;
  return inner.kind === "expr" && opOf(inner) === "match" && inner.items.length === 4
    ? inner
    : undefined;
}

function matchFromEmptyCollapseCheck(a: Atom): ExprAtom | undefined {
  if (a.kind !== "expr" || opOf(a) !== "==" || a.items.length !== 3) return undefined;
  const left = a.items[1]!;
  const right = a.items[2]!;
  const collapseArg = (x: Atom): ExprAtom | undefined =>
    x.kind === "expr" && opOf(x) === "collapse" && x.items.length === 2
      ? matchInsideOnce(x.items[1]!)
      : undefined;
  if (collapsedEmptySpellings.some((e) => atomEq(left, e))) return collapseArg(right);
  if (collapsedEmptySpellings.some((e) => atomEq(right, e))) return collapseArg(left);
  return undefined;
}

function tryFastNamedOnceMatch(
  env: MinEnv,
  st: St,
  body: Atom,
  b: Bindings,
): { value: Atom | undefined; state: St } | undefined {
  if (body.kind !== "expr" || opOf(body) !== "match" || body.items.length !== 4) return undefined;
  const sn = contextualSpaceName(env, st.world, inst(env, b, body.items[1]!));
  if (sn === undefined || sn === "&self") return undefined;
  const subbed = subTokens(st.world, body.items[2]!, env.intern);
  if (opOf(subbed) === "," && subbed.kind === "expr") return undefined;
  const pInst = inst(env, b, resolveStates(st.world, subbed));
  const space = st.world.spaces.get(sn) ?? emptyLog;
  if (!pInst.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const st2 = { counter: st.counter + logSize(space), world: st.world };
  if (idxCount(logGroundIdx(space), pInst) === 0) return { value: undefined, state: st2 };
  return { value: inst(env, b, body.items[3]!), state: st2 };
}

function tryFastNamedAddIfAbsent(
  env: MinEnv,
  st: St,
  ifExpr: ExprAtom,
  b: Bindings,
): { added: boolean; state: St } | undefined {
  const match = matchFromEmptyCollapseCheck(ifExpr.items[1]!);
  if (match === undefined) return undefined;
  const add = ifExpr.items[2]!;
  const otherwise = ifExpr.items[3]!;
  if (
    add.kind !== "expr" ||
    opOf(add) !== "add-atom" ||
    add.items.length !== 3 ||
    otherwise.kind !== "expr" ||
    opOf(otherwise) !== "empty" ||
    otherwise.items.length !== 1
  )
    return undefined;
  const matchSpace = inst(env, b, match.items[1]!);
  const addSpace = inst(env, b, add.items[1]!);
  const matchAtom = inst(
    env,
    b,
    resolveStates(st.world, subTokens(st.world, match.items[2]!, env.intern)),
  );
  const addAtom = inst(env, b, add.items[2]!);
  if (!atomEq(matchSpace, addSpace) || !atomEq(matchAtom, addAtom)) return undefined;
  const name = contextualSpaceName(env, st.world, matchSpace);
  if (name === undefined || name === "&self") return undefined;
  const space = st.world.spaces.get(name) ?? emptyLog;
  if (!matchAtom.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const checked: St = { counter: st.counter + logSize(space), world: st.world };
  if (idxCount(logGroundIdx(space), matchAtom) !== 0) return { added: false, state: checked };
  if (opOf(addAtom) === "=") disableTabling(evaluationCacheEnvironment(env));
  return {
    added: true,
    state: {
      counter: checked.counter,
      world: appendSpace(env, checked.world, name, [addAtom]),
    },
  };
}

function isCanonicalAddUniqueRule(lhs: Atom, rhs: Atom): boolean {
  if (lhs.kind !== "expr" || opOf(lhs) !== "add-unique-or-fail" || lhs.items.length !== 3)
    return false;
  const spaceVar = lhs.items[1]!;
  const exprVar = lhs.items[2]!;
  if (spaceVar.kind !== "var" || exprVar.kind !== "var") return false;
  if (rhs.kind !== "expr" || opOf(rhs) !== "let" || rhs.items.length !== 4) return false;
  const stVar = rhs.items[1]!;
  const key = rhs.items[2]!;
  const body = rhs.items[3]!;
  if (stVar.kind !== "var") return false;
  if (
    key.kind !== "expr" ||
    opOf(key) !== "s" ||
    key.items.length !== 2 ||
    key.items[1]!.kind !== "expr" ||
    opOf(key.items[1]!) !== "repra" ||
    key.items[1]!.items.length !== 2 ||
    !atomEq(key.items[1]!.items[1]!, exprVar)
  )
    return false;
  if (body.kind !== "expr" || opOf(body) !== "if" || body.items.length !== 4) return false;
  const match = matchFromEmptyCollapseCheck(body.items[1]!);
  const add = body.items[2]!;
  const otherwise = body.items[3]!;
  return (
    match !== undefined &&
    atomEq(match.items[1]!, spaceVar) &&
    atomEq(match.items[2]!, stVar) &&
    add.kind === "expr" &&
    opOf(add) === "add-atom" &&
    add.items.length === 3 &&
    atomEq(add.items[1]!, spaceVar) &&
    atomEq(add.items[2]!, stVar) &&
    otherwise.kind === "expr" &&
    opOf(otherwise) === "empty" &&
    otherwise.items.length === 1
  );
}

function tryFastAddUniqueOrFailCall(
  env: MinEnv,
  st: St,
  call: ExprAtom,
  b: Bindings,
): { added: boolean; state: St } | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalAddUniqueRule(rules[0]![0], rules[0]![1])) return undefined;
  const spaceAtom = inst(env, b, call.items[1]!);
  const name = contextualSpaceName(env, st.world, spaceAtom);
  if (name === undefined || name === "&self") return undefined;
  const value = inst(env, b, call.items[2]!);
  const key = expr([sym("s"), expr([sym("repra"), value])]);
  const space = st.world.spaces.get(name) ?? emptyLog;
  if (!key.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const checked: St = {
    counter: st.counter + rules.length + logSize(space),
    world: st.world,
  };
  if (idxCount(logGroundIdx(space), key) !== 0) return { added: false, state: checked };
  return {
    added: true,
    state: {
      counter: checked.counter,
      world: appendSpace(env, checked.world, name, [key]),
    },
  };
}

type QueueParts = { inList: ExprAtom; outList: ExprAtom; size: IntVal };
type FastRuleResult = { results: Array<[Atom, Bindings]>; state: St };

const isExprOp = (a: Atom, op: string, len: number): a is ExprAtom =>
  a.kind === "expr" && a.items.length === len && opOf(a) === op;

const isRuleVar = (a: Atom): boolean => a.kind === "var";

const isIntLiteral = (a: Atom, n: IntVal): boolean => atomEq(a, gint(n));

const intValue = (a: Atom): IntVal | undefined =>
  a.kind === "gnd" && a.value.g === "int" ? a.value.n : undefined;

type QueueRuleArgs = { eVar: Atom; inVar: Atom; outAtom: Atom; nVar: Atom };

function queueRuleArgs(lhs: Atom, op: "enqueue" | "dequeue"): QueueRuleArgs | undefined {
  if (!isExprOp(lhs, op, 3)) return undefined;
  const eVar = lhs.items[1]!;
  const lhsQueue = lhs.items[2]!;
  if (!isRuleVar(eVar) || !isExprOp(lhsQueue, "queue", 4)) return undefined;
  return {
    eVar,
    inVar: lhsQueue.items[1]!,
    outAtom: lhsQueue.items[2]!,
    nVar: lhsQueue.items[3]!,
  };
}

function queueParts(a: Atom): QueueParts | undefined {
  if (!isExprOp(a, "queue", 4)) return undefined;
  const inList = a.items[1]!;
  const outList = a.items[2]!;
  const size = intValue(a.items[3]!);
  if (inList.kind !== "expr" || outList.kind !== "expr" || size === undefined) return undefined;
  return { inList, outList, size };
}

function plusOne(a: Atom, v: Atom): boolean {
  return isExprOp(a, "+", 3) && atomEq(a.items[1]!, v) && isIntLiteral(a.items[2]!, 1);
}

function minusOne(a: Atom, v: Atom): boolean {
  return isExprOp(a, "-", 3) && atomEq(a.items[1]!, v) && isIntLiteral(a.items[2]!, 1);
}

function isCanonicalEmptyQueueRule(lhs: Atom, rhs: Atom): boolean {
  return (
    isExprOp(lhs, "empty-queue", 1) &&
    isExprOp(rhs, "queue", 4) &&
    atomEq(rhs.items[1]!, emptyExpr) &&
    atomEq(rhs.items[2]!, emptyExpr) &&
    isIntLiteral(rhs.items[3]!, 0)
  );
}

function isCanonicalEnqueueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "enqueue");
  if (lhsVars === undefined || !isExprOp(rhs, "queue", 4)) return false;
  const { eVar, inVar, outAtom: outVar, nVar } = lhsVars;
  const rhsIn = rhs.items[1]!;
  return (
    isRuleVar(inVar) &&
    isRuleVar(outVar) &&
    isRuleVar(nVar) &&
    isExprOp(rhsIn, "cons", 3) &&
    atomEq(rhsIn.items[1]!, eVar) &&
    atomEq(rhsIn.items[2]!, inVar) &&
    atomEq(rhs.items[2]!, outVar) &&
    plusOne(rhs.items[3]!, nVar)
  );
}

function isCanonicalNormalDequeueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "dequeue");
  if (lhsVars === undefined || !isExprOp(rhs, "queue", 4)) return false;
  const { eVar, inVar, outAtom: outCons, nVar } = lhsVars;
  if (!isRuleVar(inVar) || !isRuleVar(nVar) || !isExprOp(outCons, "cons", 3)) return false;
  const outVar = outCons.items[2]!;
  return (
    isRuleVar(outVar) &&
    atomEq(outCons.items[1]!, eVar) &&
    atomEq(rhs.items[1]!, inVar) &&
    atomEq(rhs.items[2]!, outVar) &&
    minusOne(rhs.items[3]!, nVar)
  );
}

function isCanonicalReverseDequeueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "dequeue");
  if (lhsVars === undefined || !isExprOp(rhs, "let", 4)) return false;
  const { eVar, inVar, outAtom, nVar } = lhsVars;
  if (!isRuleVar(inVar) || !atomEq(outAtom, emptyExpr) || !isRuleVar(nVar)) return false;
  const pat = rhs.items[1]!;
  const rev = rhs.items[2]!;
  const body = rhs.items[3]!;
  if (!isExprOp(pat, "cons", 3) || !isExprOp(rev, "reverse", 2) || !isExprOp(body, "queue", 4))
    return false;
  const restVar = pat.items[2]!;
  return (
    isRuleVar(restVar) &&
    atomEq(pat.items[1]!, eVar) &&
    atomEq(rev.items[1]!, inVar) &&
    atomEq(body.items[1]!, emptyExpr) &&
    atomEq(body.items[2]!, restVar) &&
    minusOne(body.items[3]!, nVar)
  );
}

function isCanonicalEmptyQueueCall(a: Atom): boolean {
  return isExprOp(a, "empty-queue", 1);
}

function isCanonicalAddUniqueOrFailCall(a: Atom, space: Atom, value: Atom): boolean {
  return (
    isExprOp(a, "add-unique-or-fail", 3) && atomEq(a.items[1]!, space) && atomEq(a.items[2]!, value)
  );
}

function letStarParts(
  a: Atom,
): { readonly bindings: readonly Atom[]; readonly body: Atom } | undefined {
  if (!isExprOp(a, "let*", 3)) return undefined;
  const bindings = a.items[1]!;
  return bindings.kind === "expr" ? { bindings: bindings.items, body: a.items[2]! } : undefined;
}

function bindingPair(a: Atom): readonly [Atom, Atom] | undefined {
  return a.kind === "expr" && a.items.length === 2 ? [a.items[0]!, a.items[1]!] : undefined;
}

function isMoveAnyCall(a: Atom, state: Atom): boolean {
  return isExprOp(a, "move", 3) && atomEq(a.items[1]!, state) && a.items[2]!.kind === "var";
}

function isCanonicalTilePuzzleBfsAllRule(lhs: Atom, rhs: Atom): boolean {
  if (!isExprOp(lhs, "bfs_all", 2)) return false;
  const start = lhs.items[1]!;
  if (start.kind !== "var") return false;
  const parts = letStarParts(rhs);
  if (parts === undefined || parts.bindings.length !== 2) return false;
  const first = bindingPair(parts.bindings[0]!);
  const second = bindingPair(parts.bindings[1]!);
  if (first === undefined || second === undefined) return false;
  const [ptVar, markStart] = first;
  const [qVar, enqueueStart] = second;
  if (ptVar.kind !== "var" || qVar.kind !== "var") return false;
  if (!isCanonicalAddUniqueOrFailCall(markStart, sym("&dup"), start)) return false;
  if (!isExprOp(enqueueStart, "enqueue", 3)) return false;
  if (!atomEq(enqueueStart.items[1]!, start)) return false;
  if (!isCanonicalEmptyQueueCall(enqueueStart.items[2]!)) return false;
  return (
    isExprOp(parts.body, "bfs_loop", 3) &&
    atomEq(parts.body.items[1]!, qVar) &&
    isIntLiteral(parts.body.items[2]!, 0)
  );
}

function isCanonicalTilePuzzleBfsLoopEmptyRule(lhs: Atom, rhs: Atom): boolean {
  return (
    isExprOp(lhs, "bfs_loop", 3) &&
    isCanonicalEmptyQueueCall(lhs.items[1]!) &&
    lhs.items[2]!.kind === "var" &&
    atomEq(lhs.items[2]!, rhs)
  );
}

function isCanonicalTilePuzzleBfsLoopStepRule(lhs: Atom, rhs: Atom): boolean {
  if (!isExprOp(lhs, "bfs_loop", 3)) return false;
  const q = lhs.items[1]!;
  const n0 = lhs.items[2]!;
  if (q.kind !== "var" || n0.kind !== "var") return false;
  const parts = letStarParts(rhs);
  if (parts === undefined || parts.bindings.length !== 4) return false;
  const q1 = bindingPair(parts.bindings[0]!);
  const ln = bindingPair(parts.bindings[1]!);
  const q2 = bindingPair(parts.bindings[2]!);
  const n1 = bindingPair(parts.bindings[3]!);
  if (q1 === undefined || ln === undefined || q2 === undefined || n1 === undefined) return false;
  const [q1Var, dequeueCall] = q1;
  const [lnVar, collapseCall] = ln;
  const [q2Var, foldCall] = q2;
  const [n1Var, plusCall] = n1;
  if (q1Var.kind !== "var" || lnVar.kind !== "var" || q2Var.kind !== "var" || n1Var.kind !== "var")
    return false;
  if (!isExprOp(dequeueCall, "once", 2)) return false;
  const dequeue = dequeueCall.items[1]!;
  if (!isExprOp(dequeue, "dequeue", 3) || dequeue.items[1]!.kind !== "var") return false;
  const stateVar = dequeue.items[1]!;
  if (!atomEq(dequeue.items[2]!, q)) return false;
  if (!isExprOp(collapseCall, "collapse", 2)) return false;
  const collapseBody = collapseCall.items[1]!;
  const inner = letStarParts(collapseBody);
  if (inner === undefined || inner.bindings.length !== 2) return false;
  const snew = bindingPair(inner.bindings[0]!);
  const marker = bindingPair(inner.bindings[1]!);
  if (snew === undefined || marker === undefined) return false;
  const [snewVar, moveCall] = snew;
  const [, markCall] = marker;
  if (snewVar.kind !== "var") return false;
  if (!isMoveAnyCall(moveCall, stateVar)) return false;
  if (!isCanonicalAddUniqueOrFailCall(markCall, sym("&dup"), snewVar)) return false;
  if (!atomEq(inner.body, snewVar)) return false;
  if (!isExprOp(foldCall, "foldl", 4)) return false;
  if (!atomEq(foldCall.items[1]!, sym("enqueue"))) return false;
  if (!atomEq(foldCall.items[2]!, lnVar) || !atomEq(foldCall.items[3]!, q1Var)) return false;
  if (
    !isExprOp(plusCall, "+", 3) ||
    !atomEq(plusCall.items[1]!, n0) ||
    !isIntLiteral(plusCall.items[2]!, 1)
  )
    return false;
  return (
    isExprOp(parts.body, "bfs_loop", 3) &&
    atomEq(parts.body.items[1]!, q2Var) &&
    atomEq(parts.body.items[2]!, n1Var)
  );
}

function tryFastEmptyQueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalEmptyQueueRule(rules[0]![0], rules[0]![1]))
    return undefined;
  return {
    results: [[expr([sym("queue"), emptyExpr, emptyExpr, gint(0)]), emptyBindings]],
    state: { counter: st.counter + rules.length, world: st.world },
  };
}

function tryFastEnqueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalEnqueueRule(rules[0]![0], rules[0]![1])) return undefined;
  const q = queueParts(call.items[2]!);
  if (q === undefined) return undefined;
  const nextIn = expr([call.items[1]!, ...q.inList.items]);
  return {
    results: [[expr([sym("queue"), nextIn, q.outList, gint(addInt(q.size, 1))]), emptyBindings]],
    // The interpreted RHS calls the stdlib `(cons ...)` rule once before `queue` becomes inert.
    state: { counter: st.counter + rules.length + 1, world: st.world },
  };
}

function queuePopBindings(want: Atom, got: Atom): Bindings[] | undefined {
  const ms = matchAtoms(want, got).filter((m) => !hasLoop(m));
  return ms.length === 0 ? undefined : ms;
}

function tryFastDequeueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (
    rules.length !== 2 ||
    !isCanonicalNormalDequeueRule(rules[0]![0], rules[0]![1]) ||
    !isCanonicalReverseDequeueRule(rules[1]![0], rules[1]![1])
  )
    return undefined;
  const q = queueParts(call.items[2]!);
  if (q === undefined) return undefined;
  const wanted = call.items[1]!;
  if (q.outList.items.length > 0) {
    const got = q.outList.items[0]!;
    const ms = queuePopBindings(wanted, got);
    if (ms === undefined) return undefined;
    const next = expr([
      sym("queue"),
      q.inList,
      expr(q.outList.items.slice(1)),
      gint(subInt(q.size, 1)),
    ]);
    return {
      results: ms.map((m) => [next, m]),
      state: { counter: st.counter + rules.length, world: st.world },
    };
  }
  if (q.inList.items.length === 0) return undefined;
  const reversed = [...q.inList.items].reverse();
  const got = reversed[0]!;
  const ms = queuePopBindings(wanted, got);
  if (ms === undefined) return undefined;
  const next = expr([sym("queue"), emptyExpr, expr(reversed.slice(1)), gint(subInt(q.size, 1))]);
  return {
    results: ms.map((m) => [next, m]),
    // The reverse branch applies the dequeue rule, then the stdlib `let` rule.
    state: { counter: st.counter + rules.length + 1, world: st.world },
  };
}

function tryFastQueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const op = opOf(call);
  if (op === "empty-queue" && call.items.length === 1) return tryFastEmptyQueueCall(env, st, call);
  if (op === "enqueue" && call.items.length === 3) return tryFastEnqueueCall(env, st, call);
  if (op === "dequeue" && call.items.length === 3) return tryFastDequeueCall(env, st, call);
  return undefined;
}

function tileCellKey(a: Atom): string | undefined {
  if (a.kind === "sym") return "s:" + a.name;
  if (a.kind === "gnd" && a.value.g === "int") return "i:" + String(a.value.n);
  return undefined;
}

function tileStateKey(a: Atom): string | undefined {
  if (a.kind !== "expr" || a.items.length !== 9) return undefined;
  const parts: string[] = [];
  let blanks = 0;
  for (const cell of a.items) {
    if (cell.kind === "sym" && cell.name === "___") blanks += 1;
    const k = tileCellKey(cell);
    if (k === undefined) return undefined;
    parts.push(k);
  }
  return blanks === 1 ? parts.join("|") : undefined;
}

function tileNeighbors(state: ExprAtom): ExprAtom[] {
  const blank = state.items.findIndex((x) => x.kind === "sym" && x.name === "___");
  const swaps =
    blank === 0
      ? [1, 3]
      : blank === 1
        ? [0, 2, 4]
        : blank === 2
          ? [1, 5]
          : blank === 3
            ? [0, 4, 6]
            : blank === 4
              ? [1, 3, 5, 7]
              : blank === 5
                ? [2, 4, 8]
                : blank === 6
                  ? [3, 7]
                  : blank === 7
                    ? [4, 6, 8]
                    : [5, 7];
  const out: ExprAtom[] = [];
  for (const j of swaps) {
    const items = state.items.slice();
    [items[blank], items[j]] = [items[j]!, items[blank]!];
    out.push(expr(items));
  }
  return out;
}

function tileVisitedAtom(state: Atom): Atom {
  return expr([sym("s"), expr([sym("repra"), state])]);
}

function hasCanonicalTilePuzzleRuntime(env: MinEnv, w: World): boolean {
  if ((env.ruleIndex.get("move")?.length ?? 0) !== 24) return false;
  const bfsAllRules = visibleStaticRulesForHead(env, w, "bfs_all");
  if (
    bfsAllRules.length !== 1 ||
    !isCanonicalTilePuzzleBfsAllRule(bfsAllRules[0]![0], bfsAllRules[0]![1])
  )
    return false;
  const bfsLoopRules = visibleStaticRulesForHead(env, w, "bfs_loop");
  if (
    bfsLoopRules.length !== 2 ||
    !isCanonicalTilePuzzleBfsLoopEmptyRule(bfsLoopRules[0]![0], bfsLoopRules[0]![1]) ||
    !isCanonicalTilePuzzleBfsLoopStepRule(bfsLoopRules[1]![0], bfsLoopRules[1]![1])
  )
    return false;
  if (logSize(w.spaces.get("&dup") ?? emptyLog) !== 0) return false;
  const emptyRules = candidatesW(env, w, expr([sym("empty-queue")]));
  if (emptyRules.length !== 1 || !isCanonicalEmptyQueueRule(emptyRules[0]![0], emptyRules[0]![1]))
    return false;
  const enqueueRules = candidatesW(
    env,
    w,
    expr([sym("enqueue"), emptyExpr, expr([sym("queue"), emptyExpr, emptyExpr, gint(0)])]),
  );
  if (
    enqueueRules.length !== 1 ||
    !isCanonicalEnqueueRule(enqueueRules[0]![0], enqueueRules[0]![1])
  )
    return false;
  const dequeueRules = candidatesW(
    env,
    w,
    expr([sym("dequeue"), variable("_"), expr([sym("queue"), emptyExpr, emptyExpr, gint(0)])]),
  );
  if (
    dequeueRules.length !== 2 ||
    !isCanonicalNormalDequeueRule(dequeueRules[0]![0], dequeueRules[0]![1]) ||
    !isCanonicalReverseDequeueRule(dequeueRules[1]![0], dequeueRules[1]![1])
  )
    return false;
  const addUniqueRules = candidatesW(
    env,
    w,
    expr([sym("add-unique-or-fail"), sym("&dup"), emptyExpr]),
  );
  return (
    addUniqueRules.length === 1 &&
    isCanonicalAddUniqueRule(addUniqueRules[0]![0], addUniqueRules[0]![1])
  );
}

function tryFastTilePuzzleBfsAll(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  if (opOf(call) !== "bfs_all" || call.items.length !== 2 || st.world.store.size !== 0)
    return undefined;
  const start = call.items[1]!;
  const startKey = tileStateKey(start);
  if (start.kind !== "expr" || startKey === undefined) return undefined;
  if (!hasCanonicalTilePuzzleRuntime(env, st.world)) return undefined;
  const seen = new Set<string>();
  const added: Atom[] = [];
  const queue: ExprAtom[] = [start];
  let head = 0;
  while (head < queue.length) {
    const state = queue[head++]!;
    for (const next of tileNeighbors(state)) {
      const key = tileStateKey(next)!;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(tileVisitedAtom(next));
      queue.push(next);
    }
  }
  return {
    results: [[gint(queue.length), emptyBindings]],
    state: {
      counter: st.counter,
      world: appendSpace(env, st.world, "&dup", added),
    },
  };
}

// True if `a` carries a grounded atom with a custom matcher (`.match`). unifyTrail compares grounded atoms
// by equality, so a query touching one declines to the immutable matcher (which honors `.match`).
function atomHasCustomGrounded(a: Atom): boolean {
  if (a.kind === "gnd") return (a as { match?: unknown }).match !== undefined;
  if (a.kind === "expr") return a.items.some(atomHasCustomGrounded);
  return false;
}

// Naive trail DFS counts each candidate per node, so a large cyclic join (which wcoJoin handles AGM-
// optimally) would blow up; this caps the per-query node visits and declines past it. matchConjCount only
// ever runs the trail over the small non-ground tail, so this is a safety net, not the common path.
const TRAIL_COUNT_BUDGET = 8_000_000;

// Count the solutions of a conjunctive `match` on a WAM-style trail (experimental.trail): bind variables in
// place over a DFS of the candidate facts, undoing on backtrack, never building a `Bindings`. The immutable
// `merge` path allocates a binding set per solution (`permutations` builds ~360k); this allocates none. A
// solution *count* is name-independent, so the gensym ordering that blocks a byte-identical result-producing
// trail match does not affect it — this is byte-identical to counting the immutable matcher's solutions.
// Returns undefined to fall back when a pattern/candidate carries a custom grounded matcher unifyTrail
// cannot reproduce.
// A fresh trail seeded with `b0`'s value bindings and eq aliases: the starting point for a trail count.
function seededTrail(b0: Bindings): Trail {
  const tr = new Trail();
  for (const [x, a] of valEntries(b0)) tr.bind(x, a);
  for (const r of eqRelations(b0)) if (tr.get(r.x) === undefined) tr.bind(r.x, variable(r.y));
  return tr;
}

// Count the solutions of `patterns` over a pre-seeded trail: bind each candidate in place over a DFS,
// undoing on backtrack, never building a binding set. Returns undefined to decline (a custom grounded
// matcher, or the node budget). Shared by matchCountTrail (the whole match) and matchConjCount's tail.
function countTrailDFS(
  tr: Trail,
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  counter0: number,
  branchNamespace: string | undefined,
  freshCaches?: ReadonlyArray<Map<Atom, Atom>>,
): { count: number; counter: number } | undefined {
  let counter = counter0;
  let count = 0;
  let bailed = false;
  let nodes = 0;
  const rec = (i: number): void => {
    if (++nodes > TRAIL_COUNT_BUDGET) {
      bailed = true; // a non-ground tail that is itself a large naive join: decline to the immutable path
      return;
    }
    if (i === patterns.length) {
      count += 1;
      return;
    }
    const pInst = tr.resolve(patterns[i]!);
    const source = getCandidates(pInst);
    // One freshen cache PER GOAL LEVEL, not one shared across the whole tail: two tail goals can match the
    // same stored fact, and a single cache would hand them the SAME freshened copy, so a fresh variable that
    // goal i bound to a query variable would reappear in goal i+1's candidate and fail to unify (a spurious
    // coreference). matchConjJoin allocates a fresh cache per tail goal for exactly this reason; mirror it.
    // The per-level cache is still shared across all join leaves, so each tail candidate freshens once.
    const cache = syntheticCandidateSource(source) ? undefined : freshCaches?.[i];
    for (const cand of source) {
      if (atomHasCustomGrounded(cand)) {
        bailed = true;
        return;
      }
      // Freshen the candidate's variables. The same fact recurs at every join leaf (the E template over all
      // 40320 permutations), so a cache shared across leaves freshens it once, not once per leaf — and the
      // counter then advances exactly as matchConjJoin's freshCache, keeping the fold's gensym in step.
      let fresh = cache?.get(cand);
      if (fresh === undefined) {
        fresh = freshenRule(counter, cand, cand, branchNamespace)[0];
        counter += 1;
        cache?.set(cand, fresh);
      }
      const mk = tr.mark();
      if (unifyTrail(tr, pInst, fresh)) rec(i + 1);
      tr.undo(mk);
      if (bailed) return;
    }
    counter += candidateCounterPadding(source);
  };
  rec(0);
  return bailed ? undefined : { count, counter };
}

function matchCountTrail(
  getCandidates: (pInst: Atom) => CandidateSource,
  patterns: readonly Atom[],
  st: St,
  b0: Bindings,
): { count: number; counter: number } | undefined {
  for (const p of patterns) if (atomHasCustomGrounded(p)) return undefined;
  return countTrailDFS(
    seededTrail(b0),
    getCandidates,
    patterns,
    st.counter,
    branchVariableNamespace(st.world),
  );
}

interface MatchPlan {
  readonly endState: St;
  readonly valuesAreNormal: boolean;
  foldItems(prev: Stack): Iterable<Item>;
  foldValues(): Iterable<Atom>;
}

function* matchSingleSolutions(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  pattern: Atom,
  st: St,
  b0: Bindings,
): Iterable<Bindings> {
  let counter = st.counter;
  const pInst = inst(env, b0, pattern);
  const source = getCandidates(pInst);
  for (const atom of source) {
    const fresh = freshenRule(counter, atom, atom, branchVariableNamespace(st.world))[0];
    counter += 1;
    for (const mb of matchAtoms(pInst, fresh))
      for (const m of merge(b0, mb)) if (!hasLoop(m)) yield m;
  }
  counter += candidateCounterPadding(source);
}

function matchSingleEndState(
  env: MinEnv,
  getCandidates: (pInst: Atom) => CandidateSource,
  pattern: Atom,
  template: Atom,
  st: St,
  b0: Bindings,
): { endState: St; valuesAreNormal: boolean } {
  const pInst = inst(env, b0, pattern);
  let valuesAreNormal =
    isNormalForm(env, st.world, pInst) && isNormalFormAssumingVars(env, st.world, template);
  let counter = st.counter;
  const source = getCandidates(pInst);
  for (const atom of source) {
    counter += 1;
    if (valuesAreNormal && !isNormalForm(env, st.world, atom)) valuesAreNormal = false;
  }
  counter += candidateCounterPadding(source);
  return { endState: { counter, world: st.world }, valuesAreNormal };
}

function matchPlan(
  env: MinEnv,
  st: St,
  space: Atom,
  pattern: Atom,
  template: Atom,
  b: Bindings,
): MatchPlan {
  const { getCandidates, patterns } = matchSetup(env, st, space, pattern, b);
  if (patterns.length === 1) {
    const pat = patterns[0]!;
    const { endState, valuesAreNormal } = matchSingleEndState(
      env,
      getCandidates,
      pat,
      template,
      st,
      b,
    );
    const solutions = (): Iterable<Bindings> =>
      matchSingleSolutions(env, getCandidates, pat, st, b);
    return {
      endState,
      valuesAreNormal,
      *foldItems(prev: Stack): Iterable<Item> {
        for (const m of solutions()) yield finItem(prev, inst(env, m, template), m);
      },
      *foldValues(): Iterable<Atom> {
        for (const m of solutions()) yield inst(env, m, template);
      },
    };
  }
  const [sols, endState] =
    patterns.length >= 2
      ? matchConjJoin(env, getCandidates, patterns, st, b)
      : matchConj(env, getCandidates, patterns, st, [b]);
  return {
    endState,
    valuesAreNormal: false,
    *foldItems(prev: Stack): Iterable<Item> {
      for (const m of sols) if (!hasLoop(m)) yield finItem(prev, inst(env, m, template), m);
    },
    *foldValues(): Iterable<Atom> {
      for (const m of sols) if (!hasLoop(m)) yield inst(env, m, template);
    },
  };
}

function matchOp(
  env: MinEnv,
  st: St,
  prev: Stack,
  space: Atom,
  pattern: Atom,
  template: Atom,
  b: Bindings,
): [Item[], St] {
  const plan = matchPlan(env, st, space, pattern, template, b);
  const out: Item[] = [];
  for (const item of plan.foldItems(prev)) out.push(item);
  return [out, plan.endState];
}

function matchItemSource(
  env: MinEnv,
  st: St,
  prev: Stack,
  space: Atom,
  pattern: Atom,
  template: Atom,
  b: Bindings,
): ItemSource {
  const plan = matchPlan(env, st, space, pattern, template, b);
  return {
    endState: plan.endState,
    foldItems(): Iterable<Item> {
      return plan.foldItems(prev);
    },
  };
}

// ---------- driver (iterative) ----------
function* interpretLoopG(
  env: MinEnv,
  fuel: number,
  st: St,
  work: Item[] | ItemSource,
  // Optional streaming consumer: when given, every finished branch is handed to `sink` instead of being
  // collected into the returned array (which stays empty). An aggregate like `(length (collapse X))` uses
  // this to count results without ever materialising them. The array, the collapsed tuple, and the length
  // walk are all O(N) structures the fold avoids.
  sink?: (pair: ContextualPair) => void,
  cursor?: CursorMode,
  // Optional generator consumer: every finished branch is handed to `accept` in production order
  // with the loop state threaded through, so one alternative can be reduced, emitted, and dropped
  // before the next is produced. The returned array stays empty. Mutually exclusive with `sink`
  // and with an answer-mode cursor.
  accept?: (pair: ContextualPair, state: St) => Gen<St>,
): Gen<[ContextualPair[], St]> {
  if (cursor?.kind === "answers" && sink !== undefined)
    throw new Error("a cursor cannot also use an eager result sink");
  if (accept !== undefined && (sink !== undefined || cursor?.kind === "answers"))
    throw new Error("a streaming accept consumer cannot combine with a sink or answer cursor");
  const acceptQueue: ContextualPair[] | undefined = accept === undefined ? undefined : [];
  const done: ContextualPair[] = [];
  const pendingAnswers: ContextualPair[] | undefined = cursor?.kind === "answers" ? [] : undefined;
  const emit = (pair: ContextualPair): void => {
    if (acceptQueue !== undefined) acceptQueue.push(pair);
    else if (pendingAnswers !== undefined) pendingAnswers.push(pair);
    else if (sink !== undefined) sink(pair);
    else done.push(pair);
  };
  // Worklist as an explicit stack. Popping the end is O(1); the previous `queue.slice(1)` plus
  // `[...more, ...queue]` rebuilt the whole array on every step (O(n) per step, O(n^2) over a run, and it
  // dominated interpretLoopG's self-time with array-growth churn on the build-heavy benchmarks). Items are
  // pushed in reverse so they still pop in the original front-to-back DFS order, so the result order and
  // the oracle stay byte-identical.
  let stack: Item[] = [];
  let source: Iterator<Item> | undefined;
  const suspended: Array<{
    stack: Item[];
    source: Iterator<Item> | undefined;
  }> = [];
  let cur = st;
  const beginSource = (src: ItemSource, suspend: boolean): void => {
    if (suspend) suspended.push({ stack, source });
    stack = [];
    source = src.foldItems()[Symbol.iterator]();
    cur = src.endState;
  };
  if (isItemSource(work)) {
    beginSource(work, false);
  } else {
    for (let i = work.length - 1; i >= 0; i--) stack.push(work[i]!);
  }
  const cursorNeedsFlush = (steps: number): boolean => {
    if (cursor === undefined) return false;
    recordCursorSteps(cursor, steps);
    return (
      (pendingAnswers !== undefined && pendingAnswers.length > 0) ||
      (cursor.budget.remaining === 0 && cursor.budget.pendingSteps > 0)
    );
  };
  const flushCursor = function* (): Gen<void> {
    if (cursor === undefined) return;
    if (pendingAnswers === undefined || pendingAnswers.length === 0) {
      yield* flushCursorProgressG(cursor, cur);
      return;
    }
    for (const pair of pendingAnswers) {
      yield* emitCursorAnswerG(cursor, pair, cur);
    }
    pendingAnswers.length = 0;
  };
  const pullSourceItem = (): boolean => {
    // A queued accepted final pauses source pulling so at most one final waits for its consumer.
    while (
      stack.length === 0 &&
      source !== undefined &&
      (acceptQueue === undefined || acceptQueue.length === 0)
    ) {
      const next = source.next();
      if (next.done === true) {
        const prev = suspended.pop();
        if (prev === undefined) {
          source = undefined;
        } else {
          stack = prev.stack;
          source = prev.source;
        }
        continue;
      }
      if (isFinal(next.value)) emit(finalPair(env, next.value));
      else stack.push(next.value);
    }
    return stack.length > 0;
  };
  const drainAccepted = function* (): Gen<void> {
    while (acceptQueue !== undefined && acceptQueue.length > 0)
      cur = yield* accept!(acceptQueue.shift()!, cur);
  };
  let f = fuel;
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  try {
    for (;;) {
      const hasWork = pullSourceItem();
      if (cursorNeedsFlush(0)) yield* flushCursor();
      if (acceptQueue !== undefined && acceptQueue.length > 0) {
        yield* drainAccepted();
        continue;
      }
      if (!hasWork) break;
      if (f <= 0) {
        for (let i = stack.length - 1; i >= 0; i--) {
          const it = stack[i]!;
          emit(isFinal(it) ? finalPair(env, it) : exhaustedPair(env, it));
        }
        yield* drainAccepted();
        if (cursorNeedsFlush(0)) yield* flushCursor();
        return [done, cur];
      }
      let it = stack.pop()!;
      checkWorldCancellation(cur.world);
      consumeWorldResource(cur.world, "steps", 1, "minimal-transition");
      checkWorldDeadline(cur.world, "minimal-transition");
      let evaluationScope = it.evaluationScope;
      // The selected context belongs only to the nested reduction started by evalc. Once its finished value
      // reaches the exact continuation stack that evalc entered from, resume that continuation in its parent
      // context. Stack nodes are persistent, so pointer identity is the delimiter and cannot match by accident.
      if (
        evaluationScope !== undefined &&
        it.stack !== null &&
        it.stack.head.fin &&
        it.stack.tail === evaluationScope.boundary
      ) {
        evaluationScope = evaluationScope.parent;
        it =
          evaluationScope === undefined
            ? { stack: it.stack, bnd: it.bnd }
            : { stack: it.stack, bnd: it.bnd, evaluationScope };
      }
      let activeEnv = env;
      if (evaluationScope !== undefined) {
        activeEnv = refreshEvaluationEnvironment(evaluationScope.env, cur.world);
        if (activeEnv !== evaluationScope.env) {
          evaluationScope = { ...evaluationScope, env: activeEnv };
          it = { ...it, evaluationScope };
        }
      }
      // `(pragma! max-stack-depth N)` bounds how deep the interpreter stack may grow before a branch is cut
      // back to a StackOverflow atom (Hyperon's pragma; bounds memory, not steps). 0 (the default) disables
      // the check, so this costs nothing unless a program opts in. A finished branch is already a result, so
      // it is returned as-is rather than turned into an error.
      const resourceStackLimit = worldRuntimeContext(cur.world).resources.ledger.limit(
        "stack-depth",
      );
      if (cur.world.maxStackDepth > 0 || resourceStackLimit !== undefined) {
        let depth = 0;
        for (let p = it.stack; p !== null; p = p.tail) depth++;
        if (resourceStackLimit !== undefined) {
          const lease = worldRuntimeContext(cur.world).resources;
          const fault = lease.tryObserve("stack-depth", depth, "minimal-transition");
          if (fault !== undefined) throw new ResourceLimitError(fault);
        }
        if (cur.world.maxStackDepth > 0 && depth >= cur.world.maxStackDepth) {
          emit(isFinal(it) ? finalPair(activeEnv, it) : exhaustedPair(activeEnv, it));
          if (cursorNeedsFlush(1)) yield* flushCursor();
          continue;
        }
      }
      const [results, st2] = yield* interpretStack1G(activeEnv, f - 1, cur, it, cursor);
      cur = st2;
      f -= 1;
      if (isItemSource(results)) {
        if (evaluationScope === undefined) {
          beginSource(results, true);
        } else {
          const sourceWithScope: ItemSource = {
            endState: results.endState,
            *foldItems(): Iterable<Item> {
              for (const item of results.foldItems())
                yield item.evaluationScope === undefined ? { ...item, evaluationScope } : item;
            },
          };
          beginSource(sourceWithScope, true);
        }
        if (cursorNeedsFlush(1)) yield* flushCursor();
        continue;
      }
      // Finals stream out immediately in result order (inlined to keep the no-sink case a direct push, no
      // per-result closure). Non-finals collect in order, then push reversed so they pop in that same order.
      const more: Item[] = [];
      for (const raw of results) {
        const r =
          evaluationScope !== undefined && raw.evaluationScope === undefined
            ? { ...raw, evaluationScope }
            : raw;
        if (isFinal(r)) {
          if (acceptQueue !== undefined) acceptQueue.push(finalPair(activeEnv, r));
          else if (pendingAnswers !== undefined) pendingAnswers.push(finalPair(activeEnv, r));
          else if (sink !== undefined) sink(finalPair(activeEnv, r));
          else done.push(finalPair(activeEnv, r));
        } else more.push(r);
      }
      for (let i = more.length - 1; i >= 0; i--) stack.push(more[i]!);
      if (cursorNeedsFlush(1)) yield* flushCursor();
    }
  } catch (error) {
    unwind.active = true;
    unwind.error = error;
    throw error;
  } finally {
    const continuations = new Set<MinimalGroundedV2Continuation>();
    const mettaCalls = new Set<MinimalMettaCallContinuation>();
    const collectContinuations = (item: Item): void => {
      if (item.groundedV2 !== undefined) continuations.add(item.groundedV2);
      if (item.mettaCall !== undefined) mettaCalls.add(item.mettaCall);
    };
    for (const item of stack) collectContinuations(item);
    for (const suspendedWork of suspended)
      for (const item of suspendedWork.stack) collectContinuations(item);
    const cleanupFailures: unknown[] = [];
    for (const continuation of continuations) {
      try {
        yield* closeMinimalGroundedV2G(continuation);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    for (const mettaCall of mettaCalls) {
      try {
        yield* closeMinimalMettaCallG(mettaCall);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    for (const iterator of [source, ...suspended.map((entry) => entry.source)]) {
      try {
        iterator?.return?.();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length > 0) {
      const cleanup = aggregateCleanupFailures(cleanupFailures, "minimal worklist cleanup failed");
      if (!unwind.active) throw cleanup;
      throw combineInitiatingAndCleanupFailure(
        unwind.error,
        cleanup,
        "minimal worklist evaluation and cleanup both failed",
      );
    }
  }
  return [done, cur];
}

// Hyperon's "already evaluated" optimization (spec `metta`: "elif metatype == Expression and <atom is
// evaluated already>: return atom"). A ground expression that has already reduced to itself is a value;
// re-evaluating it would re-walk the whole term, so a growing data term (Peano `(S (S ... Z))` is the worst
// case) costs O(n) per step and O(n^2) overall. We mark such terms here and skip them on the next visit.
// Only GROUND terms are cached: a term with variables can reduce differently under a different binding, so
// its irreducibility is not stable. The cache is per-env and reset when rules change, because hash-consing
// can make a later reducible term share the same object as an earlier irreducible one.

// Reduce each (atom, bindings) of `pairs` to normal form and flatten the results. `onTerminal` decides per
// pair whether it is already final (return the result atoms to keep as-is) or needs another mettaEval pass
// (return undefined to recurse). This is the shared tail of the three non-operator metta-call cases below
// (expression-headed rule hit, the interpret-tuple fallback, and a bare symbol); only the terminal test
// differs between them.
function* reduceChildrenG(
  env: MinEnv,
  fuel: number,
  st: St,
  pairs: ContextualPair[],
  onTerminal: (p: ContextualPair) => Array<[Atom, Bindings]> | undefined,
  cursor?: CursorMode,
  emitter?: MettaAnswerEmitter,
): Gen<[Array<[Atom, Bindings]>, St]> {
  const out: Array<[Atom, Bindings]> = [];
  let cur = st;
  for (const p of pairs) {
    const term = onTerminal(p);
    let produced: Array<[Atom, Bindings]>;
    if (term !== undefined) {
      produced = term;
    } else {
      const selected = refreshEvaluationEnvironment(p[2] ?? env, cur.world);
      const [more, st3] = yield* mettaEvalG(selected, fuel - 1, cur, p[1], p[0], cursor);
      cur = st3;
      produced = more;
    }
    if (emitter?.retainReturnedAnswers !== false) out.push(...produced);
    if (emitter !== undefined) {
      cur = yield* emitMettaAnswersG(emitter, produced, cur);
      if (emitter.retainReturnedAnswers === false) emitter.omittedReturnCount += produced.length;
    }
  }
  return [out, cur];
}

// ---------- runtime-rule tabling (fibadd: a `(= (fib $N) ...)` added at runtime via add-atom) ----------

function prepareCollapseRoute(
  env: MinEnv,
  st: St,
  bnd: Bindings,
  call: Atom,
): CollapseRoute | undefined {
  if (
    !collapseRouteEnabled() ||
    size(bnd) !== 0 ||
    call.kind !== "expr" ||
    !call.ground ||
    call.items.length === 0 ||
    call.items[0]!.kind !== "sym" ||
    env.varRulesVar.length !== 0 ||
    st.world.selfVarRules.length !== 0
  )
    return undefined;
  if (isDefinedHead(env, st.world, DONE_UNIT.name)) return undefined;
  const op = call.items[0]!.name;
  if (
    st.world.selfRules.has(op) ||
    staticRulesChangedFor(st.world, op) ||
    env.pureFunctors?.has(op) === true
  )
    return undefined;
  const rules = visibleStaticRulesForHead(env, st.world, op);
  if (rules === undefined || rules.length !== 1) return undefined;
  const args = call.items.slice(1);
  if (args.some((arg) => !isNormalForm(env, st.world, arg))) return undefined;
  if (typeMismatch(env, st.world, op, args, typeViewFor(env, st.world).sigs.get(op)) !== undefined)
    return undefined;

  const [lhs, rhs] = rules[0]!;
  if (lhs.kind !== "expr" || lhs.items.length !== call.items.length || !canMatchShallow(lhs, call))
    return undefined;

  const suffix = worldFreshVariableSuffix(st.world, st.counter);
  const matches: Bindings[] = [];
  for (const mb of matchAtomsScoped(lhs, call, suffix))
    for (const m of merge(bnd, mb)) if (!hasLoop(m)) matches.push(m);
  if (matches.length !== 1) return undefined;

  const body = inst(env, matches[0]!, rhs, suffix);
  const tail = tailMatchBuild(body);
  if (tail === undefined) return undefined;
  if (hasAnyAtomVar(tail.boundVars, tail.tailMatch.items.slice(1))) return undefined;
  let buildExpr = tail.buildExpr;
  let voidCalls: ReadonlyArray<{ readonly op: string; readonly args: readonly Atom[] }> | undefined;
  if (voidBuildEnabled()) {
    const split = splitVoidBuild(buildExpr, env);
    if (split !== undefined) {
      buildExpr = split.prefix;
      voidCalls = split.calls;
    }
  }
  return {
    buildExpr,
    tailMatch: tail.tailMatch,
    st: { counter: st.counter + 1, world: st.world },
    bnd: matches[0]!,
    voidCalls,
  };
}

// Count-aggregate (the FAQ / factorized-database COUNT, mork-uni-join's `Count` semiring): a
// `(match space (head $v1..$vk) tmpl)` whose pattern is all-distinct bare variables unifies with exactly the
// space atoms of that head and arity, so the number of solutions is a tally, not an enumeration. Count the
// head/arity-matching candidates in one pass over the matcher's own candidate source, with no per-candidate
// freshen, unify, trail, or collapse materialisation. The gensym still advances once per candidate the
// streaming match would *iterate* (every head-matching atom the source yields, including ones a different
// arity rules out), so `counter += iterated` stays byte-identical to the unfused path; `count` is the
// arity-matching subset (a bare-variable atom in the space unifies any arity). Returns undefined (fall back)
// unless the resolved pattern is a single all-distinct-variable expression.
function tryCountAggregate(
  env: MinEnv,
  st: St,
  bnd: Bindings,
  match: ExprAtom,
): { count: number; iterated: number } | undefined {
  if (match.items.length < 3) return undefined;
  const { getCandidates, patterns } = matchSetup(env, st, match.items[1]!, match.items[2]!, bnd);
  if (patterns.length !== 1) return undefined;
  const pat = inst(env, bnd, patterns[0]!);
  if (pat.kind !== "expr" || pat.items.length === 0 || pat.items[0]!.kind !== "sym")
    return undefined;
  const seen = new Set<string>();
  for (let i = 1; i < pat.items.length; i++) {
    const a = pat.items[i]!;
    if (a.kind !== "var" || seen.has(a.name)) return undefined;
    seen.add(a.name);
  }
  // A ground (nullary) pattern routes through the exact-membership index, which advances the counter
  // differently from a per-candidate scan, so require at least one variable argument: then the streaming
  // match is the candidate scan whose count and counter this tally reproduces.
  if (seen.size === 0) return undefined;
  const k = headKey(pat)!; // defined: the head is a symbol (guarded above)
  const arity = pat.items.length;
  // A candidate unifies with the all-distinct-variable, symbol-headed pattern `(k $v..)` iff it is a bare
  // variable, or an expr of the same arity whose head is the same symbol `k` or a variable. A same-arity
  // candidate whose head is a different symbol, a grounded value, or a nested expr does NOT unify, though it
  // is still yielded as a candidate (so it advances `iterated`/the counter). Counting by arity alone
  // over-counts those: a named space yields the whole space unfiltered, and `&self` admits headKey-undefined
  // (grounded- or expr-headed) atoms.
  const unifies = (a: Atom): boolean =>
    a.kind === "var" ||
    (a.kind === "expr" &&
      a.items.length === arity &&
      (headKey(a) === k || a.items[0]!.kind === "var"));
  const w = st.world;
  // Direct tally over the runtime &self store, skipping the materialisation (and, for the flat space, the
  // decoding) of a ~1.5M-element candidate array, when the candidate set IS exactly that store: a &self match
  // with no state to resolve and no static or variable-headed facts of this head, so `matchCandidates` would
  // yield only the runtime atoms whose head is `k` (or which are variable-headed). Counting is
  // order-independent, so the newest-first log walk is fine. Same head filter as `runtimeCandidates`, so
  // `iterated` (and thus the counter) is identical. The flat store tallies columnar-ly (countHeadArity
  // mirrors `unifies` exactly); at most one of the two stores is non-empty, and summing keeps the tally
  // right either way.
  const sn = contextualSpaceName(env, w, inst(env, bnd, match.items[1]!));
  if (
    (sn === undefined || sn === "&self") &&
    w.store.size === 0 &&
    env.varHeadedFacts.length === 0 &&
    (env.factIndex.get(k)?.length ?? 0) === 0
  ) {
    let count = 0;
    let iterated = 0;
    for (let p = w.selfExtra; p !== null; p = p.prev) {
      const akk = headKey(p.atom);
      if (akk === undefined || akk === k) {
        iterated += 1;
        if (unifies(p.atom)) count += 1;
      }
    }
    if (w.flatSelfExtra !== undefined) {
      const flat = w.flatSelfExtra.countHeadArity(k, arity);
      count += flat.count;
      iterated += flat.iterated;
    }
    return { count, iterated };
  }
  const source = getCandidates(pat);
  let count = 0;
  let iterated = 0;
  for (const cand of source) {
    iterated += 1;
    if (unifies(cand)) count += 1;
  }
  iterated += candidateCounterPadding(source);
  return { count, iterated };
}

function* countTailMatchG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  match: ExprAtom,
  cursor?: CursorMode,
): Gen<{ count: number; state: St }> {
  const agg = countAggregateEnabled() ? tryCountAggregate(env, st, bnd, match) : undefined;
  if (agg !== undefined)
    return {
      count: agg.count,
      state: { counter: st.counter + agg.iterated, world: st.world },
    };
  {
    const { getCandidates, patterns } = matchSetup(env, st, match.items[1]!, match.items[2]!, bnd);
    // The multi-goal conjunctive count folds the WCO join by default (order- and name-independent, so
    // byte-identical to the materializing count it replaces). The single-pattern trail count stays behind
    // experimental.trail: tryCountAggregate above already covers the common single-pattern tally, and
    // matchCountTrail is the general experimental path.
    const tc =
      patterns.length >= 2 && conjCountEnabled()
        ? matchConjCount(env, getCandidates, patterns, st, bnd)
        : env.useTrail === true
          ? matchCountTrail(getCandidates, patterns, st, bnd)
          : undefined;
    if (tc !== undefined)
      return {
        count: tc.count,
        state: { counter: tc.counter, world: st.world },
      };
  }
  let count = 0;
  const [, stC] = yield* interpretLoopG(
    env,
    fuel,
    st,
    [
      {
        stack: admitAtom(expr([sym("metta"), countOnlyMatch(match), UNDEF, sym("&self")]), null),
        bnd,
      },
    ],
    () => {
      count++;
    },
    nestedCursorMode(cursor),
  );
  return { count, state: stC };
}

function* tryCollapseRouteG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  call: Atom,
  cursor?: CursorMode,
): Gen<{ count: number; state: St } | undefined> {
  const route = prepareCollapseRoute(env, st, bnd, call);
  if (route === undefined) return undefined;
  // Drive the build prefix through the same type-directed `metta` evaluation the unfused path uses for the
  // whole call, so the add-atom side effects run and every build branch reduces to the `done` sentinel. A
  // Bare `admitAtom(buildExpr)` would treat the let* as data and return it unreduced. Count the build
  // emissions with a sink instead of materialising them. A split compiled suffix is admitted only while each
  // dead call emits at most one branch; multi-branch side effects need a tail count at each branch state and
  // decline back to the interpreter.
  let buildCount = 0;
  const [, stAfterPrefix] = yield* interpretLoopG(
    env,
    fuel,
    route.st,
    [
      {
        stack: admitAtom(expr([sym("metta"), route.buildExpr, UNDEF, sym("&self")]), null),
        bnd: route.bnd,
      },
    ],
    (item) => {
      if (!atomEq(item[0], DONE_UNIT)) throw new Error("collapse route build yielded non-unit");
      buildCount += 1;
    },
    nestedCursorMode(cursor),
  );
  if (buildCount === 0) return { count: 0, state: stAfterPrefix };
  let stAfterBuild = stAfterPrefix;
  if (route.voidCalls !== undefined) {
    for (const call of route.voidCalls) {
      let nextBuildCount = 0;
      let cur = stAfterBuild;
      for (let i = 0; i < buildCount; i++) {
        const cr = runCompiledEffectCount(env, call.op, call.args, cur, COMPILED_IMPURE_OPS);
        if (cr === undefined) return undefined; // did not compile this run; fall back
        if (cr.count > 1) return undefined; // multi-branch effects need a tail count at each branch state
        nextBuildCount += cr.count;
        cur = cr.state;
      }
      buildCount = nextBuildCount;
      stAfterBuild = cur;
      if (buildCount === 0) return { count: 0, state: stAfterBuild };
    }
  }
  const tailStart = stAfterBuild.counter;
  const tail = yield* countTailMatchG(env, fuel, stAfterBuild, route.bnd, route.tailMatch, cursor);
  const tailDelta = tail.state.counter - tailStart;
  return {
    count: tail.count * buildCount,
    state: { counter: tailStart + tailDelta * buildCount, world: tail.state.world },
  };
}

function canStreamStdlibCase(env: MinEnv, w: World): boolean {
  return (
    STREAM_CASE &&
    (env.ruleIndex.get("case")?.length ?? 0) === 1 &&
    env.varRulesVar.length === 0 &&
    !w.selfRules.has("case") &&
    !staticRulesChangedFor(w, "case") &&
    w.selfVarRules.length === 0
  );
}

const choicePlanApplication =
  (env: MinEnv, world: World) =>
  (name: string, args: readonly Atom[]): boolean =>
    checkApplication(env, world, name, args) === null;

function staticSpaceHasCustomMatcher(env: MinEnv): boolean {
  const cached = staticCustomMatcherCache.get(env);
  if (cached?.atomCount === env.atoms.length) return cached.hasCustomMatcher;
  const hasCustomMatcher = env.atoms.some(atomHasCustomGrounded);
  staticCustomMatcherCache.set(env, { atomCount: env.atoms.length, hasCustomMatcher });
  return hasCustomMatcher;
}

function isDiscardedFiniteMatch(env: MinEnv, world: World, call: ExprAtom): boolean {
  if (
    opOf(call) !== "let" ||
    call.items.length !== 4 ||
    call.items[1]!.kind !== "var" ||
    call.items[2]!.kind !== "expr" ||
    opOf(call.items[2]!) !== "match" ||
    call.items[2]!.items.length !== 4 ||
    call.items[3]!.kind !== "expr" ||
    opOf(call.items[3]!) !== "empty" ||
    call.items[3]!.items.length !== 1 ||
    (env.ruleIndex.get("let")?.length ?? 0) !== 1 ||
    (env.ruleIndex.get("match")?.length ?? 0) !== 0 ||
    (env.ruleIndex.get("empty")?.length ?? 0) !== 0 ||
    env.varRulesVar.length > 0 ||
    world.selfVarRules.length > 0 ||
    world.selfRules.has("let") ||
    world.selfRules.has("match") ||
    world.selfRules.has("empty") ||
    staticRulesChangedFor(world, "let") ||
    staticRulesChangedFor(world, "match") ||
    staticRulesChangedFor(world, "empty") ||
    env.gt.has("let") ||
    env.agt.has("let") ||
    env.gt.has("match") ||
    env.agt.has("match") ||
    !env.gt.has("empty") ||
    env.agt.has("empty") ||
    !isTableSafeGroundedOp("empty", env.gt.get("empty")!) ||
    world.store.size !== 0 ||
    world.tokens.size !== 0
  )
    return false;
  const match = call.items[2]! as ExprAtom;
  const space = match.items[1]!;
  if (space.kind !== "sym") return false;
  if (atomHasCustomGrounded(match.items[2]!) || atomHasCustomGrounded(match.items[3]!))
    return false;
  if (space.name === "&self") {
    if (staticSpaceHasCustomMatcher(env)) return false;
    return !logToArray(world.selfExtra).some(atomHasCustomGrounded);
  }
  const named = world.spaces.get(space.name);
  return named === undefined || !logToArray(named).some(atomHasCustomGrounded);
}

function tryFastUniqueChoiceFunction(
  env: MinEnv,
  world: World,
  op: string,
  args: readonly Atom[],
): Atom[] | undefined {
  if (
    typeViewFor(env, world).sigs.has(op) ||
    world.selfRules.has(op) ||
    staticRulesChangedFor(world, op)
  )
    return undefined;
  const rules = env.ruleIndex.get(op);
  if (rules?.length !== 1) return undefined;
  const [lhs, rhs] = rules[0]!;
  if (
    lhs.kind !== "expr" ||
    lhs.items.length !== args.length + 1 ||
    lhs.items[0]!.kind !== "sym" ||
    lhs.items[0]!.name !== op ||
    rhs.kind !== "expr" ||
    opOf(rhs) !== "unique-atom" ||
    rhs.items.length !== 2
  )
    return undefined;
  const collapse = rhs.items[1]!;
  if (collapse.kind !== "expr" || opOf(collapse) !== "collapse" || collapse.items.length !== 2)
    return undefined;
  if (!canRunChoicePlan(env, world) || !args.every((arg) => isClosedChoiceValue(env, world, arg)))
    return undefined;
  const bindings = new Map<string, Atom>();
  for (let index = 0; index < args.length; index++) {
    const parameter = lhs.items[index + 1]!;
    if (parameter.kind !== "var" || bindings.has(parameter.name)) return undefined;
    bindings.set(parameter.name, args[index]!);
  }
  const planned = runDistinctChoicePlanBound(
    collapse.items[1]!,
    bindings,
    choicePlanConstructor(env, world),
    choicePlanDataExpression(env, world),
    choicePlanApplication(env, world),
  );
  if (planned === undefined) return undefined;
  return [sym(","), ...planned];
}

function streamCaseSource(
  env: MinEnv,
  st: St,
  bnd: Bindings,
  matchExpr: ExprAtom,
  cases: Atom,
): ItemSource | undefined {
  if (cases.kind !== "expr" || cases.items.length !== 1) return undefined;
  const onlyCase = cases.items[0]!;
  if (onlyCase.kind !== "expr" || onlyCase.items.length !== 2 || onlyCase.items[0]!.kind !== "var")
    return undefined;
  const casePattern = inst(env, bnd, onlyCase.items[0]!);
  const caseTemplate = inst(env, bnd, onlyCase.items[1]!);
  const caseRuleEnd = { counter: st.counter + 1, world: st.world };
  const plan = matchPlan(
    env,
    caseRuleEnd,
    matchExpr.items[1]!,
    matchExpr.items[2]!,
    matchExpr.items[3]!,
    bnd,
  );
  if (!plan.valuesAreNormal) return undefined;
  let valueCount = 0;
  const valueIter = plan.foldValues()[Symbol.iterator]();
  for (let next = valueIter.next(); !next.done; next = valueIter.next()) valueCount += 1;
  const switchCount = valueCount === 0 ? 1 : valueCount;
  const endState = {
    counter: plan.endState.counter + 2 * switchCount,
    world: plan.endState.world,
  };
  const bodyFor = (value: Atom): Atom => {
    for (const mb of matchAtoms(value, casePattern))
      for (const m of merge(bnd, mb)) if (!hasLoop(m)) return inst(env, m, caseTemplate);
    return sym("Empty");
  };
  return {
    endState,
    *foldItems(): Iterable<Item> {
      let any = false;
      for (const value of plan.foldValues()) {
        any = true;
        yield {
          stack: admitAtom(expr([sym("metta"), bodyFor(value), UNDEF, sym("&self")]), null),
          bnd,
        };
      }
      if (!any)
        yield {
          stack: admitAtom(expr([sym("metta"), bodyFor(sym("Empty")), UNDEF, sym("&self")]), null),
          bnd,
        };
    },
  };
}

// ---------- mettaEval (type-directed metta-call loop) ----------
interface RulePairPlan {
  readonly selected: MinEnv;
  readonly pb: Bindings;
  /** Terminal answer pairs when the alternative needs no nested evaluation; undefined otherwise. */
  readonly final: Array<[Atom, Bindings]> | undefined;
}

/**
 * Classify one interpreted-rule alternative. A plain call instead of a generator so the deep
 * recursion (the eval case delegates into mettaEvalG at each level) holds no extra native frame
 * per level; both the batch loop and the streaming pass share it.
 */
function planRulePair(
  env: MinEnv,
  world: World,
  queryVars: readonly string[],
  partB: Bindings,
  wApp: Atom,
  p: ContextualPair,
  opReturnsAtom: boolean,
): RulePairPlan {
  const selected = refreshEvaluationEnvironment(p[2] ?? env, world);
  const pb = mergeRestrict(selected, queryVars, partB, p[1]);
  if (atomEq(p[0], notReducibleA) || atomEq(p[0], wApp)) {
    // wApp did not reduce (a constructor application / data term). Cache a ground one so the next visit
    // short-circuits instead of re-walking it.
    return { selected, pb, final: [[wApp, partB]] };
  }
  if (opReturnsAtom && !isEmbeddedOp(p[0])) return { selected, pb, final: [[p[0], pb]] };
  if (isErrorAtom(p[0])) {
    // Error atoms are terminal data in Minimal MeTTa. Re-evaluating one can repeatedly wrap or reproduce
    // the same host failure instead of publishing it.
    return { selected, pb, final: [[p[0], pb]] };
  }
  return { selected, pb, final: undefined };
}

/** Map nested evaluation results back through the rule's restricted bindings. */
function mapReducedRulePairs(
  plan: RulePairPlan,
  queryVars: readonly string[],
  more: ReadonlyArray<readonly [Atom, Bindings]>,
): Array<[Atom, Bindings]> {
  return more.map((m): [Atom, Bindings] => [
    m[0],
    mergeRestrict(plan.selected, queryVars, plan.pb, m[1]),
  ]);
}

function* reduceRulePairsG(
  env: MinEnv,
  fuel: number,
  st: St,
  queryVars: readonly string[],
  partB: Bindings,
  wApp: Atom,
  pairs: readonly ContextualPair[],
  opReturnsAtom: boolean,
  cursor?: CursorMode,
  emitter?: MettaAnswerEmitter,
): Gen<[Array<[Atom, Bindings]>, St]> {
  const out: Array<[Atom, Bindings]> = [];
  const isolate = pairs.length > 1 && worldRuntimeContext(st.world).policy === "isolated-branches";
  const alternatives = isolate ? isolatedBranchStates(st, pairs.length) : undefined;
  const terminals: St[] = [];
  let cur = st;
  try {
    for (let index = 0; index < pairs.length; index += 1) {
      const p = pairs[index]!;
      let branch = alternatives?.branches[index] ?? cur;
      const plan = planRulePair(env, branch.world, queryVars, partB, wApp, p, opReturnsAtom);
      let produced = plan.final;
      if (produced === undefined) {
        const [more, st4] = yield* mettaEvalG(
          plan.selected,
          fuel - 1,
          branch,
          plan.pb,
          p[0],
          cursor,
        );
        branch = st4;
        produced = mapReducedRulePairs(plan, queryVars, more);
      }
      out.push(...produced);
      enforceDistinctLimit(env, out.length);
      if (emitter !== undefined && !distinctGroundEnabled(env))
        branch = yield* emitMettaAnswersG(emitter, produced, branch);
      if (isolate) terminals.push(branch);
      else cur = branch;
    }
    if (!isolate) return [out, cur];
    const parent = alternatives!.parent;
    if (emitter?.accept !== undefined)
      return [
        out,
        {
          counter: Math.max(parent.counter, ...terminals.map((terminal) => terminal.counter)),
          world: parent.world,
        },
      ];
    return [out, mergeScheduledStates(env, parent, terminals)];
  } finally {
    if (alternatives !== undefined)
      releaseChildWorldRuntimes(
        alternatives.parent.world,
        alternatives.branches.map((branch) => branch.world),
      );
  }
}

interface StreamedInterpretedPass {
  /** `single` preserves the caller's one-pair tail-call trampoline; `streamed` already reduced,
   *  emitted, and (subject to the retention flag) collected every alternative. */
  readonly kind: "single" | "streamed";
  readonly pair?: ContextualPair;
  readonly out: Array<[Atom, Bindings]>;
  readonly state: St;
}

/**
 * Run one interpreted-rule producer pass with streaming reduction. The first finished alternative
 * is held back so a single-answer chain returns as `single` and keeps the caller's trampoline; a
 * second alternative starts streaming, reducing and emitting each alternative as it is produced so
 * a nested consumer can prune the tail and no alternative bag is retained.
 */
function* streamedInterpretedPassG(
  env: MinEnv,
  fuel: number,
  start: St,
  work: Item[],
  queryVars: readonly string[],
  partB: Bindings,
  wApp: Atom,
  opReturnsAtom: boolean,
  cursor: CursorMode | undefined,
  emitter: MettaAnswerEmitter,
): Gen<StreamedInterpretedPass> {
  let first: ContextualPair | undefined;
  let firstState: St | undefined;
  let streaming = false;
  let isolation: StreamingIsolatedBranches | undefined;
  const out: Array<[Atom, Bindings]> = [];
  let producedCount = 0;
  const retain = emitter.retainReturnedAnswers;
  const reduceOne = function* (p: ContextualPair, state: St): Gen<St> {
    let branch = isolation !== undefined ? allocateStreamingIsolatedBranch(isolation) : state;
    const plan = planRulePair(env, branch.world, queryVars, partB, wApp, p, opReturnsAtom);
    let produced = plan.final;
    if (produced === undefined) {
      const [more, st4] = yield* mettaEvalG(plan.selected, fuel - 1, branch, plan.pb, p[0], cursor);
      branch = st4;
      produced = mapReducedRulePairs(plan, queryVars, more);
    }
    producedCount += produced.length;
    enforceDistinctLimit(env, producedCount);
    if (retain !== false) out.push(...produced);
    branch = yield* emitMettaAnswersG(emitter, produced, branch);
    if (retain === false) emitter.omittedReturnCount += produced.length;
    if (isolation !== undefined) {
      recordStreamingIsolatedTerminal(isolation, branch);
      return isolation.parent;
    }
    return branch;
  };
  const acceptPair = function* (pair: ContextualPair, state: St): Gen<St> {
    if (!streaming) {
      if (first === undefined) {
        first = pair;
        firstState = state;
        return state;
      }
      streaming = true;
      isolation = beginStreamingIsolatedBranches(state, emitter.accept !== undefined);
      const held = first;
      first = undefined;
      state = yield* reduceOne(held, isolation?.parent ?? state);
    }
    return yield* reduceOne(pair, state);
  };
  try {
    const [, endState] = yield* interpretLoopG(
      env,
      fuel,
      start,
      work,
      undefined,
      nestedCursorMode(cursor),
      acceptPair,
    );
    if (!streaming)
      return {
        kind: "single",
        ...(first === undefined ? {} : { pair: first }),
        out,
        state: endState,
      };
    return {
      kind: "streamed",
      out,
      state: isolation !== undefined ? finishStreamingIsolatedBranches(env, isolation) : endState,
    };
  } catch (error) {
    // A producer fault after one held alternative still delivers that alternative first, exactly
    // as the direct grounded stream does; a consumer-close unwind discards it instead.
    if (first !== undefined && emitter.lifecycle.unwinding !== true) {
      const held = first;
      first = undefined;
      try {
        yield* reduceOne(held, firstState!);
      } catch (flushError) {
        throw combineInitiatingAndCleanupFailure(
          error,
          flushError,
          "interpreted alternatives and their delivery both failed",
        );
      }
    }
    throw error;
  } finally {
    releaseStreamingIsolatedBranches(isolation);
  }
}

function* reduceDirectAsyncGroundedApplicationG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  wApp: ExprAtom,
  op: string,
  args: readonly Atom[],
  queryVars: readonly string[],
  opReturnsAtom: boolean,
  cursor?: CursorMode,
  emitter?: MettaAnswerEmitter,
): Gen<[Array<[Atom, Bindings]>, St]> {
  const effectPolicy = groundedEffectPolicy(env, op);
  if (groundedEffectRejected(st.world, effectPolicy))
    return yield* finishDirectGroundedApplicationG(
      env,
      fuel,
      st,
      bnd,
      wApp,
      queryVars,
      opReturnsAtom,
      {
        tag: "incorrectArgument",
        msg: `${op}: irreversible effect is not allowed in an isolated branch`,
      },
      cursor,
      emitter,
    );
  const groundedArgs = args.map((arg) =>
    resolveStates(st.world, subTokens(st.world, arg, env.intern)),
  );
  const result = yield* callGroundedG(env, st.world, op, groundedArgs);
  return yield* finishDirectGroundedApplicationG(
    env,
    fuel,
    st,
    bnd,
    wApp,
    queryVars,
    opReturnsAtom,
    result,
    cursor,
    emitter,
  );
}

/** Continue a direct grounded application after its one host call has settled. Keeping invocation and
 *  reduction separate lets a finite batch of admitted async calls share structured cancellation without
 *  replaying a host effect when one returned atom still needs ordinary MeTTa evaluation. */
function* finishDirectGroundedApplicationG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  wApp: ExprAtom,
  queryVars: readonly string[],
  opReturnsAtom: boolean,
  result: ReduceResult,
  cursor?: CursorMode,
  emitter?: MettaAnswerEmitter,
  recordEffects = true,
): Gen<[Array<[Atom, Bindings]>, St]> {
  let items: Item[];
  let next = st;
  switch (result.tag) {
    case "ok": {
      const operation = opOf(wApp);
      if (recordEffects && operation !== undefined)
        recordGroundedOperationEffects(
          st.world,
          operation,
          groundedEffectPolicy(env, operation),
          result.results,
        );
      const effects = applyReduceEffects(env, st, bnd, result.effects);
      if (effects.tag === "error") {
        items = [finItem(null, errAtom(wApp, effects.msg), bnd)];
      } else {
        next = effects.state;
        items = result.results.map((atom) => evalResult(null, atom, bnd, wApp));
      }
      break;
    }
    case "runtimeError":
      items = [finItem(null, errAtom(wApp, result.msg), bnd)];
      break;
    case "incorrectArgument":
      items = [finItem(null, errTextAtom(wApp, result.msg), bnd)];
      break;
    case "noReduce":
      [items, next] = queryOp(env, st, null, wApp, bnd);
      break;
  }
  const [pairs, reducedState] = yield* interpretLoopG(
    env,
    fuel,
    next,
    items,
    undefined,
    nestedCursorMode(cursor),
  );
  return yield* reduceRulePairsG(
    env,
    fuel,
    reducedState,
    queryVars,
    [],
    wApp,
    pairs,
    opReturnsAtom,
    cursor,
    emitter,
  );
}

class SchedulerCancellationError extends Error {
  readonly reason: CancellationReason;

  constructor(operation: string, reason: CancellationReason) {
    super(`${operation} cancelled: ${reason.message ?? reason.code}`);
    this.name = "SchedulerCancellationError";
    this.reason = reason;
  }
}

function schedulerCancellationError(
  operation: string,
  reason: CancellationReason,
): SchedulerCancellationError {
  return new SchedulerCancellationError(operation, reason);
}

function* closeScheduleG<T, R>(
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

function* chargeSchedulerStepsG(
  cursor: CursorMode | undefined,
  state: St,
  steps: number,
): Gen<void> {
  if (cursor === undefined) return;
  recordCursorSteps(cursor, steps);
  yield* flushCursorProgressG(cursor, state);
}

function* takeFirstScheduledAnswerG(
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

function* evaluateChoiceBranchesG(
  operation: "superpose" | "hyperpose",
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  call: Atom,
  argument: Atom,
  cursor: CursorMode | undefined,
  emitter: MettaAnswerEmitter | undefined,
): Gen<EvalRes> {
  if (argument.kind !== "expr")
    return [[[errTextAtom(call, `${operation} expects one expression`), bindings]], state];
  if (operation === "superpose") {
    const out: Array<[Atom, Bindings]> = [];
    const retainReturned = emitter?.retainReturnedAnswers;
    const sourceEmitter: MettaAnswerEmitter = {
      emitted: new WeakSet(),
      emittedCount: 0,
      omittedReturnCount: 0,
      ...(retainReturned === undefined ? {} : { retainReturnedAnswers: retainReturned }),
      lifecycle: emitter?.lifecycle ?? { unwinding: false },
      accept: function* (pair, answerState): Gen<St> {
        const expanded: ContextualPair[] =
          pair[0].kind === "expr"
            ? (pair[0].items[0]?.kind === "sym" && pair[0].items[0].name === ","
                ? pair[0].items.slice(1)
                : pair[0].items
              ).map(
                (atom): ContextualPair =>
                  pair[2] === undefined ? [atom, pair[1]] : [atom, pair[1], pair[2]],
              )
            : [
                pair[2] === undefined
                  ? [errTextAtom(call, "superpose expects one expression"), pair[1]]
                  : [errTextAtom(call, "superpose expects one expression"), pair[1], pair[2]],
              ];
        if (retainReturned !== false)
          for (const expandedPair of expanded) out.push([expandedPair[0], expandedPair[1]]);
        const next = yield* emitMettaAnswersG(emitter, expanded, answerState);
        if (emitter !== undefined && retainReturned === false)
          emitter.omittedReturnCount += expanded.length;
        return next;
      },
    };
    const [sourcePairs, sourceState] = yield* mettaEvalG(
      env,
      fuel,
      state,
      bindings,
      argument,
      cursor,
      sourceEmitter,
    );
    const terminal = yield* emitReturnedMettaAnswersG(sourceEmitter, sourcePairs, sourceState);
    return [out, terminal];
  }
  const branches =
    argument.items[0]?.kind === "sym" && argument.items[0].name === ","
      ? argument.items.slice(1)
      : argument.items;
  if (!choiceBranchesParallelSafe(env, state.world, branches)) {
    const out: Array<[Atom, Bindings]> = [];
    let current = state;
    for (const branch of branches) {
      const emittedAtStart = emitter?.emittedCount ?? 0;
      const omittedAtStart = emitter?.omittedReturnCount ?? 0;
      const [pairs, terminal] = yield* mettaEvalG(
        env,
        fuel,
        current,
        bindings,
        branch,
        cursor,
        emitter,
      );
      if (emitter?.retainReturnedAnswers !== false) out.push(...pairs);
      current =
        emitter === undefined
          ? terminal
          : yield* forwardReturnedMettaAnswersG(
              emitter,
              pairs,
              terminal,
              emittedAtStart,
              omittedAtStart,
            );
    }
    return [out, current];
  }
  const schedule = fairSchedule(operation, env, fuel, state, bindings, branches);
  const out: Array<[Atom, Bindings]> = [];
  let current = state;
  let continuationCounter = state.counter;
  let continuationIndex = 0;
  const hasContinuation = emitter?.accept !== undefined;
  const continuationDeltas: BranchStateDelta[] = [];
  let exhausted = false;
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  try {
    for (;;) {
      const event = (yield schedule.nextEffect()) as SearchEvent<MinimalSearchAnswer, St>;
      yield* chargeSchedulerStepsG(cursor, current, event.steps);
      switch (event.kind) {
        case "answer": {
          current = hasContinuation
            ? isolateAnswerContinuation(
                event.value.state,
                continuationIndex++,
                Math.max(continuationCounter, event.value.state.counter),
              )
            : event.value.state;
          const pair: [Atom, Bindings] = [event.value.atom, event.value.bindings];
          if (emitter?.retainReturnedAnswers !== false) out.push(pair);
          if (emitter !== undefined) {
            const continuationStart = current;
            current = yield* emitMettaAnswersG(emitter, [pair], current);
            if (emitter.retainReturnedAnswers === false) emitter.omittedReturnCount += 1;
            if (hasContinuation) {
              continuationCounter = current.counter;
              continuationDeltas.push(captureBranchStateDelta(continuationStart, current));
            }
          }
          break;
        }
        case "pending":
          break;
        case "exhausted":
          exhausted = true;
          current = event.terminal;
          for (const delta of continuationDeltas)
            current = applyBranchStateDelta(env, current, delta);
          return [out, current];
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
    if (!exhausted)
      yield* closeScheduleG(
        schedule,
        { code: "parent-closed", message: `${operation} tail closed` },
        unwind,
      );
  }
}

function* runCompiledCooperativelyG(
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

function argumentMayProduceAlternatives(env: MinEnv, world: World, argument: Atom): boolean {
  if (argument.kind === "gnd") return false;
  if (argument.kind === "var") return true;
  if (argument.kind === "sym")
    return (
      (env.ruleIndex.get(argument.name)?.length ?? 0) > 0 ||
      (world.selfRules.get(argument.name)?.length ?? 0) > 0 ||
      env.varRulesVar.length > 0 ||
      world.selfVarRules.length > 0
    );
  if (argument.items.length === 0) return false;
  if (isNormalForm(env, world, argument)) return false;
  const operation = opOf(argument);
  if (operation === undefined) return true;
  const grounded = env.gt.get(operation);
  if (grounded !== undefined && isSingleResultGroundedOp(operation, grounded)) return false;
  const compiled = env.compiled?.get(operation);
  return !(
    compiled?.kind === "functional" &&
    !world.selfRules.has(operation) &&
    !staticRulesChangedFor(world, operation) &&
    world.selfVarRules.length === 0
  );
}

interface DirectAsyncGroundedApplication {
  readonly application: ExprAtom;
  readonly op: string;
  readonly args: readonly Atom[];
  readonly queryVars: readonly string[];
  readonly opReturnsAtom: boolean;
}

function directAsyncGroundedApplication(
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

function sameBindingRelations(left: Bindings, right: Bindings): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const l = left[index]!;
    const r = right[index]!;
    if (l.tag !== r.tag || l.x !== r.x) return false;
    if (l.tag === "val") {
      if (r.tag !== "val" || !atomEq(l.a, r.a)) return false;
    } else if (r.tag !== "eq" || l.y !== r.y) {
      return false;
    }
  }
  return true;
}

function rememberGroundEvaluation(
  env: MinEnv,
  input: Atom,
  bindings: Bindings,
  start: St,
  pairs: readonly [Atom, Bindings][],
  end: St,
): void {
  if (
    input.kind !== "expr" ||
    !input.ground ||
    pairs.length !== 1 ||
    !atomEq(pairs[0]![0], input) ||
    !sameBindingRelations(pairs[0]![1], bindings) ||
    end.world !== start.world
  )
    return;
  env.evaluatedAtoms.add(input);
}

function* mettaEvalG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
  cursor?: CursorMode,
  emitter?: MettaAnswerEmitter,
  preEvaluatedApplication?: PreEvaluatedApplication,
): Gen<[Array<[Atom, Bindings]>, St]> {
  const selected = refreshEvaluationEnvironment(env, st.world);
  const input = inst(selected, bnd, a);
  if (input.kind === "expr" && input.ground) {
    if (selected.evaluatedAtoms.has(input)) return [[[input, bnd]], st];
    if (
      selected.varRulesVar.length === 0 &&
      st.world.selfVarRules.length === 0 &&
      isNormalForm(selected, st.world, input)
    ) {
      selected.evaluatedAtoms.add(input);
      return [[[input, bnd]], st];
    }
  }
  const [pairs, endState] = yield* mettaEvalUncachedG(
    selected,
    fuel,
    st,
    bnd,
    a,
    input,
    cursor,
    emitter,
    preEvaluatedApplication,
  );
  rememberGroundEvaluation(selected, input, bnd, st, pairs, endState);
  return [pairs, endState];
}

function* mettaEvalUncachedG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
  w: Atom,
  cursor?: CursorMode,
  emitter?: MettaAnswerEmitter,
  preEvaluatedApplication?: PreEvaluatedApplication,
): Gen<[Array<[Atom, Bindings]>, St]> {
  checkWorldCancellation(st.world);
  consumeWorldResource(st.world, "steps", 1, "metta-eval");
  checkWorldDeadline(st.world, "metta-eval");
  const cooperativeSearch = cursor?.kind === "cooperative";
  if (fuel <= 0) return [[[makeExpr(env, [sym("Error"), w, sym("StackOverflow")]), bnd]], st];
  // Constructor / normal-form short-circuit (Curry's constructor/defined partition; Hanus' incremental
  // normalization). A non-ground operator-headed term whose head is a constructor and whose arguments are all
  // already in normal form cannot reduce, so it is its own value: skip the re-instantiation, argument
  // re-evaluation, and reduce-probe the type-directed loop would otherwise repeat each time a data subterm (a
  // proof/type term in a backward chainer) is revisited. Ground terms take the evaluated-mark path above.
  // Enabled only when no catch-all (`($x …)`) equation exists, so `candidatesW` for every constructor-headed
  // node is empty: re-evaluating the term advances the fresh-variable counter by zero and mutates no state, so
  // returning it directly is byte-identical to the full path. (`METTA_CTOR_SC=0` disables it for A/B.)
  if (
    CTOR_SC &&
    w.kind === "expr" &&
    !w.ground &&
    w.items.length > 0 &&
    env.varRulesVar.length === 0 &&
    st.world.selfVarRules.length === 0 &&
    isNormalForm(env, st.world, w)
  )
    return [[[w, bnd]], st];
  if (w.kind === "expr" && w.items.length > 0) {
    const head = w.items[0]!;
    const executableV2 =
      head.kind === "gnd" && head.exec !== undefined
        ? groundedV2Registration(head.exec)
        : undefined;
    if (executableV2 !== undefined) {
      const originalArgs = a.kind === "expr" ? a.items.slice(1) : w.items.slice(1);
      const groundedArgs = w.items
        .slice(1)
        .map((argument) => resolveStates(st.world, subTokens(st.world, argument, env.intern)));
      return yield* reduceGroundedV2ApplicationG(
        executableV2,
        env,
        fuel,
        st,
        bnd,
        bnd,
        w,
        "<grounded-exec>",
        originalArgs,
        groundedArgs,
        queryVarsOf(originalArgs),
        false,
        cursor,
        emitter,
      );
    }
  }
  if (w.kind === "expr" && w.items.length > 0 && w.items[0]!.kind === "sym") {
    // Tail-call trampoline. A ground operator-headed call usually reduces in a linear chain (every
    // tail-recursive MeTTa function: count, iterate, a Peano walk). Reducing each step by recursing into
    // mettaEvalG grows the native JS stack a few frames per step, so a chain a few thousand deep overflows.
    // Here the single-continuation ground case loops instead: `la`/`lbnd`/`lst`/`lw` carry the current
    // atom, bindings, state, and instantiated form across iterations, and `pendingKeys` remembers the
    // chain's tabling keys so the whole chain still memoises when it terminates (flushReturn writes them).
    let la = a;
    let lbnd = bnd;
    let lst = st;
    let lw = w;
    let preparedApplication = preEvaluatedApplication;
    const pendingKeys: CompletedTableKey[] = [];
    const flushReturn = (res: Array<[Atom, Bindings]>, stR: St): [Array<[Atom, Bindings]>, St] => {
      const finalRes =
        distinctGroundEnabled(env) && res.every((pair) => pair[0].ground)
          ? dedupGroundPairs(res)
          : res;
      if (
        pendingKeys.length > 0 &&
        env.tableSpace !== undefined &&
        finalRes.every((p) => p[0].ground)
      ) {
        const prod = finalRes.map((p) => p[0]);
        for (const pending of pendingKeys) rememberGroundTable(env, pending, prod);
      }
      return [finalRes, stR];
    };
    reduceTrampoline: for (;;) {
      const op = (lw.items[0] as { name: string }).name;
      const args = lw.items.slice(1);
      const prepared = preparedApplication;
      if (prepared === undefined && isDiscardedFiniteMatch(env, lst.world, lw))
        return flushReturn([], lst);
      if (prepared === undefined && (op === "superpose" || op === "hyperpose") && args.length === 1)
        return yield* evaluateChoiceBranchesG(
          op,
          env,
          fuel,
          lst,
          lbnd,
          lw,
          args[0]!,
          cursor,
          emitter,
        );
      const directUniqueChoice =
        cooperativeSearch || prepared !== undefined
          ? undefined
          : tryFastUniqueChoiceFunction(env, lst.world, op, args);
      if (directUniqueChoice !== undefined)
        return flushReturn([[makeExpr(env, directUniqueChoice), lbnd]], lst);
      if (
        prepared === undefined &&
        !cooperativeSearch &&
        op === "unique-atom" &&
        args.length === 1 &&
        args[0]!.kind === "expr" &&
        opOf(args[0]!) === "collapse" &&
        args[0]!.items.length === 2 &&
        canRunChoicePlan(env, lst.world)
      ) {
        const collapsedCall = args[0]!.items[1]!;
        const planned = runDistinctChoicePlan(
          collapsedCall,
          choicePlanConstructor(env, lst.world),
          choicePlanDataExpression(env, lst.world),
          choicePlanApplication(env, lst.world),
        );
        if (planned !== undefined)
          return flushReturn([[makeExpr(env, [sym(","), ...planned]), lbnd]], lst);
        const collapsedOp = opOf(collapsedCall);
        const tableVersion =
          collapsedOp === undefined ||
          collapsedCall.kind !== "expr" ||
          checkApplication(env, lst.world, collapsedOp, collapsedCall.items.slice(1)) !== null
            ? undefined
            : groundTableVersionIfAdmissible(env, lst.world, collapsedOp, collapsedCall);
        if (
          collapsedOp !== undefined &&
          tableVersion === 0 &&
          lst.world.selfRules.size === 0 &&
          lst.world.selfVarRules.length === 0 &&
          !staticRuleSetChanged(lst.world) &&
          env.tableSpace !== undefined &&
          collapsedCall.kind === "expr"
        ) {
          const native = runDistinctIntRelation(
            env,
            collapsedOp,
            collapsedCall.items.slice(1),
            env.tableSpace.resourceBudget(),
          );
          if (native?.tag === "limit")
            return flushReturn(
              [[makeExpr(env, [sym("Error"), lw, sym("TableResourceLimit")]), lbnd]],
              lst,
            );
          if (native?.tag === "ok") {
            const unique = dedupAlphaStable([sym(","), ...native.answers]);
            return flushReturn([[makeExpr(env, unique), lbnd]], lst);
          }
        }
        if (collapsedOp !== undefined && collapsedCall.ground && tableVersion !== undefined) {
          const previousDepth = env.distinctGroundDepth;
          env.distinctGroundDepth = (previousDepth ?? 0) + 1;
          try {
            const [answers, distinctState] = yield* mettaEvalG(
              env,
              fuel - 1,
              lst,
              lbnd,
              collapsedCall,
              cursor,
            );
            enforceDistinctLimit(env, answers.length);
            const unique = dedupAlphaStable([sym(","), ...answers.map((answer) => answer[0])]);
            return flushReturn([[makeExpr(env, unique), lbnd]], distinctState);
          } catch (error) {
            if (error !== DISTINCT_RESOURCE_LIMIT) throw error;
            return flushReturn(
              [[makeExpr(env, [sym("Error"), lw, sym("TableResourceLimit")]), lbnd]],
              lst,
            );
          } finally {
            env.distinctGroundDepth = previousDepth;
          }
        }
      }
      if (prepared === undefined && !cooperativeSearch && op === "collapse" && args.length === 1) {
        if (canRunChoicePlan(env, lst.world)) {
          const planned = runChoicePlan(
            args[0]!,
            choicePlanConstructor(env, lst.world),
            choicePlanDataExpression(env, lst.world),
            choicePlanApplication(env, lst.world),
          );
          if (planned !== undefined)
            return flushReturn([[makeExpr(env, [sym(","), ...planned]), lbnd]], lst);
        }
        const match = matchInsideOnce(args[0]!);
        if (match !== undefined) {
          const namedMatch = tryFastNamedOnceMatch(env, lst, match, lbnd);
          if (namedMatch !== undefined) {
            const items = namedMatch.value === undefined ? [] : [namedMatch.value];
            return flushReturn([[expr([sym(","), ...items]), lbnd]], namedMatch.state);
          }
        }
      }
      if (prepared === undefined && op === "if" && args.length === 3) {
        const added = tryFastNamedAddIfAbsent(env, lst, lw, lbnd);
        if (added !== undefined)
          return flushReturn(added.added ? [[emptyExpr, lbnd]] : [], added.state);
      }
      if (prepared === undefined && op === "add-unique-or-fail" && args.length === 2) {
        const added = tryFastAddUniqueOrFailCall(env, lst, lw, lbnd);
        if (added !== undefined)
          return flushReturn(added.added ? [[emptyExpr, lbnd]] : [], added.state);
      }
      // Streaming `(length (collapse Z))` / `(size-atom (collapse Z))`: count Z's results with a folding sink
      // instead of materialising the collapsed tuple, walking it, and (via the array `interpretLoopG` would
      // otherwise build) holding every result at once. The emit-bound benchmarks are exactly this shape.
      // Byte-identical to the unfused path: `collapse` runs `collapse-bind (metta Z %Undefined%
      // (context-space))`, `(context-space)` is always `&self`, and `collapse-extract` is 1-to-1, so the count
      // equals that interpretation's result count. Gated to the grounded op (a user `length`/`size-atom` rule
      // disables it).
      if (
        prepared === undefined &&
        !cooperativeSearch &&
        (op === "length" || op === "size-atom") &&
        args.length === 1 &&
        args[0]!.kind === "expr" &&
        opOf(args[0]!) === "collapse" &&
        args[0]!.items.length === 2 &&
        !hasVisibleStaticRuleHead(env, lst.world, op) &&
        !lst.world.selfRules.has(op)
      ) {
        // Trail fast path: `(length (collapse (match space pat _)))` counts the match's solutions with no
        // per-solution allocation (matchCountTrail). `countOnlyMatch` would neutralize the template to a
        // ground unit, so the result count equals the solution count; we count solutions directly. Falls
        // through to the streaming interpretation when the trail declines or the collapsed atom is not a
        // bare `match` (e.g. peano's `(demo-peano ...)`).
        const z = args[0]!.items[1]!;
        if (z.kind === "expr" && opOf(z) === "match" && z.items.length === 4) {
          const counted = yield* countTailMatchG(env, fuel, lst, lbnd, z, cursor);
          return flushReturn([[gint(BigInt(counted.count)), lbnd]], counted.state);
        }
        const routed = yield* tryCollapseRouteG(env, fuel, lst, lbnd, z, cursor);
        if (routed !== undefined)
          return flushReturn([[gint(BigInt(routed.count)), lbnd]], routed.state);
        let count = 0;
        const [, stC] = yield* interpretLoopG(
          env,
          fuel,
          lst,
          [
            {
              stack: admitAtom(
                expr([sym("metta"), countOnlyMatch(args[0]!.items[1]!), UNDEF, sym("&self")]),
                null,
              ),
              bnd: lbnd,
            },
          ],
          () => {
            count++;
          },
          nestedCursorMode(cursor),
        );
        return flushReturn([[gint(BigInt(count)), lbnd]], stC);
      }
      const opSig = prepared?.signature ?? typeViewFor(env, lst.world).sigs.get(op);
      const appErr =
        prepared === undefined ? checkApplication(env, lst.world, op, args, opSig) : null;
      if (appErr !== null) return flushReturn([[appErr, lbnd]], lst);
      if (
        prepared === undefined &&
        !cooperativeSearch &&
        op === "case" &&
        args.length === 2 &&
        args[0]!.kind === "expr" &&
        opOf(args[0]!) === "match" &&
        args[0]!.items.length === 4 &&
        args[1]!.kind === "expr" &&
        canStreamStdlibCase(env, lst.world)
      ) {
        const source = streamCaseSource(env, lst, lbnd, args[0]! as ExprAtom, args[1]!);
        if (source !== undefined) {
          const [selected, stCase] = yield* interpretLoopG(
            env,
            fuel,
            lst,
            source,
            undefined,
            nestedCursorMode(cursor),
          );
          const [pairs, stReduced] = yield* reduceChildrenG(
            env,
            fuel,
            stCase,
            selected,
            () => undefined,
            cursor,
            emitter,
          );
          return flushReturn(pairs, stReduced);
        }
      }
      const originalArgs = prepared?.originalArgs ?? args;
      const groundedOriginalArgs =
        prepared?.originalArgs ?? (la.kind === "expr" ? la.items.slice(1) : args);
      const queryVars = prepared?.queryVars ?? queryVarsOf(args);
      // Reuse the one signature lookup (opSig, from the applicability check above) across argMask and the
      // per-result returnsAtom check in the reduce loop below.
      const sig = opSig;
      const opReturnsAtom =
        sig !== undefined && sig.length > 0 && atomEq(sig[sig.length - 1]!, sym("Atom"));
      // Concurrency primitives drive their own branches; their arguments stay unevaluated regardless of
      // arity, so a `par`/`race`/`with-mutex` branch is evaluated concurrently, not eagerly in sequence.
      const mask = LAZY_ARGS_OPS.has(op)
        ? args.map(() => false)
        : LEATTA_EVAL_ARGS_OPS.has(op)
          ? args.map(() => true)
          : argMask(sig, args.length);
      if (
        prepared === undefined &&
        env.agt.has(op) &&
        groundedV2For(env, op) === undefined &&
        !(pettaOpNames.has(op) && hasRuleFor(env, lst.world, lst.counter, lw)) &&
        args.every(
          (argument, index) =>
            mask[index] !== true || (argument.ground && isNormalForm(env, lst.world, argument)),
        )
      )
        return yield* reduceDirectAsyncGroundedApplicationG(
          env,
          fuel,
          lst,
          lbnd,
          lw,
          op,
          args,
          queryVars,
          opReturnsAtom,
          cursor,
          emitter,
        );
      // (1) type-directed argument evaluation, binding-threaded
      let partials: Array<[Atom[], Bindings]> = [[[], []]];
      let cur = lst;
      if (prepared !== undefined) {
        partials = [[args, lbnd]];
      } else if (
        cooperativeSearch &&
        args.some(
          (argument, index) =>
            mask[index] === true && argumentMayProduceAlternatives(env, lst.world, argument),
        )
      ) {
        const streamedOut: Array<[Atom, Bindings]> = [];
        let streamedAnswerCount = 0;
        const partialCounts = args.map(() => 0);
        const recordPartial = (depth: number): void => {
          const count = (partialCounts[depth - 1] ?? 0) + 1;
          partialCounts[depth - 1] = count;
          enforceDistinctLimit(env, count);
        };
        const evaluateArguments = function* (
          index: number,
          state: St,
          accAtoms: readonly Atom[],
          accB: Bindings,
        ): Gen<St> {
          if (index === args.length) {
            const application = accAtoms.every((atom, atomIndex) => atom === args[atomIndex])
              ? lw
              : makeExpr(env, [sym(op), ...accAtoms]);
            const emittedAtStart = emitter?.emittedCount ?? 0;
            const omittedAtStart = emitter?.omittedReturnCount ?? 0;
            const [answers, reducedState] = yield* mettaEvalG(
              env,
              fuel,
              state,
              accB,
              application,
              cursor,
              emitter,
              { originalArgs: args, queryVars, signature: sig },
            );
            if (emitter?.retainReturnedAnswers !== false) streamedOut.push(...answers);
            streamedAnswerCount += answers.length;
            enforceDistinctLimit(env, streamedAnswerCount);
            return emitter === undefined
              ? reducedState
              : yield* forwardReturnedMettaAnswersG(
                  emitter,
                  answers,
                  reducedState,
                  emittedAtStart,
                  omittedAtStart,
                );
          }

          const argument = args[index]!;
          if (!mask[index]!) {
            recordPartial(index + 1);
            return yield* evaluateArguments(
              index + 1,
              state,
              [...accAtoms, inst(env, accB, argument)],
              accB,
            );
          }

          const retainReturned = emitter?.retainReturnedAnswers;
          const argumentEmitter: MettaAnswerEmitter = {
            emitted: new WeakSet(),
            emittedCount: 0,
            omittedReturnCount: 0,
            ...(retainReturned === undefined ? {} : { retainReturnedAnswers: retainReturned }),
            lifecycle: emitter?.lifecycle ?? { unwinding: false },
            accept: function* (pair, answerState): Gen<St> {
              recordPartial(index + 1);
              return yield* evaluateArguments(
                index + 1,
                answerState,
                [...accAtoms, pair[0]],
                mergeRestrict(env, queryVars, accB, pair[1]),
              );
            },
          };
          const [answers, argumentState] = yield* mettaEvalG(
            env,
            fuel - 1,
            state,
            accB,
            argument,
            cursor,
            argumentEmitter,
          );
          return yield* emitReturnedMettaAnswersG(argumentEmitter, answers, argumentState);
        };
        cur = yield* evaluateArguments(0, cur, [], []);
        return flushReturn(streamedOut, cur);
      } else {
        for (let i = 0; i < args.length; i++) {
          const ae = args[i]!;
          const evalThis = mask[i]!;
          const nextParts: Array<[Atom[], Bindings]> = [];
          for (const [accAtoms, accB] of partials) {
            if (evalThis) {
              const [ps, st2] = yield* mettaEvalG(env, fuel - 1, cur, accB, ae, cursor);
              cur = st2;
              for (const p of ps) {
                nextParts.push([[...accAtoms, p[0]], mergeRestrict(env, queryVars, accB, p[1])]);
              }
            } else {
              nextParts.push([[...accAtoms, inst(env, accB, ae)], accB]);
            }
          }
          enforceDistinctLimit(env, nextParts.length);
          partials = nextParts;
        }
      }
      // (2) reduce each combination
      const out: Array<[Atom, Bindings]> = [];
      let cur2 = cur;
      const tabling = !cooperativeSearch && env.tableSpace !== undefined && queryVars.length === 0;
      for (const [partAtoms, partB] of partials) {
        // error propagation: a type-directed-evaluated arg reduced to an error and changed
        let errFound: Atom | undefined;
        for (let i = 0; i < partAtoms.length; i++) {
          if (isErrorAtom(partAtoms[i]!) && !atomEq(partAtoms[i]!, originalArgs[i]!)) {
            errFound = partAtoms[i]!;
            break;
          }
        }
        if (errFound !== undefined) {
          out.push([errFound, partB]);
          continue;
        }
        // Reuse `lw` when every evaluated argument came back as the very object that went in, instead of
        // rebuilding an equal copy. The no-reduce exits below mark and return `wApp`, so preserving the
        // input's identity is what lets the evaluated-mark short-circuit hit on a later revisit of this
        // object. The plain log stores the rebuilt copy (so either object works there), but the flat
        // store re-decodes one canonical object per term: marking a fresh copy per visit while the
        // canonical object stays unmarked re-descended peano's whole S^n spine every round, O(K^3).
        const wApp = partAtoms.every((p, i) => p === args[i])
          ? lw
          : makeExpr(env, [sym(op), ...partAtoms]);
        let interpretedApplication = wApp;
        // PeTTa-style partial application: grounded ops and untyped lowercase user functions applied to
        // fewer arguments than their arity become `(partial fn (args))` closures. Requires at least one
        // argument, so a nullary thunk is still evaluated rather than curried.
        if (partAtoms.length >= 1) {
          const ar = functionArity(env, cur2.world, op);
          if (ar !== undefined && partAtoms.length < ar) {
            out.push([makeExpr(env, [sym("partial"), sym(op), makeExpr(env, partAtoms)]), partB]);
            continue;
          }
        }
        const groundedV2 = groundedV2For(env, op);
        if (
          groundedV2 !== undefined &&
          !(pettaOpNames.has(op) && hasRuleFor(env, cur2.world, cur2.counter, wApp))
        ) {
          const groundedArgs = partAtoms.map((argument) =>
            resolveStates(cur2.world, subTokens(cur2.world, argument, env.intern)),
          );
          const mergedCallBindings = merge(lbnd, partB);
          const [answers, groundedState] = yield* reduceGroundedV2ApplicationG(
            groundedV2,
            env,
            fuel,
            cur2,
            partB,
            mergedCallBindings[0] ?? partB,
            wApp,
            op,
            groundedOriginalArgs,
            groundedArgs,
            queryVars,
            opReturnsAtom,
            cursor,
            emitter,
          );
          cur2 = groundedState;
          out.push(...answers);
          enforceDistinctLimit(env, out.length);
          continue;
        }
        const fastTilePuzzle = cooperativeSearch
          ? undefined
          : tryFastTilePuzzleBfsAll(env, cur2, wApp);
        if (fastTilePuzzle !== undefined) {
          cur2 = fastTilePuzzle.state;
          for (const [value, rb] of fastTilePuzzle.results)
            out.push([value, mergeRestrict(env, queryVars, partB, rb)]);
          continue;
        }
        const fastQueue = tryFastQueueCall(env, cur2, wApp);
        if (fastQueue !== undefined) {
          if (cooperativeSearch) yield* chargeSchedulerStepsG(cursor, cur2, 1);
          cur2 = fastQueue.state;
          for (const [value, rb] of fastQueue.results)
            out.push([value, mergeRestrict(env, queryVars, partB, rb)]);
          continue;
        }
        let modedTableAdmissible = false;
        let modedRuntimeVersion = 0;
        if (
          !cooperativeSearch &&
          env.tableSpace !== undefined &&
          !wApp.ground &&
          keyWellFormed(wApp)
        ) {
          const runtimeRulesVisible =
            cur2.world.selfRules.size > 0 || cur2.world.selfVarRules.length > 0;
          modedRuntimeVersion = runtimeRulesVisible ? cur2.world.selfRuleVersion : 0;
          if (runtimeRulesVisible) {
            modedTableAdmissible =
              runtimeFunctorPureModed(env, cur2.world, op) &&
              runtimeFunctorTableWorth(env, cur2.world, op, true) &&
              !containsImpureHead(env, cur2.world, wApp, MODED_IMPURE_OPS, true);
          } else {
            modedTableAdmissible =
              !staticRuleSetChanged(cur2.world) &&
              (env.modedPureFunctors?.has(op) ?? false) &&
              (env.modedTableWorth?.has(op) ?? false) &&
              !containsImpureHead(env, cur2.world, wApp, MODED_IMPURE_OPS, true);
          }
        }
        // Compiled fast path. A nondeterministic group runs before a profitable moded table only when a
        // later recursive call consumes a clause-local answer field. Independent overlap such as relational
        // Fibonacci stays table-first; dependent BFC joins avoid retaining their intermediate relation.
        const compiledHolder = env.compiled?.get(op);
        const preferCompiledModed =
          compiledHolder?.kind === "nondet" && compiledHolder.preferDirectForModed;
        if (
          env.compiled !== undefined &&
          (!modedTableAdmissible || preferCompiledModed) &&
          !cur2.world.selfRules.has(op) &&
          !staticRulesChangedFor(cur2.world, op) &&
          cur2.world.selfVarRules.length === 0
        ) {
          let cr: CompiledRunResult | undefined;
          if (cooperativeSearch) {
            const cooperative = yield* runCompiledCooperativelyG(env, op, partAtoms, cur2, cursor!);
            if (cooperative?.kind === "done") cr = cooperative.result;
            else if (cooperative?.kind === "bail")
              interpretedApplication = makeExpr(env, [sym(op), ...cooperative.residualArgs]);
          } else {
            cr = runCompiled(env, op, partAtoms, cur2, COMPILED_IMPURE_OPS, undefined, fuel);
          }
          if (cr !== undefined) {
            // A compiled holder returns the one-step rule-application results (the instantiated RHSs) plus
            // the counter advance the candidate scan would have cost. Reduce each result to normal form
            // exactly as the interpreted rule-application path does (the `pairs` loop below), so a RHS with
            // reducible subterms (a recursive call, a grounded op) finishes evaluating and the fresh-variable
            // counter stays in lockstep.
            // An impure compiled body runs the slot machine to completion (every recursive call resolves
            // through the holder, every grounded op is computed) or BAILs; it never returns a half-reduced
            // term. So its result is already normal form and the re-reduce below only re-walks it. For a
            // deep binary build (matespace rewriteK) that re-walk is the dominant cost and advances the
            // fresh-variable counter past what the build needed. Skip it. The result stays alpha-equivalent
            // to the interpreted path (the gensym counter only names fresh vars, so a different count yields
            // a consistently-renamed term, never a captured one), which is exactly the equality the oracle
            // and LeaTTa check (`alphaEq`). Pure compiled results keep the re-reduce (unchanged).
            const impResult = cr.state !== undefined;
            if (cr.state !== undefined) cur2 = cr.state;
            else if (cr.counterDelta !== 0)
              cur2 = {
                counter: cur2.counter + cr.counterDelta,
                world: cur2.world,
              };
            for (const r of cr.results) {
              const pb = mergeRestrict(env, queryVars, partB, r.bnd);
              if (atomEq(r.atom, notReducibleA) || atomEq(r.atom, wApp)) {
                out.push([wApp, partB]);
              } else if ((opReturnsAtom || impResult) && !isEmbeddedOp(r.atom)) {
                out.push([r.atom, pb]);
              } else {
                const [more, st4] = yield* mettaEvalG(env, fuel - 1, cur2, pb, r.atom, cursor);
                cur2 = st4;
                for (const m of more) out.push([m[0], mergeRestrict(env, queryVars, pb, m[1])]);
              }
            }
            continue;
          }
        }
        // Ground tabling uses separate domains for the normal ordered bag and a distinct answer set requested
        // by unique(collapse ...). Runtime rules are version-keyed; purely static calls use version 0.
        let eligible = false;
        let key: CompletedTableKey | undefined;
        if (tabling && wApp.ground) {
          const runtimeVersion = groundTableVersionIfAdmissible(env, cur2.world, op, wApp);
          if (runtimeVersion !== undefined) {
            eligible = true;
            key = env.tableSpace!.key(
              distinctGroundEnabled(env) ? "ground-distinct" : "ground",
              wApp,
              runtimeVersion,
            );
          }
          if (eligible) {
            const hit = key === undefined ? undefined : env.tableSpace!.getCompleted(key);
            if (hit !== undefined) {
              for (const r of hit.results) out.push([r, partB]);
              continue;
            }
          }
        }
        // moded tabling: memoise a PURE call that itself carries free variables (a backward-chaining
        // search's own output/existential variables, e.g. the proof term `$x` in `(obc $s (: $x $a))`),
        // keyed by the same structural variant token scheme as ground tabling. Entirely separate from
        // ground tabling just above: applies only
        // when `wApp` is NOT ground (ground tabling already covers that case), independent of `queryVars`/
        // `tabling` (which require there be no query variables at all — the opposite of what this needs).
        // A direct active variant re-entry replays the answers known so far and marks the active table
        // cyclic. The producer below then re-runs until no new canonical answers appear. Non-top active hits
        // remain conservative because mutual-recursive SCC completion needs producer state for every entry.
        let modedEligible = false;
        let modedKey: CompletedTableKey | undefined;
        let modedMap: Map<string, string> | undefined;
        let modedNumCallVars = 0;
        let modedActive: ActiveTableEntry | undefined;
        let modedCallVarNames: readonly string[] = [];
        if (modedTableAdmissible) {
          const tableSpace = env.tableSpace!;
          const encoded = tableSpace.key("moded", wApp, modedRuntimeVersion);
          const modedHit = tableSpace.getCompleted(encoded);
          if (modedHit !== undefined) {
            for (const cachedResult of modedHit.results) {
              const [freshened, stF] = freshenModedResult(
                cur2,
                cachedResult,
                encoded.varNames,
                modedHit.numCallVars,
              );
              cur2 = stF;
              out.push([freshened, partB]);
            }
            continue;
          }
          const active = tableSpace.getActive(encoded);
          if (active !== undefined && tableSpace.isTopActive(active)) {
            tableSpace.markCyclic(active);
            for (const cachedResult of active.results) {
              const [freshened, stF] = freshenModedResult(
                cur2,
                cachedResult,
                encoded.varNames,
                active.numCallVars,
              );
              cur2 = stF;
              out.push([freshened, partB]);
            }
            continue;
          }
          const started =
            active === undefined
              ? tableSpace.beginActive(encoded, encoded.varNames.length)
              : undefined;
          if (started === null) {
            out.push([makeExpr(env, [sym("Error"), wApp, sym("TableResourceLimit")]), partB]);
            continue;
          }
          if (started !== undefined) {
            modedEligible = true;
            modedKey = encoded;
            modedMap = encoded.canonicalMap;
            modedNumCallVars = encoded.varNames.length;
            modedActive = started;
            modedCallVarNames = encoded.varNames;
          }
        }
        const before = out.length;
        try {
          const runProducerPass = function* (start: St): Gen<[Array<[Atom, Bindings]>, St]> {
            const [pairs, st3] = yield* interpretLoopG(
              env,
              fuel,
              start,
              [
                {
                  stack: admitAtom(makeExpr(env, [sym("eval"), interpretedApplication]), null),
                  bnd: lbnd,
                },
              ],
              undefined,
              nestedCursorMode(cursor),
            );
            return yield* reduceRulePairsG(
              env,
              fuel,
              st3,
              queryVars,
              partB,
              interpretedApplication,
              pairs,
              opReturnsAtom,
              cursor,
              emitter,
            );
          };
          if (modedEligible) {
            const active = modedActive!;
            const start = cur2;
            const map = modedMap!;
            const [firstPass, firstState] = yield* runProducerPass(start);
            cur2 = firstState;
            const firstCanonical = firstPass.map((p) => canonicalize(p[0], map));
            if (!active.cyclic) {
              for (const p of firstPass) out.push(p);
              rememberModedTable(env, modedKey!, modedNumCallVars, firstCanonical);
            } else {
              let added = env.tableSpace!.addActiveAnswers(active, firstCanonical);
              let maxCounter = Math.max(start.counter, firstState.counter);
              let rounds = 1;
              while (added > 0 && !active.overBudget) {
                if (rounds >= fuel) {
                  out.push([makeExpr(env, [sym("Error"), wApp, sym("StackOverflow")]), partB]);
                  added = 0;
                  break;
                }
                const [pass, passState] = yield* runProducerPass(start);
                maxCounter = Math.max(maxCounter, passState.counter);
                added = env.tableSpace!.addActiveAnswers(
                  active,
                  pass.map((p) => canonicalize(p[0], map)),
                );
                rounds++;
              }
              cur2 = { counter: maxCounter, world: start.world };
              if (active.overBudget) {
                out.push([makeExpr(env, [sym("Error"), wApp, sym("TableResourceLimit")]), partB]);
              } else if (out.length === before) {
                for (const cachedResult of active.results) {
                  const [freshened, stF] = freshenModedResult(
                    cur2,
                    cachedResult,
                    modedCallVarNames,
                    active.numCallVars,
                  );
                  cur2 = stF;
                  out.push([freshened, partB]);
                }
                rememberModedTable(env, modedKey!, modedNumCallVars, active.results);
              }
            }
          } else {
            const producerWork: Item[] = [
              {
                stack: admitAtom(makeExpr(env, [sym("eval"), interpretedApplication]), null),
                bnd: lbnd,
              },
            ];
            let pairs: ContextualPair[];
            if (
              cooperativeSearch &&
              emitter !== undefined &&
              !distinctGroundEnabled(env) &&
              !eligible
            ) {
              // Stream rule alternatives through their reduction as they are produced, so a
              // nested consumer such as `once` can close the tail. A single-answer chain returns
              // whole and keeps the trampoline below.
              const pass = yield* streamedInterpretedPassG(
                env,
                fuel,
                cur2,
                producerWork,
                queryVars,
                partB,
                interpretedApplication,
                opReturnsAtom,
                cursor,
                emitter,
              );
              cur2 = pass.state;
              if (pass.kind === "streamed") {
                for (const r of pass.out) out.push(r);
                pairs = [];
              } else {
                pairs = pass.pair === undefined ? [] : [pass.pair];
              }
            } else {
              const [batchPairs, st3] = yield* interpretLoopG(
                env,
                fuel,
                cur2,
                producerWork,
                undefined,
                nestedCursorMode(cursor),
              );
              cur2 = st3;
              pairs = batchPairs;
            }
            // Tail call: one ground call reducing to a single operator-headed continuation, with no branching
            // (one partial, one pair) and no bindings to thread (queryVars empty). Loop on the continuation
            // via reduceTrampoline instead of recursing into mettaEvalG, so the native stack stays flat down a
            // deep tail-recursive chain. Defer this call's tabling key to pendingKeys: it shares the chain's
            // normal form, so flushReturn caches it (and every key above it) once the chain terminates.
            if (
              partials.length === 1 &&
              queryVars.length === 0 &&
              pairs.length === 1 &&
              pairs[0]![2] === undefined
            ) {
              const p = pairs[0]!;
              // Every Error atom is terminal data. Re-feeding one into the trampoline can reproduce the
              // same failure forever because the trampoline does not decrement fuel.
              if (isErrorAtom(p[0]))
                return flushReturn([[p[0], mergeRestrict(env, queryVars, partB, p[1])]], cur2);
              const isData = atomEq(p[0], notReducibleA) || atomEq(p[0], interpretedApplication);
              if (!isData && !(opReturnsAtom && !isEmbeddedOp(p[0])) && opOf(p[0]) !== undefined) {
                const pb = mergeRestrict(env, queryVars, partB, p[1]);
                if (eligible && key !== undefined) pendingKeys.push(key);
                la = p[0];
                lbnd = pb;
                lst = cur2;
                // p[0] is operator-headed (opOf check) and instantiate preserves the head, so this stays an
                // expression headed by a symbol, exactly what the loop top reads as `lw.items[0]`.
                lw = inst(env, lbnd, la) as ExprAtom;
                preparedApplication = undefined;
                continue reduceTrampoline;
              }
            }
            const [reduced, st4] = yield* reduceRulePairsG(
              env,
              fuel,
              cur2,
              queryVars,
              partB,
              interpretedApplication,
              pairs,
              opReturnsAtom,
              cursor,
              emitter,
            );
            cur2 = st4;
            const producedPairs =
              distinctGroundEnabled(env) && reduced.every((pair) => pair[0].ground)
                ? dedupGroundPairs(reduced)
                : reduced;
            enforceDistinctLimit(env, producedPairs.length);
            for (const r of producedPairs) out.push(r);
            if (eligible) {
              const produced = producedPairs.map((p) => p[0]);
              if (key !== undefined && produced.every((a) => a.ground))
                rememberGroundTable(env, key, produced);
            }
          }
        } finally {
          // Cleared on every exit (success, an uncaught grounded-op error, or a native stack overflow
          // unwinding through here) so a call that fails partway never leaves its key stuck active. Only ever
          // removes a key this same iteration added.
          if (modedEligible && modedKey !== undefined) env.tableSpace?.endActive(modedKey);
        }
      }
      return flushReturn(out, cur2);
    }
  }

  if (w.kind === "expr" && w.items.length > 0) {
    // expression-headed application
    const ruleWork: Item[] = [{ stack: admitAtom(makeExpr(env, [sym("eval"), w]), null), bnd }];
    const isDataFinal = (p: ContextualPair): boolean =>
      atomEq(p[0], w) || atomEq(p[0], notReducibleA);
    let st1: St;
    let reduced: ContextualPair[];
    if (cooperativeSearch && emitter !== undefined && !distinctGroundEnabled(env)) {
      // Stream expression-headed rule alternatives through their reduction as they are produced,
      // with the same one-alternative lookahead as the interpreted-application pass: a single
      // alternative keeps the batch tail, data finals only feed the tuple-fallback decision.
      let first: ContextualPair | undefined;
      let firstState: St | undefined;
      let streaming = false;
      const out: Array<[Atom, Bindings]> = [];
      const retain = emitter.retainReturnedAnswers;
      const reduceOne = function* (p: ContextualPair, state: St): Gen<St> {
        const selected = refreshEvaluationEnvironment(p[2] ?? env, state.world);
        const [more, st4] = yield* mettaEvalG(selected, fuel - 1, state, p[1], p[0], cursor);
        if (retain !== false) out.push(...more);
        const after = yield* emitMettaAnswersG(emitter, more, st4);
        if (retain === false) emitter.omittedReturnCount += more.length;
        return after;
      };
      const acceptRule = function* (pair: ContextualPair, state: St): Gen<St> {
        if (isDataFinal(pair)) return state;
        if (!streaming) {
          if (first === undefined) {
            first = pair;
            firstState = state;
            return state;
          }
          streaming = true;
          const held = first;
          first = undefined;
          state = yield* reduceOne(held, state);
        }
        return yield* reduceOne(pair, state);
      };
      try {
        const [, endState] = yield* interpretLoopG(
          env,
          fuel,
          st,
          ruleWork,
          undefined,
          nestedCursorMode(cursor),
          acceptRule,
        );
        if (streaming) return [out, endState];
        st1 = endState;
        reduced = first === undefined ? [] : [first];
      } catch (error) {
        // A fault after one held alternative still delivers that alternative first; a
        // consumer-close unwind discards it instead.
        if (first !== undefined && emitter.lifecycle.unwinding !== true) {
          const held = first;
          first = undefined;
          try {
            yield* reduceOne(held, firstState!);
          } catch (flushError) {
            throw combineInitiatingAndCleanupFailure(
              error,
              flushError,
              "interpreted alternatives and their delivery both failed",
            );
          }
        }
        throw error;
      }
    } else {
      const [ruleRes, batchState] = yield* interpretLoopG(
        env,
        fuel,
        st,
        ruleWork,
        undefined,
        nestedCursorMode(cursor),
      );
      st1 = batchState;
      reduced = ruleRes.filter((p) => !isDataFinal(p));
    }
    if (reduced.length === 0) {
      const tupleWork: Item[] = [
        {
          stack: admitAtom(
            makeExpr(env, [sym("eval"), makeExpr(env, [sym("interpret-tuple"), w, sym("&self")])]),
            null,
          ),
          bnd,
        },
      ];
      // the interpret-tuple fallback: a tuple element equal to the whole term is already final.
      const finalTupleElement = (p: ContextualPair): Array<[Atom, Bindings]> | undefined =>
        atomEq(p[0], w) ? [[p[0], p[1]]] : undefined;
      if (cooperativeSearch) {
        // Stream the tuple's item cross-product through evaluator continuations, mirroring the
        // stdlib interpret-tuple chain: items evaluate left to right, each combination rebuilds
        // the tuple and reduces it as soon as it exists. A nested consumer such as `once` can
        // then close the unvisited tail, and no alternative bag is retained after its answers
        // cross the emitter boundary.
        const out: Array<[Atom, Bindings]> = [];
        const retainReturned = emitter?.retainReturnedAnswers;
        const evaluateTupleItems = function* (
          index: number,
          state: St,
          accItems: readonly Atom[],
          accB: Bindings,
        ): Gen<St> {
          if (index === w.items.length) {
            const rebuilt = accItems.every((item, itemIndex) => item === w.items[itemIndex])
              ? w
              : makeExpr(env, [...accItems]);
            const pair: ContextualPair = [rebuilt, accB];
            const term = finalTupleElement(pair);
            let produced: Array<[Atom, Bindings]>;
            let next = state;
            if (term !== undefined) {
              produced = term;
            } else {
              const [more, reducedState] = yield* mettaEvalG(
                env,
                fuel - 1,
                state,
                accB,
                rebuilt,
                cursor,
              );
              produced = more;
              next = reducedState;
            }
            if (retainReturned !== false) out.push(...produced);
            if (emitter !== undefined) {
              next = yield* emitMettaAnswersG(emitter, produced, next);
              if (retainReturned === false) emitter.omittedReturnCount += produced.length;
            }
            return next;
          }
          const item = w.items[index]!;
          const itemEmitter: MettaAnswerEmitter = {
            emitted: new WeakSet(),
            emittedCount: 0,
            omittedReturnCount: 0,
            retainReturnedAnswers: false,
            lifecycle: emitter?.lifecycle ?? { unwinding: false },
            accept: function* (pair, answerState): Gen<St> {
              const merged = merge(accB, pair[1]);
              return yield* evaluateTupleItems(
                index + 1,
                answerState,
                [...accItems, pair[0]],
                merged.length > 0 ? merged[0]! : pair[1],
              );
            },
          };
          const [answers, itemState] = yield* mettaEvalG(
            env,
            fuel - 1,
            state,
            accB,
            item,
            cursor,
            itemEmitter,
          );
          return yield* emitReturnedMettaAnswersG(itemEmitter, answers, itemState);
        };
        const tupleState = yield* evaluateTupleItems(0, st1, [], bnd);
        return [out, tupleState];
      }
      const [tupleRes, st2] = yield* interpretLoopG(
        env,
        fuel,
        st1,
        tupleWork,
        undefined,
        nestedCursorMode(cursor),
      );
      return yield* reduceChildrenG(env, fuel, st2, tupleRes, finalTupleElement, cursor, emitter);
    }
    // a rule fired: every reduced result still needs evaluating to normal form.
    return yield* reduceChildrenG(env, fuel, st1, reduced, () => undefined, cursor, emitter);
  }

  // bare symbol / variable / grounded
  const [pairs, st1] = yield* interpretLoopG(
    env,
    fuel,
    st,
    [{ stack: admitAtom(makeExpr(env, [sym("eval"), w]), null), bnd }],
    undefined,
    nestedCursorMode(cursor),
  );
  // an irreducible symbol stays itself; an Atom-typed result is inert; anything else evaluates on.
  return yield* reduceChildrenG(
    env,
    fuel,
    st1,
    pairs,
    (p) =>
      atomEq(p[0], notReducibleA) || atomEq(p[0], w)
        ? [[w, bnd]]
        : returnsAtom(env, st1.world, w) && !isEmbeddedOp(p[0])
          ? [[p[0], p[1]]]
          : undefined,
    cursor,
    emitter,
  );
}

function mettaReturnsInputForExpectedType(atom: Atom, expectedType: Atom): boolean {
  if (atom.kind === "var") return true;
  if (expectedType.kind !== "sym") return false;
  return expectedType.name === "Atom" || expectedType.name === metaType(atom);
}

function mettaTypeTerminal(atom: Atom): boolean {
  return atomEq(atom, emptyA) || atomEq(atom, notReducibleA) || isErrorAtom(atom);
}

/** Apply Hyperon's `metta` expected-type contract around the ordinary type-directed evaluator. */
function* mettaEvalExpectedG(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  atom: Atom,
  expectedType: Atom,
  cursor?: CursorMode,
): Gen<[Array<[Atom, Bindings]>, St]> {
  const input = inst(env, bnd, atom);
  if (mettaReturnsInputForExpectedType(input, expectedType)) return [[[input, bnd]], st];
  const [pairs, st2] = yield* mettaEvalG(env, fuel, st, bnd, atom, cursor);
  if (atomEq(expectedType, UNDEF)) return [pairs, st2];

  const out: Array<[Atom, Bindings]> = [];
  for (const [result, resultBindings] of pairs) {
    if (mettaTypeTerminal(result)) {
      out.push([result, resultBindings]);
      continue;
    }
    const actualTypes = getTypesForQuery(env, st2.world, result);
    let matched: Bindings | undefined;
    for (const actualType of actualTypes) {
      matched = matchType(resultBindings, expectedType, actualType);
      if (matched !== undefined) break;
    }
    if (matched !== undefined) {
      out.push([result, matched]);
      continue;
    }
    for (const actualType of actualTypes)
      out.push([
        makeExpr(env, [
          sym("Error"),
          result,
          makeExpr(env, [sym("BadType"), expectedType, actualType]),
        ]),
        resultBindings,
      ]);
  }
  return [out, st2];
}

// ---------- public API ----------

function* minimalCursorGenerator(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  atom: Atom,
  cooperative: boolean,
  delivery: CursorDeliveryControl,
): Gen<[ContextualPair[], St]> {
  const cursorKind: CursorModeKind | undefined =
    delivery.directDrain === true && !delivery.streaming
      ? delivery.batchDrain === true
        ? "progress"
        : undefined
      : delivery.eagerDrain === true
        ? "answers"
        : delivery.streaming
          ? "answers"
          : cooperative
            ? "progress"
            : undefined;
  const cursorMode =
    cursorKind === undefined ? undefined : makeCursorMode(cursorKind, delivery.budget);
  return yield* interpretLoopG(
    env,
    fuel,
    state,
    [{ stack: admitAtom(atom, null), bnd: bindings }],
    undefined,
    cursorMode,
  );
}

function* mettaCursorGenerator(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  atom: Atom,
  cooperative: boolean,
  delivery: CursorDeliveryControl,
): Gen<CursorEvalRes> {
  ensureCompiled(env, atom);
  const cursorMode = mettaCursorMode(cooperative, delivery);
  const emitter = mettaCursorEmitter(delivery, cursorMode);
  const selected = refreshEvaluationEnvironment(env, state.world);
  const input = inst(selected, bindings, atom);
  const cached = input.kind === "expr" && input.ground && selected.evaluatedAtoms.has(input);
  const direct =
    !cached && fuel > 0 ? directAsyncGroundedApplication(selected, state, input) : undefined;
  let result: [Array<[Atom, Bindings]>, St];
  if (direct === undefined) {
    result = yield* mettaEvalG(env, fuel, state, bindings, atom, cursorMode, emitter);
  } else {
    result = yield* reduceDirectAsyncGroundedApplicationG(
      selected,
      fuel,
      state,
      bindings,
      direct.application,
      direct.op,
      direct.args,
      direct.queryVars,
      direct.opReturnsAtom,
      cursorMode,
      emitter,
    );
    rememberGroundEvaluation(selected, input, bindings, state, result[0], result[1]);
  }
  const finalState =
    emitter === undefined
      ? result[1]
      : yield* emitReturnedMettaAnswersG(emitter, result[0], result[1]);
  return [result[0], finalState];
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

function pinnedCursorSource(
  kind: "minimal" | "metta",
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions,
): PinnedCursorSource {
  const pinned = pinAsyncEvaluation(env, options.state ?? initSt());
  const bindings = snapshotBindings(options.bindings ?? emptyBindings);
  const delivery: CursorDeliveryControl = {
    streaming: true,
    lifecycle: { unwinding: false },
    budget: newCursorBudget(),
  };
  const generator =
    kind === "minimal"
      ? minimalCursorGenerator(
          pinned.env,
          options.fuel ?? DEFAULT_FUEL,
          pinned.state,
          bindings,
          atom,
          options.cooperative ?? true,
          delivery,
        )
      : mettaCursorGenerator(
          pinned.env,
          options.fuel ?? DEFAULT_FUEL,
          pinned.state,
          bindings,
          atom,
          options.cooperative ?? true,
          delivery,
        );
  return { generator, state: pinned.state, delivery, release: pinned.release };
}

/** Pull-based synchronous execution of one Minimal MeTTa interpretation plan. */
export class MinimalSyncSearchCursor extends GeneratorSyncSearchCursor<MinimalSearchAnswer> {
  constructor(env: MinEnv, atom: Atom, options: MinimalInterpretOptions = {}) {
    const source = pinnedCursorSource("minimal", env, atom, options);
    super(source.generator, source.state, source.delivery, source.release, contextualCursorAnswer);
  }
}

/** Pull-based synchronous normal-form evaluation with answer-boundary suspension. */
export class MettaSyncSearchCursor extends GeneratorSyncSearchCursor<MinimalSearchAnswer> {
  constructor(env: MinEnv, atom: Atom, options: MinimalInterpretOptions = {}) {
    const source = pinnedCursorSource("metta", env, atom, options);
    super(source.generator, source.state, source.delivery, source.release, contextualCursorAnswer);
  }
}

class GeneratorAsyncSearchCursor<T extends InternalSearchAnswer> implements AsyncSearchCursor<
  T,
  St
> {
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

/** Pull-based asynchronous execution over a pinned Minimal control plan. */
export class MinimalAsyncSearchCursor extends GeneratorAsyncSearchCursor<MinimalSearchAnswer> {
  constructor(env: MinEnv, atom: Atom, options: MinimalInterpretOptions = {}) {
    const source = pinnedCursorSource("minimal", env, atom, options);
    super(source.generator, source.state, source.release, source.delivery, contextualCursorAnswer);
  }
}

/** Pull-based asynchronous normal-form evaluation over a pinned snapshot. */
export class MettaAsyncSearchCursor extends GeneratorAsyncSearchCursor<MinimalSearchAnswer> {
  constructor(env: MinEnv, atom: Atom, options: MinimalInterpretOptions = {}) {
    const source = pinnedCursorSource("metta", env, atom, options);
    super(source.generator, source.state, source.release, source.delivery, contextualCursorAnswer);
  }
}

function ownedSyncSearchCursor(
  env: MinEnv,
  atom: Atom,
  options: Required<Pick<MinimalInterpretOptions, "fuel" | "state" | "bindings">>,
): GeneratorSyncSearchCursor<MinimalSearchAnswer> {
  const source = pinnedCursorSource("metta", env, atom, {
    ...options,
    cooperative: true,
  });
  return new GeneratorSyncSearchCursor(
    source.generator,
    source.state,
    source.delivery,
    source.release,
    contextualCursorAnswer,
    options.state.world,
  );
}

function ownedAsyncSearchCursor<T extends InternalSearchAnswer>(
  kind: "minimal" | "metta",
  env: MinEnv,
  atom: Atom,
  options: Required<Pick<MinimalInterpretOptions, "fuel" | "state" | "bindings">>,
  materializeAnswer: CursorAnswerMaterializer<T>,
  driverSignal?: AbortSignal,
  ownRuntime = false,
): GeneratorAsyncSearchCursor<T> {
  const delivery: CursorDeliveryControl = {
    streaming: true,
    lifecycle: { unwinding: false },
    budget: newCursorBudget(),
    directDrain: true,
  };
  const bindings = snapshotBindings(options.bindings);
  return new GeneratorAsyncSearchCursor(
    kind === "minimal"
      ? minimalCursorGenerator(env, options.fuel, options.state, bindings, atom, true, delivery)
      : mettaCursorGenerator(env, options.fuel, options.state, bindings, atom, true, delivery),
    options.state,
    () => undefined,
    delivery,
    materializeAnswer,
    driverSignal,
    ownRuntime ? options.state.world : undefined,
  );
}

function* settledDirectGroundedCursorGenerator(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  direct: DirectAsyncGroundedApplication,
  settled: ReduceResult,
  remember: boolean,
  delivery: CursorDeliveryControl,
): Gen<CursorEvalRes> {
  const cursorMode = mettaCursorMode(true, delivery);
  const emitter = mettaCursorEmitter(delivery, cursorMode);
  const result = yield* finishDirectGroundedApplicationG(
    env,
    fuel,
    state,
    bindings,
    direct.application,
    direct.queryVars,
    direct.opReturnsAtom,
    settled,
    cursorMode,
    emitter,
    false,
  );
  if (remember)
    rememberGroundEvaluation(env, direct.application, bindings, state, result[0], result[1]);
  const finalState =
    emitter === undefined
      ? result[1]
      : yield* emitReturnedMettaAnswersG(emitter, result[0], result[1]);
  return [result[0], finalState];
}

/** Resume a grounded branch whose host operation has already run. */
function ownedSettledDirectGroundedCursor(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  direct: DirectAsyncGroundedApplication,
  settled: ReduceResult,
  driverSignal: AbortSignal,
  remember = true,
): GeneratorAsyncSearchCursor<InternalSearchAnswer> {
  const delivery: CursorDeliveryControl = {
    streaming: true,
    lifecycle: { unwinding: false },
    budget: newCursorBudget(),
    directDrain: true,
  };
  return new GeneratorAsyncSearchCursor(
    settledDirectGroundedCursorGenerator(
      env,
      fuel,
      state,
      snapshotBindings(bindings),
      direct,
      settled,
      remember,
      delivery,
    ),
    state,
    () => undefined,
    delivery,
    terminalCursorAnswer,
    driverSignal,
    state.world,
  );
}

function eagerMinimalSyncCursor(
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions,
): GeneratorSyncSearchCursor<InternalSearchAnswer> {
  const pinned = pinAsyncEvaluation(env, options.state ?? initSt());
  const bindings = snapshotBindings(options.bindings ?? emptyBindings);
  const cooperative = options.cooperative ?? false;
  const delivery: CursorDeliveryControl = {
    streaming: true,
    lifecycle: { unwinding: false },
    budget: newCursorBudget(),
    directDrain: !cooperative,
  };
  return new GeneratorSyncSearchCursor(
    minimalCursorGenerator(
      pinned.env,
      options.fuel ?? DEFAULT_FUEL,
      pinned.state,
      bindings,
      atom,
      cooperative,
      delivery,
    ),
    pinned.state,
    delivery,
    pinned.release,
    terminalCursorAnswer,
  );
}

function eagerMinimalAsyncCursor(
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions,
): GeneratorAsyncSearchCursor<InternalSearchAnswer> {
  const pinned = pinAsyncEvaluation(env, options.state ?? initSt());
  const bindings = snapshotBindings(options.bindings ?? emptyBindings);
  const cooperative = options.cooperative ?? false;
  const delivery: CursorDeliveryControl = {
    streaming: true,
    lifecycle: { unwinding: false },
    budget: newCursorBudget(),
    directDrain: !cooperative,
  };
  return new GeneratorAsyncSearchCursor(
    minimalCursorGenerator(
      pinned.env,
      options.fuel ?? DEFAULT_FUEL,
      pinned.state,
      bindings,
      atom,
      cooperative,
      delivery,
    ),
    pinned.state,
    pinned.release,
    delivery,
    terminalCursorAnswer,
  );
}

export const createMinimalSearchCursor = (
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions = {},
): MinimalSyncSearchCursor => new MinimalSyncSearchCursor(env, atom, options);

export const createMinimalAsyncSearchCursor = (
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions = {},
): MinimalAsyncSearchCursor => new MinimalAsyncSearchCursor(env, atom, options);

export const createMettaSearchCursor = (
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions = {},
): MettaSyncSearchCursor => new MettaSyncSearchCursor(env, atom, options);

export const createMettaAsyncSearchCursor = (
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions = {},
): MettaAsyncSearchCursor => new MettaAsyncSearchCursor(env, atom, options);

function minimalControlSchedule(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  atom: Atom,
): DualModeSearchCursor<InternalSearchAnswer, St> {
  return new DualModeSearchCursor(
    "collapse-bind",
    () => createMinimalSearchCursor(env, atom, { fuel, state, bindings, cooperative: true }),
    () =>
      ownedAsyncSearchCursor("minimal", env, atom, { fuel, state, bindings }, terminalCursorAnswer),
  );
}

function* drainMinimalScheduleG(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  atom: Atom,
  cursor: CursorMode,
): Gen<[InternalSearchAnswer[], St]> {
  const schedule = minimalControlSchedule(env, fuel, state, bindings, atom);
  const answers: InternalSearchAnswer[] = [];
  let exhausted = false;
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  try {
    for (;;) {
      const event = (yield schedule.nextEffect()) as SearchEvent<InternalSearchAnswer, St>;
      yield* chargeSchedulerStepsG(cursor, state, event.steps);
      switch (event.kind) {
        case "answer":
          answers.push(event.value);
          break;
        case "pending":
          break;
        case "exhausted":
          exhausted = true;
          return [answers, event.terminal];
        case "cancelled":
          throw schedulerCancellationError("collapse-bind", event.reason);
        case "fault":
          throw event.error;
      }
    }
  } catch (error) {
    unwind.active = true;
    unwind.error = error;
    throw error;
  } finally {
    if (!exhausted)
      yield* closeScheduleG(
        schedule,
        {
          code: "parent-closed",
          message: "collapse-bind source closed",
        },
        unwind,
      );
  }
}

function fairSchedule(
  operation: string,
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  branches: readonly Atom[],
): DualModeSearchCursor<MinimalSearchAnswer, St> {
  const isolated = isolatedBranchStates(state, branches.length);
  const parentState = isolated.parent;
  const branchStates = isolated.branches;
  const syncFactory = (): SyncSearchCursor<MinimalSearchAnswer, St> => {
    const source = new FairSyncCursor(
      branches.map((branch, index) =>
        ownedSyncSearchCursor(env, branch, {
          fuel,
          state: branchStates[index]!,
          bindings,
        }),
      ),
    );
    return new MapTerminalSyncCursor(source, (terminals) =>
      mergeScheduledStates(
        env,
        parentState,
        terminals.filter((terminal): terminal is St => terminal !== undefined),
      ),
    );
  };
  const asyncFactory = (): AsyncSearchCursor<MinimalSearchAnswer, St> => {
    const controller = new AbortController();
    const source = fairAsyncMettaBranches(env, fuel, bindings, branches, branchStates, controller);
    return new MapTerminalAsyncCursor(source, (terminals) =>
      mergeScheduledStates(
        env,
        parentState,
        terminals.filter((terminal): terminal is St => terminal !== undefined),
      ),
    );
  };
  return new DualModeSearchCursor(operation, syncFactory, asyncFactory);
}

function fairAsyncMettaBranches(
  env: MinEnv,
  fuel: number,
  bindings: Bindings,
  branches: readonly Atom[],
  branchStates: readonly St[],
  controller: AbortController,
): FairAsyncCursor<MinimalSearchAnswer, St> {
  return new FairAsyncCursor(
    branches.map((branch, index) =>
      ownedAsyncSearchCursor(
        "metta",
        env,
        branch,
        {
          fuel,
          state: branchStates[index]!,
          bindings,
        },
        contextualCursorAnswer,
        controller.signal,
        true,
      ),
    ),
    DEFAULT_SEARCH_QUANTUM,
    controller,
  );
}

function onceSchedule(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  branch: Atom,
): DualModeSearchCursor<MinimalSearchAnswer, St> {
  const syncFactory = (): SyncSearchCursor<MinimalSearchAnswer, St> =>
    new MapTerminalSyncCursor(
      new OnceSyncCursor(createMettaSearchCursor(env, branch, { fuel, state, bindings })),
      (terminal) => terminal ?? state,
    );
  const asyncFactory = (): AsyncSearchCursor<MinimalSearchAnswer, St> =>
    new MapTerminalAsyncCursor(
      new OnceAsyncCursor(
        ownedAsyncSearchCursor(
          "metta",
          env,
          branch,
          { fuel, state, bindings },
          contextualCursorAnswer,
        ),
      ),
      (terminal) => terminal ?? state,
    );
  return new DualModeSearchCursor("once", syncFactory, asyncFactory);
}

function raceSchedule(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  branches: readonly Atom[],
): DualModeSearchCursor<MinimalSearchAnswer, St> {
  const isolated = isolatedBranchStates(state, branches.length);
  const parentState = isolated.parent;
  const branchStates = isolated.branches;
  const asyncFactory = (): AsyncSearchCursor<MinimalSearchAnswer, St> => {
    const controller = new AbortController();
    const source = fairAsyncMettaBranches(env, fuel, bindings, branches, branchStates, controller);
    return new MapTerminalAsyncCursor(new OnceAsyncCursor(source), () => parentState);
  };
  return new DualModeSearchCursor("race", undefined, asyncFactory);
}

interface DirectParBranch {
  readonly env: MinEnv;
  readonly state: St;
  readonly direct: DirectAsyncGroundedApplication;
}

interface SettledDirectParBranch extends DirectParBranch {
  readonly result: ReduceResult;
  readonly effectsApplied?: boolean;
}

interface PrefetchedDirectParBranch {
  readonly branch: SettledDirectParBranch;
  readonly event: Extract<
    SearchBatchEvent<InternalSearchAnswer, St>,
    { readonly kind: "pending" | "exhausted" }
  >;
  readonly cursor?: AsyncSearchCursor<InternalSearchAnswer, St>;
  /** True when the settled host result required an interpreter continuation. */
  readonly evaluated: boolean;
}

function directParApplications(
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

async function invokeDirectParBranch(
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

function completedDirectParBranch(
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

function applySettledDirectParEffects(
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

function prefetchedDirectParSchedule(
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

function* tryDirectParG(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  branches: readonly Atom[],
): Gen<DirectParEvaluation | undefined> {
  const applications = directParApplications(env, fuel, state, bindings, branches);
  if (applications === undefined) return undefined;
  const isolated = isolatedBranchStates(state, applications.length);
  const directBranches: DirectParBranch[] = applications.map((application, index) => ({
    env: application.env,
    state: isolated.branches[index]!,
    direct: application.direct,
  }));
  const continuationController = new AbortController();
  const continuationCursors: Array<AsyncSearchCursor<InternalSearchAnswer, St> | undefined> =
    directBranches.map(() => undefined);
  pendingAsyncOpBox.op = "par";
  const result = (yield driverEffect(
    "par",
    () => {
      throw new AsyncInSyncError("par");
    },
    async (signal, maxSteps = DEFAULT_SEARCH_QUANTUM) => {
      const allowances = directParAllowances(directBranches.length, maxSteps);
      const group = await runStructuredTaskGroup(
        directBranches,
        async (branch, index, branchSignal): Promise<PrefetchedDirectParBranch> => {
          try {
            const settled = applySettledDirectParEffects(
              {
                ...branch,
                result: await invokeDirectParBranch(branch, branchSignal),
              },
              bindings,
            );
            const completed = completedDirectParBranch(settled);
            if (completed !== undefined)
              return {
                branch: settled,
                event: {
                  kind: "exhausted",
                  values: completed,
                  terminal: settled.state,
                  steps: 0,
                },
                evaluated: false,
              };

            const cursor = ownedSettledDirectGroundedCursor(
              settled.env,
              fuel,
              settled.state,
              bindings,
              settled.direct,
              settled.result,
              continuationController.signal,
              settled.effectsApplied !== true,
            );
            continuationCursors[index] = cursor;
            if (allowances[index] === 0)
              return {
                branch: settled,
                event: { kind: "pending", values: [], steps: 0 },
                cursor,
                evaluated: true,
              };
            const event = await cursor.nextBatch({
              maxSteps: allowances[index]!,
              signal: branchSignal,
            });
            branchSignal.throwIfAborted();
            if (event.kind === "fault") throw event.error;
            if (event.kind === "cancelled") throw schedulerCancellationError("par", event.reason);
            return { branch: settled, event, cursor, evaluated: true };
          } catch (error) {
            if (!continuationController.signal.aborted)
              continuationController.abort(
                branchSignal.aborted ? branchSignal.reason : { code: "fault" },
              );
            throw error;
          }
        },
        {
          signal,
          selectCriticalFault: (faults, cancellation) =>
            selectWorkerQuiescenceFailure(faults, cancellation),
        },
      );
      if (group.kind === "exhausted") return group;

      const reason: CancellationReason =
        group.kind === "cancelled"
          ? group.reason
          : { code: "fault", message: "direct par branch failed" };
      if (!continuationController.signal.aborted) continuationController.abort(reason);
      const cleanupFailure = await closeDirectParCursors(continuationCursors, reason);
      if (cleanupFailure === undefined) return group;
      const initiating = group.kind === "fault" ? group.error : group.reason;
      return {
        kind: "fault" as const,
        error: combineInitiatingAndCleanupFailure(
          initiating,
          cleanupFailure,
          "direct par and continuation cleanup both failed",
        ),
      };
    },
  )) as
    | { readonly kind: "exhausted"; readonly results: readonly PrefetchedDirectParBranch[] }
    | { readonly kind: "cancelled"; readonly reason: CancellationReason }
    | { readonly kind: "fault"; readonly error: unknown };
  switch (result.kind) {
    case "cancelled":
      for (const branch of directBranches) releaseWorldRuntime(branch.state.world, result.reason);
      throw schedulerCancellationError("par", result.reason);
    case "fault":
      for (const branch of directBranches)
        releaseWorldRuntime(branch.state.world, {
          code: "fault",
          message: "direct par branch failed",
        });
      throw result.error;
    case "exhausted": {
      for (const prefetched of result.results) {
        if (!prefetched.evaluated) {
          const branch = prefetched.branch;
          const answers = prefetched.event.values;
          rememberGroundEvaluation(
            branch.env,
            branch.direct.application,
            bindings,
            branch.state,
            answers.map((answer) => [answer.atom, answer.bindings]),
            prefetched.event.kind === "exhausted" ? prefetched.event.terminal : branch.state,
          );
        }
      }
      if (result.results.every((branch) => branch.event.kind === "exhausted")) {
        return {
          kind: "complete",
          answers: result.results.flatMap((branch) => branch.event.values),
          state: mergeScheduledStates(
            env,
            isolated.parent,
            result.results.map((branch) =>
              branch.event.kind === "exhausted" ? branch.event.terminal : branch.branch.state,
            ),
          ),
        };
      }
      return {
        kind: "resume",
        schedule: prefetchedDirectParSchedule(
          env,
          isolated.parent,
          result.results,
          continuationController,
        ),
      };
    }
  }
}

function parSchedule(
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  branches: readonly Atom[],
  admitCompleted: boolean,
): DualModeSearchCursor<InternalSearchAnswer, St> {
  const isolated = isolatedBranchStates(state, branches.length);
  const parentState = isolated.parent;
  const branchStates = isolated.branches;
  const completed = admitCompleted
    ? completedParCandidate(env, fuel, bindings, branches, branchStates)
    : undefined;
  const asyncFactory = (): AsyncSearchCursor<InternalSearchAnswer, St> => {
    if (completed !== undefined)
      return new CompletedAsyncSearchCursor(completed.answers, () => {
        completed.commitCaches();
        return mergeScheduledStates(env, parentState, branchStates);
      });
    const controller = new AbortController();
    const source = ParallelSourceOrderedAsyncCursor.fromFactories(
      branches.map(
        (branch, index) => () =>
          ownedAsyncSearchCursor(
            "metta",
            env,
            branch,
            {
              fuel,
              state: branchStates[index]!,
              bindings,
            },
            terminalCursorAnswer,
            controller.signal,
            true,
          ),
      ),
      controller,
    );
    return new MapTerminalAsyncCursor(source, (terminals) =>
      mergeScheduledStates(env, parentState, terminals),
    );
  };
  return new DualModeSearchCursor("par", undefined, asyncFactory);
}

/** Execute an atom directly as Minimal MeTTa control without full type-directed normalization. */
export function interpretMinimal(
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions = {},
): EvalRes {
  const state = options.state ?? initSt();
  const bindings = options.bindings ?? emptyBindings;
  try {
    const cursor = eagerMinimalSyncCursor(env, atom, options);
    return minimalDrainResult(drainSyncCursor(cursor, { maxSteps: MINIMAL_DRAIN_QUANTUM }));
  } catch (error) {
    if (isNativeStackOverflow(error)) return stackOverflowResult(env, state, bindings, atom);
    throw error;
  }
}

/** Async direct Minimal MeTTa execution with a pinned program and world snapshot. */
export function interpretMinimalAsync(
  env: MinEnv,
  atom: Atom,
  options: MinimalInterpretOptions & { readonly signal?: AbortSignal } = {},
): Promise<EvalRes> {
  const state = options.state ?? initSt();
  const bindings = options.bindings ?? emptyBindings;
  const cursor = eagerMinimalAsyncCursor(env, atom, options);
  return drainAsyncCursor(cursor, {
    maxSteps: MINIMAL_DRAIN_QUANTUM,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
    .then((result) => minimalDrainResult(result, options.signal?.reason))
    .catch((error: unknown) => {
      if (isNativeStackOverflow(error)) return stackOverflowResult(env, state, bindings, atom);
      throw error;
    });
}

function mettaEval(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
): [Array<[Atom, Bindings]>, St] {
  ensureCompiled(env, a);
  try {
    return runGenSync(mettaEvalG(env, fuel, st, bnd, a));
  } catch (e) {
    if (isNativeStackOverflow(e)) return stackOverflowResult(env, st, bnd, a);
    throw e;
  }
}

/** Async type-directed evaluation: awaits async grounded operations (`env.agt`). An optional `signal`
 *  makes it cancellable (used by `race` to stop losing branches). */
export function mettaEvalAsync(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
  signal?: AbortSignal,
): Promise<[Array<[Atom, Bindings]>, St]> {
  ensureCompiled(env, a);
  const pinned = pinAsyncEvaluation(env, st);
  return runGenAsync(mettaEvalG(pinned.env, fuel, pinned.state, bnd, a), signal)
    .catch((e: unknown) => {
      if (isNativeStackOverflow(e)) return stackOverflowResult(pinned.env, pinned.state, bnd, a);
      throw e;
    })
    .finally(pinned.release);
}

/** Async evaluation for a runner that exclusively owns both `env` and `st` for the whole suspension. */
export function mettaEvalAsyncOwned(
  env: MinEnv,
  fuel: number,
  st: St,
  bnd: Bindings,
  a: Atom,
  signal?: AbortSignal,
): Promise<[Array<[Atom, Bindings]>, St]> {
  ensureCompiled(env, a);
  return runGenAsync(mettaEvalG(env, fuel, st, bnd, a), signal).catch((e: unknown) => {
    if (isNativeStackOverflow(e)) return stackOverflowResult(env, st, bnd, a);
    throw e;
  });
}

/** Evaluate `atom` (i.e. interpret `(eval atom)`) under `env`, returning the result atoms. */
export function evalAtom(
  env: MinEnv,
  atom: Atom,
  st: St = initSt(),
  fuel = DEFAULT_FUEL,
): [Atom[], St] {
  const [pairs, st2] = mettaEval(env, fuel, st, [], atom);
  return [pairs.map((p) => p[0]), st2];
}

export { mettaEval };
