// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Evaluate a head on the real engine. Composing the head's atom and running it is the whole point of the
// canvas: you build a program visually, evaluate it, and read the result beneath the node. The async form
// awaits any async grounded operations reached during evaluation.

import { MeTTa, atomIsError, type Atom } from "@mettascript/hyperon";
import type { Graph } from "./model";
import { composeAtom, graphToAtoms } from "./atom";

/** Load the whole graph into a space so its own rules and facts are active when a head is evaluated. Adds
 *  every head atom to `metta`'s space and returns it; a fresh engine is created when none is given. This is
 *  what makes evaluating a query like `(fact 5)` reduce through a `(= (fact $n) ...)` rule drawn on the
 *  same canvas. */
export function loadProgram(graph: Graph, metta: MeTTa = new MeTTa()): MeTTa {
  const space = metta.space();
  for (const atom of graphToAtoms(graph)) space.addAtom(atom);
  return metta;
}

/** The outcome of evaluating a head: the result atoms, a short label for display, and whether any result
 *  is an error (or evaluation threw). */
export interface EvalResult {
  atoms: Atom[];
  label: string;
  error: boolean;
}

const MAX_LABEL = 80;

/** Nothing to show (an empty or dropped head). A fresh object each call, never shared. */
function nothing(): EvalResult {
  return { atoms: [], label: "", error: false };
}

/** Turn result atoms into a display result, truncating a long label. */
function summarize(results: Atom[]): EvalResult {
  const text = results.map(String).join(", ");
  const label = text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
  return { atoms: results, label, error: results.some(atomIsError) };
}

/** Evaluate the head at `headId`, catching a thrown error as a failed result. */
export function evaluateHead(graph: Graph, headId: string, metta: MeTTa): EvalResult {
  const atom = composeAtom(graph, headId);
  if (atom === null) return nothing();
  try {
    return summarize(metta.evaluateAtom(atom));
  } catch (e) {
    return { atoms: [], label: String(e), error: true };
  }
}

/** Like {@link evaluateHead}, awaiting async grounded operations reached during evaluation. */
export async function evaluateHeadAsync(
  graph: Graph,
  headId: string,
  metta: MeTTa,
): Promise<EvalResult> {
  const atom = composeAtom(graph, headId);
  if (atom === null) return nothing();
  try {
    return summarize(await metta.evaluateAtomAsync(atom));
  } catch (e) {
    return { atoms: [], label: String(e), error: true };
  }
}
