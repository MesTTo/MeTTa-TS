// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, atomEq, expr, internAtom, sym } from "../atom";
import { type AtomLog, emptyLog, logAppendAll, logSize, logToArray } from "../atomlog";
import { type GroundingTable } from "../builtins";
import { compileDependentNondetGroup, type CompiledFns, compileEnv } from "../compile";
import {
  argKey,
  detachProgramCollectionsIfShared,
  emptyEnv,
  emptyStaticNestedMatchIndex,
  invalidateTabling,
  isNamedEvaluationEnvironment,
  KEY_SEP,
  matchesAnyNestedHead,
  namedEvaluationEnvironments,
  nestedArgHead,
  pushTo,
  pushUniqueType,
} from "./env";
import { type MinEnv, type World } from "./machine";
import { headKey, opOf } from "./terms";
import { namedSpaceAtoms, retireCachedProgramSnapshot } from "./world";
import { ForkableSet, forkSet } from "../persistent-collection";
import { isVariableHeadedPattern } from "../reduction-dependency";
import {
  analyzeModedPurity as analyzeModedPurityRef,
  analyzePurity as analyzePurityRef,
  analyzeTableWorth,
} from "../tabling";

// A function passed to another as an argument blocks compilation: iterate's `$step` is called as
// `($step $i $state)`, and the typed compiled core cannot type a call to an unknown `$step`. PeTTa's answer
// is to SPECIALIZE the call: bind the higher-order parameter to the concrete function, producing a
// first-order clone (`iterate$quad-step`) with the recursion rewritten to the clone, so it compiles. Done
// once over the static rules; byte-identical to the original because the clone computes the same thing.

/** Does `a` use variable `name` as the head of an application `($name ...)`? */
function usedAsHead(a: Atom, name: string): boolean {
  if (a.kind !== "expr" || a.items.length === 0) return false;
  if (a.items[0]!.kind === "var" && (a.items[0] as { name: string }).name === name) return true;
  return a.items.some((it) => usedAsHead(it, name));
}

/** Per single-clause functor, its arity and the parameter indices used higher-order in its body. */
function hoFunctors(env: MinEnv): Map<string, { arity: number; idxs: number[] }> {
  const out = new Map<string, { arity: number; idxs: number[] }>();
  for (const [g, eqs] of env.ruleIndex) {
    if (eqs.length !== 1) continue;
    const [lhs, rhs] = eqs[0]!;
    if (lhs.kind !== "expr") continue;
    const idxs: number[] = [];
    for (let k = 0; k < lhs.items.length - 1; k++) {
      const p = lhs.items[k + 1]!;
      if (p.kind === "var" && usedAsHead(rhs, p.name)) idxs.push(k);
    }
    if (idxs.length > 0) out.set(g, { arity: lhs.items.length - 1, idxs });
  }
  return out;
}

/** Build the specialized body: `($pk args)` -> `(fsym args)`; a recursive `(g ... $pk@k ...)` ->
 *  `(sName ... without arg k)`; a bare `$pk` -> `fsym`. */
function specBody(
  a: Atom,
  pk: string,
  fsym: string,
  g: string,
  sName: string,
  k: number,
  gArity: number,
): Atom {
  const rec = (x: Atom): Atom => specBody(x, pk, fsym, g, sName, k, gArity);
  if (a.kind === "var") return a.name === pk ? sym(fsym) : a;
  if (a.kind !== "expr" || a.items.length === 0) return a;
  const h = a.items[0]!;
  if (h.kind === "var" && h.name === pk) return expr([sym(fsym), ...a.items.slice(1).map(rec)]);
  if (h.kind === "sym" && h.name === g && a.items.length - 1 === gArity) {
    const argK = a.items[k + 1]!;
    if (argK.kind === "var" && argK.name === pk)
      return expr([
        sym(sName),
        ...a.items
          .slice(1)
          .filter((_, i) => i !== k)
          .map(rec),
      ]);
  }
  return expr(a.items.map(rec));
}

/** Create (once) the specialization of `g` at parameter `k` bound to function symbol `fsym`; returns its
 *  name, or undefined if `g` is not a single-clause var-headed rule. */
