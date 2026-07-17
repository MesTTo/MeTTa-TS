// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

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
} from "../atom";
import { idxCount, logGroundIdx, logNonGround, logToArray } from "../atomlog";
import {
  type Bindings,
  emptyBindings,
  eqRelations,
  hasLoop,
  lookupVal,
  size,
  valEntries,
} from "../bindings";
import { isSingleResultGroundedOp, isTableSafeGroundedOp } from "../builtins";
import { type CompiledImpureOps } from "../compile";
import { readEnv } from "../env";
import { argKey, KEY_SEP, nestedArgHead, orderedIndexedAtoms } from "./env";
import { candidateCounterPadding, type ContextualPair, syntheticCandidateSource } from "./geneval";
import {
  inst,
  type Item,
  type MinEnv,
  type St,
  type Stack,
  type TypeView,
  type World,
} from "./machine";
import { compiledAddAtom, compiledAddIfAbsent, namedSpaceCandidateGetter } from "./mutate";
import { freshenRule, mutexKey, subTokens, typePrep } from "./par";
import {
  branchVariableNamespace,
  candidatesW,
  canMatchShallow,
  makeExpr,
  mergeRestrict,
  notReducibleA,
  resolveAll,
  resolveStates,
  runtimeCandidates,
  worldFreshVariableSuffix,
} from "./query";
import {
  selfAtoms,
  staticAtomRemoved,
  staticRulesChangedFor,
  visibleStaticAtoms,
  visibleStaticRulesForHead,
} from "./specializer";
import {
  type CollapseRoute,
  collapseRouteEnabled,
  DONE_UNIT,
  hasAnyAtomVar,
  splitVoidBuild,
  staticCustomMatcherCache,
  tailMatchBuild,
  voidBuildEnabled,
} from "./tabling";
import {
  admitAtom,
  finItem,
  headKey,
  isEmbeddedOp,
  opOf,
  skipApplicationCheck,
  strictArityError,
} from "./terms";
import {
  functionArity,
  getTypesWithView,
  headOr,
  isDefinedHead,
  isNormalForm,
  isNormalFormAssumingVars,
  matchType,
  refreshEvaluationEnvironment,
  typeViewFor,
} from "./typeops";
import { type CandidateSource, contextualSpaceName, UNDEF } from "./world";
import { addVarBinding, matchAtoms, matchAtomsScoped, merge } from "../match";
import { stdlibDocAtoms } from "../stdlib";
import { Trail, unifyTrail } from "../trail";
import { type Relation, wcoJoin, wcoJoinFold } from "../wcojoin";

// The minimal MeTTa interpreter and type-directed evaluator: a faithful port of LeaTTa
// `MettaHyperonFull/Minimal/Interpreter.lean` (itself a port of Hyperon `interpreter.rs`).
// A CPS nondeterministic stack machine over the minimal instructions, with `mettaEval` (the
// type-directed metta-call loop) on top. The driver is iterative to keep the JS stack shallow.

// Constructor / normal-form short-circuit, on by default. `METTA_CTOR_SC=0` disables it for A/B measurement.
export const CTOR_SC = readEnv("METTA_CTOR_SC") !== "0";

// Internal A/B gate for the `(case (match ...) cases)` streaming path. Default on; `0` restores the
// materializing stdlib expansion in one binary.
export const STREAM_CASE = readEnv("METTA_STREAM_CASE") !== "0";

export interface ItemSource {
  readonly endState: St;
  foldItems(): Iterable<Item>;
}

export type ItemBatch = Item[] | ItemSource;

export function isItemSource(work: Item[] | ItemSource): work is ItemSource {
  return !Array.isArray(work);
}

export const emptyA = sym("Empty");

const collapsedEmptyA = expr([sym(",")]);

const collapsedEmptySpellings: readonly Atom[] = [emptyExpr, collapsedEmptyA];

export const unitA = emptyExpr;

export const errAtom = (a: Atom, msg: string): Atom => expr([sym("Error"), a, sym(msg)]);

// Does any `=` rule in scope reduce `a`? Used to let a program's own definition win over a PeTTa-compat
// grounded op of the same name (those ops are a fallback, not an override).
export function hasRuleFor(env: MinEnv, w: World, counter: number, a: Atom): boolean {
  for (const [lhs, rhs] of candidatesW(env, w, a)) {
    const [fl] = freshenRule(counter, lhs, rhs, branchVariableNamespace(w));
    if (matchAtoms(fl, a).length > 0) return true;
  }
  return false;
}

