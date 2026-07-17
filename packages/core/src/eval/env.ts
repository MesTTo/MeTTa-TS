// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, atomEq, type GroundedExec, type GroundedMatch, sym } from "../atom";
import { BindingPacketRegistry } from "../binding-packet";
import {
  groundedOperationType,
  type GroundFn,
  type GroundingTable,
  type ReduceResult,
} from "../builtins";
import { EFFECT_CLASSES } from "../effect-journal";
import {
  type AsyncGroundFn,
  type GroundedEffectPolicy,
  type HostImportFn,
  type MinEnv,
  type NamedSpace,
  type StaticNestedMatchIndex,
} from "../eval/machine";
import { opOf } from "../eval/terms";
import {
  type GroundedOperationV2,
  type GroundedOperationV2Options,
  type GroundedOperationV2Registration,
  groundedV2AsyncAdapter,
  groundedV2MatcherAdapter,
  groundedV2SyncAdapter,
  markGroundedV2Registration,
} from "../grounded-v2";
import { asRevisionMap, RevisionMap, RevisionSet } from "../revision-collection";

export const DEFAULT_RUNTIME_CAPABILITIES: readonly string[] = Object.freeze([
  "atomspace-read",
  "atomspace-write",
  "grounded-exec",
  "import",
]);

interface NamedEvaluationEnvironment {
  readonly root: MinEnv;
  readonly name: string;
  readonly source: NamedSpace | undefined;
}

export const namedEvaluationEnvironments = new WeakMap<MinEnv, NamedEvaluationEnvironment>();

export const rootContextEnvironments = new WeakMap<MinEnv, MinEnv>();

export interface CachedNamedEnvironment {
  readonly source: NamedSpace | undefined;
  readonly shared: readonly Atom[] | undefined;
  readonly expectedType: Atom;
  readonly typeProgramVersion: number;
  readonly groundingVersion: number;
  readonly syncRegistry: GroundingTable;
  readonly asyncRegistry: Map<string, AsyncGroundFn>;
  readonly groundedEffects: Map<string, GroundedEffectPolicy> | undefined;
  readonly syncSize: number;
  readonly asyncSize: number;
  readonly syncRevision: number | undefined;
  readonly asyncRevision: number | undefined;
  readonly groundedEffectRevision: number | undefined;
  readonly imports: Map<string, Atom[]>;
  readonly importRevision: number | undefined;
  readonly capabilities: ReadonlySet<string> | undefined;
  readonly capabilityRevision: number | undefined;
  readonly hostImport: HostImportFn | undefined;
  readonly environment: MinEnv;
}

export const namedEnvironmentCache = new WeakMap<
  MinEnv,
  Map<string, readonly CachedNamedEnvironment[]>
>();

export function rootEvaluationEnvironment(env: MinEnv): MinEnv {
  return namedEvaluationEnvironments.get(env)?.root ?? rootContextEnvironments.get(env) ?? env;
}

export function isNamedEvaluationEnvironment(env: MinEnv): boolean {
  return env.evaluationContext !== undefined && namedEvaluationEnvironments.has(env);
}

export function evaluationCacheEnvironment(env: MinEnv): MinEnv {
  return isNamedEvaluationEnvironment(env) ? env : rootEvaluationEnvironment(env);
}

export function activeSpaceAtom(env: MinEnv): Atom {
  return env.evaluationContext?.currentSpace ?? sym("&self");
}

export function activeSpaceName(env: MinEnv): string {
  const space = activeSpaceAtom(env);
  return space.kind === "sym" ? space.name : "&self";
}

const bindingPacketRegistries = new WeakMap<MinEnv, BindingPacketRegistry>();

export const pinnedProgramOwners = new WeakMap<MinEnv, MinEnv>();

export const pinnedProgramEnvironments = new WeakSet<MinEnv>();

export const activeProgramSnapshots = new WeakMap<MinEnv, Set<MinEnv>>();

export function programIdentityEnvironment(env: MinEnv): MinEnv {
  const root = rootEvaluationEnvironment(env);
  return pinnedProgramOwners.get(root) ?? root;
}

