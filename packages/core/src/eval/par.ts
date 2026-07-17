// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  type Atom,
  atomEq,
  atomVars,
  expr,
  type ExprAtom,
  gint,
  hashOf,
  internBuiltExpr,
  type InternTable,
  sym,
  variable,
} from "../atom";
import { emptyLog, logAppendAll, logFromArray, logSize, logToArray } from "../atomlog";
import { type GroundedModuleInstallation } from "../builtins";
import { evaluationCacheEnvironment } from "./env";
import {
  type JournalWorldDelta,
  type MinEnv,
  type St,
  type World,
  type WorldMutation,
} from "./machine";
import { parsedStateId, type StateCellId } from "./query";
import { disableTabling, runtimeAtoms } from "./specializer";
import { headKey, opOf } from "./terms";
import {
  inheritWorldRuntime,
  isTypeDeclaration,
  namedSpaceAtoms,
  nextRuntimeRuleSetVersion,
  nextWorldGeneration,
  recordWorldMutation,
  releaseWorldRuntime,
  resolveTok,
  worldRuntimeContext,
  worldRuntimeContexts,
} from "./world";
import { FlatAtomSpace } from "../flat-atomspace";
import { format } from "../parser";
import { forkMap } from "../persistent-collection";
import { type ResourceLease } from "../resources";
import { applySubst, type Subst } from "../substitution";
import { isRuntimeId, type StateId } from "../trace";
import { legacyFreshVariableSuffix } from "../variable-scope";

// Each concurrent branch evaluates in isolation on the SAME immutable starting world, so they cannot
// see each other's mutations mid-flight. Their effects are merged afterwards as multiset deltas against
// the base: atoms a branch added are added, atoms it removed are removed, state/token writes that
// differ from the base are applied. Add-only effects (the common case) commute and the merge is
// order-independent; a genuine conflict (two branches mutating the same cell) resolves by branch order.
// That is why `with-mutex` exists: to serialise such a section.
export function multisetDelta(
  base: readonly Atom[],
  branch: readonly Atom[],
): { added: Atom[]; removed: Atom[] } {
  const remaining = base.slice();
  const added: Atom[] = [];
  for (const a of branch) {
    const i = remaining.findIndex((x) => atomEq(x, a));
    if (i >= 0) remaining.splice(i, 1);
    else added.push(a);
  }
  return { added, removed: remaining };
}

export function applyAtomDelta(
  into: Atom[],
  added: readonly Atom[],
  removed: readonly Atom[],
): Atom[] {
  const out = into.slice();
  for (const r of removed) {
    const i = out.findIndex((x) => atomEq(x, r));
    if (i >= 0) out.splice(i, 1);
  }
  out.push(...added);
  return out;
}

interface NamedSpaceDelta {
  readonly name: string;
  readonly introduced: boolean;
  readonly added: readonly Atom[];
  readonly removed: readonly Atom[];
}

interface StoreWrite {
  readonly key: number | StateId;
  readonly introduced: boolean;
  readonly value: Atom;
}

interface ScannedWorldDelta {
  readonly kind: "scanned";
  readonly generationDelta: number;
  readonly moduleInstallations: readonly GroundedModuleInstallation[];
  readonly selfAdded: readonly Atom[];
  readonly selfRemoved: readonly Atom[];
  readonly spaces: readonly NamedSpaceDelta[];
  readonly store: readonly StoreWrite[];
  readonly tokens: readonly (readonly [string, Atom])[];
  readonly removedStatic: readonly Atom[];
  readonly hasTypeMutations: boolean;
  readonly maxStackDepth: number | undefined;
}

export type WorldDelta = JournalWorldDelta | ScannedWorldDelta;

export interface BranchStateDelta {
  readonly counter: number;
  readonly world: WorldDelta;
}

function atomArraysEqual(left: readonly Atom[], right: readonly Atom[]): boolean {
  return left.length === right.length && left.every((atom, index) => atomEq(atom, right[index]!));
}

