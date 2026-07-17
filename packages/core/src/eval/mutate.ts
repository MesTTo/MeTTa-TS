// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, atomEq, sym } from "../atom";
import {
  emptyLog,
  idxCount,
  logFromArray,
  logGroundIdx,
  logNonGround,
  logSize,
  logToArray,
} from "../atomlog";
import { type Bindings } from "../bindings";
import {
  type GroundedImportWorldDelta,
  type GroundedModuleInstallation,
  type GroundFn,
  type ReduceEffect,
  type ReduceResult,
} from "../builtins";
import {
  addGroundedOperationType,
  detachProgramCollectionsIfShared,
  evaluationCacheEnvironment,
  groundedV2RegistrationRecord,
  installGroundedEffectPolicy,
  invalidateGroundedRegistration,
  normalizedGroundedEffectPolicy,
  pinnedProgramEnvironments,
  rootEvaluationEnvironment,
} from "../eval/env";
import {
  exactCandidateSource,
  type Gen,
  groundedCallContext,
  groundedCallContextWithSignal,
  isPromiseLike,
  pendingAsyncOpBox,
} from "../eval/geneval";
import {
  type AsyncGroundFn,
  AsyncInSyncError,
  driverEffect,
  type GroundedEffectPolicy,
  inst,
  type JournalWorldDelta,
  type MinEnv,
  type NamedSpace,
  type St,
  type StreamingIsolatedBranches,
  type World,
  type WorldMutation,
} from "../eval/machine";
import {
  appendSpace,
  applyAtomDelta,
  assertJournalDeltasDoNotConflict,
  type BranchStateDelta,
  captureWorldDelta,
  checkedCounterAdvance,
  checkedGenerationAdvance,
  indexSelfRules,
  multisetDelta,
  releaseChildWorldRuntimes,
  type WorldDelta,
} from "../eval/par";
import { collectGroundedV2LegacyG, makeExpr, resolveStates } from "../eval/query";
import {
  addStaticRemoval,
  disableTabling,
  hasStaticAtom,
  mergeStaticRemovals,
  runtimeAtoms,
  selfAtoms,
  staticRemovalState,
} from "../eval/specializer";
import { headKey, opOf } from "../eval/terms";
import { buildWorldTypeView, selectPinnedProgramEnvironment } from "../eval/typeops";
import {
  acquirePinnedProgram,
  type CandidateSource,
  checkWorldDeadline,
  cloneWorld,
  contextualSpaceName,
  groundedContextIdentities,
  groundedContextIdentity,
  inheritWorldRuntime,
  isTypeDeclaration,
  namedSpaceAtoms,
  nextRuntimeRuleSetVersion,
  nextWorldGeneration,
  type PinnedAsyncEvaluation,
  recordWorldMutation,
  retireCachedProgramSnapshot,
  worldRuntimeContext,
  worldRuntimeContexts,
} from "../eval/world";
import { FlatAtomSpace } from "../flat-atomspace";
import {
  type GroundedOperationV2,
  type GroundedOperationV2Options,
  groundedV2AsyncAdapter,
  groundedV2Registration,
  groundedV2SyncAdapter,
} from "../grounded-v2";
import { format } from "../parser";
import { ForkableMap, forkMap } from "../persistent-collection";
import { isRuntimeId, type StateId } from "../trace";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export function* callHostImportG(
  env: MinEnv,
  world: World,
  space: Atom,
  file: Atom,
  bindings: Bindings,
): Gen<ReduceResult | undefined> {
  const hostImport = env.hostImport;
  if (hostImport === undefined) return undefined;
  const groundedV2 = groundedV2Registration(hostImport);
  if (groundedV2 !== undefined)
    return yield* collectGroundedV2LegacyG(
      groundedV2,
      env,
      world,
      "import!",
      [space, file],
      bindings,
      makeExpr(env, [sym("import!"), space, file]),
    );
  checkWorldDeadline(world, "import!");
  pendingAsyncOpBox.op = "import!";
  return (yield driverEffect(
    "import!",
    () => {
      const result = hostImport(space, file, groundedCallContext(env, world));
      if (isPromiseLike(result)) throw new AsyncInSyncError("import!");
      checkWorldDeadline(world, "import!");
      return result;
    },
    async (signal) => {
      const result = await hostImport(
        space,
        file,
        groundedCallContextWithSignal(env, world, signal),
      );
      checkWorldDeadline(world, "import!");
      return result;
    },
  )) as ReduceResult;
}

