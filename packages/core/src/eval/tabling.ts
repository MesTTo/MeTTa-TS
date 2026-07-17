// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  type Atom,
  atomEq,
  atomVars,
  collectVars,
  expr,
  type ExprAtom,
  sym,
  variable,
} from "../atom";
import { ExactAtomSet } from "../atom-set";
import { type BindingRel, type Bindings, fromRelations, makeValRel } from "../bindings";
import { isTableSafeGroundedOp } from "../builtins";
import { readEnv } from "../env";
import { runtimeModedPureCache, runtimePureCache, runtimeTableWorthCache } from "./env";
import { type MinEnv, type St, type World } from "./machine";
import { checkedCounterAdvance } from "./par";
import {
  branchVariableNamespace,
  candidatesW,
  canMatchShallow,
  groundedEffectPolicy,
} from "./query";
import { staticRulesChangedFor, staticRuleSetChanged } from "./specializer";
import { opOf } from "./terms";
import { isDefinedHead, typeViewFor } from "./typeops";
import { UNDEF } from "./world";
import { instantiate } from "../instantiate";
import {
  containsOpaqueApplication,
  isVariableHeadedPattern,
  scanReductionDependencies,
} from "../reduction-dependency";
import { collectionRevision } from "../revision-collection";
import { type TableKey } from "../table-space";
import {
  functorCallCount,
  IMPURE_OPS,
  isModedTablingImpureHead,
  isTablingImpureHead,
  keyWellFormed,
  MODED_IMPURE_OPS,
} from "../tabling";
import { legacyFreshVariableSuffix } from "../variable-scope";

// TableSpace keys pure calls structurally, not by formatting them. Runtime rules live in the per-world
// copy-on-write `selfRules`, and a static function may call a runtime-defined helper. Runtime table keys
// therefore use the whole world's `selfRuleVersion`, not just the queried functor's own rule array. A stale
// entry simply has a different key and is never hit; the bounded table store evicts it later.
// A functor with runtime rules is tabling-safe iff its rules (static + this world's runtime) reference only
// pure ops, transitively. Mirrors analyzePurity but over the combined rule set; cached by functor + version
// so it is computed once per rule-set, not per call. A self/mutual-recursion cycle is treated as pure (the
// fixpoint), since a cycle adds no impure op. `impureOps`/`cache` are passed so ground tabling (`IMPURE_OPS`)
// and moded tabling (`MODED_IMPURE_OPS`, which treats `empty` as pure) each classify against their own set
// with their OWN cache — the two must not share a map, since a call to one must never read a cached answer
// the other computed for the same functor/version.
function runtimeFunctorPureWith(
  env: MinEnv,
  w: World,
  op: string,
  impureOps: ReadonlySet<string>,
  isImpureHead: typeof isTablingImpureHead,
  cache: Map<string, boolean>,
): boolean {
  // A variable-headed rule (e.g. the `|->` lambda applicator) can rewrite ANY call, so its mere presence
  // makes tabling unsound. Static rule removals are branch-local, so the static graph no longer matches the
  // shared table's assumptions. In both cases, decline to table rather than versioning partial rule views.
  if (
    staticRuleSetChanged(w) ||
    env.varRules.some(([lhs]) => isVariableHeadedPattern(lhs)) ||
    w.selfVarRules.length > 0
  )
    return false;
  if (staticRulesChangedFor(w, op)) return false;
  const ck = op + "@" + w.selfRuleVersion;
  const cached = cache.get(ck);
  if (cached !== undefined) return cached;
  const visit = (f: string, seen: Set<string>): boolean => {
    if (seen.has(f)) return true;
    seen.add(f);
    const rules = [...(env.ruleIndex.get(f) ?? []), ...(w.selfRules.get(f) ?? [])];
    const hasRule = (name: string): boolean => env.ruleIndex.has(name) || w.selfRules.has(name);
    for (const [, rhs] of rules) {
      const dependencies = scanReductionDependencies([rhs], hasRule);
      if (containsOpaqueApplication(rhs)) return false;
      for (const h of dependencies.names) {
        if (isImpureHead(env, h, impureOps)) return false;
        if ((env.ruleIndex.has(h) || w.selfRules.has(h)) && !visit(h, seen)) return false;
      }
    }
    return true;
  };
  const pure = visit(op, new Set());
  cache.set(ck, pure);
  return pure;
}