function importAtomDeltasEqual(
  left: readonly { readonly space: Atom; readonly atom: Atom }[],
  right: readonly { readonly space: Atom; readonly atom: Atom }[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (delta, index) =>
        atomEq(delta.space, right[index]!.space) && atomEq(delta.atom, right[index]!.atom),
    )
  );
}

function moduleInstallationsEqual(
  left: GroundedModuleInstallation,
  right: GroundedModuleInstallation,
): boolean {
  return (
    atomEq(left.request, right.request) &&
    left.resolvedIdentity === right.resolvedIdentity &&
    left.source === right.source &&
    left.contentHash === right.contentHash &&
    atomEq(left.targetSpace, right.targetSpace) &&
    importAtomDeltasEqual(left.worldDelta.addedAtoms, right.worldDelta.addedAtoms) &&
    importAtomDeltasEqual(left.worldDelta.removedAtoms, right.worldDelta.removedAtoms) &&
    left.worldDelta.boundTokens.length === right.worldDelta.boundTokens.length &&
    left.worldDelta.boundTokens.every(
      (delta, index) =>
        delta.name === right.worldDelta.boundTokens[index]!.name &&
        atomEq(delta.atom, right.worldDelta.boundTokens[index]!.atom),
    )
  );
}

function worldMutationsEqual(left: WorldMutation, right: WorldMutation): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "add-atoms":
      return (
        right.kind === "add-atoms" &&
        left.space === right.space &&
        atomArraysEqual(left.atoms, right.atoms)
      );
    case "remove-atom":
      return (
        right.kind === "remove-atom" && left.space === right.space && atomEq(left.atom, right.atom)
      );
    case "set-state":
      return (
        right.kind === "set-state" &&
        left.key === right.key &&
        left.introduced === right.introduced &&
        atomEq(left.value, right.value)
      );
    case "create-space":
      return (
        right.kind === "create-space" &&
        left.name === right.name &&
        atomArraysEqual(left.atoms, right.atoms)
      );
    case "set-token":
      return (
        right.kind === "set-token" && left.name === right.name && atomEq(left.value, right.value)
      );
    case "set-max-stack-depth":
      return right.kind === "set-max-stack-depth" && left.value === right.value;
    case "install-module":
      return (
        right.kind === "install-module" &&
        moduleInstallationsEqual(left.installation, right.installation)
      );
  }
}

export function worldDeltasEqual(left: WorldDelta, right: WorldDelta): boolean {
  if (left.generationDelta !== right.generationDelta || left.kind !== right.kind) return false;
  if (left.kind !== "journal" || right.kind !== "journal") return false;
  return (
    left.effects.length === right.effects.length &&
    left.effects.every((effect, index) => {
      const candidate = right.effects[index]!;
      if (effect.payload.kind !== candidate.payload.kind) return false;
      const payloadEqual =
        effect.payload.kind === "world" && candidate.payload.kind === "world"
          ? worldMutationsEqual(effect.payload.mutation, candidate.payload.mutation)
          : effect.payload.kind === "operation" && candidate.payload.kind === "operation"
            ? atomArraysEqual(effect.payload.results, candidate.payload.results)
            : false;
      return (
        effect.class === candidate.class &&
        effect.phase === candidate.phase &&
        effect.operation === candidate.operation &&
        effect.commitment === candidate.commitment &&
        payloadEqual
      );
    })
  );
}