export function finalPair(env: MinEnv, it: Item): ContextualPair {
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

export function exhaustedPair(env: MinEnv, it: Item): ContextualPair {
  const f = it.stack;
  const selected = it.evaluationScope?.env;
  const active = selected ?? env;
  const atom =
    f === null
      ? emptyA
      : makeExpr(active, [sym("Error"), inst(active, it.bnd, f.head.atom), sym("StackOverflow")]);
  return selected === undefined ? [atom, it.bnd] : [atom, it.bnd, selected];
}

export function partialApplicationView(env: MinEnv, w: World, atom: Atom): Atom {
  if (atom.kind !== "expr" || atom.items.length < 2) return atom;
  const head = atom.items[0]!;
  if (head.kind !== "sym") return atom;
  const args = atom.items.slice(1);
  const arity = functionArity(env, w, head.name);
  if (arity === undefined || args.length >= arity) return atom;
  return makeExpr(env, [sym("partial"), head, makeExpr(env, args)]);
}

/** The type(s) reported by the user-facing `get-type` op. Same as `getTypes`, but with hyperon's tuple
 *  case: when an expression's head is not a function, the whole expression is a tuple and its type is the
 *  tuple of its elements' types, e.g. `(a b)` with `a:A`, `b:B` is `(A B)`. When an element has SEVERAL
 *  types the result is the cartesian product, one tuple type per combination (hyperon types.rs:
 *  `get_atom_types((a b))` is `[(A B), (B B)]` when `a:{A,B}`). This is kept out of `getTypes` itself
 *  because that drives type-directed argument evaluation, which must stay conservative (%Undefined%) for an
 *  ordinary tuple expression rather than invent a tuple type. */
export function getTypesForQuery(env: MinEnv, w: World, a: Atom): Atom[] {
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

export function typeCheckArgs(
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

export function typeMismatch(
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
export function matchConjCount(
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

export function getDocOf(env: MinEnv, w: World, atom: Atom): Atom {
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

export function spaceMutate(
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

export const COMPILED_IMPURE_OPS: CompiledImpureOps = {
  addAtom: compiledAddAtom,
  matchSolutions: compiledMatchSolutions,
  addIfAbsent: compiledAddIfAbsent,
};

// Shared setup for `match`: resolve the queried space, normalize a `(, ...)` conjunction into its goal
// patterns, and build the candidate-fact generator (&self's functor index, or a named space's atoms).
// Factored out of matchOp so the trail counter reuses the exact same candidate semantics (no second copy).
export function matchSetup(
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

export function matchInsideOnce(a: Atom): ExprAtom | undefined {
  if (a.kind !== "expr" || opOf(a) !== "once" || a.items.length !== 2) return undefined;
  const inner = a.items[1]!;
  return inner.kind === "expr" && opOf(inner) === "match" && inner.items.length === 4
    ? inner
    : undefined;
}

export function matchFromEmptyCollapseCheck(a: Atom): ExprAtom | undefined {
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

export function matchCountTrail(
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

export function matchOp(
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

export function matchItemSource(
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

export function prepareCollapseRoute(
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
export function tryCountAggregate(
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

export function canStreamStdlibCase(env: MinEnv, w: World): boolean {
  return (
    STREAM_CASE &&
    (env.ruleIndex.get("case")?.length ?? 0) === 1 &&
    env.varRulesVar.length === 0 &&
    !w.selfRules.has("case") &&
    !staticRulesChangedFor(w, "case") &&
    w.selfVarRules.length === 0
  );
}

export const choicePlanApplication =
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

export function isDiscardedFiniteMatch(env: MinEnv, world: World, call: ExprAtom): boolean {
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

export function streamCaseSource(
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
export function planRulePair(
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
export function mapReducedRulePairs(
  plan: RulePairPlan,
  queryVars: readonly string[],
  more: ReadonlyArray<readonly [Atom, Bindings]>,
): Array<[Atom, Bindings]> {
  return more.map((m): [Atom, Bindings] => [
    m[0],
    mergeRestrict(plan.selected, queryVars, plan.pb, m[1]),
  ]);
}

export interface StreamedInterpretedPass {
  /** `single` preserves the caller's one-pair tail-call trampoline; `streamed` already reduced,
   *  emitted, and (subject to the retention flag) collected every alternative. */
  readonly kind: "single" | "streamed";
  readonly pair?: ContextualPair;
  readonly out: Array<[Atom, Bindings]>;
  readonly state: St;
}

export function argumentMayProduceAlternatives(env: MinEnv, world: World, argument: Atom): boolean {
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

export function rememberGroundEvaluation(
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

export function mettaReturnsInputForExpectedType(atom: Atom, expectedType: Atom): boolean {
  if (atom.kind === "var") return true;
  if (expectedType.kind !== "sym") return false;
  return expectedType.name === "Atom" || expectedType.name === metaType(atom);
}

export function mettaTypeTerminal(atom: Atom): boolean {
  return atomEq(atom, emptyA) || atomEq(atom, notReducibleA) || isErrorAtom(atom);
}