/** Register a sync grounded operation and invalidate analyses that may have classified its name. */
export function registerGroundedOperation(
  env: MinEnv,
  name: string,
  op: GroundFn,
  effects: GroundedEffectPolicy = { classes: ["host-io"], speculative: false },
): void {
  const policy = normalizedGroundedEffectPolicy(effects);
  retireCachedProgramSnapshot(env);
  detachProgramCollectionsIfShared(env);
  env.gt.set(name, op);
  env.groundingVersion = (env.groundingVersion ?? 0) + 1;
  installGroundedEffectPolicy(env, name, policy);
  addGroundedOperationType(env, name, op);
  invalidateGroundedRegistration(env);
}

/** Register an async grounded operation and invalidate analyses that may have classified its name. */
export function registerAsyncGroundedOperation(
  env: MinEnv,
  name: string,
  op: AsyncGroundFn,
  effects: GroundedEffectPolicy = { classes: ["suspension"], speculative: true },
): void {
  const policy = normalizedGroundedEffectPolicy(effects);
  retireCachedProgramSnapshot(env);
  env.agt.set(name, op);
  env.groundingVersion = (env.groundingVersion ?? 0) + 1;
  installGroundedEffectPolicy(env, name, policy);
  invalidateGroundedRegistration(env);
}

/** Register a pull-based grounded operation with an explicit execution and effect contract. */
export function registerGroundedOperationV2(
  env: MinEnv,
  name: string,
  operation: GroundedOperationV2,
  options: GroundedOperationV2Options,
): void {
  const registration = groundedV2RegistrationRecord(operation, options);
  retireCachedProgramSnapshot(env);
  detachProgramCollectionsIfShared(env);
  if (options.mode === "sync") {
    env.agt.delete(name);
    registerGroundedOperation(
      env,
      name,
      groundedV2SyncAdapter(registration),
      registration.options.effects,
    );
  } else {
    env.gt.delete(name);
    registerAsyncGroundedOperation(
      env,
      name,
      groundedV2AsyncAdapter(registration),
      registration.options.effects,
    );
  }
}

export function namedSpaceCandidateGetter(
  w: World,
  space: NamedSpace | undefined,
): (pInst: Atom) => CandidateSource {
  let scan: Atom[] | undefined;
  return (pInst: Atom): CandidateSource => {
    const log = space ?? emptyLog;
    if (pInst.ground && logNonGround(log) === 0 && w.store.size === 0) {
      return exactCandidateSource(pInst, idxCount(logGroundIdx(log), pInst), logSize(log));
    }
    scan ??= namedSpaceAtoms(space).map((x) => resolveStates(w, x));
    return scan;
  };
}

/** Pin one async query to its starting program and world while sharing static indexes until a write. */
export function pinAsyncEvaluation(env: MinEnv, state: St): PinnedAsyncEvaluation {
  if (pinnedProgramEnvironments.has(env)) return { env, state, release: () => undefined };

  const root = rootEvaluationEnvironment(env);
  if (pinnedProgramEnvironments.has(root)) return { env, state, release: () => undefined };

  const world = cloneWorld(state.world);
  const program = acquirePinnedProgram(root);
  const pinnedRoot = program.env;
  const selected = selectPinnedProgramEnvironment(env, root, pinnedRoot, world);

  return {
    env: selected,
    state: { counter: state.counter, world },
    release: program.release,
  };
}