export function bindingPacketRegistry(env: MinEnv): BindingPacketRegistry {
  const owner = programIdentityEnvironment(env);
  let registry = bindingPacketRegistries.get(owner);
  if (registry === undefined) {
    registry = new BindingPacketRegistry("binding-packets");
    bindingPacketRegistries.set(owner, registry);
  }
  return registry;
}

export function emptyStaticNestedMatchIndex(): StaticNestedMatchIndex {
  return { byHead: new Map(), wildcardAtPos: new Map(), nonGroundFactHeads: new Set() };
}

function cloneArrayMap<T>(source: ReadonlyMap<string, readonly T[]>): Map<string, T[]> {
  return new Map([...source].map(([key, values]) => [key, values.slice()]));
}

/** Detach mutable static indexes only when a live async snapshot still shares them. */
export function detachProgramCollectionsIfShared(env: MinEnv): void {
  const snapshots = activeProgramSnapshots.get(env);
  const liveSnapshotSharesProgram =
    snapshots !== undefined && [...snapshots].some((snapshot) => snapshot.atoms === env.atoms);
  if (env.staticProgramShared !== true && !liveSnapshotSharesProgram) return;
  env.ruleIndex = cloneArrayMap(env.ruleIndex);
  env.varRules = env.varRules.slice();
  env.varRulesVar = env.varRulesVar.slice();
  env.sigs = cloneArrayMap(env.sigs);
  env.atoms = env.atoms.slice();
  env.types = cloneArrayMap(env.types);
  env.exprTypes = env.exprTypes.slice();
  env.factIndex = cloneArrayMap(env.factIndex);
  env.argIndex = cloneArrayMap(env.argIndex);
  env.nonGroundAtPos = cloneArrayMap(env.nonGroundAtPos);
  env.varHeadedFacts = env.varHeadedFacts.slice();
  if (env.groundedEffects !== undefined) env.groundedEffects = new RevisionMap(env.groundedEffects);
  if (env.nestedMatchIndex !== undefined) {
    env.nestedMatchIndex = {
      byHead: cloneArrayMap(env.nestedMatchIndex.byHead),
      wildcardAtPos: cloneArrayMap(env.nestedMatchIndex.wildcardAtPos),
      nonGroundFactHeads: new Set(env.nestedMatchIndex.nonGroundFactHeads),
    };
  }
  env.staticProgramShared = false;
}

export const KEY_SEP = "\x01";

const ARG_SEP = "\x00";

/** Index key for a ground-leaf first argument (symbol or grounded primitive); undefined for a variable,
 *  an expression, or a non-primitive grounded value (which are not first-argument indexable). */
export function argKey(a: Atom): string | undefined {
  if (a.kind === "sym") return "s" + ARG_SEP + a.name;
  if (a.kind === "gnd") {
    if (a.match !== undefined) return undefined;
    const v = a.value;
    switch (v.g) {
      case "int":
      case "float":
        // Ground equality compares mixed ints/floats through Number, so both kinds need the same key.
        // Precision collisions for huge ints are safe because the matcher checks every candidate.
        return "n" + ARG_SEP + Number(v.n);
      case "str":
        return "S" + ARG_SEP + v.s;
      case "bool":
        return "b" + ARG_SEP + (v.b ? "1" : "0");
      default:
        return undefined;
    }
  }
  return undefined;
}

/** A fixed nested expression head that can safely prefilter full unification. */
export function nestedArgHead(a: Atom): string | undefined {
  if (a.kind !== "expr") return undefined;
  const head = a.items[0];
  return head?.kind === "sym" ? head.name : undefined;
}

/** Whether a ground argument without a fixed symbol head may match a symbol-headed expression. */
export function matchesAnyNestedHead(a: Atom): boolean {
  if (a.kind === "gnd") return a.match !== undefined;
  if (a.kind !== "expr" || a.items.length === 0) return false;
  const head = a.items[0]!;
  return head.kind === "gnd" && head.match !== undefined;
}

export function pushTo<T>(m: Map<string, T[]>, k: string, x: T): void {
  const cur = m.get(k);
  if (cur === undefined) m.set(k, [x]);
  else cur.push(x);
}