/** Capture only the mutations made after `base`; inherited branch-prefix state is not part of the delta. */
export function captureWorldDelta(base: World, branch: World): WorldDelta {
  const generationDelta = branch.generation - base.generation;
  if (!Number.isSafeInteger(generationDelta) || generationDelta < 0)
    throw new Error("branch continuation moved its world generation backwards");
  const baseRuntime = worldRuntimeContexts.get(base);
  const branchRuntime = worldRuntimeContexts.get(branch);
  if (
    baseRuntime !== undefined &&
    branchRuntime !== undefined &&
    baseRuntime.audit === branchRuntime.audit
  ) {
    try {
      return {
        kind: "journal",
        generationDelta,
        effects: branchRuntime.journal.since(baseRuntime.journal),
      };
    } catch {
      // Structurally supplied worlds can lack shared journal ancestry. The compatibility diff below
      // preserves their behavior, while every evaluator-created branch takes the O(delta) journal path.
    }
  }
  if (branch === base)
    return {
      kind: "scanned",
      generationDelta,
      moduleInstallations: [],
      selfAdded: [],
      selfRemoved: [],
      spaces: [],
      store: [],
      tokens: [],
      removedStatic: [],
      hasTypeMutations: false,
      maxStackDepth: undefined,
    };
  if (branch.moduleInstallations.length < base.moduleInstallations.length)
    throw new Error("branch removed an installed module from its inherited world");
  const self =
    base.selfExtra === branch.selfExtra && base.flatSelfExtra === branch.flatSelfExtra
      ? { added: [], removed: [] }
      : multisetDelta(runtimeAtoms(base), runtimeAtoms(branch));
  const spaces: NamedSpaceDelta[] = [];
  if (base.spaces !== branch.spaces)
    for (const [name, value] of branch.spaces) {
      const introduced = !base.spaces.has(name);
      const baseValue = base.spaces.get(name);
      const delta =
        baseValue === value
          ? { added: [], removed: [] }
          : multisetDelta(namedSpaceAtoms(baseValue), namedSpaceAtoms(value));
      if (introduced || delta.added.length > 0 || delta.removed.length > 0)
        spaces.push({ name, introduced, added: delta.added, removed: delta.removed });
    }
  const store: StoreWrite[] = [];
  if (base.store !== branch.store)
    for (const [key, value] of branch.store)
      if (!Object.is(base.store.get(key), value))
        store.push({ key, introduced: !base.store.has(key), value });
  const tokens: Array<readonly [string, Atom]> = [];
  if (base.tokens !== branch.tokens)
    for (const [name, value] of branch.tokens)
      if (!Object.is(base.tokens.get(name), value)) tokens.push([name, value]);
  const removedStatic =
    base.removedStatic === branch.removedStatic
      ? []
      : logToArray(branch.removedStatic).filter(
          (atom) => !logToArray(base.removedStatic).some((candidate) => atomEq(candidate, atom)),
        );
  return {
    kind: "scanned",
    generationDelta,
    moduleInstallations: branch.moduleInstallations.slice(base.moduleInstallations.length),
    selfAdded: self.added,
    selfRemoved: self.removed,
    spaces,
    store,
    tokens,
    removedStatic,
    hasTypeMutations: branch.hasTypeMutations,
    maxStackDepth: branch.maxStackDepth === base.maxStackDepth ? undefined : branch.maxStackDepth,
  };
}

export function captureBranchStateDelta(base: St, branch: St): BranchStateDelta {
  const counter = branch.counter - base.counter;
  if (!Number.isSafeInteger(counter) || counter < 0)
    throw new Error("branch continuation moved its fresh-variable counter backwards");
  return { counter, world: captureWorldDelta(base.world, branch.world) };
}

export class WorldConflictError extends Error {
  readonly kind = "world-conflict" as const;
  readonly retryable = true;

  constructor(
    readonly target: string,
    readonly firstBranch: number,
    readonly secondBranch: number,
  ) {
    super(
      `isolated branches ${firstBranch} and ${secondBranch} conflict on world target '${target}'`,
    );
    this.name = "WorldConflictError";
  }
}

interface AtomWriteFootprint {
  readonly branch: number;
  readonly operation: "add" | "remove";
  readonly space: string;
  readonly atom: Atom;
}

