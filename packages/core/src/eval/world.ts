// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, atomEq, type ExprAtom, type InternTable, sym } from "../atom";
import { emptyLog, logToArray } from "../atomlog";
import { type Bindings } from "../bindings";
import { type GroundFn, type GroundingTable } from "../builtins";
import { type CompiledFns } from "../compile";
import {
  defaultEffectCommitment,
  EffectAudit,
  type EffectClass,
  type EffectCommitment,
  EffectJournal,
  type EffectPhase,
} from "../effect-journal";
import {
  activeProgramSnapshots,
  activeSpaceName,
  pinnedProgramEnvironments,
  pinnedProgramOwners,
  programIdentityEnvironment,
  pushUniqueType,
  rootEvaluationEnvironment,
} from "./env";
import {
  type AsyncGroundFn,
  type BranchEffectPayload,
  type EvaluationContext,
  type GroundedContextIdentity,
  type GroundedEffectPolicy,
  type HostImportFn,
  type MinEnv,
  type NamedSpace,
  type RuntimeAllocationLane,
  type St,
  type TypeView,
  type World,
  type WorldMutation,
} from "./machine";
import { opOf } from "./terms";
import { ForkableMap, ForkableSet, forkMap, forkSet } from "../persistent-collection";
import {
  type CancellationReason,
  CancellationScope,
  type CancellationScopeSnapshot,
  type ResourceKind,
  type ResourceLease,
  ResourceLedger,
  ResourceLimitError,
  type ResourcePolicy,
  type ResourceSnapshot,
} from "../resources";
import { collectionRevision, RevisionMap, RevisionSet } from "../revision-collection";
import { TableSpace } from "../table-space";
import {
  childTraceContext,
  isRuntimeId,
  rootTraceContext,
  RuntimeIdAllocator,
  type TraceContext,
} from "../trace";

export interface CandidateSource extends Iterable<Atom> {
  readonly counterPadding?: number;
  readonly synthetic?: true;
}

export const groundedContextIdentities = new WeakMap<World, GroundedContextIdentity>();

export function groundedContextIdentity(world: World): GroundedContextIdentity {
  const cached = groundedContextIdentities.get(world);
  if (cached?.generation === world.generation) return cached;
  const identity = { generation: world.generation };
  groundedContextIdentities.set(world, identity);
  return identity;
}

export function namedSpaceAtoms(space: NamedSpace | undefined): Atom[] {
  return logToArray(space ?? emptyLog);
}

export function contextualSpaceName(env: MinEnv, w: World, requested: Atom): string | undefined {
  const name = spaceName(w, requested);
  return name === "&self" ? activeSpaceName(env) : name;
}

export function contextualSpaceAtom(env: MinEnv, w: World, requested: Atom): Atom {
  const name = contextualSpaceName(env, w, requested);
  return name === undefined ? requested : sym(name);
}

export type WorldCommitPolicy = "sequential-commit" | "isolated-branches";

export type IrreversibleEffectPolicy = "allow" | "reject";

interface WorldRuntimeContext {
  readonly branch: string;
  readonly policy: WorldCommitPolicy;
  readonly irreversibleEffects: IrreversibleEffectPolicy;
  readonly audit: EffectAudit;
  readonly journal: EffectJournal<BranchEffectPayload>;
  readonly nextSequence: number;
  readonly resources: ResourceLease;
  readonly cancellation: CancellationScope;
  readonly ids: RuntimeIdAllocator;
  readonly trace: TraceContext;
}

export interface BranchEffectSnapshot {
  readonly id: { readonly branch: string; readonly sequence: number };
  readonly class: EffectClass;
  readonly phase: EffectPhase;
  readonly operation: string;
  readonly commitment: EffectCommitment;
}

export interface BranchRuntimeSnapshot {
  readonly branch: string;
  readonly policy: WorldCommitPolicy;
  readonly irreversibleEffects: IrreversibleEffectPolicy;
  readonly effects: readonly BranchEffectSnapshot[];
  readonly resources: ResourceSnapshot;
  readonly cancellation: CancellationScopeSnapshot;
}

export interface BranchRuntimeOptions {
  readonly resources?: ResourcePolicy;
  readonly signal?: AbortSignal;
}

