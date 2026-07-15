// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Completions for the node-creation input: a fuzzy symbol finder. Candidates are the symbols already in
// the space (every function you have defined and every symbol you have used) plus a curated stdlib list,
// ranked exact, then prefix, then substring, then subsequence.

import { SymbolAtom, type MeTTa } from "@metta-ts/hyperon";

/** Common MeTTa special forms and grounded operations, always offered. */
const STDLIB = [
  "if",
  "case",
  "let",
  "let*",
  "match",
  "superpose",
  "collapse",
  "empty",
  "unify",
  "quote",
  "sealed",
  "car-atom",
  "cdr-atom",
  "cons-atom",
  "decons-atom",
  "get-type",
  "get-metatype",
  "assertEqual",
  "assertAlphaEqual",
  "add-atom",
  "remove-atom",
  "bind!",
  "new-space",
  "&self",
  "+",
  "-",
  "*",
  "/",
  "%",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "and",
  "or",
  "not",
];

/** Every symbol name that appears anywhere in the space's atoms. */
function spaceSymbols(metta: MeTTa): Set<string> {
  const names = new Set<string>();
  for (const atom of metta.space().getAtoms())
    for (const descendant of atom.iterate())
      if (descendant instanceof SymbolAtom) names.add(descendant.name());
  return names;
}

/** Is `q` a subsequence of `name` (fuzzy match)? */
function isSubsequence(q: string, name: string): boolean {
  let i = 0;
  for (const ch of name) if (i < q.length && ch === q[i]) i++;
  return i === q.length;
}

/** Score `name` against a lowercased query: exact 100, prefix 80, substring 50, subsequence 20, else 0. */
function matchScore(name: string, q: string): number {
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 50;
  return isSubsequence(q, name) ? 20 : 0;
}

/** Ranked completion candidates for `prefix`, drawn from the space and the stdlib. Empty prefix yields
 *  nothing. Ties break toward shorter, then alphabetical, names. */
export function completionsFor(prefix: string, metta: MeTTa, limit = 9): string[] {
  const q = prefix.toLowerCase();
  if (q === "") return [];
  const pool = new Set<string>(STDLIB);
  for (const s of spaceSymbols(metta)) pool.add(s);
  return [...pool]
    .map((name) => ({ name, score: matchScore(name.toLowerCase(), q) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((x) => x.name);
}