export function assertJournalDeltasDoNotConflict(
  base: World,
  deltas: readonly JournalWorldDelta[],
): void {
  const scalarWrites = new Map<string, number>();
  const atomWrites = new Map<string, AtomWriteFootprint[]>();
  const claimScalar = (target: string, branch: number, collision?: string): void => {
    const owner = scalarWrites.get(target);
    if (owner !== undefined && owner !== branch) {
      if (collision !== undefined) throw new Error(collision);
      throw new WorldConflictError(target, owner, branch);
    }
    scalarWrites.set(target, branch);
  };
  const claimAtom = (
    space: string,
    atom: Atom,
    operation: AtomWriteFootprint["operation"],
    branch: number,
  ): void => {
    const bucketKey = `${space}:${String(hashOf(atom))}`;
    const bucket = atomWrites.get(bucketKey) ?? [];
    for (const prior of bucket) {
      if (prior.branch === branch || !atomEq(prior.atom, atom)) continue;
      if (operation === "add" && prior.operation === "add") continue;
      throw new WorldConflictError(`space:${space}:atom:${format(atom)}`, prior.branch, branch);
    }
    bucket.push({ branch, operation, space, atom });
    atomWrites.set(bucketKey, bucket);
  };

  for (let branch = 0; branch < deltas.length; branch += 1) {
    for (const effect of deltas[branch]!.effects) {
      if (effect.payload.kind !== "world") continue;
      const mutation = effect.payload.mutation;
      switch (mutation.kind) {
        case "add-atoms":
          if (
            !base.spaces.has(mutation.space) &&
            mutation.space.startsWith("&") &&
            isRuntimeId(mutation.space.slice(1), "space")
          )
            claimScalar(
              `allocation:space:${mutation.space}`,
              branch,
              `branch allocation collision for space '${mutation.space}'`,
            );
          for (const atom of mutation.atoms) claimAtom(mutation.space, atom, "add", branch);
          break;
        case "remove-atom":
          claimAtom(mutation.space, mutation.atom, "remove", branch);
          break;
        case "set-state":
          claimScalar(
            `state:${String(mutation.key)}`,
            branch,
            mutation.introduced &&
              typeof mutation.key === "string" &&
              isRuntimeId(mutation.key, "state")
              ? `branch allocation collision for state '${mutation.key}'`
              : undefined,
          );
          break;
        case "create-space":
          claimScalar(
            `space:${mutation.name}`,
            branch,
            `branch allocation collision for space '${mutation.name}'`,
          );
          break;
        case "set-token":
          claimScalar(`token:${mutation.name}`, branch);
          break;
        case "set-max-stack-depth":
          claimScalar("setting:max-stack-depth", branch);
          break;
        case "install-module":
          break;
      }
    }
  }
}

export function releaseChildWorldRuntimes(base: World, branches: readonly World[]): void {
  const baseResources = worldRuntimeContext(base).resources;
  const released = new Set<ResourceLease>();
  for (const branch of branches) {
    const context = worldRuntimeContexts.get(branch);
    if (
      context === undefined ||
      context.resources === baseResources ||
      released.has(context.resources)
    )
      continue;
    released.add(context.resources);
    releaseWorldRuntime(branch);
  }
}

/** A stable string key for a `with-mutex` lock name (a structural serialisation, no `format` dep). */
export function mutexKey(a: Atom): string {
  switch (a.kind) {
    case "sym":
      return "s:" + a.name;
    case "var":
      return "v:" + a.name;
    case "gnd": {
      const g = a.value;
      return g.g === "str"
        ? "S:" + g.s
        : g.g === "int" || g.g === "float"
          ? "n:" + g.n
          : "g:" + g.g;
    }
    case "expr":
      return "e:[" + a.items.map(mutexKey).join(",") + "]";
  }
}

export function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = (): void => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

export const stateHandle = (id: StateCellId): Atom =>
  expr([sym("State"), typeof id === "number" ? gint(id) : sym(id)]);

export function stateId(w: World, a: Atom): StateCellId | undefined {
  const r = resolveTok(w, a);
  return parsedStateId(r);
}

interface RuntimeAllocation<T> {
  readonly value: T;
  readonly nextCounter: number;
}