const runtimeFunctorPure = (env: MinEnv, w: World, op: string): boolean =>
  runtimeFunctorPureWith(env, w, op, IMPURE_OPS, isTablingImpureHead, runtimePureCache);

export const runtimeFunctorPureModed = (env: MinEnv, w: World, op: string): boolean =>
  runtimeFunctorPureWith(
    env,
    w,
    op,
    MODED_IMPURE_OPS,
    isModedTablingImpureHead,
    runtimeModedPureCache,
  );

export function runtimeFunctorTableWorth(
  env: MinEnv,
  w: World,
  op: string,
  moded: boolean,
): boolean {
  const staticWorth = (moded ? env.modedTableWorth : env.tableWorth)?.has(op) ?? false;
  if (w.selfRules.size === 0) return staticWorth;
  const ck = (moded ? "m:" : "g:") + op + "@" + w.selfRuleVersion;
  const cached = runtimeTableWorthCache.get(ck);
  if (cached !== undefined) return cached;
  const targets = new Set([op]);
  const directBranching = [...(env.ruleIndex.get(op) ?? []), ...(w.selfRules.get(op) ?? [])].some(
    ([, rhs]) => functorCallCount(rhs, targets) >= 2,
  );
  const worth = staticWorth || directBranching;
  runtimeTableWorthCache.set(ck, worth);
  return worth;
}

export type CompletedTableKey = TableKey;

export function containsImpureHead(
  env: MinEnv,
  world: World,
  atom: Atom,
  impureOps: ReadonlySet<string>,
  moded: boolean,
): boolean {
  const hasRule = (name: string): boolean => env.ruleIndex.has(name) || world.selfRules.has(name);
  const scan = scanReductionDependencies([atom], hasRule);
  if (containsOpaqueApplication(atom)) return true;
  const runtimeRulesVisible = world.selfRules.size > 0 || world.selfVarRules.length > 0;
  const staticPure = moded ? env.modedPureFunctors : env.pureFunctors;
  for (const name of scan.names) {
    const isImpureHead = moded ? isModedTablingImpureHead : isTablingImpureHead;
    if (isImpureHead(env, name, impureOps)) return true;
    if (!hasRule(name)) continue;
    const pure = runtimeRulesVisible
      ? moded
        ? runtimeFunctorPureModed(env, world, name)
        : runtimeFunctorPure(env, world, name)
      : (staticPure?.has(name) ?? false);
    if (!pure) return true;
  }
  return false;
}

const CHOICE_STATEFUL_HEADS: ReadonlySet<string> = new Set([
  "add-atom",
  "remove-atom",
  "add-reduct",
  "add-reducts",
  "add-atoms",
  "new-state",
  "get-state",
  "change-state!",
  "new-space",
  "new-mork-space",
  "fork-space",
  "get-atoms",
  "bind!",
  "context-space",
  "match",
  "get-type",
  "get-type-space",
  "check-types",
  "get-doc",
  "pragma!",
  "register-module!",
]);

const CHOICE_SERIALIZED_HEADS: ReadonlySet<string> = new Set(["with-mutex", "with_mutex"]);

interface ChoiceEffectSummary {
  readonly stateful: boolean;
  readonly serialized: boolean;
}

const EMPTY_CHOICE_EFFECTS: ChoiceEffectSummary = Object.freeze({
  stateful: false,
  serialized: false,
});

function combineChoiceEffects(
  left: ChoiceEffectSummary,
  right: ChoiceEffectSummary,
): ChoiceEffectSummary {
  return {
    stateful: left.stateful || right.stateful,
    serialized: left.serialized || right.serialized,
  };
}

function groundedChoiceEffects(env: MinEnv, operation: string): ChoiceEffectSummary {
  if (!env.gt.has(operation) && !env.agt.has(operation)) return EMPTY_CHOICE_EFFECTS;
  const policy = groundedEffectPolicy(env, operation);
  const stateful = policy.classes.some(
    (effectClass) => effectClass === "atomspace-read" || effectClass === "atomspace-write",
  );
  return { stateful, serialized: false };
}

