// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Automatic tabling support: classify which functors are safe to memoise, and build the memo key.
// A pure functor's result bag is a function of its ground arguments alone, so caching that bag and
// replaying it preserves order and multiplicity exactly. "Pure" here is conservative: no world or
// state mutation, no I/O, no type/space read, and no nondeterminism-introducing op.
import { type Atom } from "./atom";
import { format } from "./parser";
import { type MinEnv } from "./eval";

/** Ops that read or write mutable state, do I/O, read types/spaces, or introduce nondeterminism.
 *  A functor whose body reaches any of these (directly or transitively) is not tabled in P1. */
export const IMPURE_OPS: ReadonlySet<string> = new Set([
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
  "import!",
  "transaction",
  "context-space",
  "par",
  "race",
  "once",
  "with-mutex",
  "with_mutex",
  "superpose",
  "hyperpose",
  "collapse",
  "collapse-bind",
  "superpose-bind",
  "collapse-extract",
  "match",
  "metta",
  "metta-thread",
  "capture",
  "println!",
  "print!",
  "trace!",
  "pragma!",
  "register-module!",
  "get-type",
  "get-type-space",
  "check-types",
  "get-doc",
  "empty",
]);

/** `IMPURE_OPS` minus `empty`, for moded tabling only (see `analyzePurityModed`). `empty`'s own grounded
 *  implementation (`builtins.ts`) is `() => ok()`: a zero-argument constant with no state, argument, or
 *  space dependency whatsoever, so it cannot make a call's answer set depend on anything the call's own
 *  arguments (and the world's rule set, which the version-keyed path already accounts for) do not already
 *  capture — unlike every other entry here (nondeterminism ops, I/O, space/state reads and writes). It
 *  is grouped with those in `IMPURE_OPS` only because ground tabling has never needed to look past that
 *  conservative default; `(empty)` pruning a failed branch is the standard, idiomatic way a MeTTa function
 *  signals "no answer" (Prolog's `fail`), so excluding it here is what actually lets moded tabling apply
 *  to ordinary backward-chaining predicates instead of never firing on any of them. */
export const MODED_IMPURE_OPS: ReadonlySet<string> = new Set(
  [...IMPURE_OPS].filter((op) => op !== "empty"),
);

/** Every symbol that heads a subexpression of `a`, collected recursively. */
function headSymbols(a: Atom, out: Set<string>): Set<string> {
  if (a.kind === "expr" && a.items.length > 0) {
    if (a.items[0]!.kind === "sym") out.add((a.items[0] as { name: string }).name);
    for (const it of a.items) headSymbols(it, out);
  }
  return out;
}

// A rule LHS that can match any functor: its head is (recursively) a variable, e.g. `($x ...)`. An
// expression-headed rule like `((|-> ...) ...)` only matches that one constructor, so it does NOT threaten
// other functors' tabling. Only a genuinely variable-headed rule does.
function variableHeaded(a: Atom): boolean {
  return (
    a.kind === "var" || (a.kind === "expr" && a.items.length > 0 && variableHeaded(a.items[0]!))
  );
}

/** The set of functor names safe to table. Conservative: a variable-headed (`$x`-headed) equation can match
 *  anything, so its presence disables tabling entirely. (`varRules` also holds expression-headed equations,
 *  which match only their own constructor and are harmless here.) `impureOps` defaults to `IMPURE_OPS`
 *  (every existing caller's exact prior behavior); moded tabling passes `MODED_IMPURE_OPS` instead. No
 *  internal cache here (unlike `runtimeFunctorPure` in eval.ts), so parameterizing carries no
 *  cache-key-collision risk — each call recomputes the fixpoint fresh over whichever set it's given. */
export function analyzePurity(
  env: MinEnv,
  impureOps: ReadonlySet<string> = IMPURE_OPS,
): Set<string> {
  if (env.varRules.some(([lhs]) => variableHeaded(lhs))) return new Set();
  const deps = new Map<string, Set<string>>();
  for (const [k, eqs] of env.ruleIndex) {
    const s = new Set<string>();
    for (const [, rhs] of eqs) headSymbols(rhs, s);
    deps.set(k, s);
  }
  const impure = new Set<string>();
  for (const [k, s] of deps) {
    for (const h of s)
      if (impureOps.has(h)) {
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

/** The memo key for a ground call. The call has no variables, so its printed form is canonical. */
export function tableKey(call: Atom): string {
  return format(call);
}

/** A key is well-formed only if it contains no Float leaf (IEEE-754 breaks lawful equality, so a
 *  float-keyed table could merge or split keys differently from `match`). Mutable references never
 *  appear in a ground call, so the float check is the only one needed in P1. */
export function keyWellFormed(a: Atom): boolean {
  if (a.kind === "gnd") return a.value.g !== "float";
  if (a.kind === "expr") return a.items.every(keyWellFormed);
  return true;
}

/** One memoized answer set for a "moded" (non-ground) tabled call: a pure functor applied to arguments
 *  that themselves carry free variables (a backward-chaining search's own output/existential variables,
 *  e.g. the proof term `$x` in `(obc $s (: $x $a))` — `$s` is ground, but `$x` and possibly `$a` are not,
 *  so `tableKey`'s plain ground-printed-form key does not apply).
 *
 *  The cache key is the call's alpha-canonical form (`canonicalize` from `./alpha`: every free variable
 *  renamed to `%N` in first-occurrence order), so two calls that are the same up to which concrete
 *  variable names they happen to use hit the same entry. `results` is stored the same way, continuing the
 *  SAME canonicalization map past the call's own variables: `%0..%(numCallVars-1)` are the call's own free
 *  variables (in canonical order), and any `%N` for `N >= numCallVars` is a variable the computation
 *  introduced along the way (an auxiliary metavariable from a nested rule application) that never
 *  appeared in the call itself.
 *
 *  Replaying a hit substitutes `%0..%(numCallVars-1)` with the NEW call's own actual variable names (found
 *  the same way, by canonicalizing it), and substitutes every `%N` for `N >= numCallVars` with a
 *  brand-new, globally-fresh variable — never reusing a name from the run that populated the cache, so two
 *  call sites replaying the same template never alias each other's auxiliary variables. */
export interface ModedTableEntry {
  readonly numCallVars: number;
  readonly results: readonly Atom[];
}