function replayWorldMutation(env: MinEnv, into: World, mutation: WorldMutation): World {
  switch (mutation.kind) {
    case "add-atoms":
      return appendSpace(env, into, mutation.space, [...mutation.atoms]);
    case "remove-atom":
      return eraseSpace(env, into, mutation.space, mutation.atom);
    case "set-state": {
      if (mutation.introduced && into.store.has(mutation.key))
        throw new Error(`branch allocation collision for state '${String(mutation.key)}'`);
      const world = cloneWorld(into);
      world.store.set(mutation.key, mutation.value);
      world.generation = nextWorldGeneration(into);
      return world;
    }
    case "create-space": {
      if (into.spaces.has(mutation.name))
        throw new Error(`branch allocation collision for space '${mutation.name}'`);
      const world = cloneWorld(into);
      world.spaces.set(mutation.name, logFromArray(mutation.atoms));
      world.generation = nextWorldGeneration(into);
      return world;
    }
    case "set-token": {
      const world = cloneWorld(into);
      world.tokens.set(mutation.name, mutation.value);
      world.generation = nextWorldGeneration(into);
      return world;
    }
    case "set-max-stack-depth": {
      const world = cloneWorld(into);
      world.maxStackDepth = mutation.value;
      world.generation = nextWorldGeneration(into);
      return world;
    }
    case "install-module":
      return inheritWorldRuntime(into, {
        ...into,
        moduleInstallations: Object.freeze([...into.moduleInstallations, mutation.installation]),
      });
  }
}

function applyJournalWorldDelta(env: MinEnv, into: World, delta: JournalWorldDelta): World {
  if (delta.effects.length === 0 && delta.generationDelta === 0) return into;
  let merged = cloneWorld(into);
  for (const effect of delta.effects)
    if (effect.payload.kind === "world")
      merged = replayWorldMutation(env, merged, effect.payload.mutation);
  merged.generation = checkedGenerationAdvance(into.generation, delta.generationDelta);
  merged.transactionDepth = into.transactionDepth;
  merged.allocation = {
    ids: into.allocation.ids.clone(),
    branchScoped: into.allocation.branchScoped,
  };
  const parent = worldRuntimeContext(into);
  const committed =
    parent.policy === "sequential-commit"
      ? {
          audit: parent.audit.commit(delta.effects),
          journal: parent.journal,
        }
      : {
          audit: parent.audit,
          journal: parent.journal.commit(delta.effects),
        };
  worldRuntimeContexts.set(merged, {
    ...parent,
    ...committed,
  });
  groundedContextIdentities.set(merged, groundedContextIdentity(into));
  return merged;
}