interface DirectChoiceEffectScan {
  readonly effects: ChoiceEffectSummary;
  readonly dependencies: ReadonlySet<string>;
}

function scanChoiceEffects(
  env: MinEnv,
  world: World,
  roots: readonly Atom[],
): DirectChoiceEffectScan {
  const hasRule = (name: string): boolean => env.ruleIndex.has(name) || world.selfRules.has(name);
  const scan = scanReductionDependencies(roots, hasRule);
  let effects: ChoiceEffectSummary = {
    stateful: false,
    serialized: false,
  };
  const dependencies = new Set<string>();
  for (const name of scan.names) {
    effects = combineChoiceEffects(effects, {
      stateful: CHOICE_STATEFUL_HEADS.has(name),
      serialized: CHOICE_SERIALIZED_HEADS.has(name),
    });
    effects = combineChoiceEffects(effects, groundedChoiceEffects(env, name));
    if (hasRule(name)) dependencies.add(name);
  }
  return { effects, dependencies };
}

interface ChoiceEffectAnalysis {
  readonly programVersion: number;
  readonly groundingVersion: number;
  readonly syncRevision: number;
  readonly asyncRevision: number;
  readonly effectRevision: number;
  readonly runtimeRuleVersion: number;
  readonly summaries: ReadonlyMap<string, ChoiceEffectSummary>;
  readonly variableEffects: ChoiceEffectSummary;
}

const choiceEffectAnalyses = new WeakMap<MinEnv, ChoiceEffectAnalysis>();

/** Propagate the two effect bits through the rule graph once per program image. */
function choiceEffectAnalysis(env: MinEnv, world: World): ChoiceEffectAnalysis {
  const programVersion = env.programVersion ?? 0;
  const groundingVersion = env.groundingVersion ?? 0;
  const syncRevision = collectionRevision(env.gt) ?? 0;
  const asyncRevision = collectionRevision(env.agt) ?? 0;
  const effectRevision =
    env.groundedEffects === undefined ? 0 : (collectionRevision(env.groundedEffects) ?? 0);
  const runtimeRuleVersion = world.selfRuleVersion;
  const cached = choiceEffectAnalyses.get(env);
  if (
    cached !== undefined &&
    cached.programVersion === programVersion &&
    cached.groundingVersion === groundingVersion &&
    cached.syncRevision === syncRevision &&
    cached.asyncRevision === asyncRevision &&
    cached.effectRevision === effectRevision &&
    cached.runtimeRuleVersion === runtimeRuleVersion
  )
    return cached;

  const names = new Set([...env.ruleIndex.keys(), ...world.selfRules.keys()]);
  const summaries = new Map<string, ChoiceEffectSummary>();
  const reverseDependencies = new Map<string, Set<string>>();
  for (const name of names) {
    const equations = [...(env.ruleIndex.get(name) ?? []), ...(world.selfRules.get(name) ?? [])];
    const direct = scanChoiceEffects(
      env,
      world,
      equations.map(([, rhs]) => rhs),
    );
    summaries.set(name, direct.effects);
    for (const dependency of direct.dependencies) {
      const dependents = reverseDependencies.get(dependency);
      if (dependents === undefined) reverseDependencies.set(dependency, new Set([name]));
      else dependents.add(name);
    }
  }

  const pending = [...names].filter((name) => {
    const summary = summaries.get(name)!;
    return summary.stateful || summary.serialized;
  });
  const queued = new Set(pending);
  while (pending.length > 0) {
    const dependency = pending.pop()!;
    queued.delete(dependency);
    const dependencyEffects = summaries.get(dependency)!;
    for (const dependent of reverseDependencies.get(dependency) ?? []) {
      const previous = summaries.get(dependent)!;
      const next = combineChoiceEffects(previous, dependencyEffects);
      if (next.stateful === previous.stateful && next.serialized === previous.serialized) continue;
      summaries.set(dependent, next);
      if (!queued.has(dependent)) {
        queued.add(dependent);
        pending.push(dependent);
      }
    }
  }

  const variableRoots = [...env.varRulesVar, ...world.selfVarRules].map(([, rhs]) => rhs);
  const variableDirect = scanChoiceEffects(env, world, variableRoots);
  let variableEffects = variableDirect.effects;
  for (const dependency of variableDirect.dependencies)
    variableEffects = combineChoiceEffects(
      variableEffects,
      summaries.get(dependency) ?? EMPTY_CHOICE_EFFECTS,
    );

  const analysis: ChoiceEffectAnalysis = {
    programVersion,
    groundingVersion,
    syncRevision,
    asyncRevision,
    effectRevision,
    runtimeRuleVersion,
    summaries,
    variableEffects,
  };
  choiceEffectAnalyses.set(env, analysis);
  return analysis;
}

