// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A step-by-step reduction trace for the playthrough. Each step is one real reduction on the engine: the
// minimal-MeTTa `(eval X)` performs a single outer rewrite (a rule application with its substitution, or a
// grounded op), and returns `(eval X)` unchanged when X cannot reduce. We walk the expression
// leftmost-innermost, reducing eager arguments before the whole, and skip the arguments a head declares as
// `Atom` (which MeTTa does not evaluate, e.g. the branches of `if`), so branches are never forced.
//
// A step can be nondeterministic: `(eval X)` returns more than one result (e.g. two rules match). We keep
// every result, so a state is a "frontier", the set of terms currently reducing, and a nondeterministic
// step widens it: `[(coin)]` becomes `[Heads, Tails]`. Every branch comes straight from the engine's own
// result list, so nothing is injected into the program (no `collapse` wrapper) and the engine is untouched.
// A deterministic trace stays one term wide, exactly as a linear trace.

import { E, S, ExpressionAtom, type Atom, type MeTTa } from "@mettascript/hyperon";

type LazyCache = Map<string, Set<number>>;

const MAX_WIDTH = 24; // cap the frontier so a combinatorial fan-out stays legible

/** The argument positions a head takes unevaluated: those its `(-> ...)` type declares as `Atom` or
 *  `Expression`. Both are the "structural, not pre-evaluated" markers a control form uses, so `case` keeps
 *  its branch list and `let*` its bindings whole; reducing the head then steps the whole form through the
 *  engine, the way it evaluates it, instead of descending into a branch that will not be taken (which for a
 *  recursive rule like `zip` never terminates). */
function lazyPositions(head: Atom, metta: MeTTa, cache: LazyCache): Set<number> {
  const key = head.toString();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const out = new Set<number>();
  const types = metta.evaluateAtom(E(S("get-type"), head));
  const type = types[0];
  if (type instanceof ExpressionAtom) {
    const items = type.children();
    // (-> T1 T2 ... Tn R): argument at expression position i has type items[i]; R is the last item.
    if (items[0]?.toString() === "->")
      for (let i = 1; i < items.length - 1; i++) {
        const t = items[i]!.toString();
        if (t === "Atom" || t === "Expression") out.add(i);
      }
  }
  cache.set(key, out);
  return out;
}

/** One outer reduction of `atom`, returning every successor (more than one when the step is
 *  nondeterministic), or null when it does not reduce. The engine's `(eval X)` already yields all branches
 *  in its result list, so we just read them; a result equal to `atom` or the unchanged `(eval atom)` marker
 *  means that branch did not step and is dropped. */
function stepAll(atom: Atom, metta: MeTTa): Atom[] | null {
  const results = metta.evaluateAtom(E(S("eval"), atom));
  const src = atom.toString();
  const out: Atom[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r instanceof ExpressionAtom) {
      const items = r.children();
      if (items.length === 2 && items[0]!.toString() === "eval" && items[1]!.toString() === src)
        continue;
    }
    const s = r.toString();
    if (s === src || seen.has(s)) continue; // no self-loops, no duplicate branches
    seen.add(s);
    out.push(r);
  }
  return out.length === 0 ? null : out;
}

/** One reduction step of the whole expression: reduce the leftmost eager argument that can reduce (fanning
 *  out if that argument is nondeterministic), else reduce the whole atom. Returns every successor, or null
 *  at a normal form. */
export function reduceStep(atom: Atom, metta: MeTTa, cache: LazyCache = new Map()): Atom[] | null {
  if (atom instanceof ExpressionAtom) {
    const items = atom.children();
    const head = items[0];
    const lazy = head !== undefined ? lazyPositions(head, metta, cache) : new Set<number>();
    for (let i = 1; i < items.length; i++) {
      if (lazy.has(i)) continue;
      const reduced = reduceStep(items[i]!, metta, cache);
      if (reduced !== null)
        return reduced.map((r) => {
          const next = [...items];
          next[i] = r;
          return E(...next);
        });
    }
  }
  return stepAll(atom, metta);
}

/** Whether two frontiers hold the same set of terms, order aside. */
function sameSet(a: readonly Atom[], b: readonly Atom[]): boolean {
  if (a.length !== b.length) return false;
  const as = a.map(String).sort();
  const bs = b.map(String).sort();
  return as.every((s, i) => s === bs[i]);
}

/** The full sequence of frontiers from `atom` to its normal form(s). The first frontier is `[atom]`; each
 *  next frontier reduces every still-reducing term one step, so nondeterministic branches all advance
 *  together and every result is shown. Capped at `maxSteps` deep and {@link MAX_WIDTH} wide. */
export function reduceTrace(atom: Atom, metta: MeTTa, maxSteps = 300): Atom[][] {
  const cache: LazyCache = new Map();
  const frontiers: Atom[][] = [[atom]];
  let frontier: Atom[] = [atom];
  let settled = false;
  for (let i = 0; i < maxSteps; i++) {
    const next: Atom[] = [];
    const seen = new Set<string>();
    let changed = false;
    for (const term of frontier) {
      const step = reduceStep(term, metta, cache);
      if (step !== null) changed = true;
      for (const s of step ?? [term]) {
        const key = s.toString();
        if (!seen.has(key)) {
          seen.add(key);
          next.push(s);
        }
      }
    }
    if (!changed) {
      settled = true;
      break;
    }
    frontier = next.length > MAX_WIDTH ? next.slice(0, MAX_WIDTH) : next;
    frontiers.push(frontier);
  }

  // Reconcile the endpoint with the engine so a playthrough finishes where Run does. A single (eval) step
  // cannot advance some terminating queries that full evaluation can, for example an expression whose head
  // must reduce while a variable binds across the whole term ((brother $x) is-brother-of $x): the trace
  // stalls with nothing rewritten. When the step-by-step has settled short of the engine's own result,
  // append that result as the final frontier. Only when it settled: a run that reached the step cap is a
  // nonterminating reduction, and full evaluation would not return either.
  if (settled) {
    const result = metta.evaluateAtom(atom);
    if (result.length > 0 && !sameSet(frontier, result))
      frontiers.push(result.length > MAX_WIDTH ? result.slice(0, MAX_WIDTH) : result);
  }
  return frontiers;
}