export const worldRuntimeContexts = new WeakMap<World, WorldRuntimeContext>();

let worldRuntimeSequence = 0;

function newWorldRuntimeContext(options: BranchRuntimeOptions = {}): WorldRuntimeContext {
  const branch = `run-${++worldRuntimeSequence}`;
  const resources = new ResourceLedger(options.resources).lease(branch);
  const ids = new RuntimeIdAllocator(branch);
  return {
    branch,
    policy: "sequential-commit",
    irreversibleEffects: "allow",
    audit: EffectAudit.empty(),
    journal: EffectJournal.root(branch),
    nextSequence: 0,
    resources,
    cancellation: new CancellationScope(branch, options.signal),
    ids,
    trace: rootTraceContext(ids),
  };
}

export function worldRuntimeContext(world: World): WorldRuntimeContext {
  let context = worldRuntimeContexts.get(world);
  if (context === undefined) {
    context = newWorldRuntimeContext();
    worldRuntimeContexts.set(world, context);
  }
  return context;
}

/** Inspect stable branch metadata without exposing mutable world-effect payloads. */
export function branchRuntimeSnapshot(state: St): BranchRuntimeSnapshot {
  const context = worldRuntimeContext(state.world);
  const effects = [...context.audit.toArray(), ...context.journal.toArray()];
  return {
    branch: context.branch,
    policy: context.policy,
    irreversibleEffects: context.irreversibleEffects,
    effects: Object.freeze(
      effects.map((effect) =>
        Object.freeze({
          id: effect.id,
          class: effect.class,
          phase: effect.phase,
          operation: effect.operation,
          commitment: effect.commitment,
        }),
      ),
    ) as readonly BranchEffectSnapshot[],
    resources: context.resources.ledger.snapshot(),
    cancellation: context.cancellation.snapshot(),
  };
}

export function consumeWorldResource(
  world: World,
  resource: ResourceKind,
  amount: number,
  operation: string,
): void {
  const lease = worldRuntimeContext(world).resources;
  if (!lease.ledger.tracked) return;
  const fault = lease.tryConsume(resource, amount, operation);
  if (fault !== undefined) throw new ResourceLimitError(fault);
}

export function checkWorldDeadline(world: World, operation: string): void {
  const lease = worldRuntimeContext(world).resources;
  if (!lease.ledger.tracked || lease.ledger.limit("wall-time-ms") === undefined) return;
  const fault = lease.checkTime(Date.now(), operation);
  if (fault !== undefined) throw new ResourceLimitError(fault);
}

export function checkWorldCancellation(world: World): void {
  const scope = worldRuntimeContext(world).cancellation;
  if (scope.linked) scope.signal.throwIfAborted();
}

export function releaseWorldRuntime(world: World, reason?: CancellationReason): void {
  const context = worldRuntimeContexts.get(world);
  if (context === undefined) return;
  if (reason !== undefined) context.cancellation.cancel(reason);
  context.cancellation.close();
  context.resources.close();
}

export function cancelWorldRuntime(world: World, reason: CancellationReason): void {
  worldRuntimeContexts.get(world)?.cancellation.cancel(reason);
}

export function inheritWorldRuntime(source: World, target: World): World {
  worldRuntimeContexts.set(target, worldRuntimeContext(source));
  return target;
}

export function forkWorldRuntime(
  source: World,
  target: World,
  branch: string,
  policy: WorldCommitPolicy = "isolated-branches",
  irreversibleEffects: IrreversibleEffectPolicy = "reject",
  debitBranch = true,
): World {
  const parent = worldRuntimeContext(source);
  if (debitBranch) consumeWorldResource(source, "branches", 1, branch);
  const ids = parent.ids.fork(`branch-${++worldRuntimeSequence}`);
  worldRuntimeContexts.set(target, {
    branch,
    policy,
    irreversibleEffects,
    audit: parent.audit,
    journal: parent.journal.fork(branch),
    nextSequence: 0,
    resources: parent.resources.fork(branch),
    cancellation: parent.cancellation.fork(branch),
    ids,
    trace: childTraceContext(ids, parent.trace),
  });
  return target;
}