/** Explicitly serialized stateful Hyperpose branches retain source-ordered state threading. */
export function choiceBranchesParallelSafe(
  env: MinEnv,
  world: World,
  branches: readonly Atom[],
): boolean {
  const analysis = choiceEffectAnalysis(env, world);
  const direct = scanChoiceEffects(env, world, branches);
  let effects = combineChoiceEffects(direct.effects, analysis.variableEffects);
  for (const dependency of direct.dependencies)
    effects = combineChoiceEffects(
      effects,
      analysis.summaries.get(dependency) ?? EMPTY_CHOICE_EFFECTS,
    );
  return !(effects.stateful && effects.serialized);
}

export function groundTableVersionIfAdmissible(
  env: MinEnv,
  world: World,
  op: string,
  call: Atom,
): number | undefined {
  if (env.tableSpace === undefined || !call.ground || !keyWellFormed(call)) return undefined;
  const runtimeRulesVisible = world.selfRules.size > 0 || world.selfVarRules.length > 0;
  const runtimeVersion = runtimeRulesVisible ? world.selfRuleVersion : 0;
  if (runtimeRulesVisible) {
    return runtimeFunctorPure(env, world, op) &&
      runtimeFunctorTableWorth(env, world, op, false) &&
      !containsImpureHead(env, world, call, IMPURE_OPS, false)
      ? runtimeVersion
      : undefined;
  }
  return (env.pureFunctors?.has(op) ?? false) &&
    (env.tableWorth?.has(op) ?? false) &&
    !staticRuleSetChanged(world) &&
    !containsImpureHead(env, world, call, IMPURE_OPS, false)
    ? runtimeVersion
    : undefined;
}

export const DISTINCT_RESOURCE_LIMIT = Symbol("distinct-resource-limit");

export function distinctGroundEnabled(env: MinEnv): boolean {
  return (env.distinctGroundDepth ?? 0) > 0;
}

export function enforceDistinctLimit(env: MinEnv, count: number): void {
  if (
    distinctGroundEnabled(env) &&
    env.tableSpace !== undefined &&
    count > env.tableSpace.entryCellLimit()
  )
    throw DISTINCT_RESOURCE_LIMIT;
}

export function dedupGroundPairs(pairs: readonly [Atom, Bindings][]): Array<[Atom, Bindings]> {
  const seen = new ExactAtomSet();
  const out: Array<[Atom, Bindings]> = [];
  for (const pair of pairs) if (seen.add(pair[0])) out.push(pair);
  return out;
}

export function rememberGroundTable(
  env: MinEnv,
  key: CompletedTableKey,
  results: readonly Atom[],
): void {
  env.tableSpace?.rememberCompleted(key, 0, results);
}

export function rememberModedTable(
  env: MinEnv,
  key: CompletedTableKey,
  numCallVars: number,
  results: readonly Atom[],
): void {
  env.tableSpace?.rememberCompleted(key, numCallVars, results);
}

/** Freshen one cached moded-tabling answer for this call instance: substitute the
 *  call's own canonical placeholders (`%0`..`%(numCallVars-1)`) with `callVarNames` (this call's actual
 *  variable names, found the same way the cache key was — by canonicalizing it), and substitute every
 *  other placeholder (one the cached computation introduced itself, never part of the call) with a
 *  brand-new, globally-fresh variable, via the same counter every other fresh-variable path in this file
 *  uses (`freshenSub`'s `name + "#" + counter` pattern). Reuses `instantiate` (already DAG-sharing-safe)
 *  to do the substitution, so a cached answer with heavy internal sharing stays cheap to replay. */