/** Apply a captured branch write set to an already merged world in deterministic journal order. */
export function applyWorldDelta(env: MinEnv, into: World, delta: WorldDelta): World {
  if (delta.kind === "journal") return applyJournalWorldDelta(env, into, delta);
  const selfChanged = delta.selfAdded.length > 0 || delta.selfRemoved.length > 0;
  const staticAtoms = logToArray(into.removedStatic);
  for (const atom of delta.removedStatic)
    if (!staticAtoms.some((candidate) => atomEq(candidate, atom))) staticAtoms.push(atom);
  const staticChanged = staticAtoms.length !== logSize(into.removedStatic);
  const changed =
    delta.generationDelta > 0 ||
    delta.moduleInstallations.length > 0 ||
    selfChanged ||
    delta.spaces.length > 0 ||
    delta.store.length > 0 ||
    delta.tokens.length > 0 ||
    staticChanged ||
    delta.maxStackDepth !== undefined;
  if (!changed) return into;

  const selfExtra = selfChanged
    ? applyAtomDelta(runtimeAtoms(into), delta.selfAdded, delta.selfRemoved)
    : runtimeAtoms(into);
  const spaces = forkMap(into.spaces);
  for (const space of delta.spaces) {
    if (
      space.introduced &&
      spaces.has(space.name) &&
      space.name.startsWith("&") &&
      isRuntimeId(space.name.slice(1), "space")
    )
      throw new Error(`branch allocation collision for space '${space.name}'`);
    spaces.set(
      space.name,
      logFromArray(
        applyAtomDelta(namedSpaceAtoms(spaces.get(space.name)), space.added, space.removed),
      ),
    );
  }
  const store = forkMap(into.store);
  for (const write of delta.store) {
    if (
      write.introduced &&
      store.has(write.key) &&
      typeof write.key === "string" &&
      isRuntimeId(write.key, "state")
    )
      throw new Error(`branch allocation collision for state '${write.key}'`);
    store.set(write.key, write.value);
  }
  const tokens = forkMap(into.tokens);
  for (const [name, value] of delta.tokens) tokens.set(name, value);
  const staticRemovals = staticRemovalState(staticAtoms);
  const flat = selfChanged
    ? into.flatSelfExtra === undefined
      ? undefined
      : FlatAtomSpace.fromAtoms(selfExtra)
    : into.flatSelfExtra;
  const merged: World = {
    generation: checkedGenerationAdvance(into.generation, delta.generationDelta),
    moduleInstallations: Object.freeze([...into.moduleInstallations, ...delta.moduleInstallations]),
    transactionDepth: into.transactionDepth,
    spaces,
    store,
    tokens,
    selfExtra: selfChanged
      ? flat === undefined
        ? logFromArray(selfExtra)
        : emptyLog
      : into.selfExtra,
    flatSelfExtra: flat,
    selfRules: selfChanged ? new ForkableMap() : into.selfRules,
    selfVarRules: selfChanged ? [] : into.selfVarRules,
    selfRuleVersion:
      selfChanged || staticChanged ? nextRuntimeRuleSetVersion() : into.selfRuleVersion,
    removedStatic: staticRemovals.removedStatic,
    removedStaticHeads: staticRemovals.removedStaticHeads,
    removedStaticVarRules: staticRemovals.removedStaticVarRules,
    hasTypeMutations: into.hasTypeMutations || delta.hasTypeMutations,
    typeView: undefined,
    typeViewProgramVersion: undefined,
    typeViewOwner: undefined,
    maxStackDepth: delta.maxStackDepth ?? into.maxStackDepth,
    allocation: {
      ids: into.allocation.ids.clone(),
      branchScoped: into.allocation.branchScoped,
    },
  };
  groundedContextIdentities.set(merged, groundedContextIdentity(into));
  if (selfChanged) indexSelfRules(merged, selfExtra);
  if (merged.hasTypeMutations) {
    const owner = rootEvaluationEnvironment(env);
    merged.typeView = buildWorldTypeView(owner, merged);
    merged.typeViewProgramVersion = owner.typeProgramVersion ?? 0;
    merged.typeViewOwner = owner;
  }
  return merged;
}

export function applyBranchStateDelta(env: MinEnv, into: St, delta: BranchStateDelta): St {
  return {
    counter: checkedCounterAdvance(into.counter, delta.counter),
    world: applyWorldDelta(env, into.world, delta.world),
  };
}

/** Merge sibling journal deltas exactly like the one-shot world merge: conflict-check the whole
 *  set against the base, then apply in branch order. */
function mergeWorldJournalDeltas(
  env: MinEnv,
  base: World,
  deltas: readonly JournalWorldDelta[],
): World {
  if (deltas.every((delta) => delta.generationDelta === 0 && delta.effects.length === 0))
    return base;
  assertJournalDeltasDoNotConflict(base, deltas);
  let merged = base;
  for (const delta of deltas) merged = applyJournalWorldDelta(env, merged, delta);
  if (deltas.some((delta) => delta.generationDelta > 0))
    merged.generation =
      Math.max(base.generation, ...deltas.map((delta) => base.generation + delta.generationDelta)) +
      1;
  groundedContextIdentities.set(merged, groundedContextIdentity(base));
  return merged;
}