export function nextWorldRuntimeBranch(source: World, label: string): string {
  return `${worldRuntimeContext(source).branch}/${label}-${++worldRuntimeSequence}`;
}

export function withWorldRuntimePolicy(
  source: World,
  target: World,
  policy: WorldCommitPolicy,
  irreversibleEffects: IrreversibleEffectPolicy,
): World {
  const current = worldRuntimeContext(source);
  worldRuntimeContexts.set(target, { ...current, policy, irreversibleEffects });
  return target;
}

export function recordWorldMutation(
  world: World,
  operation: string,
  mutation: WorldMutation,
): void {
  const current = worldRuntimeContext(world);
  if (current.policy === "sequential-commit") {
    worldRuntimeContexts.set(world, {
      ...current,
      audit: current.audit.appendFields(
        current.branch,
        current.nextSequence,
        "atomspace-write",
        "answer",
        operation,
        "reversible",
      ),
      nextSequence: current.nextSequence + 1,
    });
    return;
  }
  worldRuntimeContexts.set(world, {
    ...current,
    journal: current.journal.append({
      class: "atomspace-write",
      phase: "answer",
      operation,
      commitment: "reversible",
      payload: { kind: "world", mutation },
    }),
    nextSequence: current.nextSequence + 1,
  });
}

export function recordOperationEffect(
  world: World,
  operation: string,
  effectClass: Exclude<EffectClass, "pure">,
  results: readonly Atom[],
): void {
  const current = worldRuntimeContext(world);
  const commitment = defaultEffectCommitment(effectClass);
  if (current.policy === "sequential-commit") {
    worldRuntimeContexts.set(world, {
      ...current,
      audit: current.audit.appendFields(
        current.branch,
        current.nextSequence,
        effectClass,
        "pre",
        operation,
        commitment,
      ),
      nextSequence: current.nextSequence + 1,
    });
    return;
  }
  worldRuntimeContexts.set(world, {
    ...current,
    journal: current.journal.append({
      class: effectClass,
      phase: "pre",
      operation,
      payload: { kind: "operation", results: Object.freeze(results.slice()) },
    }),
    nextSequence: current.nextSequence + 1,
  });
}

let runtimeRuleSetVersionCounter = 0;

export function nextRuntimeRuleSetVersion(): number {
  return ++runtimeRuleSetVersionCounter;
}

export function nextWorldGeneration(world: World): number {
  return world.generation + 1;
}

export const initSt = (options: BranchRuntimeOptions = {}): St => {
  const state: St = {
    counter: 0,
    world: {
      generation: 0,
      moduleInstallations: [],
      transactionDepth: 0,
      spaces: new ForkableMap(),
      store: new ForkableMap(),
      tokens: new ForkableMap(),
      selfExtra: emptyLog,
      flatSelfExtra: undefined,
      selfRules: new ForkableMap(),
      selfVarRules: [],
      selfRuleVersion: 0,
      removedStatic: emptyLog,
      removedStaticHeads: new ForkableSet(),
      removedStaticVarRules: false,
      hasTypeMutations: false,
      typeView: undefined,
      typeViewProgramVersion: undefined,
      typeViewOwner: undefined,
      maxStackDepth: 0,
      allocation: {
        ids: new RuntimeIdAllocator("metta"),
        branchScoped: false,
      },
    },
  };
  worldRuntimeContexts.set(state.world, newWorldRuntimeContext(options));
  return state;
};

function makeWorldView(
  w: World,
  allocation: RuntimeAllocationLane,
  spaces: World["spaces"],
  store: World["store"],
  tokens: World["tokens"],
  selfRules: World["selfRules"],
  removedStaticHeads: World["removedStaticHeads"],
  contextIdentity: GroundedContextIdentity,
): World {
  const view: World = {
    generation: w.generation,
    moduleInstallations: w.moduleInstallations,
    transactionDepth: w.transactionDepth,
    spaces,
    store,
    tokens,
    selfExtra: w.selfExtra,
    flatSelfExtra: w.flatSelfExtra,
    selfRules,
    selfVarRules: w.selfVarRules,
    selfRuleVersion: w.selfRuleVersion,
    removedStatic: w.removedStatic,
    removedStaticHeads,
    removedStaticVarRules: w.removedStaticVarRules,
    hasTypeMutations: w.hasTypeMutations,
    typeView: w.typeView,
    typeViewProgramVersion: w.typeViewProgramVersion,
    typeViewOwner: w.typeViewOwner,
    maxStackDepth: w.maxStackDepth,
    allocation,
  };
  groundedContextIdentities.set(view, contextIdentity);
  inheritWorldRuntime(w, view);
  return view;
}