function makeSpec(env: MinEnv, g: string, k: number, fsym: string): string | undefined {
  const sName = g + "$" + fsym;
  if (env.ruleIndex.has(sName)) return sName;
  const eqs = env.ruleIndex.get(g);
  if (eqs === undefined || eqs.length !== 1) return undefined;
  const [lhs, rhs] = eqs[0]!;
  if (lhs.kind !== "expr") return undefined;
  const params = lhs.items.slice(1);
  const pk = params[k];
  if (pk === undefined || pk.kind !== "var") return undefined;
  const newLhs = expr([sym(sName), ...params.filter((_, i) => i !== k)]);
  const newRhs = specBody(rhs, pk.name, fsym, g, sName, k, params.length);
  addAtomToEnv(env, expr([sym("="), newLhs, newRhs]));
  return sName;
}

/** Rewrite higher-order calls in `a`: `(g ... fsym@k ...)`, where g is higher-order at k and the kth arg is
 *  a function symbol, becomes a call to g's specialization with that argument dropped. */
function rewriteHO(env: MinEnv, a: Atom, ho: Map<string, { arity: number; idxs: number[] }>): Atom {
  if (a.kind !== "expr" || a.items.length === 0) return a;
  const items = a.items.map((x) => rewriteHO(env, x, ho));
  const h = items[0]!;
  if (h.kind === "sym") {
    const info = ho.get(h.name);
    if (info !== undefined && items.length - 1 === info.arity) {
      for (const k of info.idxs) {
        const argK = items[k + 1];
        if (argK !== undefined && argK.kind === "sym" && env.ruleIndex.has(argK.name)) {
          const sName = makeSpec(env, h.name, k, argK.name);
          if (sName !== undefined)
            return expr([sym(sName), ...items.slice(1).filter((_, i) => i !== k)]);
        }
      }
    }
  }
  // Unchanged subtree: return the original atom so the caller can detect "no rewrite" by identity (this also
  // keeps the pass idempotent when it re-runs on each recompile).
  return items.every((it, i) => it === a.items[i]) ? a : expr(items);
}

/** Rewrite every static rule body's higher-order calls to specialized first-order functions. Idempotent and
 *  required on each recompile because the runner may evaluate a leading bang (and trigger the first compile)
 *  before the program's own equations are even loaded. */
function specializeHO(env: MinEnv): void {
  const ho = hoFunctors(env);
  if (ho.size === 0) return;
  // Snapshot the rule bodies first: makeSpec adds new rules as it goes, and a specialized body is already
  // first-order, so it never needs another pass.
  const rules: Array<[string, Atom, Atom]> = [];
  for (const [g, eqs] of env.ruleIndex) for (const [lhs, rhs] of eqs) rules.push([g, lhs, rhs]);
  for (const [g, lhs, rhs] of rules) {
    const newRhs = rewriteHO(env, rhs, ho);
    if (newRhs !== rhs) {
      const eqs = env.ruleIndex.get(g);
      if (eqs !== undefined)
        for (let i = 0; i < eqs.length; i++)
          if (eqs[i]![0] === lhs && eqs[i]![1] === rhs) eqs[i] = [lhs, newRhs];
    }
  }
}

function ensureTablingAnalysis(env: MinEnv): void {
  if (env.tableSpace === undefined) return;
  if (
    env.tablingDirty === false &&
    env.pureFunctors !== undefined &&
    env.tableWorth !== undefined &&
    env.modedPureFunctors !== undefined &&
    env.modedTableWorth !== undefined
  )
    return;
  retireCachedProgramSnapshot(env);
  env.pureFunctors = analyzePurityRef(env);
  env.tableWorth = analyzeTableWorth(env, env.pureFunctors);
  env.modedPureFunctors = analyzeModedPurityRef(env);
  env.modedTableWorth = analyzeTableWorth(env, env.modedPureFunctors);
  env.tablingDirty = false;
}

/** Static rule functors mentioned as expression heads in a query. This is a conservative call set: a
 *  data position can cause extra compilation, but a missing head can never expose stale compiled code. */
function queryRuleFunctors(env: MinEnv, a: Atom, into: Set<string>): void {
  const pending = [a];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.kind !== "expr" || current.items.length === 0) continue;
    const head = current.items[0]!;
    if (head.kind === "sym" && env.ruleIndex.has(head.name)) into.add(head.name);
    for (let i = current.items.length - 1; i >= 0; i--) pending.push(current.items[i]!);
  }
}

