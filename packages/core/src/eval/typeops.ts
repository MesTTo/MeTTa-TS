// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, atomEq, expr, sym } from "../atom";
import { logToArray } from "../atomlog";
import { type Bindings } from "../bindings";
import { groundedOperationType } from "../builtins";
import {
  activeSpaceAtom,
  activeSpaceName,
  type CachedNamedEnvironment,
  isNamedEvaluationEnvironment,
  namedEnvironmentCache,
  namedEvaluationEnvironments,
  pinnedProgramEnvironments,
  pushUniqueType,
  rootContextEnvironments,
  rootEvaluationEnvironment,
} from "../eval/env";
import { inst, type MinEnv, type TypeView, type World } from "../eval/machine";
import {
  addAtomToEnv,
  buildEnv,
  hasVisibleStaticRuleHead,
  runtimeAtoms,
  visibleStaticRulesForHead,
} from "../eval/specializer";
import { headKey, lowerFunctionHead, opOf } from "../eval/terms";
import {
  copyEvaluationContext,
  installTypeDeclaration,
  isTypeDeclaration,
  namedSpaceAtoms,
  resolveTok,
  UNDEF,
} from "../eval/world";
import { matchAtoms, merge } from "../match";
import { collectionRevision } from "../revision-collection";
import { IMPURE_OPS } from "../tabling";

// A head some reduction can fire on: it carries an equation (static or runtime), a type signature (so
// type-directed evaluation applies), or a grounded/built-in implementation. Its negation is Curry's
// "constructor" — a symbol that only builds data and never reduces. The signature check is what makes this
// derive from env data alone: every interpreter special form (`if`, `let`, `eval`, `match`, …) is declared in
// the prelude, so no reserved-vocabulary list is needed.
export function isDefinedHead(env: MinEnv, w: World, name: string): boolean {
  return (
    hasVisibleStaticRuleHead(env, w, name) ||
    typeViewFor(env, w).sigs.has(name) ||
    w.selfRules.has(name) ||
    env.gt.has(name) ||
    env.agt.has(name) ||
    IMPURE_OPS.has(name)
  );
}

// Is `t` already in normal form — no rewrite or grounded reduction can fire anywhere in it? Constructor/
// defined partition (Curry; Hanus, normalizing narrowing): a constructor-rooted term is irreducible at the
// head and reduces only if a subterm does. Caller restricts use to when no catch-all (`($x …)`) equation
// exists, so a constructor head's `candidatesW` is empty and re-evaluating `t` is a pure no-op that advances
// nothing — which is why the short-circuit can return `t` as-is, byte-identically.
export function isNormalForm(env: MinEnv, w: World, t: Atom): boolean {
  switch (t.kind) {
    case "var":
    case "gnd":
      return true;
    case "sym":
      return !isDefinedHead(env, w, t.name);
    case "expr": {
      const its = t.items;
      if (its.length === 0) return true;
      const h = its[0]!;
      if (h.kind !== "sym" || isDefinedHead(env, w, h.name)) return false;
      for (let i = 1; i < its.length; i++) if (!isNormalForm(env, w, its[i]!)) return false;
      return true;
    }
  }
}

export function isNormalFormAssumingVars(env: MinEnv, w: World, t: Atom): boolean {
  switch (t.kind) {
    case "var":
      return true;
    case "sym":
    case "gnd":
      return isNormalForm(env, w, t);
    case "expr": {
      if (t.items.length === 0) return true;
      const h = t.items[0]!;
      return (
        h.kind === "sym" &&
        !isDefinedHead(env, w, h.name) &&
        t.items.every((x) => isNormalFormAssumingVars(env, w, x))
      );
    }
  }
}

function withExpectedEvaluationType(env: MinEnv, expectedType: Atom): MinEnv {
  const currentExpected = env.evaluationContext?.expectedType ?? UNDEF;
  if (atomEq(currentExpected, expectedType)) return env;
  const currentSpace = activeSpaceAtom(env);
  const visibleSpaces = env.evaluationContext?.visibleSpaces ?? [currentSpace];
  const view: MinEnv = {
    ...env,
    evaluationContext: { currentSpace, visibleSpaces, expectedType },
  };
  const named = namedEvaluationEnvironments.get(env);
  if (named === undefined) rootContextEnvironments.set(view, rootEvaluationEnvironment(env));
  else namedEvaluationEnvironments.set(view, named);
  return view;
}