export function cloneWorld(w: World): World {
  return makeWorldView(
    w,
    {
      ids: w.allocation.ids.clone(),
      branchScoped: w.allocation.branchScoped,
    },
    forkMap(w.spaces),
    forkMap(w.store),
    forkMap(w.tokens),
    forkMap(w.selfRules),
    forkSet(w.removedStaticHeads),
    groundedContextIdentity(w),
  );
}

/** Fork a branch view over copy-on-write world components. Evaluator mutations replace a component or
 *  call `cloneWorld` before mutating its Map, Set, or rule index, so an untouched branch can share them. */
export function forkWorldView(
  w: World,
  allocation: RuntimeAllocationLane,
  contextIdentity = groundedContextIdentity(w),
): World {
  return makeWorldView(
    w,
    allocation,
    w.spaces,
    w.store,
    w.tokens,
    w.selfRules,
    w.removedStaticHeads,
    contextIdentity,
  );
}

export interface PinnedAsyncEvaluation {
  readonly env: MinEnv;
  readonly state: St;
  readonly release: () => void;
}

interface ProgramSnapshotStamp {
  readonly reusable: boolean;
  readonly programVersion: number;
  readonly typeProgramVersion: number;
  readonly groundingVersion: number;
  readonly atoms: Atom[];
  readonly ruleIndex: MinEnv["ruleIndex"];
  readonly sigs: MinEnv["sigs"];
  readonly types: MinEnv["types"];
  readonly gt: GroundingTable;
  readonly gtRevision: number | undefined;
  readonly agt: Map<string, AsyncGroundFn>;
  readonly agtRevision: number | undefined;
  readonly groundedEffects: Map<string, GroundedEffectPolicy> | undefined;
  readonly groundedEffectRevision: number | undefined;
  readonly imports: Map<string, Atom[]>;
  readonly importRevision: number | undefined;
  readonly capabilities: ReadonlySet<string> | undefined;
  readonly capabilityRevision: number | undefined;
  readonly sharedContextAtoms: readonly Atom[] | undefined;
  readonly hostImport: HostImportFn | undefined;
  readonly evaluationContext: EvaluationContext | undefined;
  readonly mutexes: Map<string, Promise<void>>;
  readonly tableSpace: TableSpace | undefined;
  readonly compiled: CompiledFns | undefined;
  readonly compiledSize: number;
  readonly intern: InternTable | undefined;
  readonly parEval: MinEnv["parEval"];
  readonly parEvalAsync: MinEnv["parEvalAsync"];
  readonly useTrail: boolean | undefined;
  readonly useFlatAtomspace: boolean | undefined;
}

interface CachedPinnedProgram {
  readonly source: MinEnv;
  readonly stamp: ProgramSnapshotStamp;
  readonly pinned: MinEnv;
  readonly snapshots: Set<MinEnv>;
  readonly pinnedGroundings: RevisionMap<string, GroundFn>;
  readonly pinnedAsyncGroundings: RevisionMap<string, AsyncGroundFn>;
  readonly pinnedGroundedEffects: RevisionMap<string, GroundedEffectPolicy> | undefined;
  readonly pinnedImports: RevisionMap<string, Atom[]>;
  readonly pinnedCapabilities: RevisionSet<string> | undefined;
  leases: number;
  retired: boolean;
  disposed: boolean;
}

const asyncProgramSnapshotCache = new WeakMap<MinEnv, CachedPinnedProgram>();