export function freshenModedResult(
  st: St,
  cachedResult: Atom,
  callVarNames: readonly string[],
  numCallVars: number,
): [Atom, St] {
  const rels: BindingRel[] = [];
  for (let i = 0; i < numCallVars; i++) rels.push(makeValRel("%" + i, variable(callVarNames[i]!)));
  const extraVars: string[] = [];
  collectVars(cachedResult, extraVars, new Set());
  let counter = st.counter;
  for (const v of extraVars) {
    if (!v.startsWith("%")) continue;
    const n = Number(v.slice(1));
    if (Number.isInteger(n) && n >= numCallVars) {
      rels.push(
        makeValRel(
          v,
          variable(`_tab${legacyFreshVariableSuffix(counter, branchVariableNamespace(st.world))}`),
        ),
      );
      counter = checkedCounterAdvance(counter, 1);
    }
  }
  const freshened = instantiate(fromRelations(rels), cachedResult);
  return [freshened, { counter, world: st.world }];
}

// Counting `(length (collapse (match $space $pat $template)))` cares only about how many solutions the
// match has, not their values: matchOp emits exactly one final item per solution (instantiate(m, template))
// and the count fusion never inspects it. So for counting, swap the template for a ground unit. Then
// instantiate(m, unit) returns the unit directly (ground short-circuit) instead of building a result tree
// per solution, which is pure garbage in the emit-bound profile.
const COUNT_UNIT = sym("u");

export function countOnlyMatch(z: Atom): Atom {
  return z.kind === "expr" && z.items.length === 4 && opOf(z) === "match"
    ? expr([z.items[0]!, z.items[1]!, z.items[2]!, COUNT_UNIT])
    : z;
}

const COLLAPSE_ROUTE_ENV = "METTA_COLLAPSE_ROUTE";

export const DONE_UNIT = sym("done");

export const collapseRouteEnabled = (): boolean => readEnv(COLLAPSE_ROUTE_ENV) !== "0";

// Disables the all-distinct-variable count-aggregate (the head/arity tally), falling back to the streaming
// count. Off switch for A/B differentials only; the tally is byte-identical, so this stays on by default.
export const countAggregateEnabled = (): boolean => readEnv("METTA_COUNT_AGGREGATE") !== "0";

// Void-context build: when a routed `(length (collapse (FN a)))` build ends in a dead binding to a compiled
// impure function (matespace's `($g (rewriteK Z K))`, whose tree result is never read), run that call in
// discard mode so its add-atom side effects happen without allocating the result tree (matespace K=19 drops
// ~25%). The binding is kept and only its value is the sentinel, so the gensym counter is byte-identical, not
// just alpha. Off switch (METTA_VOID_BUILD=0) for the differential.
export const voidBuildEnabled = (): boolean => readEnv("METTA_VOID_BUILD") !== "0";

// Conjunctive collapse-count via the worst-case-optimal join fold (matchConjCount). A multi-goal
// `(length/size-atom (collapse (match &self (, ...) tmpl)))` folds the same wcoJoin the default result path
// (matchConjJoin) already runs, counting each solution instead of allocating its answer atom. The count is
// order- and name-independent, so the fold is byte-identical to materializing-then-counting and needs no
// experimental gate; it skips ~360k atom allocations on permutations (2.8s -> 0.48s). Off switch
// (METTA_CONJ_COUNT=0) drops back to the materializing count for the differential.
export const conjCountEnabled = (): boolean => readEnv("METTA_CONJ_COUNT") !== "0";

interface TailMatchBuild {
  readonly buildExpr: Atom;
  readonly tailMatch: ExprAtom;
  readonly boundVars: ReadonlySet<string>;
}

export interface CollapseRoute {
  readonly buildExpr: Atom;
  readonly tailMatch: ExprAtom;
  readonly st: St;
  readonly bnd: Bindings;
  /** Dead build bindings to compiled impure functions, split off to run in discard/count mode. */
  readonly voidCalls?:
    | ReadonlyArray<{ readonly op: string; readonly args: readonly Atom[] }>
    | undefined;
}

