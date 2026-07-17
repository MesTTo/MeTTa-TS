// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, expr, gstr, type InternTable, sym } from "../atom";
import { type AtomLog } from "../atomlog";
import { type BindingFrame } from "../binding-frame";
import { type Bindings } from "../bindings";
import {
  type GroundedCallContext,
  type GroundedModuleInstallation,
  type GroundingTable,
  type ReduceResult,
} from "../builtins";
import { type CompiledFns } from "../compile";
import { type EffectClass, type EffectRecord } from "../effect-journal";
import { FlatAtomSpace } from "../flat-atomspace";
import { type GroundedAnswerCursor, type GroundedCallContextV2 } from "../grounded-v2";
import { instantiate } from "../instantiate";
import { type CancellationReason, type ResourceLease } from "../resources";
import {
  type AsyncSearchCursor,
  DEFAULT_SEARCH_QUANTUM,
  drainAsyncCursor,
  drainSyncCursor,
  type SearchDrainResult,
  type SearchEvent,
  type SyncSearchCursor,
} from "../search-cursor";
import { TableSpace } from "../table-space";
import { RuntimeIdAllocator, type StateId, type TraceContext } from "../trace";
import { isWorkerQuiescenceError } from "../worker-protocol";

// The driver functions are generators that `yield` a pending Promise only at the one async boundary
// (an async grounded operation). A sync driver runs a generator to completion and throws if it ever
// actually suspends; an async driver awaits the yielded Promises. One implementation, two drivers
// (the gensync / Effect pattern), so the synchronous path is unchanged in behaviour and async is
// purely additive. `yield*` propagates a suspension up through the whole nested call chain.
/** A grounded operation that runs asynchronously, for the async runner. */
export type AsyncGroundFn = (
  args: readonly Atom[],
  context?: GroundedCallContext,
) => Promise<ReduceResult>;

export type HostImportFn = (
  space: Atom,
  file: Atom,
  context?: GroundedCallContext,
) => ReduceResult | Promise<ReduceResult>;

export const DRIVER_EFFECT = Symbol("driver-effect");

export interface DriverEffect<R = unknown> {
  readonly effect: typeof DRIVER_EFFECT;
  readonly operation: string;
  runSync(maxSteps?: number): R;
  runAsync(signal: AbortSignal, maxSteps?: number): R | Promise<R>;
}

export const driverEffect = <R>(
  operation: string,
  runSync: (maxSteps?: number) => R,
  runAsync: (signal: AbortSignal, maxSteps?: number) => R | Promise<R>,
): DriverEffect<R> => ({ effect: DRIVER_EFFECT, operation, runSync, runAsync });

/** Thrown when synchronous evaluation reaches an async grounded operation. Use the async runner. */
export class AsyncInSyncError extends Error {
  constructor(op: string) {
    super(
      `async grounded operation '${op}' reached in synchronous evaluation; use the async runner`,
    );
    this.name = "AsyncInSyncError";
  }
}

/** The grounded-operation boundary: a sync op returns immediately; an async op (in `env.agt`) yields its
 *  Promise, which the async driver awaits and the sync driver rejects. */
export interface CompleteGroundedCallContext extends GroundedCallContext {
  readonly generation: number;
  readonly typeEnvironment: NonNullable<GroundedCallContext["typeEnvironment"]>;
  readonly groundingEnvironment: NonNullable<GroundedCallContext["groundingEnvironment"]>;
  readonly imports: NonNullable<GroundedCallContext["imports"]>;
  readonly moduleInstallations: NonNullable<GroundedCallContext["moduleInstallations"]>;
  readonly capabilities: NonNullable<GroundedCallContext["capabilities"]>;
}

