// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Alpha-equivalence (LeaTTa `Core/Alpha.lean`): two atoms are alpha-equal when canonicalising
// their variables to first-occurrence order makes them structurally equal.
import { type Atom, type ExprAtom, variable, expr, atomEq } from "./atom";

/** Rename every variable in `a` to `%N`, N assigned in first-occurrence order per `map` (shared across a
 *  whole `canonicalize` call so repeat occurrences of the same variable get the same placeholder). Exported
 *  for tabling's moded (non-ground) cache keys: two calls that are the same up to which concrete variable
 *  names they happen to use canonicalize to the same atom, and `map`'s insertion order (`[...map.keys()]`)
 *  recovers which original name became which `%N`, needed to freshen a cached answer back to a new call's
 *  actual names. `memo` is a per-call cache (fresh map, so per-call use only): within one canonicalize
 *  call, a variable already in `map` always renames the same way, so a shared expr node (instantiate
 *  shares unchanged subterms by reference) needs walking only once, not once per incoming path — the same
 *  DAG-vs-tree reasoning as instantiate/occursThrough/atomEq elsewhere in this package. */
export function canonicalize(a: Atom, map: Map<string, string>, memo?: Map<Atom, Atom>): Atom {
  if (a.ground) return a;
  switch (a.kind) {
    case "var": {
      let c = map.get(a.name);
      if (c === undefined) {
        c = "%" + String(map.size);
        map.set(a.name, c);
      }
      return variable(c);
    }
    case "expr": {
      if (memo === undefined) return canonicalizeExpr(a, map, new Map());
      return canonicalizeExpr(a, map, memo);
    }
    default:
      return a;
  }
}

function canonicalizeExpr(a: ExprAtom, map: Map<string, string>, memo: Map<Atom, Atom>): Atom {
  const cached = memo.get(a);
  if (cached !== undefined) return cached;
  const its = a.items;
  let items: Atom[] | null = null;
  for (let i = 0; i < its.length; i++) {
    const it = its[i]!;
    const r = canonicalize(it, map, memo);
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

export function alphaEq(a: Atom, b: Atom): boolean {
  return atomEq(canonicalize(a, new Map()), canonicalize(b, new Map()));
}