/** Merge disjoint occurrence-id buckets without changing source order or duplicate multiplicity. */
export function orderedIndexedAtoms(
  env: MinEnv,
  indexed: readonly number[],
  wildcards: readonly number[],
): Atom[] {
  const out: Atom[] = [];
  let i = 0;
  let j = 0;
  while (i < indexed.length || j < wildcards.length) {
    const indexedId = indexed[i];
    const wildcardId = wildcards[j];
    if (wildcardId === undefined || (indexedId !== undefined && indexedId < wildcardId)) {
      out.push(env.atoms[indexedId!]!);
      i += 1;
    } else {
      out.push(env.atoms[wildcardId]!);
      j += 1;
    }
  }
  return out;
}

export function pushUniqueType(m: Map<string, Atom[]>, k: string, x: Atom): void {
  const cur = m.get(k);
  if (cur === undefined) m.set(k, [x]);
  else if (!cur.some((e) => atomEq(e, x))) m.set(k, [...cur, x]);
}

export function addGroundedOperationType(env: MinEnv, name: string, op: GroundFn): void {
  const type = groundedOperationType(op);
  if (type === undefined) return;
  if (type.kind === "expr" && opOf(type) === "->") env.sigs.set(name, type.items.slice(1));
  pushUniqueType(env.types, name, type);
  env.typeCache = undefined;
  env.typeProgramVersion = (env.typeProgramVersion ?? 0) + 1;
}

/** An empty environment for grounding table `gt`. Grow it with `addAtomToEnv`. */
export function emptyEnv(gt: GroundingTable): MinEnv {
  const groundingTable = asRevisionMap(gt);
  const env: MinEnv = {
    programVersion: 0,
    ruleIndex: new Map(),
    varRules: [],
    varRulesVar: [],
    sigs: new Map(),
    typeProgramVersion: 0,
    gt: groundingTable,
    atoms: [],
    types: new Map(),
    imports: new RevisionMap(),
    exprTypes: [],
    agt: new RevisionMap(),
    groundedEffects: new RevisionMap(),
    groundingVersion: 0,
    capabilities: new RevisionSet(DEFAULT_RUNTIME_CAPABILITIES),
    mutexes: new Map(),
    evaluatedAtoms: new WeakSet(),
    factIndex: new Map(),
    argIndex: new Map(),
    nonGroundAtPos: new Map(),
    nestedMatchIndex: emptyStaticNestedMatchIndex(),
    varHeadedFacts: [],
  };
  for (const [name, op] of groundingTable) addGroundedOperationType(env, name, op);
  return env;
}

export const runtimePureCache = new Map<string, boolean>();

export const runtimeModedPureCache = new Map<string, boolean>();

export const runtimeTableWorthCache = new Map<string, boolean>();

/** Static load (`addAtomToEnv`) changed rules or grounded-operation registration changed dispatch. */
export function invalidateTabling(env: MinEnv): void {
  runtimePureCache.clear();
  runtimeModedPureCache.clear();
  runtimeTableWorthCache.clear();
  env.workerReplaySafeFunctors = undefined;
  if (env.compiled !== undefined) {
    env.compiled.clear();
    env.compileDirty = true;
    env.compiledComplete = false;
  }
  if (env.tableSpace !== undefined) {
    env.tableSpace.clear();
    env.tablingDirty = true;
  }
}

export function invalidateGroundedRegistration(env: MinEnv): void {
  env.evaluatedAtoms = new WeakSet();
  invalidateTabling(env);
  // Compiled nodes inline the standard grounded arithmetic and comparison semantics. A host can replace
  // those names, so this environment must stay on dispatch-aware interpretation after registration.
  env.compiled = undefined;
  env.compileDirty = undefined;
  env.compiledComplete = undefined;
}

const EFFECT_CLASS_SET: ReadonlySet<string> = new Set(EFFECT_CLASSES);