function namedSpaceEnv(env: MinEnv, w: World, name: string, expectedType: Atom = UNDEF): MinEnv {
  const root = rootEvaluationEnvironment(env);
  const source = w.spaces.get(name);
  const shared = root.sharedContextAtoms ?? [];
  let byName = namedEnvironmentCache.get(root);
  if (byName === undefined) {
    byName = new Map();
    namedEnvironmentCache.set(root, byName);
  }
  const cached = byName.get(name) ?? [];
  const typeProgramVersion = root.typeProgramVersion ?? 0;
  const groundingVersion = root.groundingVersion ?? 0;
  const syncRevision = collectionRevision(root.gt);
  const asyncRevision = collectionRevision(root.agt);
  const groundedEffectRevision =
    root.groundedEffects === undefined ? 0 : collectionRevision(root.groundedEffects);
  const importRevision = collectionRevision(root.imports);
  const capabilityRevision =
    root.capabilities === undefined ? 0 : collectionRevision(root.capabilities);
  const hit = cached.find(
    (entry) =>
      entry.source === source &&
      entry.shared === root.sharedContextAtoms &&
      atomEq(entry.expectedType, expectedType) &&
      entry.typeProgramVersion === typeProgramVersion &&
      entry.groundingVersion === groundingVersion &&
      entry.syncRegistry === root.gt &&
      entry.asyncRegistry === root.agt &&
      entry.groundedEffects === root.groundedEffects &&
      entry.syncSize === root.gt.size &&
      entry.asyncSize === root.agt.size &&
      entry.syncRevision === syncRevision &&
      entry.asyncRevision === asyncRevision &&
      entry.groundedEffectRevision === groundedEffectRevision &&
      entry.imports === root.imports &&
      entry.importRevision === importRevision &&
      entry.capabilities === root.capabilities &&
      entry.capabilityRevision === capabilityRevision &&
      entry.hostImport === root.hostImport,
  );
  if (hit !== undefined) return hit.environment;

  const local = namedSpaceAtoms(source);
  const view = buildEnv(shared.slice(), root.gt);
  for (const atom of local) addAtomToEnv(view, atom, false);
  // A context changes the program/type view, not the runtime services. Sync and async groundeds, imports,
  // host import resolution, interning, and mutex ownership therefore stay attached to the root runner.
  view.imports = root.imports;
  view.agt = root.agt;
  if (root.groundedEffects !== undefined) view.groundedEffects = root.groundedEffects;
  view.mutexes = root.mutexes;
  if (root.capabilities !== undefined) view.capabilities = root.capabilities;
  if (root.hostImport !== undefined) view.hostImport = root.hostImport;
  if (root.intern !== undefined) view.intern = root.intern;
  if (root.useTrail !== undefined) view.useTrail = root.useTrail;
  if (root.useFlatAtomspace !== undefined) view.useFlatAtomspace = root.useFlatAtomspace;
  view.evaluationContext = {
    currentSpace: sym(name),
    visibleSpaces: [sym(name)],
    expectedType,
  };
  // Worker evaluators are built from the root program image. A named context must stay local until the
  // structured worker protocol can transport that selected image instead of formatted source alone.
  namedEvaluationEnvironments.set(view, { root, name, source });
  const entry: CachedNamedEnvironment = {
    source,
    shared: root.sharedContextAtoms,
    expectedType,
    typeProgramVersion,
    groundingVersion,
    syncRegistry: root.gt,
    asyncRegistry: root.agt,
    groundedEffects: root.groundedEffects,
    syncSize: root.gt.size,
    asyncSize: root.agt.size,
    syncRevision,
    asyncRevision,
    groundedEffectRevision,
    imports: root.imports,
    importRevision,
    capabilities: root.capabilities,
    capabilityRevision,
    hostImport: root.hostImport,
    environment: view,
  };
  const sameExpected = cached.findIndex((candidate) =>
    atomEq(candidate.expectedType, expectedType),
  );
  const next = cached.slice();
  if (sameExpected < 0) next.push(entry);
  else next[sameExpected] = entry;
  byName.set(name, next.length <= 8 ? next : next.slice(-8));
  return view;
}

export function refreshEvaluationEnvironment(env: MinEnv, w: World): MinEnv {
  if (env.evaluationContext === undefined) return env;
  const named = namedEvaluationEnvironments.get(env);
  if (named === undefined) return env;
  return namedSpaceEnv(named.root, w, named.name, env.evaluationContext?.expectedType ?? UNDEF);
}

export function selectEvaluationEnvironment(
  env: MinEnv,
  w: World,
  requested: Atom,
  expectedType: Atom,
): MinEnv | undefined {
  const resolved = resolveTok(w, requested);
  if (resolved.kind !== "sym") return undefined;
  if (resolved.name === "&self") return withExpectedEvaluationType(env, expectedType);
  if (resolved.name === activeSpaceName(env)) return withExpectedEvaluationType(env, expectedType);
  return namedSpaceEnv(env, w, resolved.name, expectedType);
}