/** Bring the compiler map up to date for one top-level query. Answer-dependent recursive search groups
 *  compile on demand; a query needing any other missing functor promotes the map to a complete compile. */
export function ensureCompiled(env: MinEnv, query: Atom): void {
  if (env.compiled === undefined) {
    ensureTablingAnalysis(env);
    return;
  }

  const called = new Set<string>();
  queryRuleFunctors(env, query, called);
  if (called.size === 0) {
    ensureTablingAnalysis(env);
    return;
  }

  if (env.compileDirty) {
    retireCachedProgramSnapshot(env);
    detachProgramCollectionsIfShared(env);
    env.compiled.clear();
    env.compiledComplete = false;
    specializeHO(env);
    ensureTablingAnalysis(env);
    env.compileDirty = false;
    called.clear();
    queryRuleFunctors(env, query, called);
  } else {
    ensureTablingAnalysis(env);
  }

  // Existing structural environments set only `compiled` and `compileDirty=false`; their maps came from
  // compileEnv and are complete. The runner marks its initially empty map incomplete explicitly.
  if (env.compiledComplete !== false) return;

  for (const root of called) {
    if (env.compiled.has(root)) continue;
    const group = compileDependentNondetGroup(env, root);
    if (group === undefined) {
      env.compiled = compileEnv(env);
      env.compiledComplete = true;
      return;
    }
    for (const [name, holder] of group) env.compiled.set(name, holder);
  }
}

/** Runtime `add-atom`/`import!` can add equations into `selfRules`, so clear static table state and let the
 *  runtime versioned purity/worth gates decide whether those new rules can be memoised. */
export function disableTabling(env: MinEnv): void {
  env.evaluatedAtoms = new WeakSet();
  env.workerReplaySafeFunctors = undefined;
  env.compiled = undefined;
  env.compileDirty = undefined;
  env.compiledComplete = undefined;
  if (env.tableSpace !== undefined) {
    env.tableSpace.clear();
    env.pureFunctors = new Set();
    env.tableWorth = new Set();
    env.modedPureFunctors = new Set();
    env.modedTableWorth = new Set();
    env.tablingDirty = false;
  }
}

/** Incorporate one atom into `env` (mutating): rule index, signatures, types, and the atom list.
 *  Lets a sequential runner extend the env per atom instead of rebuilding it each query; correctness
 *  gated by the 270/270 oracle. */