function mergeWorldsUnchecked(env: MinEnv, base: World, branches: readonly World[]): World {
  const deltas = branches.map((branch) => captureWorldDelta(base, branch));
  if (
    branches.every((branch) => branch.generation === base.generation) &&
    deltas.every((delta) => delta.kind !== "journal" || delta.effects.length === 0)
  )
    return base;
  if (deltas.every((delta): delta is JournalWorldDelta => delta.kind === "journal"))
    return mergeWorldJournalDeltas(env, base, deltas);
  // The concurrent-branch merge works on materialized arrays (par is off the hot path); the result is
  // rebuilt into a log. The atom order is preserved so merged `&self` content matches the array version.
  const baseSelf = runtimeAtoms(base);
  let selfExtra = baseSelf.slice();
  const spaces = forkMap(base.spaces);
  const store = forkMap(base.store);
  const tokens = forkMap(base.tokens);
  const moduleInstallations = base.moduleInstallations.slice();
  const staticRemovals = mergeStaticRemovals(base, branches);
  const introducedOpaqueSpaces = new Set<string>();
  const introducedOpaqueStates = new Set<StateId>();
  let changed = false;
  let selfChanged = false;
  let maxStackDepth = base.maxStackDepth;
  for (const w of branches) {
    const newModules = w.moduleInstallations.slice(base.moduleInstallations.length);
    if (newModules.length > 0) {
      changed = true;
      moduleInstallations.push(...newModules);
    }
    const d = multisetDelta(baseSelf, runtimeAtoms(w));
    if (d.added.length > 0 || d.removed.length > 0) {
      changed = true;
      selfChanged = true;
      selfExtra = applyAtomDelta(selfExtra, d.added, d.removed);
    }
    for (const [k, v] of w.spaces) {
      if (!base.spaces.has(k) && k.startsWith("&") && isRuntimeId(k.slice(1), "space")) {
        if (introducedOpaqueSpaces.has(k))
          throw new Error(`branch allocation collision for space '${k}'`);
        introducedOpaqueSpaces.add(k);
      }
      const baseV = namedSpaceAtoms(base.spaces.get(k));
      const sd = multisetDelta(baseV, namedSpaceAtoms(v));
      if (base.spaces.has(k) && sd.added.length === 0 && sd.removed.length === 0) continue;
      changed = true;
      spaces.set(
        k,
        logFromArray(applyAtomDelta(namedSpaceAtoms(spaces.get(k)), sd.added, sd.removed)),
      );
    }
    for (const [k, v] of w.store) {
      if (typeof k === "string" && !base.store.has(k) && isRuntimeId(k, "state")) {
        if (introducedOpaqueStates.has(k))
          throw new Error(`branch allocation collision for state '${k}'`);
        introducedOpaqueStates.add(k);
      }
      if (!Object.is(base.store.get(k), v)) {
        changed = true;
        store.set(k, v);
      }
    }
    for (const [k, v] of w.tokens)
      if (!Object.is(base.tokens.get(k), v)) {
        changed = true;
        tokens.set(k, v);
      }
    if (w.maxStackDepth !== base.maxStackDepth) {
      changed = true;
      maxStackDepth = w.maxStackDepth;
    }
  }
  const staticChanged = logSize(staticRemovals.removedStatic) !== logSize(base.removedStatic);
  changed ||= staticChanged;
  if (!changed) return base;
  // Rebuild the rule index from the merged `&self` atoms (par is rare; correctness over speed here).
  const flat = selfChanged
    ? base.flatSelfExtra === undefined
      ? undefined
      : FlatAtomSpace.fromAtoms(selfExtra)
    : base.flatSelfExtra;
  const merged: World = {
    generation: Math.max(base.generation, ...branches.map((branch) => branch.generation)) + 1,
    moduleInstallations: Object.freeze(moduleInstallations),
    transactionDepth: base.transactionDepth,
    spaces,
    store,
    tokens,
    selfExtra: selfChanged
      ? flat === undefined
        ? logFromArray(selfExtra)
        : emptyLog
      : base.selfExtra,
    flatSelfExtra: flat,
    selfRules: selfChanged ? new ForkableMap() : base.selfRules,
    selfVarRules: selfChanged ? [] : base.selfVarRules,
    selfRuleVersion:
      selfChanged || staticChanged ? nextRuntimeRuleSetVersion() : base.selfRuleVersion,
    removedStatic: staticRemovals.removedStatic,
    removedStaticHeads: staticRemovals.removedStaticHeads,
    removedStaticVarRules: staticRemovals.removedStaticVarRules,
    hasTypeMutations: base.hasTypeMutations || branches.some((branch) => branch.hasTypeMutations),
    typeView: undefined,
    typeViewProgramVersion: undefined,
    typeViewOwner: undefined,
    maxStackDepth,
    allocation: {
      ids: base.allocation.ids.clone(),
      branchScoped: base.allocation.branchScoped,
    },
  };
  if (selfChanged) indexSelfRules(merged, selfExtra);
  if (merged.hasTypeMutations) {
    const owner = rootEvaluationEnvironment(env);
    merged.typeView = buildWorldTypeView(owner, merged);
    merged.typeViewProgramVersion = owner.typeProgramVersion ?? 0;
    merged.typeViewOwner = owner;
  }
  return inheritWorldRuntime(base, merged);
}