export function allocateStateCell(state: St): RuntimeAllocation<StateCellId> {
  if (state.world.allocation.branchScoped) {
    let id: StateId;
    do id = state.world.allocation.ids.next("state");
    while (state.world.store.has(id));
    return { value: id, nextCounter: state.counter + 1 };
  }
  let id = state.counter;
  while (state.world.store.has(id)) id += 1;
  return { value: id, nextCounter: id + 1 };
}

export function allocateSpaceName(state: St): RuntimeAllocation<string> {
  if (state.world.allocation.branchScoped) {
    let name: string;
    do name = `&${state.world.allocation.ids.next("space")}`;
    while (state.world.spaces.has(name) || state.world.tokens.has(name));
    return { value: name, nextCounter: state.counter + 1 };
  }
  let counter = state.counter;
  let name = `&space-${counter}`;
  while (state.world.spaces.has(name) || state.world.tokens.has(name)) {
    counter += 1;
    name = `&space-${counter}`;
  }
  return { value: name, nextCounter: counter + 1 };
}

function subTokensExpr(
  w: World,
  a: ExprAtom,
  intern: InternTable | undefined,
  memo: Map<Atom, Atom>,
): Atom {
  const cached = memo.get(a);
  if (cached !== undefined) return cached;
  const its = a.items;
  let items: Atom[] | null = null;
  for (let i = 0; i < its.length; i++) {
    const it = its[i]!;
    const r =
      it.kind === "sym"
        ? (w.tokens.get(it.name) ?? it)
        : it.kind === "expr"
          ? subTokensExpr(w, it, intern, memo)
          : it;
    if (items !== null) items.push(r);
    else if (r !== it) {
      items = its.slice(0, i);
      items.push(r);
    }
  }
  const result =
    items === null ? a : intern === undefined ? expr(items) : internBuiltExpr(intern, expr(items));
  memo.set(a, result);
  return result;
}

// A rewrite-heavy program (backward chaining over recursive rules) makes `instantiate` return the same
// subterm object at many embedding positions (structural sharing, not a copy), so this walks a DAG, not a
// tree. Rebuilding unconditionally via `.map()` on every visit (as before) both allocated a fresh copy of
// every unchanged subtree AND re-walked a shared node once per incoming path — the same
// exponential-paths-vs-linear-nodes blowup as the (fixed) unmemoized `occursThrough`/`instantiate`/
// `collectVars`. `memo` (fresh per top-level call, since it's fixed given the same `w`/`intern`) plus
// returning `a` unchanged when no child substituted restores both the sharing and the single-visit cost.
export function subTokens(w: World, a: Atom, intern?: InternTable): Atom {
  if (w.tokens.size === 0) return a; // no bind! tokens: identity, skip the tree clone (hot path)
  if (a.kind === "sym") return w.tokens.get(a.name) ?? a;
  if (a.kind !== "expr") return a;
  return subTokensExpr(w, a, intern, new Map());
}

function wrapStatesExpr(w: World, a: ExprAtom, memo: Map<Atom, Atom>): Atom {
  const cached = memo.get(a);
  if (cached !== undefined) return cached;
  const state = parsedStateId(a);
  if (state !== undefined) {
    const value = w.store.get(state);
    const result = value !== undefined ? expr([sym("StateValue"), value]) : a;
    memo.set(a, result);
    return result;
  }
  const its = a.items;
  let items: Atom[] | null = null;
  for (let i = 0; i < its.length; i++) {
    const it = its[i]!;
    const r = it.kind === "expr" ? wrapStatesExpr(w, it, memo) : it;
    if (items !== null) items.push(r);
    else if (r !== it) {
      items = its.slice(0, i);
      items.push(r);
    }
  }
  const result = items === null ? a : expr(items);
  memo.set(a, result);
  return result;
}

