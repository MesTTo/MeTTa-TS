// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Addressing a subterm by a path of child indices, so a click on a block can reduce exactly the term it
// sits on. A path is the list of `children()` indices from an atom down to the subterm. `reduceAtPath`
// takes one engine reduction of the addressed subterm and splices the result back into the whole atom, so
// clicking a redex rewrites it in place.

import { E, ExpressionAtom, type Atom, type MeTTa } from "@metta-ts/hyperon";
import { reduceStep } from "../reduce";

/** The subterm at `path`, or null if the path leaves the tree. */
export function atomAtPath(atom: Atom, path: readonly number[]): Atom | null {
  let cur: Atom = atom;
  for (const k of path) {
    if (!(cur instanceof ExpressionAtom)) return null;
    const child = cur.children()[k];
    if (child === undefined) return null;
    cur = child;
  }
  return cur;
}

/** A copy of `atom` with the subterm at `path` replaced. An empty path replaces the whole atom. Returns
 *  the atom unchanged if the path leaves the tree. */
export function replaceAtPath(atom: Atom, path: readonly number[], replacement: Atom): Atom {
  if (path.length === 0) return replacement;
  if (!(atom instanceof ExpressionAtom)) return atom;
  const items = atom.children();
  const [k, ...rest] = path;
  const child = items[k!];
  if (child === undefined) return atom;
  const next = [...items];
  next[k!] = replaceAtPath(child, rest, replacement);
  return E(...next);
}

/** Take one engine reduction of the subterm at `path` and splice it back, or null if that subterm is
 *  already in normal form (nothing to reduce). A nondeterministic step yields several results; an in-place
 *  reduction shows a single tree, so it takes the first branch (Play shows every branch in its frontier). */
export function reduceAtPath(atom: Atom, path: readonly number[], metta: MeTTa): Atom | null {
  const target = atomAtPath(atom, path);
  if (target === null) return null;
  const reduced = reduceStep(target, metta);
  if (reduced === null) return null;
  return replaceAtPath(atom, path, reduced[0]!);
}