export function addAtomToEnv(env: MinEnv, x: Atom, replaceTypeSignature = true): void {
  retireCachedProgramSnapshot(env);
  detachProgramCollectionsIfShared(env);
  if (env.sharedContextAtoms === env.atoms) env.atoms = env.atoms.slice();
  env.programVersion = (env.programVersion ?? 0) + 1;
  const atom = env.intern === undefined ? x : internAtom(env.intern, x);
  const occurrenceId = env.atoms.length;
  // Old structural MinEnv values may not carry this optional index. Initialize only for an empty env;
  // a nonempty legacy env must stay on the complete candidate path because its earlier atoms are unindexed.
  const nestedMatchIndex =
    env.nestedMatchIndex ??
    (occurrenceId === 0 ? (env.nestedMatchIndex = emptyStaticNestedMatchIndex()) : undefined);
  env.atoms.push(atom);
  // Clause indexes for `match`: root functor, ground leaves, and one nested expression-head level.
  const fk = headKey(atom);
  if (fk === undefined) env.varHeadedFacts.push(atom);
  else {
    pushTo(env.factIndex, fk, atom);
    if (!atom.ground) nestedMatchIndex?.nonGroundFactHeads.add(fk);
    if (atom.kind === "expr")
      for (let i = 1; i < atom.items.length; i++) {
        const argument = atom.items[i]!;
        const positionKey = fk + KEY_SEP + i;
        const ak = argKey(argument);
        if (ak !== undefined) pushTo(env.argIndex, fk + KEY_SEP + i + KEY_SEP + ak, atom);
        else pushTo(env.nonGroundAtPos, positionKey, atom);

        if (atom.ground) {
          const nestedHead = nestedArgHead(argument);
          if (nestedHead !== undefined && nestedMatchIndex !== undefined)
            pushTo(nestedMatchIndex.byHead, fk + KEY_SEP + i + KEY_SEP + nestedHead, occurrenceId);
          else if (matchesAnyNestedHead(argument) && nestedMatchIndex !== undefined)
            pushTo(nestedMatchIndex.wildcardAtPos, positionKey, occurrenceId);
        }
      }
  }
  if (opOf(atom) === "=" && atom.kind === "expr" && atom.items.length === 3) {
    env.evaluatedAtoms = new WeakSet();
    const lhs = atom.items[1]!;
    const rhs = atom.items[2]!;
    const k = headKey(lhs);
    if (k === undefined) {
      env.varRules.push([lhs, rhs]);
      if (isVariableHeadedPattern(lhs)) env.varRulesVar.push([lhs, rhs]);
    } else {
      const cur = env.ruleIndex.get(k);
      if (cur === undefined) env.ruleIndex.set(k, [[lhs, rhs]]);
      else cur.push([lhs, rhs]);
    }
    invalidateTabling(env);
  }
  if (atom.kind === "expr" && opOf(atom) === ":" && atom.items.length === 3) {
    const subj = atom.items[1]!;
    const t = atom.items[2]!;
    if (subj.kind === "sym") {
      if (
        opOf(t) === "->" &&
        t.kind === "expr" &&
        (replaceTypeSignature || !env.sigs.has(subj.name))
      )
        env.sigs.set(subj.name, t.items.slice(1));
      pushUniqueType(env.types, subj.name, t);
    } else if (subj.kind === "expr") {
      if (!env.exprTypes.some(([s, tt]) => atomEq(s, subj) && atomEq(tt, t)))
        env.exprTypes.push([subj, t]);
    }
    env.typeCache = undefined; // a new type declaration invalidates the getTypes memo
    env.typeProgramVersion = (env.typeProgramVersion ?? 0) + 1;
    disableTabling(env);
  }
}

export function buildEnv(atoms: Atom[], gt: GroundingTable): MinEnv {
  const env = emptyEnv(gt);
  for (const x of atoms) addAtomToEnv(env, x);
  return env;
}

interface EnvironmentMutationSnapshot {
  readonly sigs: Map<string, Atom[]>;
  readonly types: Map<string, Atom[]>;
  readonly exprTypes: Array<[Atom, Atom]>;
  readonly typeCache: WeakMap<Atom, Atom[]> | undefined;
  readonly evaluatedAtoms: WeakSet<Atom>;
  readonly compiled: CompiledFns | undefined;
  readonly compileDirty: boolean | undefined;
  readonly compiledComplete: boolean | undefined;
  readonly pureFunctors: Set<string> | undefined;
  readonly workerReplaySafeFunctors: Set<string> | undefined;
  readonly modedPureFunctors: Set<string> | undefined;
  readonly tableWorth: Set<string> | undefined;
  readonly modedTableWorth: Set<string> | undefined;
  readonly tablingDirty: boolean | undefined;
}

export function snapshotEnvironmentMutations(env: MinEnv): EnvironmentMutationSnapshot {
  return {
    sigs: new Map(env.sigs),
    types: new Map(env.types),
    exprTypes: env.exprTypes.slice(),
    typeCache: env.typeCache,
    evaluatedAtoms: env.evaluatedAtoms,
    compiled: env.compiled,
    compileDirty: env.compileDirty,
    compiledComplete: env.compiledComplete,
    pureFunctors: env.pureFunctors,
    workerReplaySafeFunctors: env.workerReplaySafeFunctors,
    modedPureFunctors: env.modedPureFunctors,
    tableWorth: env.tableWorth,
    modedTableWorth: env.modedTableWorth,
    tablingDirty: env.tablingDirty,
  };
}