// If `buildExpr` is `(let (...) ... done)` / `(let* (pairs) done)` whose final binding suffix calls compiled
// impure functions with ground arguments, return the build with that suffix replaced by `done` plus the
// calls to run in discard/count mode. The bindings are dead (their values are never read: the route already
// checked the tail match uses no let-bound variable, and the split only takes a suffix), so running them for
// effects and multiplicity is equivalent. Any other shape returns undefined and the normal build runs.
export function splitVoidBuild(
  buildExpr: Atom,
  env: MinEnv,
):
  | {
      readonly prefix: Atom;
      readonly calls: ReadonlyArray<{ readonly op: string; readonly args: readonly Atom[] }>;
    }
  | undefined {
  if (buildExpr.kind !== "expr") return undefined;
  const voidable = (rhs: Atom): { op: string; args: readonly Atom[] } | undefined => {
    if (rhs.kind !== "expr" || rhs.items.length === 0 || rhs.items[0]!.kind !== "sym")
      return undefined;
    const op = rhs.items[0]!.name;
    const args = rhs.items.slice(1);
    if (env.compiled?.get(op)?.kind !== "imperative" || args.some((a) => !a.ground))
      return undefined;
    return { op, args };
  };
  // Keep the binding in the prefix but replace its evaluated value with the sentinel, rather than dropping it:
  // the `let` machinery (and its gensym) then runs exactly as before, the discarded result value is the only
  // thing not built, and the call's own gensym is restored by running it separately in discard mode. So the
  // build's fresh-variable counter is byte-identical, not just alpha-equivalent.
  const head = opOf(buildExpr);
  if (head === "let" && buildExpr.items.length === 4 && atomEq(buildExpr.items[3]!, DONE_UNIT)) {
    const v = voidable(buildExpr.items[2]!);
    if (v === undefined) return undefined;
    return {
      prefix: expr([buildExpr.items[0]!, buildExpr.items[1]!, DONE_UNIT, DONE_UNIT]),
      calls: [v],
    };
  }
  if (
    head === "let*" &&
    buildExpr.items.length === 3 &&
    buildExpr.items[1]!.kind === "expr" &&
    atomEq(buildExpr.items[2]!, DONE_UNIT)
  ) {
    const pairs = buildExpr.items[1]!.items;
    let splitAt = pairs.length;
    const calls: Array<{ readonly op: string; readonly args: readonly Atom[] }> = [];
    while (splitAt > 0) {
      const pair = pairs[splitAt - 1]!;
      if (pair.kind !== "expr" || pair.items.length !== 2) return undefined;
      const v = voidable(pair.items[1]!);
      if (v === undefined) break;
      calls.unshift(v);
      splitAt -= 1;
    }
    if (calls.length === 0) return undefined;
    const newPairs = [
      ...pairs.slice(0, splitAt),
      ...pairs.slice(splitAt).map((pair) => expr([(pair as ExprAtom).items[0]!, DONE_UNIT])),
    ];
    return {
      prefix: expr([buildExpr.items[0]!, expr(newPairs), DONE_UNIT]),
      calls,
    };
  }
  return undefined;
}

function addAtomVars(into: Set<string>, atom: Atom): void {
  for (const name of atomVars(atom)) into.add(name);
}

export function hasAnyAtomVar(vars: ReadonlySet<string>, atoms: readonly Atom[]): boolean {
  for (const atom of atoms) for (const name of atomVars(atom)) if (vars.has(name)) return true;
  return false;
}

export function tailMatchBuild(body: Atom): TailMatchBuild | undefined {
  if (body.kind !== "expr") return undefined;
  const op = opOf(body);
  if (op === "match" && body.items.length === 4)
    return { buildExpr: DONE_UNIT, tailMatch: body, boundVars: new Set() };
  if (op === "let" && body.items.length === 4) {
    const inner = tailMatchBuild(body.items[3]!);
    if (inner === undefined) return undefined;
    const boundVars = new Set(inner.boundVars);
    addAtomVars(boundVars, body.items[1]!);
    return {
      buildExpr: expr([body.items[0]!, body.items[1]!, body.items[2]!, inner.buildExpr]),
      tailMatch: inner.tailMatch,
      boundVars,
    };
  }
  if (op === "let*" && body.items.length === 3 && body.items[1]!.kind === "expr") {
    const inner = tailMatchBuild(body.items[2]!);
    if (inner === undefined) return undefined;
    const boundVars = new Set(inner.boundVars);
    for (const pair of body.items[1]!.items) {
      if (pair.kind !== "expr" || pair.items.length !== 2) return undefined;
      addAtomVars(boundVars, pair.items[0]!);
    }
    return {
      buildExpr: expr([body.items[0]!, body.items[1]!, inner.buildExpr]),
      tailMatch: inner.tailMatch,
      boundVars,
    };
  }
  return undefined;
}