function mergeWorlds(env: MinEnv, base: World, branches: readonly World[]): World {
  try {
    return mergeWorldsUnchecked(env, base, branches);
  } finally {
    releaseChildWorldRuntimes(base, branches);
  }
}

function invalidateWorldTypeView(world: World): void {
  world.hasTypeMutations = true;
  world.typeView = undefined;
  world.typeViewProgramVersion = undefined;
  world.typeViewOwner = undefined;
}

export function importModuleName(file: Atom): string | undefined {
  if (file.kind === "sym") return file.name;
  if (file.kind === "gnd" && file.value.g === "str") return file.value.s;
  if (
    file.kind === "expr" &&
    file.items.length === 2 &&
    file.items[0]?.kind === "sym" &&
    file.items[0].name === "library"
  ) {
    const name = file.items[1];
    if (name?.kind === "sym") return name.name;
    if (name?.kind === "gnd" && name.value.g === "str") return name.value.s;
  }
  return undefined;
}

export function moduleContentHash(atoms: readonly Atom[]): string {
  const canonical = JSON.stringify(atoms.map(format));
  return `sha256:${bytesToHex(sha256(utf8ToBytes(canonical)))}`;
}

function importWorldDelta(env: MinEnv, before: World, after: World): GroundedImportWorldDelta {
  const owner = rootEvaluationEnvironment(env);
  const addedAtoms: Array<{ readonly space: Atom; readonly atom: Atom }> = [];
  const removedAtoms: Array<{ readonly space: Atom; readonly atom: Atom }> = [];
  const names = new Set(["&self", ...before.spaces.keys(), ...after.spaces.keys()]);
  for (const name of names) {
    const beforeAtoms =
      name === "&self" ? selfAtoms(owner, before) : namedSpaceAtoms(before.spaces.get(name));
    const afterAtoms =
      name === "&self" ? selfAtoms(owner, after) : namedSpaceAtoms(after.spaces.get(name));
    const delta = multisetDelta(beforeAtoms, afterAtoms);
    for (const atom of delta.added) addedAtoms.push({ space: sym(name), atom });
    for (const atom of delta.removed) removedAtoms.push({ space: sym(name), atom });
  }
  const boundTokens: Array<{ readonly name: string; readonly atom: Atom }> = [];
  for (const [name, atom] of after.tokens) {
    const previous = before.tokens.get(name);
    if (previous === undefined || !atomEq(previous, atom)) boundTokens.push({ name, atom });
  }
  return Object.freeze({
    addedAtoms: Object.freeze(addedAtoms.map((delta) => Object.freeze(delta))),
    removedAtoms: Object.freeze(removedAtoms.map((delta) => Object.freeze(delta))),
    boundTokens: Object.freeze(boundTokens.map((delta) => Object.freeze(delta))),
  });
}

export function recordModuleInstallation(
  env: MinEnv,
  before: World,
  after: World,
  request: Atom,
  source: GroundedModuleInstallation["source"],
  targetSpace: string,
  resolvedIdentity?: string,
  contentHash?: string,
): World {
  const generation =
    after.generation === before.generation ? nextWorldGeneration(before) : after.generation;
  const record: GroundedModuleInstallation = Object.freeze({
    request,
    source,
    ...(resolvedIdentity === undefined ? {} : { resolvedIdentity }),
    ...(contentHash === undefined ? {} : { contentHash }),
    targetSpace: sym(targetSpace),
    previousGeneration: before.generation,
    generation,
    worldDelta: importWorldDelta(env, before, after),
  });
  const installed = inheritWorldRuntime(after, {
    ...after,
    generation,
    moduleInstallations: Object.freeze([...after.moduleInstallations, record]),
  });
  recordWorldMutation(installed, "import!", { kind: "install-module", installation: record });
  return installed;
}