interface CachedGroundedContext {
  readonly syncRegistry: GroundingTable;
  readonly asyncRegistry: Map<string, AsyncGroundFn>;
  readonly typeProgramVersion: number;
  readonly syncRevision: number | undefined;
  readonly asyncRevision: number | undefined;
  readonly imports: Map<string, Atom[]>;
  readonly importRevision: number | undefined;
  readonly capabilities: ReadonlySet<string> | undefined;
  readonly capabilityRevision: number | undefined;
  readonly evaluationContext: GroundedCallContext;
  readonly context: CompleteGroundedCallContext;
}

export interface GroundedContextIdentity {
  readonly generation: number;
  contexts?: WeakMap<MinEnv, CachedGroundedContext>;
}

export type Ret = "none" | "chain" | "function";

export type MachineControl = "execute" | "deliver";

export interface Frame {
  readonly atom: Atom;
  readonly ret: Ret;
  readonly vars: readonly string[];
  /** Explicitly distinguishes code admitted for one transition from delivered data. */
  readonly control?: MachineControl;
  /** Compatibility mirror for callers that inspect the pre-U5 frame shape. */
  readonly fin: boolean;
  /** Stable call attribution for a function delimiter. */
  readonly callAtom?: Atom;
}

// The evaluation stack as an immutable cons-list (O(1) push/rest, no per-step array slice/spread;
// the array form showed up as ArrayPrototypeSlice in the profile). `null` is the empty stack.
export interface StackCons {
  readonly head: Frame;
  readonly tail: Stack;
}

export type Stack = StackCons | null;

export const cons = (head: Frame, tail: Stack): StackCons => ({ head, tail });

export interface Item {
  readonly stack: Stack;
  readonly bnd: Bindings;
  /** Dynamic evaluator selected by `evalc`, delimited by the continuation stack it entered from. */
  readonly evaluationScope?: EvaluationScope;
  /** Owned pull continuation for a grounded V2 answer stream. */
  readonly groundedV2?: MinimalGroundedV2Continuation;
  /** Owned pull continuation for a streamed `metta`/`metta-thread` call. */
  readonly mettaCall?: MinimalMettaCallContinuation;
}

export interface MinimalMettaCallContinuation {
  readonly operation: "metta" | "metta-thread";
  readonly bnd: Bindings;
  readonly schedule: DualModeSearchCursor<MinimalSearchAnswer, St>;
  /** Turn one full-evaluator answer into the minimal items the batch case would have produced. */
  readonly project: (answer: MinimalSearchAnswer) => Item[];
  closed: boolean;
}

export interface MinimalGroundedV2Continuation {
  readonly operation: string;
  readonly subject: Atom;
  readonly continuation: Stack;
  readonly call: ActiveGroundedV2Call;
  readonly context: GroundedCallContextV2;
  readonly answers: GroundedAnswerCursor;
  readonly isolation?: StreamingIsolatedBranches;
  activeIsolatedAnswer: boolean;
  closed: boolean;
}

export interface StreamingIsolatedBranches {
  readonly parent: St;
  readonly contextIdentity: GroundedContextIdentity;
  readonly sequence: number;
  /** True when a downstream continuation owns each answer's state, so terminals are discarded. */
  readonly acceptedDownstream: boolean;
  nextIndex: number;
  /** The branch currently handed to a continuation; released when its terminal is recorded. */
  activeBranch: St | undefined;
  /** Journal deltas of recorded terminals, retained only on the merge path and only when non-empty. */
  readonly terminalDeltas: JournalWorldDelta[];
  maxTerminalCounter: number;
  finished: boolean;
}

export interface EvaluationScope {
  readonly env: MinEnv;
  readonly boundary: Stack;
  readonly parent?: EvaluationScope;
}

export const frame = (
  atom: Atom,
  ret: Ret = "none",
  vars: readonly string[] = [],
  control: MachineControl = "execute",
  callAtom?: Atom,
): Frame =>
  callAtom === undefined
    ? { atom, ret, vars, control, fin: control === "deliver" }
    : { atom, ret, vars, control, fin: control === "deliver", callAtom };