// Same DAG-sharing fix as `subTokens` above, for the same reason (both walk atoms coming out of
// `instantiate`, which shares unchanged subtrees by reference).
function wrapStates(w: World, a: Atom): Atom {
  if (w.store.size === 0) return a; // no state cells: identity, skip the tree clone (hot path)
  if (a.kind !== "expr") return a;
  return wrapStatesExpr(w, a, new Map());
}

export const typePrep = (env: MinEnv, w: World, a: Atom): Atom =>
  wrapStates(w, subTokens(w, a, env.intern));

// Variable list of a rule (lhs vars first, then rhs-only vars), cached on the rule pair. Rules are static,
// so their variable set never changes; queryOp freshens the same rules on every reduction, so caching skips
// re-walking the rule each time (atomVars showed up hot in profiling otherwise). The RHS is part of the key
// because hash-consing can make distinct rules share an identical LHS.
const ruleVarsCache = new WeakMap<Atom, WeakMap<Atom, string[]>>();

function ruleVars(lhs: Atom, rhs: Atom): string[] {
  let rhsCache = ruleVarsCache.get(lhs);
  if (rhsCache === undefined) {
    rhsCache = new WeakMap();
    ruleVarsCache.set(lhs, rhsCache);
  }
  let vs = rhsCache.get(rhs);
  if (vs === undefined) {
    vs = atomVars(lhs);
    const seen = new Set(vs);
    for (const v of atomVars(rhs))
      if (!seen.has(v)) {
        seen.add(v);
        vs.push(v);
      }
    rhsCache.set(rhs, vs);
  }
  return vs;
}

// The fresh-rename substitution for one rule application: each rule variable receives one shared suffix.
function freshenSub(suffix: string, lhs: Atom, rhs: Atom): Subst {
  // A ground lhs and rhs have no variables, so the substitution is empty. Short-circuit before `ruleVars`
  // walks the whole term: a `match` over N ground facts freshens each candidate `freshenRule(fact, fact)`,
  // and the facts are distinct (no ruleVarsCache hit), so this turns the count's per-candidate cost from
  // O(term size) to O(1) — the difference between O(N·depth) and O(N) on a deep-term space like matespace.
  if (lhs.ground && rhs.ground) return [];
  const vs = ruleVars(lhs, rhs);
  return vs.length === 0 ? [] : vs.map((v) => [v, variable(v + suffix)]);
}

export function freshenRule(
  counter: number,
  lhs: Atom,
  rhs: Atom,
  branchNamespace?: string,
): [Atom, Atom] {
  const sub = freshenSub(legacyFreshVariableSuffix(counter, branchNamespace), lhs, rhs);
  if (sub.length === 0) return [lhs, rhs];
  return [applySubst(sub, lhs), applySubst(sub, rhs)];
}

// space-mutation helpers used by add/remove/import
/** Index any `(= lhs rhs)` rules among `atoms` into a (freshly cloned) world's rule index. Facts are
 *  left to the log; only equality rules are indexed, so function reduction never scans the fact log. */
export function indexSelfRules(w: World, atoms: readonly Atom[]): void {
  for (const x of atoms) {
    if (opOf(x) === "=" && x.kind === "expr" && x.items.length === 3) {
      const lhs = x.items[1]!;
      const rhs = x.items[2]!;
      const k = headKey(lhs);
      if (k === undefined) w.selfVarRules = [...w.selfVarRules, [lhs, rhs]];
      else w.selfRules.set(k, [...(w.selfRules.get(k) ?? []), [lhs, rhs]]);
    }
  }
}