function reindexRuntimeSelfRules(w: World): void {
  w.selfRules = new ForkableMap();
  w.selfVarRules = [];
  indexSelfRules(w, runtimeAtoms(w));
  w.selfRuleVersion = nextRuntimeRuleSetVersion();
}

export function eraseSpace(env: MinEnv, w0: World, name: string, a: Atom): World {
  const w = cloneWorld(w0);
  const erase1 = (xs: readonly Atom[]): { readonly atoms: Atom[]; readonly removed: boolean } => {
    const i = xs.findIndex((y) => atomEq(y, a));
    return i < 0
      ? { atoms: [...xs], removed: false }
      : { atoms: [...xs.slice(0, i), ...xs.slice(i + 1)], removed: true };
  };
  if (name === "&self") {
    if (w.flatSelfExtra !== undefined) {
      const next = w.flatSelfExtra.removeOne(a);
      if (next.size !== w.flatSelfExtra.size) {
        w.flatSelfExtra = next;
        reindexRuntimeSelfRules(w);
        if (isTypeDeclaration(a)) {
          invalidateWorldTypeView(w);
          disableTabling(evaluationCacheEnvironment(env));
        }
        w.generation = nextWorldGeneration(w0);
        recordWorldMutation(w, "remove-atom", { kind: "remove-atom", space: name, atom: a });
        return w;
      }
    }
    const xs = logToArray(w.selfExtra);
    const i = xs.findIndex((y) => atomEq(y, a));
    if (i >= 0) {
      w.selfExtra = logFromArray([...xs.slice(0, i), ...xs.slice(i + 1)]);
      reindexRuntimeSelfRules(w);
      if (isTypeDeclaration(a)) {
        invalidateWorldTypeView(w);
        disableTabling(evaluationCacheEnvironment(env));
      }
      w.generation = nextWorldGeneration(w0);
      recordWorldMutation(w, "remove-atom", { kind: "remove-atom", space: name, atom: a });
    } else if (hasStaticAtom(env, a)) {
      addStaticRemoval(w, a);
      if (isTypeDeclaration(a)) {
        invalidateWorldTypeView(w);
        disableTabling(evaluationCacheEnvironment(env));
      }
      w.generation = nextWorldGeneration(w0);
      recordWorldMutation(w, "remove-atom", { kind: "remove-atom", space: name, atom: a });
    }
  } else {
    const erased = erase1(namedSpaceAtoms(w.spaces.get(name)));
    w.spaces.set(name, logFromArray(erased.atoms));
    if (erased.removed) {
      w.generation = nextWorldGeneration(w0);
      recordWorldMutation(w, "remove-atom", { kind: "remove-atom", space: name, atom: a });
    }
  }
  return w;
}

export function applyReduceEffects(
  env: MinEnv,
  st: St,
  b: Bindings,
  effects: readonly ReduceEffect[] | undefined,
): { readonly tag: "ok"; readonly state: St } | { readonly tag: "error"; readonly msg: string } {
  if (effects === undefined || effects.length === 0) return { tag: "ok", state: st };
  let next = st;
  for (const effect of effects) {
    switch (effect.kind) {
      case "addAtom": {
        const space = inst(env, b, effect.space);
        const name = contextualSpaceName(env, next.world, space);
        if (name === undefined) return { tag: "error", msg: "async effect addAtom: not a space" };
        const atom = inst(env, b, effect.atom);
        if (opOf(atom) === "=") disableTabling(evaluationCacheEnvironment(env));
        next = { counter: next.counter, world: appendSpace(env, next.world, name, [atom]) };
        break;
      }
      case "removeAtom": {
        const space = inst(env, b, effect.space);
        const name = contextualSpaceName(env, next.world, space);
        if (name === undefined)
          return { tag: "error", msg: "async effect removeAtom: not a space" };
        const atom = inst(env, b, effect.atom);
        if (opOf(atom) === "=") disableTabling(evaluationCacheEnvironment(env));
        next = {
          counter: next.counter,
          world: eraseSpace(env, next.world, name, atom),
        };
        break;
      }
      case "bindToken": {
        const w = cloneWorld(next.world);
        const value = inst(env, b, effect.atom);
        w.tokens.set(effect.name, value);
        w.generation = nextWorldGeneration(next.world);
        recordWorldMutation(w, "grounded-effect", {
          kind: "set-token",
          name: effect.name,
          value,
        });
        next = { counter: next.counter, world: w };
        break;
      }
    }
  }
  return { tag: "ok", state: next };
}

