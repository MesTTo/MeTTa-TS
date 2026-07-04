// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Applying a binding set as a substitution (LeaTTa `bindingsToSubst` / `instantiate`).
import {
  type Atom,
  type ExprAtom,
  type InternTable,
  canInternExprItems,
  expr,
  internBuiltExpr,
  variable,
} from "./atom";
import { type Bindings, lookupVal, isEmpty, valEntries } from "./bindings";
import { type Subst } from "./substitution";

/** A binding set viewed as a substitution: value bindings only; `eq` aliases are dropped. */
export function bindingsToSubst(b: Bindings): Subst {
  const out: Array<readonly [string, Atom]> = [];
  for (const e of valEntries(b)) out.push(e);
  return out;
}

/** Apply a binding set to an atom: replace each variable by its value binding (eq aliases dropped), one
 *  pass. Walks `b` directly via `lookupVal` instead of first materializing a `Subst` array on every call.
 *  that conversion was pure allocation on the hot substitution path (instantiate dominated the emit
 *  profile). A new term is built only where a child changed; the empty binding and closed subterms
 *  short-circuit to sharing. */
export function instantiate(b: Bindings, a: Atom, suffix = "", intern?: InternTable): Atom {
  // `suffix` scopes a rule RHS's variables: `$x` resolves as `name<suffix>`, and an unbound one becomes
  // the freshened variable `name<suffix>`. The result is byte-identical to first freshening the RHS, just without the
  // clone. The suffix-free path (the overwhelming majority) is unchanged.
  if (a.kind === "var") {
    if (suffix === "") return isEmpty(b) ? a : (lookupVal(b, a.name) ?? a);
    const name = a.name + suffix;
    return lookupVal(b, name) ?? variable(name);
  }
  if (a.ground || a.kind !== "expr") return a;
  if (isEmpty(b) && suffix === "") return a;
  // This same-call substitution is shared by object identity below (`memo`), so a term visited more than
  // once in this one substitution (a DAG, not a tree, since sharing below returns unchanged subtrees by
  // reference) is instantiated once and replayed, not re-walked once per incoming path.
  return instantiateExpr(b, a, suffix, intern, new Map());
}

/** Instantiate one child atom: the leaf cases (var/ground/non-expr) need no memo, so this stays a plain
 *  call for them and only enters the memoized expression path (`instantiateExpr`) when there's a subterm
 *  worth sharing across the current substitution. */
function instantiateChild(
  b: Bindings,
  a: Atom,
  suffix: string,
  intern: InternTable | undefined,
  memo: Map<Atom, Atom>,
): Atom {
  if (a.kind === "var") {
    if (suffix === "") return isEmpty(b) ? a : (lookupVal(b, a.name) ?? a);
    const name = a.name + suffix;
    return lookupVal(b, name) ?? variable(name);
  }
  if (a.ground || a.kind !== "expr") return a;
  return instantiateExpr(b, a, suffix, intern, memo);
}

/** The recursive, memoized half of `instantiate`. `memo` is fresh per top-level call (keyed by `b`/`suffix`
 *  being fixed for its whole duration), so caching a compound atom's substituted form by object identity is
 *  sound: the answer for a given shared node cannot change mid-substitution, only ever recomputed for free. */
function instantiateExpr(
  b: Bindings,
  a: ExprAtom,
  suffix: string,
  intern: InternTable | undefined,
  memo: Map<Atom, Atom>,
): Atom {
  const cached = memo.get(a);
  if (cached !== undefined) return cached;
  const its = a.items;
  let items: Atom[] | null = null;
  for (let i = 0; i < its.length; i++) {
    const it = its[i]!;
    const r = instantiateChild(b, it, suffix, intern, memo);
    if (items !== null) items.push(r);
    else if (r !== it) {
      items = its.slice(0, i);
      items.push(r);
    }
  }
  // Rebuild via `expr()` rather than `{ ...a, items }` so the `ground` flag is recomputed from the new
  // children. Spreading `a` copied the template's flag, which is wrong once a variable was replaced by a
  // ground value (e.g. `(S $x)` with `$x := (S Z)` becomes the ground `(S (S Z))` but kept ground=false).
  // A stale non-ground flag makes such a term miss the evaluated-mark cache and churn through re-evaluation.
  const result =
    items === null
      ? a
      : intern === undefined || !canInternExprItems(items)
        ? expr(items)
        : internBuiltExpr(intern, expr(items));
  memo.set(a, result);
  return result;
}