export function selectPinnedProgramEnvironment(
  source: MinEnv,
  root: MinEnv,
  pinnedRoot: MinEnv,
  world: World,
): MinEnv {
  let selected = pinnedRoot;
  const named = namedEvaluationEnvironments.get(source);
  if (named !== undefined) {
    selected = namedSpaceEnv(
      pinnedRoot,
      world,
      named.name,
      source.evaluationContext?.expectedType ?? UNDEF,
    );
  } else if (source !== root || source.evaluationContext !== undefined) {
    selected = { ...pinnedRoot };
    if (source.evaluationContext !== undefined)
      selected.evaluationContext = copyEvaluationContext(source.evaluationContext);
    rootContextEnvironments.set(selected, pinnedRoot);
  }
  pinnedProgramEnvironments.add(selected);
  return selected;
}

/** Rebuild the complete root type view from intrinsic grounded types plus visible declarations. */
export function buildWorldTypeView(env: MinEnv, world: World): TypeView {
  const view: TypeView = {
    sigs: new Map(),
    types: new Map(),
    exprTypes: [],
    typeCache: undefined,
  };
  for (const [name, operation] of env.gt) {
    const type = groundedOperationType(operation);
    if (type === undefined) continue;
    if (type.kind === "expr" && opOf(type) === "->") view.sigs.set(name, type.items.slice(1));
    pushUniqueType(view.types, name, type);
  }

  // Static removal is a multiset operation. Consume one matching tombstone per declaration occurrence.
  const removed = logToArray(world.removedStatic).filter(isTypeDeclaration);
  for (const atom of env.atoms) {
    if (!isTypeDeclaration(atom)) continue;
    const removedIndex = removed.findIndex((candidate) => atomEq(candidate, atom));
    if (removedIndex >= 0) {
      removed.splice(removedIndex, 1);
      continue;
    }
    installTypeDeclaration(view, atom, true);
  }

  // Runtime imports and add-atom declarations extend intrinsic/static signatures without replacing them.
  // The rule matches registerImportedTypes and prevents a module redeclaration from shadowing a grounded
  // operation's evaluator contract.
  for (const atom of runtimeAtoms(world)) installTypeDeclaration(view, atom, false);
  return view;
}

export function typeViewFor(env: MinEnv, world: World): TypeView {
  if (!world.hasTypeMutations || isNamedEvaluationEnvironment(env)) return env;
  const owner = rootEvaluationEnvironment(env);
  const programVersion = owner.typeProgramVersion ?? 0;
  if (
    world.typeView === undefined ||
    world.typeViewProgramVersion !== programVersion ||
    world.typeViewOwner !== owner
  ) {
    world.typeView = buildWorldTypeView(owner, world);
    world.typeViewProgramVersion = programVersion;
    world.typeViewOwner = owner;
  }
  return world.typeView;
}

export function returnsAtom(env: MinEnv, w: World, a: Atom): boolean {
  const op = headKey(a);
  if (op === undefined) return false;
  const ts = typeViewFor(env, w).sigs.get(op);
  const last = ts && ts.length > 0 ? ts[ts.length - 1] : undefined;
  return last !== undefined && atomEq(last, sym("Atom"));
}

/** The arity admitted for PeTTa-style partial application: grounded ops use their `(-> ...)` signature,
 *  untyped lowercase user functions use their defining `=` rule head. Typed user functions stay under
 *  Hyperon's strict arity checks. */
export function functionArity(env: MinEnv, w: World, name: string): number | undefined {
  const view = typeViewFor(env, w);
  const sig = view.sigs.get(name);
  if (sig !== undefined && sig.length >= 1) {
    const types = view.types.get(name) ?? [];
    const hasDataType = types.some((t) => !(t.kind === "expr" && opOf(t) === "->"));
    if (!hasDataType && env.gt.has(name)) return sig.length - 1;
  }
  if (!lowerFunctionHead.test(name)) return undefined;
  for (const [lhs] of [
    ...visibleStaticRulesForHead(env, w, name),
    ...(w.selfRules.get(name) ?? []),
  ])
    if (lhs.kind === "expr" && lhs.items.length >= 2) return lhs.items.length - 1;
  return undefined;
}

export const headOr = (xs: readonly Atom[], d: Atom): Atom => (xs.length > 0 ? xs[0]! : d);