export const errTextAtom = (a: Atom, msg: string): Atom => expr([sym("Error"), a, gstr(msg)]);

export const inst = (env: MinEnv, b: Bindings, a: Atom, suffix = ""): Atom =>
  instantiate(b, a, suffix, env.intern);

export interface MinEnv {
  /** Static program revision used to validate reusable async program snapshots. */
  programVersion?: number;
  /** Static indexes share a cached program image and must detach before their first write. */
  staticProgramShared?: boolean;
  ruleIndex: Map<string, Array<[Atom, Atom]>>;
  varRules: Array<[Atom, Atom]>;
  // The genuinely variable-headed (`($x …)`) subset of `varRules`. Those can match a query of ANY head;
  // the rest of `varRules` are expression-headed (e.g. PeTTa's `((|-> …) …)` applicators) and can only match
  // an expression-headed query. Kept as a separate list so a symbol/grounded query skips the dead probes.
  varRulesVar: Array<[Atom, Atom]>;
  sigs: Map<string, Atom[]>;
  /** Local version of the static and grounded type program used to validate cached world views. */
  typeProgramVersion?: number;
  gt: GroundingTable;
  atoms: Atom[];
  /** Runtime-independent prelude/module atoms inherited by every selected named-space evaluator. */
  sharedContextAtoms?: readonly Atom[];
  types: Map<string, Atom[]>;
  imports: Map<string, Atom[]>;
  exprTypes: Array<[Atom, Atom]>;
  /** Async grounded operations, dispatched by the async runner; empty for pure synchronous evaluation. */
  agt: Map<string, AsyncGroundFn>;
  /** Environment-local effect declarations for sync and async grounded operations. */
  groundedEffects?: Map<string, GroundedEffectPolicy>;
  /** Local version of the sync and async grounded registries used by context descriptors. */
  groundingVersion?: number;
  /** Optional host-language import hook used by async `import!` for files outside the MeTTa import map. */
  hostImport?: HostImportFn;
  /** Capabilities made visible to grounded operations in this runtime. */
  capabilities?: ReadonlySet<string>;
  /** Dynamic atomspace selected by `evalc` or `metta`. Absent means the compatibility `&self` context. */
  evaluationContext?: EvaluationContext;
  /** Per-runner `with-mutex` locks (a Promise chain per key), so mutexes do not leak across runners. */
  mutexes: Map<string, Promise<void>>;
  /** Optional per-run hash-cons table for immutable terms. */
  intern?: InternTable;
  /** Ground expressions proven to reduce only to themselves. */
  evaluatedAtoms: WeakSet<Atom>;
  // Clause indexing over &self atoms, so `match` scales past a linear scan (Prolog-style clause indexing).
  // `factIndex` maps an atom's head key (functor for an expression, name for a symbol) to its atoms;
  // used for variable/expression first-argument queries. `argIndex` is the finer index, keyed by
  // `functor + arg key` for atoms whose first argument is a ground leaf, so a query like
  // `(edge 500000 $y)` jumps straight to the matching row even when a million atoms share the functor.
  // `argIndex` and `nonGroundAtPos` store exact leaf and residual candidates.
  // `varHeadedFacts` holds atoms with no head key (variable-headed), which can unify with any pattern.
  factIndex: Map<string, Atom[]>;
  argIndex: Map<string, Atom[]>;
  nonGroundAtPos: Map<string, Atom[]>;
  /** Internal static nested-head index. Optional so existing structural `MinEnv` values stay compatible. */
  nestedMatchIndex?: StaticNestedMatchIndex | undefined;
  varHeadedFacts: Atom[];
  /** Automatic tabling storage: structural variant keys over token tries and bounded completed entries.
   *  `undefined` when tabling is disabled. */
  tableSpace?: TableSpace | undefined;
  /** Positive only while an idempotent unique(collapse ...) consumer evaluates a proven-pure ground call. */
  distinctGroundDepth?: number | undefined;
  /** Functor names proven tabling-safe by `analyzePurity`; recomputed when equations change. */
  pureFunctors?: Set<string> | undefined;
  /** Static functors whose complete rule graph can be replayed by an isolated worker. */
  workerReplaySafeFunctors?: Set<string> | undefined;
  /** Functor names proven safe for variant tabling by `analyzeModedPurity`. */
  modedPureFunctors?: Set<string> | undefined;
  /** Pure functors whose rule SCC has branching recursion, so ground tabling is likely useful. */
  tableWorth?: Set<string> | undefined;
  /** Pure functors whose rule SCC has branching recursion under the moded purity rules. */
  modedTableWorth?: Set<string> | undefined;
  /** Set when equations changed and the purity/profitability analysis must be refreshed before evaluation. */
  tablingDirty?: boolean | undefined;
  /** Memo for `getTypes` of ground atoms: a ground atom's type is a pure function of the env's type tables,
   *  which only change via `addAtomToEnv` (where this is reset). Keyed by atom identity, so the recursion
   *  reuses the type of every shared subterm (a growing Peano/list term is the worst case otherwise). */
  typeCache?: WeakMap<Atom, Atom[]> | undefined;
  /** Optional parallel branch evaluator for `hyperpose` (set by a host worker pool). Given the formatted
   *  branch atoms and whether to stop at the first result, returns each branch's result atoms, or `null` for
   *  a branch that errored or (under firstOnly) lost the race. It re-evaluates each branch from the program's
   *  rules in a worker, so it is only used when a branch is pure and the space carries no runtime additions,
   *  so it is identical to evaluating in line. */
  parEval?: (
    branchSrcs: string[],
    firstOnly: boolean,
    remainingFuel: number,
    initialCounter: number,
  ) => ({ readonly atoms: Atom[]; readonly counterDelta: number } | null)[];
  /** Async host-worker equivalent, used by browser Web Workers and other non-blocking hosts. */
  parEvalAsync?: (
    branchSrcs: string[],
    firstOnly: boolean,
    signal: AbortSignal,
    remainingFuel: number,
    initialCounter: number,
  ) => Promise<({ readonly atoms: Atom[]; readonly counterDelta: number } | null)[]>;
  /** Compiled pure deterministic functions (the int/bool functional core); undefined when disabled. */
  compiled?: CompiledFns | undefined;
  /** Set when an equation changed, so the compiler re-runs before the next query. */
  compileDirty?: boolean | undefined;
  /** False when `compiled` contains only query-directed dependent search groups. Undefined retains the
   *  historical meaning for structural environments whose map was produced by `compileEnv`. */
  compiledComplete?: boolean | undefined;
  /** Opt-in trail-based matching (`experimental.trail`): the conjunctive `match` enumerates on a WAM-style
   *  trail (zero per-solution allocation) instead of the immutable `Bindings`/`merge` threading. Off by
   *  default; byte-identical to the reference matcher (differential-gated), falling back to it per query for
   *  cases the trail cannot reproduce (custom grounded matchers). */
  useTrail?: boolean;
  /** Compact runtime `&self` atomspace. When on, runtime additions are stored as flat term ids and decoded
   *  only when a query or observable operation needs tree atoms. */
  useFlatAtomspace?: boolean;
}

