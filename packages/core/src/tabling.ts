// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Automatic tabling support: classify which functors are safe to memoise.
// A pure functor's result bag is a function of its ground arguments alone, so caching that bag and
// replaying it preserves order and multiplicity exactly. "Pure" here is conservative: no world or
// state mutation, no I/O, no type/space read, and no nondeterminism-introducing op.
import { type Atom } from "./atom";
import { isModedTableSafeGroundedOp, isTableSafeGroundedOp } from "./builtins";
import { type MinEnv } from "./eval";
import { IMPURE_OPS, MODED_IMPURE_OPS } from "./operation-classification";
import {
  containsOpaqueApplication,
  isVariableHeadedPattern,
  scanReductionDependencies,
} from "./reduction-dependency";

export { IMPURE_OPS, MODED_IMPURE_OPS };

function tablingImpureHeadWith(
  env: MinEnv,
  name: string,
  impureOps: ReadonlySet<string>,
  groundedTableSafe: typeof isTableSafeGroundedOp,
): boolean {
  if (impureOps.has(name) || env.agt.has(name)) return true;
  const grounded = env.gt.get(name);
  return grounded !== undefined && !groundedTableSafe(name, grounded);
}

/** A named grounded operation is table-safe only when it is an unchanged built-in on the pure list. */
export function isTablingImpureHead(
  env: MinEnv,
  name: string,
  impureOps: ReadonlySet<string> = IMPURE_OPS,
): boolean {
  return tablingImpureHeadWith(env, name, impureOps, isTableSafeGroundedOp);
}

/** A named operation is moded-table-safe only when it is invariant under variable renaming. */
export function isModedTablingImpureHead(
  env: MinEnv,
  name: string,
  impureOps: ReadonlySet<string> = MODED_IMPURE_OPS,
): boolean {
  return tablingImpureHeadWith(env, name, impureOps, isModedTableSafeGroundedOp);
}

type ImpureHead = (env: MinEnv, name: string, impureOps: ReadonlySet<string>) => boolean;

function analyzePurityWith(
  env: MinEnv,
  impureOps: ReadonlySet<string>,
  isImpureHead: ImpureHead,
  rejectOpaqueApplications: boolean,
): Set<string> {
  if (env.varRules.some(([lhs]) => isVariableHeadedPattern(lhs))) return new Set();
  const deps = new Map<string, Set<string>>();
  const impure = new Set<string>();
  const hasStaticRule = (name: string): boolean => env.ruleIndex.has(name);
  for (const [k, eqs] of env.ruleIndex) {
    const s = new Set<string>();
    for (const [, rhs] of eqs) {
      scanReductionDependencies([rhs], hasStaticRule, s);
      if (rejectOpaqueApplications && containsOpaqueApplication(rhs)) impure.add(k);
    }
    deps.set(k, s);
  }
  for (const [k, s] of deps) {
    if (impure.has(k)) continue;
    for (const h of s)
      if (isImpureHead(env, h, impureOps)) {
        impure.add(k);
        break;
      }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [k, s] of deps) {
      if (impure.has(k)) continue;
      for (const h of s)
        if (impure.has(h)) {
          impure.add(k);
          changed = true;
          break;
        }
    }
  }
  const pure = new Set<string>();
  for (const k of deps.keys()) if (!impure.has(k)) pure.add(k);
  return pure;
}

/** The set of functor names safe to table. Conservative: a variable-headed (`$x`-headed) equation can match
 *  anything, so its presence disables tabling entirely. (`varRules` also holds expression-headed equations,
 *  which match only their own constructor and are harmless here.) `impureOps` defaults to `IMPURE_OPS`
 *  (every existing caller's exact prior behavior). `impureOps` changes the effect policy, but this API
 *  intentionally retains ground-call safety for built-ins. Use `analyzeModedPurity` for variant tabling. */