export function compiledAddAtom(env: MinEnv, st: St, space: Atom, added: Atom): St | undefined {
  if (opOf(added) === "=") return undefined;
  const name = contextualSpaceName(env, st.world, space);
  if (name === undefined) return undefined;
  return {
    counter: st.counter,
    world: appendSpace(env, st.world, name, [added]),
  };
}

/** The compiled add-if-absent: an exact ground-membership probe, then append when absent. Covers
 *  `&self` (which tryFastNamedAddIfAbsent leaves to the interpreter) under the same guards as the
 *  exact-count candidate path: every runtime fact ground, no static or variable-headed facts of this
 *  head that could also unify, no state handles. The counter advances by the space size, the same
 *  convention as the named-space fast path (the interpreted collapse-once-match iterates the
 *  candidates); compiled callers are on the alpha-equivalent naming contract anyway. */
export function compiledAddIfAbsent(
  env: MinEnv,
  st: St,
  space: Atom,
  atom: Atom,
): { added: boolean; state: St } | undefined {
  if (!atom.ground || opOf(atom) === "=") return undefined;
  const w = st.world;
  if (w.store.size !== 0) return undefined;
  const name = contextualSpaceName(env, w, space);
  if (name === undefined) return undefined;
  if (name === "&self") {
    const k = headKey(atom);
    if (k === undefined) return undefined;
    if (env.varHeadedFacts.length !== 0 || (env.factIndex.get(k)?.length ?? 0) !== 0)
      return undefined;
    if (logNonGround(w.selfExtra) !== 0 || (w.flatSelfExtra?.nonGroundCount ?? 0) !== 0)
      return undefined;
    const size = logSize(w.selfExtra) + (w.flatSelfExtra?.size ?? 0);
    const checked: St = { counter: st.counter + size, world: w };
    const present =
      idxCount(logGroundIdx(w.selfExtra), atom) + (w.flatSelfExtra?.exactCount(atom) ?? 0);
    if (present !== 0) return { added: false, state: checked };
    return {
      added: true,
      state: {
        counter: checked.counter,
        world: appendSpace(env, w, "&self", [atom]),
      },
    };
  }
  const log = w.spaces.get(name) ?? emptyLog;
  if (logNonGround(log) !== 0) return undefined;
  const checked: St = { counter: st.counter + logSize(log), world: w };
  if (idxCount(logGroundIdx(log), atom) !== 0) return { added: false, state: checked };
  return {
    added: true,
    state: {
      counter: checked.counter,
      world: appendSpace(env, w, name, [atom]),
    },
  };
}

export function finishStreamingIsolatedBranches(env: MinEnv, owner: StreamingIsolatedBranches): St {
  if (owner.finished) throw new Error("streaming isolated branches finished twice");
  owner.finished = true;
  const counter = Math.max(owner.parent.counter, owner.maxTerminalCounter);
  if (owner.acceptedDownstream) return { counter, world: owner.parent.world };
  return { counter, world: mergeWorldJournalDeltas(env, owner.parent.world, owner.terminalDeltas) };
}

export function mergeScheduledStates(env: MinEnv, base: St, states: readonly St[]): St {
  if (states.length === 0) return base;
  return {
    counter: Math.max(base.counter, ...states.map((state) => state.counter)),
    world: mergeWorlds(
      env,
      base.world,
      states.map((state) => state.world),
    ),
  };
}