const CHOICE_PLAN_RULE_COUNTS: ReadonlyArray<readonly [string, number]> = [
  ["collapse", 1],
  ["let", 1],
  ["let*", 1],
  ["if", 2],
  ["superpose", 0],
  ["+", 0],
  ["-", 0],
  ["*", 0],
  ["<", 0],
  ["<=", 0],
  [">", 0],
  [">=", 0],
  ["==", 0],
  ["!=", 0],
  ["unique-atom", 0],
];

const CHOICE_PLAN_SIGNATURES: ReadonlyArray<readonly [string, readonly Atom[]]> = [
  ["collapse", [sym("Atom"), sym("Atom")]],
  ["let", [sym("Atom"), UNDEF, sym("Atom"), UNDEF]],
  ["let*", [sym("Expression"), sym("Atom"), UNDEF]],
  ["superpose", [sym("Expression"), UNDEF]],
  ["+", [sym("Number"), sym("Number"), sym("Number")]],
  ["-", [sym("Number"), sym("Number"), sym("Number")]],
  ["*", [sym("Number"), sym("Number"), sym("Number")]],
  ["if", [sym("Bool"), sym("Atom"), sym("Atom"), variable("t")]],
  ["==", [variable("t"), variable("t"), sym("Bool")]],
  ["!=", [variable("t"), variable("t"), sym("Bool")]],
  ["<", [sym("Number"), sym("Number"), sym("Bool")]],
  ["<=", [sym("Number"), sym("Number"), sym("Bool")]],
  [">", [sym("Number"), sym("Number"), sym("Bool")]],
  [">=", [sym("Number"), sym("Number"), sym("Bool")]],
];

const CHOICE_PLAN_GROUNDED_OPS = [
  "+",
  "-",
  "*",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "superpose",
  "unique-atom",
];

export function canRunChoicePlan(env: MinEnv, w: World): boolean {
  const view = typeViewFor(env, w);
  if (env.varRulesVar.length > 0 || w.selfVarRules.length > 0) return false;
  for (const name of CHOICE_PLAN_GROUNDED_OPS) {
    const grounded = env.gt.get(name);
    if (grounded === undefined || env.agt.has(name) || !isTableSafeGroundedOp(name, grounded))
      return false;
  }
  for (const [name, expectedRules] of CHOICE_PLAN_RULE_COUNTS) {
    if ((env.ruleIndex.get(name)?.length ?? 0) !== expectedRules) return false;
    if (w.selfRules.has(name) || staticRulesChangedFor(w, name)) return false;
  }
  if (view.sigs.has("unique-atom")) return false;
  for (const [name, expected] of CHOICE_PLAN_SIGNATURES) {
    const actual = view.sigs.get(name);
    if (
      actual === undefined ||
      actual.length !== expected.length ||
      actual.some((type, index) => !atomEq(type, expected[index]!))
    )
      return false;
  }
  return true;
}

export const choicePlanConstructor =
  (env: MinEnv, world: World) =>
  (name: string): boolean =>
    !isDefinedHead(env, world, name);

export const choicePlanDataExpression =
  (env: MinEnv, world: World) =>
  (atom: ExprAtom): boolean =>
    candidatesW(env, world, atom).every(([lhs]) => !canMatchShallow(lhs, atom));

export function isClosedChoiceValue(env: MinEnv, world: World, atom: Atom): boolean {
  if (!atom.ground) return false;
  if (atom.kind !== "expr") return atom.kind !== "sym" || !isDefinedHead(env, world, atom.name);
  if (atom.items.length === 0) return true;
  const head = atom.items[0]!;
  if (head.kind === "expr") return false;
  if (head.kind === "sym" && isDefinedHead(env, world, head.name)) return false;
  return atom.items.every((item) => isClosedChoiceValue(env, world, item));
}

export const staticCustomMatcherCache = new WeakMap<
  MinEnv,
  { readonly atomCount: number; readonly hasCustomMatcher: boolean }
>();