export interface TypeView {
  sigs: Map<string, Atom[]>;
  types: Map<string, Atom[]>;
  exprTypes: Array<[Atom, Atom]>;
  typeCache?: WeakMap<Atom, Atom[]> | undefined;
}

/** The atomspace-dependent part of one dynamic evaluation context. */
export type EvaluationContext = GroundedCallContext;

export interface StaticNestedMatchIndex {
  /** Occurrence ids by functor, argument position, and nested expression head. */
  readonly byHead: Map<string, number[]>;
  /** Occurrence ids whose argument or argument head has a custom grounded matcher. */
  readonly wildcardAtPos: Map<string, number[]>;
  /** Root functors with a non-ground static fact. */
  readonly nonGroundFactHeads: Set<string>;
}

export interface GroundedEffectPolicy {
  readonly classes: readonly EffectClass[];
  /** The operation may run in an isolated branch that can be discarded. */
  readonly speculative: boolean;
}

export type NamedSpace = AtomLog;

export interface World {
  /** Monotone logical-update generation for observable branch-world mutations. */
  generation: number;
  /** Successful catalog and host imports in commit order. Repeated imports remain distinct. */
  moduleInstallations: readonly GroundedModuleInstallation[];
  /** Nested transaction depth used to reject host imports that cannot be rolled back. */
  transactionDepth: number;
  spaces: Map<string, NamedSpace>;
  store: Map<number | StateId, Atom>;
  tokens: Map<string, Atom>;
  // `&self` runtime additions as a persistent O(1)-append log (was a wholesale-copied `Atom[]`).
  selfExtra: AtomLog;
  // Experimental compact runtime additions for `&self`. Present only when `experimental.flatAtomspace` is on
  // and all appended atoms have a compact encoding.
  flatSelfExtra: FlatAtomSpace | undefined;
  // Runtime `(= lhs rhs)` rules indexed by lhs head key (var-headed in `selfVarRules`), so function
  // reduction looks them up directly instead of scanning the whole `selfExtra` log every reduction,
  // the difference between O(1) and O(n) when a program has added many ground facts.
  selfRules: Map<string, Array<[Atom, Atom]>>;
  selfVarRules: ReadonlyArray<[Atom, Atom]>;
  // Monotone version for the whole runtime rule set. A static function can call a runtime-defined helper, so
  // table keys and runtime purity caches must change when any runtime rule changes, not only the queried
  // functor's own rule array.
  selfRuleVersion: number;
  // Static atoms removed from `&self` in this world. Static program atoms live in `env`; this tombstone
  // keeps removal branch-local without mutating the shared env.
  removedStatic: AtomLog;
  removedStaticHeads: Set<string>;
  removedStaticVarRules: boolean;
  /** True once a branch adds or removes a type declaration in `&self`. */
  hasTypeMutations: boolean;
  /** Complete visible type tables for that branch, built lazily after a type mutation. */
  typeView: TypeView | undefined;
  /** Static type-program version used to build `typeView`. */
  typeViewProgramVersion: number | undefined;
  /** Root environment whose static type program owns `typeView`. */
  typeViewOwner: MinEnv | undefined;
  // Interpreter stack-depth bound, set in-language by `(pragma! max-stack-depth N)` (Hyperon's pragma).
  // 0 means unlimited (the Hyperon default). When positive, a branch whose stack reaches this depth
  // degrades to a StackOverflow error atom instead of recursing further. The pragma is a depth bound only; the
  // host's step budget (the `fuel` argument) is the resource ceiling and is never changed by a pragma, so a
  // program cannot raise its own limits past what the embedder allows.
  maxStackDepth: number;
  /** Allocation authority for state and space handles. Fan-out branches receive disjoint child lanes. */
  allocation: RuntimeAllocationLane;
}

