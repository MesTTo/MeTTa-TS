// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { alphaEq } from "./alpha";
import { type Atom, atomEq, hashOf } from "./atom";

/** Structural set with collision checks. Iterating input order and keeping the first atom gives stable dedup. */
export class ExactAtomSet {
  private readonly buckets = new Map<number, Atom | Atom[]>();

  add(atom: Atom): boolean {
    const hash = hashOf(atom);
    const bucket = this.buckets.get(hash);
    if (bucket === undefined) {
      this.buckets.set(hash, atom);
      return true;
    }
    if (!Array.isArray(bucket)) {
      if (atomEq(bucket, atom)) return false;
      this.buckets.set(hash, [bucket, atom]);
      return true;
    }
    if (bucket.some((candidate) => atomEq(candidate, atom))) return false;
    bucket.push(atom);
    return true;
  }
}

export function dedupExact(atoms: readonly Atom[]): Atom[] {
  const seen = new ExactAtomSet();
  const out: Atom[] = [];
  for (const atom of atoms) if (seen.add(atom)) out.push(atom);
  return out;
}

/** Alpha-equivalence only differs from structural equality for terms containing variables. */
export function dedupAlphaStable(atoms: readonly Atom[]): Atom[] {
  const exact = new ExactAtomSet();
  const nonGround: Atom[] = [];
  const out: Atom[] = [];
  for (const atom of atoms) {
    if (atom.ground) {
      if (exact.add(atom)) out.push(atom);
      continue;
    }
    if (nonGround.some((candidate) => alphaEq(candidate, atom))) continue;
    nonGround.push(atom);
    out.push(atom);
  }
  return out;
}