function programSnapshotStamp(root: MinEnv): ProgramSnapshotStamp {
  const gtRevision = collectionRevision(root.gt);
  const agtRevision = collectionRevision(root.agt);
  const groundedEffectRevision =
    root.groundedEffects === undefined ? 0 : collectionRevision(root.groundedEffects);
  const importRevision = collectionRevision(root.imports);
  const capabilityRevision =
    root.capabilities === undefined ? 0 : collectionRevision(root.capabilities);
  return {
    reusable:
      gtRevision !== undefined &&
      agtRevision !== undefined &&
      groundedEffectRevision !== undefined &&
      importRevision !== undefined &&
      capabilityRevision !== undefined,
    programVersion: root.programVersion ?? 0,
    typeProgramVersion: root.typeProgramVersion ?? 0,
    groundingVersion: root.groundingVersion ?? 0,
    atoms: root.atoms,
    ruleIndex: root.ruleIndex,
    sigs: root.sigs,
    types: root.types,
    gt: root.gt,
    gtRevision,
    agt: root.agt,
    agtRevision,
    groundedEffects: root.groundedEffects,
    groundedEffectRevision,
    imports: root.imports,
    importRevision,
    capabilities: root.capabilities,
    capabilityRevision,
    sharedContextAtoms: root.sharedContextAtoms,
    hostImport: root.hostImport,
    evaluationContext: root.evaluationContext,
    mutexes: root.mutexes,
    tableSpace: root.tableSpace,
    compiled: root.compiled,
    compiledSize: root.compiled?.size ?? 0,
    intern: root.intern,
    parEval: root.parEval,
    parEvalAsync: root.parEvalAsync,
    useTrail: root.useTrail,
    useFlatAtomspace: root.useFlatAtomspace,
  };
}

function sameProgramSnapshot(left: ProgramSnapshotStamp, right: ProgramSnapshotStamp): boolean {
  return (
    right.reusable &&
    left.programVersion === right.programVersion &&
    left.typeProgramVersion === right.typeProgramVersion &&
    left.groundingVersion === right.groundingVersion &&
    left.atoms === right.atoms &&
    left.ruleIndex === right.ruleIndex &&
    left.sigs === right.sigs &&
    left.types === right.types &&
    left.gt === right.gt &&
    left.gtRevision === right.gtRevision &&
    left.agt === right.agt &&
    left.agtRevision === right.agtRevision &&
    left.groundedEffects === right.groundedEffects &&
    left.groundedEffectRevision === right.groundedEffectRevision &&
    left.imports === right.imports &&
    left.importRevision === right.importRevision &&
    left.capabilities === right.capabilities &&
    left.capabilityRevision === right.capabilityRevision &&
    left.sharedContextAtoms === right.sharedContextAtoms &&
    left.hostImport === right.hostImport &&
    left.evaluationContext === right.evaluationContext &&
    left.mutexes === right.mutexes &&
    left.tableSpace === right.tableSpace &&
    left.compiled === right.compiled &&
    left.compiledSize === right.compiledSize &&
    left.intern === right.intern &&
    left.parEval === right.parEval &&
    left.parEvalAsync === right.parEvalAsync &&
    left.useTrail === right.useTrail &&
    left.useFlatAtomspace === right.useFlatAtomspace
  );
}

function programSnapshotStillCurrent(stamp: ProgramSnapshotStamp, root: MinEnv): boolean {
  return (
    stamp.reusable &&
    stamp.programVersion === (root.programVersion ?? 0) &&
    stamp.typeProgramVersion === (root.typeProgramVersion ?? 0) &&
    stamp.groundingVersion === (root.groundingVersion ?? 0) &&
    stamp.atoms === root.atoms &&
    stamp.ruleIndex === root.ruleIndex &&
    stamp.sigs === root.sigs &&
    stamp.types === root.types &&
    stamp.gt === root.gt &&
    stamp.gtRevision === collectionRevision(root.gt) &&
    stamp.agt === root.agt &&
    stamp.agtRevision === collectionRevision(root.agt) &&
    stamp.groundedEffects === root.groundedEffects &&
    stamp.groundedEffectRevision ===
      (root.groundedEffects === undefined ? 0 : collectionRevision(root.groundedEffects)) &&
    stamp.imports === root.imports &&
    stamp.importRevision === collectionRevision(root.imports) &&
    stamp.capabilities === root.capabilities &&
    stamp.capabilityRevision ===
      (root.capabilities === undefined ? 0 : collectionRevision(root.capabilities)) &&
    stamp.sharedContextAtoms === root.sharedContextAtoms &&
    stamp.hostImport === root.hostImport &&
    stamp.evaluationContext === root.evaluationContext &&
    stamp.mutexes === root.mutexes &&
    stamp.tableSpace === root.tableSpace &&
    stamp.compiled === root.compiled &&
    stamp.compiledSize === (root.compiled?.size ?? 0) &&
    stamp.intern === root.intern &&
    stamp.parEval === root.parEval &&
    stamp.parEvalAsync === root.parEvalAsync &&
    stamp.useTrail === root.useTrail &&
    stamp.useFlatAtomspace === root.useFlatAtomspace
  );
}