export function normalizedGroundedEffectPolicy(policy: GroundedEffectPolicy): GroundedEffectPolicy {
  if (!Array.isArray(policy.classes) || policy.classes.length === 0)
    throw new TypeError("grounded effect policy must declare at least one effect class");
  if (typeof policy.speculative !== "boolean")
    throw new TypeError("grounded effect policy speculative flag must be boolean");
  const classes = [...new Set(policy.classes)];
  if (classes.some((effectClass) => !EFFECT_CLASS_SET.has(effectClass)))
    throw new TypeError("grounded effect policy contains an unknown effect class");
  if (classes.includes("pure") && classes.length !== 1)
    throw new TypeError("a pure grounded operation cannot declare another effect class");
  return Object.freeze({
    classes: Object.freeze(classes),
    speculative: policy.speculative,
  });
}

export function installGroundedEffectPolicy(
  env: MinEnv,
  name: string,
  policy: GroundedEffectPolicy,
): void {
  const policies = env.groundedEffects ?? (env.groundedEffects = new RevisionMap());
  policies.set(name, policy);
}

export function groundedV2RegistrationRecord(
  operation: GroundedOperationV2,
  options: GroundedOperationV2Options,
): GroundedOperationV2Registration {
  if (options.mode !== "sync" && options.mode !== "async")
    throw new TypeError("grounded V2 mode must be 'sync' or 'async'");
  const effects = normalizedGroundedEffectPolicy(options.effects);
  const requiredCapabilities = [...new Set(options.requiredCapabilities ?? [])];
  if (requiredCapabilities.some((capability) => capability.length === 0))
    throw new TypeError("grounded V2 capabilities must not contain an empty name");
  return Object.freeze({
    operation,
    options: Object.freeze({
      mode: options.mode,
      effects,
      requiredCapabilities: Object.freeze(requiredCapabilities),
    }),
  });
}

function executableResults(result: ReduceResult): readonly Atom[] {
  switch (result.tag) {
    case "ok":
      if (result.effects !== undefined && result.effects.length > 0)
        throw new Error("direct grounded executable V2 calls cannot apply evaluator effects");
      return result.results;
    case "noReduce":
      throw new Error("grounded executable V2 operation is stuck");
    case "runtimeError":
    case "incorrectArgument":
      throw new Error(result.msg);
  }
}

/** Create an executable grounded-atom function backed by the same V2 cursor protocol. */
export function groundedExecutableV2(
  operation: GroundedOperationV2,
  options: GroundedOperationV2Options,
): GroundedExec {
  const registration = groundedV2RegistrationRecord(operation, options);
  if (options.mode === "sync") {
    const legacy = groundedV2SyncAdapter(registration);
    return markGroundedV2Registration(
      (args, context) => executableResults(legacy(args, context)),
      registration,
    );
  }
  const legacy = groundedV2AsyncAdapter(registration);
  return markGroundedV2Registration(
    async (args, context) => executableResults(await legacy(args, context)),
    registration,
  );
}

/** Create an `import!` host callback backed by the V2 cursor and fault protocol. */
export function groundedHostImportV2(
  operation: GroundedOperationV2,
  options: GroundedOperationV2Options,
): HostImportFn {
  const registration = groundedV2RegistrationRecord(operation, options);
  if (options.mode === "sync") {
    const legacy = groundedV2SyncAdapter(registration);
    return markGroundedV2Registration(
      (space, file, context) => legacy([space, file], context),
      registration,
    );
  }
  const legacy = groundedV2AsyncAdapter(registration);
  return markGroundedV2Registration(
    async (space, file, context) => await legacy([space, file], context),
    registration,
  );
}

/** Create a finite custom matcher backed by the V2 termination and binding protocol. */
export function groundedMatcherV2(
  operation: GroundedOperationV2,
  options: GroundedOperationV2Options,
): GroundedMatch {
  const registration = groundedV2RegistrationRecord(operation, options);
  if (
    registration.options.mode !== "sync" ||
    registration.options.effects.classes.length !== 1 ||
    registration.options.effects.classes[0] !== "pure"
  )
    throw new TypeError("grounded V2 custom matchers must be synchronous and pure");
  return groundedV2MatcherAdapter(registration);
}