export function appendSpace(env: MinEnv, w0: World, name: string, atoms: Atom[]): World {
  // `&self` add-atom only touches `selfExtra` (and the rule index iff an equality is added), so SHARE the
  // unchanged spaces/store/tokens by reference rather than `cloneWorld`'s four fresh Maps. That copy was
  // the per-add allocation that kept the add-heavy benchmarks (matespace family) quadratic-in-GC even
  // after the log made append itself O(1).
  if (name === "&self") {
    let selfRules = w0.selfRules;
    let selfVarRules = w0.selfVarRules;
    let selfExtra = w0.selfExtra;
    let flatSelfExtra = w0.flatSelfExtra;
    let copiedRules = false;
    const typesChanged = atoms.some(isTypeDeclaration);
    if (typesChanged) disableTabling(evaluationCacheEnvironment(env));
    for (const x of atoms) {
      if (opOf(x) === "=" && x.kind === "expr" && x.items.length === 3) {
        if (!copiedRules) {
          selfRules = forkMap(w0.selfRules);
          copiedRules = true;
        }
        const lhs = x.items[1]!;
        const rhs = x.items[2]!;
        const k = headKey(lhs);
        if (k === undefined) selfVarRules = [...selfVarRules, [lhs, rhs]];
        else selfRules.set(k, [...(selfRules.get(k) ?? []), [lhs, rhs]]);
      }
    }
    if (env.useFlatAtomspace === true) {
      if (flatSelfExtra !== undefined || logSize(selfExtra) === 0) {
        const base = flatSelfExtra ?? FlatAtomSpace.empty();
        const appended = base.appendAll(atoms);
        if (appended !== undefined) {
          flatSelfExtra = appended;
        } else {
          // The batch is not flat-storable: move everything to the plain log, permanently, so the
          // candidate order stays the insertion order (flat facts first would interleave otherwise).
          selfExtra = logFromArray([...base.toArray(), ...logToArray(selfExtra), ...atoms]);
          flatSelfExtra = undefined;
        }
      } else {
        selfExtra = logAppendAll(selfExtra, atoms);
      }
    } else {
      selfExtra = logAppendAll(selfExtra, atoms);
    }
    const next = inheritWorldRuntime(w0, {
      generation: atoms.length === 0 ? w0.generation : nextWorldGeneration(w0),
      moduleInstallations: w0.moduleInstallations,
      transactionDepth: w0.transactionDepth,
      spaces: w0.spaces,
      store: w0.store,
      tokens: w0.tokens,
      selfExtra,
      flatSelfExtra,
      selfRules,
      selfVarRules,
      selfRuleVersion: copiedRules ? nextRuntimeRuleSetVersion() : w0.selfRuleVersion,
      removedStatic: w0.removedStatic,
      removedStaticHeads: w0.removedStaticHeads,
      removedStaticVarRules: w0.removedStaticVarRules,
      hasTypeMutations: w0.hasTypeMutations || typesChanged,
      typeView: typesChanged ? undefined : w0.typeView,
      typeViewProgramVersion: typesChanged ? undefined : w0.typeViewProgramVersion,
      typeViewOwner: typesChanged ? undefined : w0.typeViewOwner,
      maxStackDepth: w0.maxStackDepth,
      allocation: w0.allocation,
    });
    if (atoms.length > 0)
      recordWorldMutation(next, "add-atom", { kind: "add-atoms", space: name, atoms });
    return next;
  }
  const spaces = forkMap(w0.spaces);
  spaces.set(name, logAppendAll(spaces.get(name) ?? emptyLog, atoms));
  const next = inheritWorldRuntime(w0, {
    ...w0,
    generation: atoms.length === 0 ? w0.generation : nextWorldGeneration(w0),
    spaces,
  });
  if (atoms.length > 0)
    recordWorldMutation(next, "add-atom", { kind: "add-atoms", space: name, atoms });
  return next;
}

export function checkedCounterAdvance(counter: number, delta: number): number {
  if (!Number.isSafeInteger(delta) || delta < 0 || delta > Number.MAX_SAFE_INTEGER - counter)
    throw new RangeError("evaluation counter is exhausted");
  return counter + delta;
}

export function checkedGenerationAdvance(generation: number, delta: number): number {
  if (!Number.isSafeInteger(delta) || delta < 0 || delta > Number.MAX_SAFE_INTEGER - generation)
    throw new RangeError("world generation is exhausted");
  return generation + delta;
}