export type WorldMutation =
  | { readonly kind: "add-atoms"; readonly space: string; readonly atoms: readonly Atom[] }
  | { readonly kind: "remove-atom"; readonly space: string; readonly atom: Atom }
  | {
      readonly kind: "set-state";
      readonly key: number | StateId;
      readonly introduced: boolean;
      readonly value: Atom;
    }
  | {
      readonly kind: "create-space";
      readonly name: string;
      readonly atoms: readonly Atom[];
    }
  | { readonly kind: "set-token"; readonly name: string; readonly value: Atom }
  | { readonly kind: "set-max-stack-depth"; readonly value: number }
  | {
      readonly kind: "install-module";
      readonly installation: GroundedModuleInstallation;
    };

interface WorldEffectPayload {
  readonly kind: "world";
  readonly mutation: WorldMutation;
}

interface OperationEffectPayload {
  readonly kind: "operation";
  readonly results: readonly Atom[];
}

export type BranchEffectPayload = WorldEffectPayload | OperationEffectPayload;

export interface RuntimeAllocationLane {
  readonly ids: RuntimeIdAllocator;
  readonly branchScoped: boolean;
}

export interface St {
  counter: number;
  world: World;
}

export interface JournalWorldDelta {
  readonly kind: "journal";
  readonly generationDelta: number;
  readonly effects: readonly EffectRecord<BranchEffectPayload>[];
}

