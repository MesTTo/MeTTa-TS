// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The substitution, made visible. A rewrite `before -> after` fires a rule `(= lhs rhs)`: `lhs` matches the
// redex, binding the rule's variables to its arguments, and `rhs` is instantiated with those bindings. We
// reconstruct `rhs` with the rule's own variables kept, insert it as an extra state, and let the play fill
// each slot in on the next step, the "silhouette" of a variable forming into the value it matched.
//
// The rule body is recovered from the space, not guessed from the diff: matching the redex's shape as a
// pattern returns the body with its variables, so a bound value shows as a hollow slot while genuine body
// literals (a base case, a decrement) stay literal. This is a display-only refinement; the engine-facing
// trace from reduceTrace stays a pure, one-rewrite-per-step sequence.

import { E, S, V, ExpressionAtom, VariableAtom, type Atom, type MeTTa } from "@metta-ts/hyperon";

/** Insert, after each linear rewrite `before -> after` that instantiates a rule body, the body with its
 *  bound values shown as hollow variables, so the next step fills them in. Grounded steps that bind nothing
 *  and nondeterministic (wide) frontiers are passed through unchanged. */
export function withSilhouettes(frontiers: Atom[][], metta: MeTTa): Atom[][] {
  const out: Atom[][] = [];
  for (let i = 0; i < frontiers.length; i++) {
    out.push(frontiers[i]!);
    const cur = frontiers[i]!;
    const next = frontiers[i + 1];
    if (next !== undefined && cur.length === 1 && next.length === 1) {
      const body = skeletonize(cur[0]!, next[0]!, metta);
      if (body !== null) out.push([body]);
    }
  }
  return out;
}

/** The rule body behind a rewrite `before -> after`: descend to the one subterm that changed (the redex),
 *  then show its reduct with the rule's variables kept as hollow slots. Null when the step is not a user-rule
 *  instantiation (a grounded op, an identity, a branch pick), leaving the trace as it was. */
export function skeletonize(before: Atom, after: Atom, metta: MeTTa): Atom | null {
  if (before instanceof ExpressionAtom && after instanceof ExpressionAtom) {
    const b = before.children();
    const a = after.children();
    if (b.length === a.length) {
      const diff: number[] = [];
      for (let i = 0; i < a.length; i++) if (b[i]!.toString() !== a[i]!.toString()) diff.push(i);
      if (diff.length === 1) {
        const i = diff[0]!;
        const sub = skeletonize(b[i]!, a[i]!, metta);
        if (sub === null) return null;
        const next = [...a];
        next[i] = sub;
        return E(...next);
      }
    }
  }
  return ruleBody(before, after, metta);
}

/** The rule body that rewrote `redex` to `reduct`, with the rule's variables kept. Found by matching the
 *  redex's shape `(head $v0 $v1 ...)` in the space and picking the body that fits `reduct`. Null when the
 *  head is not a user rule, or the matching body carries no variable (a constant rule, an identity). */
function ruleBody(redex: Atom, reduct: Atom, metta: MeTTa): Atom | null {
  if (!(redex instanceof ExpressionAtom)) return null;
  const kids = redex.children();
  if (kids.length < 2) return null;
  const pattern = E(kids[0]!, ...kids.slice(1).map((_, i) => V("v" + String(i))));
  const bodies = metta.evaluateAtom(
    E(S("match"), S("&self"), E(S("="), pattern, V("body")), V("body")),
  );
  for (const cand of bodies)
    if (cand instanceof ExpressionAtom && hasVar(cand) && fits(cand, reduct))
      return cleanVars(cand);
  return null;
}

/** Whether a rule body `pattern` fits the ground `reduct`: its variables match anything, everything else
 *  matches structurally. One-directional, since `reduct` is fully evaluated (ground) at this position. */
function fits(pattern: Atom, ground: Atom): boolean {
  if (pattern instanceof VariableAtom) return true;
  if (pattern instanceof ExpressionAtom && ground instanceof ExpressionAtom) {
    const p = pattern.children();
    const g = ground.children();
    return p.length === g.length && p.every((c, i) => fits(c, g[i]!));
  }
  return pattern.toString() === ground.toString();
}

function hasVar(atom: Atom): boolean {
  if (atom instanceof VariableAtom) return true;
  if (atom instanceof ExpressionAtom) return atom.children().some(hasVar);
  return false;
}

/** Rename the rule's variables to their source names ($n#62 -> $n), so a slot reads as the variable it is. */
function cleanVars(atom: Atom): Atom {
  if (atom instanceof VariableAtom) return V(atom.name().replace(/#\d+$/, ""));
  if (atom instanceof ExpressionAtom) return E(...atom.children().map(cleanVars));
  return atom;
}