export function analyzePurity(
  env: MinEnv,
  impureOps: ReadonlySet<string> = IMPURE_OPS,
): Set<string> {
  return analyzePurityWith(env, impureOps, isTablingImpureHead, true);
}

/** Functors whose calls and answers are invariant under alpha-renaming. */
export function analyzeModedPurity(
  env: MinEnv,
  impureOps: ReadonlySet<string> = MODED_IMPURE_OPS,
): Set<string> {
  return analyzePurityWith(env, impureOps, isModedTablingImpureHead, true);
}

/** Find candidates for the compiler's own subset proofs. A dynamic head is not accepted as a purity
 *  proof here. It remains available so higher-order specialization and tuple compilers can decide from
 *  their typed context whether the expression is executable or data. Table and worker admission must use
 *  their stricter analyses instead. */
export function analyzeCompilerCandidates(
  env: MinEnv,
  impureOps: ReadonlySet<string> = IMPURE_OPS,
): Set<string> {
  return analyzePurityWith(env, impureOps, isTablingImpureHead, false);
}

function callHeads(a: Atom, out: Set<string>): void {
  if (a.kind !== "expr" || a.items.length === 0) return;
  if (a.items[0]!.kind === "sym") out.add((a.items[0] as { name: string }).name);
  for (const it of a.items) callHeads(it, out);
}

/** How many calls in `a` target any functor in `targets`. */
export function functorCallCount(a: Atom, targets: ReadonlySet<string>): number {
  if (a.kind !== "expr" || a.items.length === 0) return 0;
  let n = a.items[0]!.kind === "sym" && targets.has((a.items[0] as { name: string }).name) ? 1 : 0;
  for (const it of a.items) n += functorCallCount(it, targets);
  return n;
}

/** Pure functors worth automatic tabling. A recursive SCC is worth tabling when some rule body branches
 *  into that same SCC at least twice. This keeps fib/proof-search overlap tabled while avoiding unbounded
 *  caches for single-tail recursion such as factorial or trial division. */
export function analyzeTableWorth(env: MinEnv, pureFunctors: ReadonlySet<string>): Set<string> {
  const deps = new Map<string, Set<string>>();
  const bodies = new Map<string, Atom[]>();
  for (const [k, eqs] of env.ruleIndex) {
    const s = new Set<string>();
    const bs: Atom[] = [];
    for (const [, rhs] of eqs) {
      callHeads(rhs, s);
      bs.push(rhs);
    }
    deps.set(k, s);
    bodies.set(k, bs);
  }

  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexes = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const components: string[][] = [];

  const strongConnect = (v: string): void => {
    indexes.set(v, index);
    lowlinks.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of deps.get(v) ?? []) {
      if (!deps.has(w)) continue;
      if (!indexes.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indexes.get(w)!));
      }
    }

    if (lowlinks.get(v) === indexes.get(v)) {
      const component: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      components.push(component);
    }
  };

  for (const v of deps.keys()) if (!indexes.has(v)) strongConnect(v);

  const worth = new Set<string>();
  for (const component of components) {
    const componentSet = new Set(component);
    const recursive =
      component.length > 1 ||
      component.some((f) => {
        const s = deps.get(f);
        return s !== undefined && s.has(f);
      });
    if (!recursive) continue;
    const branchesInsideComponent = component.some((f) =>
      (bodies.get(f) ?? []).some((rhs) => functorCallCount(rhs, componentSet) >= 2),
    );
    if (!branchesInsideComponent) continue;
    for (const f of component) if (pureFunctors.has(f)) worth.add(f);
  }
  return worth;
}

/** A key is well-formed only if it contains no Float leaf (IEEE-754 breaks lawful equality, so a
 *  float-keyed table could merge or split keys differently from `match`). Mutable references never
 *  appear in a ground call, so the float check is the only one needed in P1. */
export function keyWellFormed(a: Atom): boolean {
  if (a.kind === "gnd") return a.value.g !== "float";
  if (a.kind === "expr") return a.items.every(keyWellFormed);
  return true;
}