function disposeCachedPinnedProgram(cached: CachedPinnedProgram): void {
  if (cached.disposed) return;
  cached.disposed = true;
  cached.snapshots.delete(cached.pinned);
  cached.pinnedGroundings.releaseSnapshot();
  cached.pinnedAsyncGroundings.releaseSnapshot();
  cached.pinnedGroundedEffects?.releaseSnapshot();
  cached.pinnedImports.releaseSnapshot();
  cached.pinnedCapabilities?.releaseSnapshot();
}

export function retireCachedProgramSnapshot(env: MinEnv): void {
  const root = rootEvaluationEnvironment(env);
  const cached = asyncProgramSnapshotCache.get(root);
  if (cached === undefined) return;
  asyncProgramSnapshotCache.delete(root);
  cached.retired = true;
  if (cached.leases === 0) disposeCachedPinnedProgram(cached);
}

function createCachedPinnedProgram(root: MinEnv, stamp: ProgramSnapshotStamp): CachedPinnedProgram {
  const pinnedGroundings =
    root.gt instanceof RevisionMap ? root.gt.snapshot() : new RevisionMap(root.gt);
  const pinnedAsyncGroundings =
    root.agt instanceof RevisionMap ? root.agt.snapshot() : new RevisionMap(root.agt);
  const pinnedGroundedEffects =
    root.groundedEffects instanceof RevisionMap
      ? root.groundedEffects.snapshot()
      : root.groundedEffects === undefined
        ? undefined
        : new RevisionMap(root.groundedEffects);
  const pinnedImports =
    root.imports instanceof RevisionMap
      ? root.imports.snapshot()
      : new RevisionMap([...root.imports].map(([name, atoms]) => [name, atoms.slice()] as const));
  const pinnedCapabilities =
    root.capabilities instanceof RevisionSet
      ? root.capabilities.snapshot()
      : root.capabilities === undefined
        ? undefined
        : new RevisionSet(root.capabilities);
  const pinned: MinEnv = {
    ...root,
    gt: pinnedGroundings,
    imports: pinnedImports,
    agt: pinnedAsyncGroundings,
    ...(pinnedGroundedEffects === undefined ? {} : { groundedEffects: pinnedGroundedEffects }),
    ...(pinnedCapabilities === undefined ? {} : { capabilities: pinnedCapabilities }),
    ...(root.evaluationContext === undefined
      ? {}
      : { evaluationContext: copyEvaluationContext(root.evaluationContext) }),
    evaluatedAtoms: new WeakSet(),
    typeCache: new WeakMap(),
    tableSpace:
      root.tableSpace === undefined ? undefined : new TableSpace(root.tableSpace.resourceBudget()),
    compiled: root.compiled === undefined ? undefined : new Map(root.compiled),
    pureFunctors: root.pureFunctors === undefined ? undefined : new Set(root.pureFunctors),
    workerReplaySafeFunctors:
      root.workerReplaySafeFunctors === undefined
        ? undefined
        : new Set(root.workerReplaySafeFunctors),
    modedPureFunctors:
      root.modedPureFunctors === undefined ? undefined : new Set(root.modedPureFunctors),
    tableWorth: root.tableWorth === undefined ? undefined : new Set(root.tableWorth),
    modedTableWorth: root.modedTableWorth === undefined ? undefined : new Set(root.modedTableWorth),
  };
  pinnedProgramEnvironments.add(pinned);
  pinnedProgramOwners.set(pinned, programIdentityEnvironment(root));
  let snapshots = activeProgramSnapshots.get(root);
  if (snapshots === undefined) {
    snapshots = new Set();
    activeProgramSnapshots.set(root, snapshots);
  }
  snapshots.add(pinned);
  return {
    source: root,
    stamp,
    pinned,
    snapshots,
    pinnedGroundings,
    pinnedAsyncGroundings,
    pinnedGroundedEffects,
    pinnedImports,
    pinnedCapabilities,
    leases: 0,
    retired: false,
    disposed: false,
  };
}