export function restoreEnvironmentMutations(
  env: MinEnv,
  snapshot: EnvironmentMutationSnapshot,
): void {
  const semanticCachesReplaced = env.evaluatedAtoms !== snapshot.evaluatedAtoms;
  env.sigs = snapshot.sigs;
  env.types = snapshot.types;
  env.exprTypes = snapshot.exprTypes;
  env.typeCache = snapshot.typeCache;
  env.evaluatedAtoms = snapshot.evaluatedAtoms;
  if (snapshot.compiled === undefined) env.compiled = undefined;
  else env.compiled = snapshot.compiled;
  if (snapshot.compileDirty === undefined) env.compileDirty = undefined;
  else env.compileDirty = snapshot.compileDirty;
  if (snapshot.compiledComplete === undefined) env.compiledComplete = undefined;
  else env.compiledComplete = snapshot.compiledComplete;
  if (snapshot.pureFunctors === undefined) env.pureFunctors = undefined;
  else env.pureFunctors = snapshot.pureFunctors;
  if (snapshot.workerReplaySafeFunctors === undefined) env.workerReplaySafeFunctors = undefined;
  else env.workerReplaySafeFunctors = snapshot.workerReplaySafeFunctors;
  if (snapshot.modedPureFunctors === undefined) env.modedPureFunctors = undefined;
  else env.modedPureFunctors = snapshot.modedPureFunctors;
  if (snapshot.tableWorth === undefined) env.tableWorth = undefined;
  else env.tableWorth = snapshot.tableWorth;
  if (snapshot.modedTableWorth === undefined) env.modedTableWorth = undefined;
  else env.modedTableWorth = snapshot.modedTableWorth;
  if (snapshot.tablingDirty === undefined) env.tablingDirty = undefined;
  else env.tablingDirty = snapshot.tablingDirty;
  if (semanticCachesReplaced) env.tableSpace?.clear();
}

/** The `&self` atoms (prelude + stdlib + KB in `env.atoms`, plus any dynamically added `selfExtra`).
 *  Returns `env.atoms` directly when nothing has been added dynamically (the common case), avoiding an
 *  O(atoms) spread allocation on every type/candidate/match lookup. Callers must not mutate the result. */
export function selfAtoms(env: MinEnv, w: World): readonly Atom[] {
  const named =
    env.evaluationContext === undefined ? undefined : namedEvaluationEnvironments.get(env);
  if (named !== undefined) return namedSpaceAtoms(w.spaces.get(named.name));
  if (w.removedStatic !== null) {
    const stat = visibleStaticAtoms(w, env.atoms);
    const runtime = runtimeAtoms(w);
    return runtime.length === 0 ? stat : [...stat, ...runtime];
  }
  const runtime = runtimeAtoms(w);
  return runtime.length === 0 ? env.atoms : [...env.atoms, ...runtime];
}

export function runtimeAtoms(w: World): Atom[] {
  const flat = w.flatSelfExtra?.toArray() ?? [];
  const log = logToArray(w.selfExtra);
  if (flat.length === 0) return log;
  if (log.length === 0) return flat;
  return [...flat, ...log];
}

export function candidates(env: MinEnv, toEval: Atom): Array<[Atom, Atom]> {
  const k = headKey(toEval);
  // An expression-headed application (its head is itself an expression, e.g. `((|-> …) …)`) is the only
  // query an expression-headed catch-all rule can match, so it gets the full `varRules`. A symbol-, grounded-,
  // or empty-headed query can only be matched by a genuinely variable-headed catch-all, so it gets just
  // `varRulesVar`. Skipping the unmatchable expression-headed rules is sound and also stops them burning a
  // fresh-variable slot per probe (queryOp advances once per candidate). Byte-identical to the oracle and to
  // Hyperon, which has no such rules; the freshening only ever differed by invisible slots.
  if (k === undefined && toEval.kind === "expr" && toEval.items.length > 0)
    return [...env.varRules]; // keyed is empty here (no head key)
  const keyed = k !== undefined ? (env.ruleIndex.get(k) ?? []) : [];
  return env.varRulesVar.length === 0 ? keyed : [...keyed, ...env.varRulesVar];
}

function removedStaticRuleInfo(a: Atom): { readonly lhs: Atom; readonly rhs: Atom } | undefined {
  if (a.kind !== "expr" || opOf(a) !== "=" || a.items.length !== 3) return undefined;
  return { lhs: a.items[1]!, rhs: a.items[2]! };
}

export function hasStaticAtom(env: MinEnv, a: Atom): boolean {
  return env.atoms.some((x) => atomEq(x, a));
}

export function staticAtomRemoved(w: World, a: Atom): boolean {
  if (w.removedStatic === null) return false;
  for (const r of logToArray(w.removedStatic)) if (atomEq(r, a)) return true;
  return false;
}