interface GroundedV2CallCache {
  visibleKeys?: ReadonlySet<string>;
  zeroDelta?: { readonly queryVars: readonly string[] | undefined; readonly bindings: Bindings };
}

export interface ActiveGroundedV2Call {
  readonly frame: BindingFrame;
  readonly trace: TraceContext;
  readonly resources: ResourceLease;
  /** Per-call caches for values that are constant across the call's answers. */
  readonly cache: GroundedV2CallCache;
  context(signal: AbortSignal): GroundedCallContextV2;
  close(): void;
}

export interface MinimalSearchAnswer {
  readonly atom: Atom;
  readonly bindings: Bindings;
  /** State at the answer boundary. Later alternatives have not run yet. */
  readonly state: St;
}

export class DualModeSearchCursor<T, R> {
  readonly #operation: string;
  readonly #syncFactory: (() => SyncSearchCursor<T, R>) | undefined;
  readonly #asyncFactory: () => AsyncSearchCursor<T, R>;
  #mode: "sync" | "async" | undefined;
  #sync: SyncSearchCursor<T, R> | undefined;
  #async: AsyncSearchCursor<T, R> | undefined;

  constructor(
    operation: string,
    syncFactory: (() => SyncSearchCursor<T, R>) | undefined,
    asyncFactory: () => AsyncSearchCursor<T, R>,
  ) {
    this.#operation = operation;
    this.#syncFactory = syncFactory;
    this.#asyncFactory = asyncFactory;
  }

  nextEffect(): DriverEffect<SearchEvent<T, R>> {
    return driverEffect(
      this.#operation,
      (maxSteps) => this.#syncCursor().next({ maxSteps: maxSteps ?? DEFAULT_SEARCH_QUANTUM }),
      async (signal, maxSteps) => {
        const event = await this.#asyncCursor().next({
          maxSteps: maxSteps ?? DEFAULT_SEARCH_QUANTUM,
          signal,
        });
        if (event.kind === "fault" && isWorkerQuiescenceError(event.error)) throw event.error;
        return event;
      },
    );
  }

  drainEffect(): DriverEffect<SearchDrainResult<T, R>> {
    return driverEffect(
      this.#operation,
      () => drainSyncCursor(this.#syncCursor()),
      async (signal) => {
        const result = await drainAsyncCursor(this.#asyncCursor(), { signal });
        if (result.kind === "fault" && isWorkerQuiescenceError(result.error)) throw result.error;
        return result;
      },
    );
  }

  closeEffect(reason: CancellationReason): DriverEffect<void> {
    return driverEffect(
      this.#operation,
      () => this.#syncCursor().close(reason),
      () => this.#asyncCursor().close(reason),
    );
  }

  #syncCursor(): SyncSearchCursor<T, R> {
    if (this.#mode === "async") throw new Error(`${this.#operation} changed driver mode`);
    if (this.#syncFactory === undefined) throw new AsyncInSyncError(this.#operation);
    this.#mode = "sync";
    return (this.#sync ??= this.#syncFactory());
  }

  #asyncCursor(): AsyncSearchCursor<T, R> {
    if (this.#mode === "sync") throw new Error(`${this.#operation} changed driver mode`);
    this.#mode = "async";
    return (this.#async ??= this.#asyncFactory());
  }
}