export function acquirePinnedProgram(root: MinEnv): {
  readonly env: MinEnv;
  readonly release: () => void;
  readonly isCurrent: () => boolean;
} {
  const stamp = programSnapshotStamp(root);
  let cached = asyncProgramSnapshotCache.get(root);
  if (cached === undefined || !sameProgramSnapshot(cached.stamp, stamp)) {
    if (cached !== undefined) {
      asyncProgramSnapshotCache.delete(root);
      cached.retired = true;
      if (cached.leases === 0) disposeCachedPinnedProgram(cached);
    }
    cached = createCachedPinnedProgram(root, stamp);
    if (stamp.reusable) asyncProgramSnapshotCache.set(root, cached);
    else cached.retired = true;
  }
  cached.leases += 1;
  let released = false;
  return {
    env: cached.pinned,
    isCurrent: () => !cached!.retired && programSnapshotStillCurrent(cached!.stamp, root),
    release: () => {
      if (released) return;
      released = true;
      cached!.leases -= 1;
      if (cached!.retired && cached!.leases === 0) disposeCachedPinnedProgram(cached!);
    },
  };
}

export function copyEvaluationContext(context: EvaluationContext): EvaluationContext {
  return {
    currentSpace: context.currentSpace,
    visibleSpaces: context.visibleSpaces.slice(),
    expectedType: context.expectedType,
  };
}

/** Reuse one immutable program image across sequential async queries. */
export interface AsyncEvaluationSession {
  evaluate(
    fuel: number,
    state: St,
    bindings: Bindings,
    atom: Atom,
    signal?: AbortSignal,
  ): Promise<[Array<[Atom, Bindings]>, St]>;
  /** Evaluate an exclusively owned state without copying its persistent world maps. */
  evaluateOwned(
    fuel: number,
    state: St,
    bindings: Bindings,
    atom: Atom,
    signal?: AbortSignal,
  ): Promise<[Array<[Atom, Bindings]>, St]>;
  isCurrent(): boolean;
  close(): void;
}

export function installTypeDeclaration(
  view: TypeView,
  atom: Atom,
  replaceSignature: boolean,
): void {
  if (!isTypeDeclaration(atom)) return;
  const subject = atom.items[1]!;
  const type = atom.items[2]!;
  if (subject.kind === "sym") {
    if (
      opOf(type) === "->" &&
      type.kind === "expr" &&
      (replaceSignature || !view.sigs.has(subject.name))
    )
      view.sigs.set(subject.name, type.items.slice(1));
    pushUniqueType(view.types, subject.name, type);
  } else if (
    subject.kind === "expr" &&
    !view.exprTypes.some(
      ([existing, existingType]) => atomEq(existing, subject) && atomEq(existingType, type),
    )
  ) {
    view.exprTypes.push([subject, type]);
  }
}

export function resolveTok(w: World, a: Atom): Atom {
  if (a.kind === "sym") return w.tokens.get(a.name) ?? a;
  return a;
}

function spaceName(w: World, a: Atom): string | undefined {
  if (a.kind === "sym" && a.name.startsWith("&") && isRuntimeId(a.name.slice(1), "space"))
    return a.name;
  const r = resolveTok(w, a);
  return r.kind === "sym" ? r.name : undefined;
}

export const UNDEF = sym("%Undefined%");

export function isTypeDeclaration(atom: Atom): atom is ExprAtom {
  return atom.kind === "expr" && opOf(atom) === ":" && atom.items.length === 3;
}