export function visibleStaticAtoms(w: World, atoms: readonly Atom[]): Atom[] {
  if (w.removedStatic === null) return atoms.slice();
  return atoms.filter((a) => !staticAtomRemoved(w, a));
}

export function staticRulesChangedFor(w: World, op: string): boolean {
  return w.removedStaticVarRules || w.removedStaticHeads.has(op);
}

export function staticRuleSetChanged(w: World): boolean {
  return logSize(w.removedStatic) > 0;
}

function staticRuleRemoved(w: World, lhs: Atom, rhs: Atom): boolean {
  if (w.removedStatic === null) return false;
  const k = headKey(lhs);
  if (k !== undefined) {
    if (!w.removedStaticHeads.has(k)) return false;
  } else if (!w.removedStaticVarRules) return false;
  for (const r of logToArray(w.removedStatic)) {
    const info = removedStaticRuleInfo(r);
    if (info === undefined) continue;
    if (info.lhs === lhs) return true;
    if (atomEq(info.lhs, lhs) && (info.rhs === rhs || atomEq(info.rhs, rhs))) return true;
  }
  return false;
}

export function visibleStaticRules(env: MinEnv, w: World, toEval: Atom): Array<[Atom, Atom]> {
  const stat = candidates(env, toEval);
  if (isNamedEvaluationEnvironment(env)) return stat;
  if (w.removedStatic === null) return stat;
  return stat.filter(([lhs, rhs]) => !staticRuleRemoved(w, lhs, rhs));
}

export function visibleStaticRulesForHead(
  env: MinEnv,
  w: World,
  name: string,
): Array<[Atom, Atom]> {
  const rules = env.ruleIndex.get(name) ?? [];
  if (isNamedEvaluationEnvironment(env)) return rules;
  if (w.removedStatic === null || !staticRulesChangedFor(w, name)) return rules;
  return rules.filter(([lhs, rhs]) => !staticRuleRemoved(w, lhs, rhs));
}

export function hasVisibleStaticRuleHead(env: MinEnv, w: World, name: string): boolean {
  const rules = env.ruleIndex.get(name);
  if (rules === undefined) return false;
  if (isNamedEvaluationEnvironment(env)) return true;
  if (w.removedStatic === null || !staticRulesChangedFor(w, name)) return true;
  return rules.some(([lhs, rhs]) => !staticRuleRemoved(w, lhs, rhs));
}

export function addStaticRemoval(w: World, a: Atom): void {
  if (staticAtomRemoved(w, a)) return;
  w.removedStatic = logAppendAll(w.removedStatic, [a]);
  const rule = removedStaticRuleInfo(a);
  if (rule === undefined) return;
  const k = headKey(rule.lhs);
  if (k === undefined) {
    w.removedStaticVarRules = true;
  } else {
    const heads = forkSet(w.removedStaticHeads);
    heads.add(k);
    w.removedStaticHeads = heads;
  }
}

export function staticRemovalState(atoms: readonly Atom[]): {
  readonly removedStatic: AtomLog;
  readonly removedStaticHeads: Set<string>;
  readonly removedStaticVarRules: boolean;
} {
  let removedStatic = emptyLog;
  const removedStaticHeads = new ForkableSet<string>();
  let removedStaticVarRules = false;
  for (const a of atoms) {
    removedStatic = logAppendAll(removedStatic, [a]);
    const rule = removedStaticRuleInfo(a);
    if (rule === undefined) continue;
    const k = headKey(rule.lhs);
    if (k === undefined) removedStaticVarRules = true;
    else removedStaticHeads.add(k);
  }
  return { removedStatic, removedStaticHeads, removedStaticVarRules };
}

export function mergeStaticRemovals(
  base: World,
  branches: readonly World[],
): {
  readonly removedStatic: AtomLog;
  readonly removedStaticHeads: Set<string>;
  readonly removedStaticVarRules: boolean;
} {
  const atoms = logToArray(base.removedStatic);
  for (const w of branches)
    for (const a of logToArray(w.removedStatic))
      if (!atoms.some((x) => atomEq(x, a))) atoms.push(a);
  return staticRemovalState(atoms);
}