// Shared constant type-result arrays for the leaf cases: getTypes is on the hot path and these
// results are read-only (callers index/headOr them, never mutate), so a fresh array per call is
// pure allocation. (MORK-spirit: stop allocating on the hot path.)
const NUMBER_T: Atom[] = [sym("Number")];

const STRING_T: Atom[] = [sym("String")];

const BOOL_T: Atom[] = [sym("Bool")];

const UNDEF_T: Atom[] = [UNDEF];

const GROUNDED_T: Atom[] = [sym("Grounded")];

export function getTypes(env: MinEnv, a: Atom): Atom[] {
  return getTypesWithView(env, env, a);
}

export function getTypesWithView(env: MinEnv, view: TypeView, a: Atom): Atom[] {
  // Memoise ground atoms: the type is stable for a fixed env, and the recursion below reuses the cached
  // type of every shared subterm. Non-ground atoms are not cached (they churn and rarely repeat by identity).
  if (a.ground) {
    const cache = (view.typeCache ??= new WeakMap());
    const hit = cache.get(a);
    if (hit !== undefined) return hit;
    const r = getTypesUncached(env, view, a);
    cache.set(a, r);
    return r;
  }
  return getTypesUncached(env, view, a);
}

function getTypesUncached(env: MinEnv, view: TypeView, a: Atom): Atom[] {
  if (a.kind === "gnd") {
    const g = a.value;
    if (g.g === "int" || g.g === "float") return NUMBER_T;
    if (g.g === "str") return STRING_T;
    if (g.g === "bool") return BOOL_T;
    // A grounded atom's declared type. The common Grounded case reuses the shared constant so the hot
    // path allocates nothing; only a custom-typed grounded atom (e.g. FileHandle) makes a singleton.
    return a.typ.kind === "sym" && a.typ.name === "Grounded" ? GROUNDED_T : [a.typ];
  }
  if (a.kind === "var") return UNDEF_T;
  if (a.kind === "sym") {
    const ts = view.types.get(a.name);
    return ts && ts.length > 0 ? ts : UNDEF_T;
  }
  // expression
  if (a.items.length === 0) return UNDEF_T;
  if (opOf(a) === "StateValue" && a.items.length === 2)
    return [expr([sym("StateMonad"), headOr(getTypesWithView(env, view, a.items[1]!), UNDEF)])];
  const direct = view.exprTypes.filter((p) => atomEq(p[0], a));
  if (direct.length > 0) return direct.map((p) => p[1]);
  const f = a.items[0]!;
  const args = a.items.slice(1);
  const argTs = args.map((x) => headOr(getTypesWithView(env, view, x), UNDEF));
  const fTypes = getTypesWithView(env, view, f);
  const out: Atom[] = [];
  for (const t of fTypes) {
    if (opOf(t) === "->" && t.kind === "expr") {
      const ts = t.items.slice(1);
      const ret = ts.length > 0 ? ts[ts.length - 1]! : UNDEF;
      const params = ts.slice(0, -1);
      let tb: Bindings = [];
      for (let i = 0; i < params.length && i < argTs.length; i++) {
        const m = matchAtoms(inst(env, tb, params[i]!), argTs[i]!);
        if (m.length > 0) {
          const merged = merge(tb, m[0]!);
          if (merged.length > 0) tb = merged[0]!;
        }
      }
      out.push(inst(env, tb, ret));
    }
  }
  return out.length > 0 ? out : UNDEF_T;
}

function matchReduced(tb: Bindings, expected: Atom, actual: Atom): Bindings | undefined {
  if (atomEq(expected, UNDEF) || atomEq(actual, UNDEF)) return tb;
  if (expected.kind === "expr" && actual.kind === "expr")
    return matchReducedList(tb, expected.items, actual.items);
  for (const mb of matchAtoms(expected, actual)) {
    const merged = merge(tb, mb);
    if (merged.length > 0) return merged[0];
  }
  return undefined;
}

function matchReducedList(
  tb: Bindings,
  es: readonly Atom[],
  acts: readonly Atom[],
): Bindings | undefined {
  if (es.length !== acts.length) return undefined;
  let cur = tb;
  for (let i = 0; i < es.length; i++) {
    const r = matchReduced(cur, es[i]!, acts[i]!);
    if (r === undefined) return undefined;
    cur = r;
  }
  return cur;
}

export function matchType(tb: Bindings, expected: Atom, actual: Atom): Bindings | undefined {
  if (
    atomEq(expected, UNDEF) ||
    atomEq(actual, UNDEF) ||
    atomEq(expected, sym("Atom")) ||
    atomEq(actual, sym("Atom"))
  )
    return tb;
  return matchReduced(tb, expected, actual);
}
