// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Test-only helpers shared by the fuzz tests: a deterministic PRNG (so failures reproduce, and to avoid
// Math.random) and a random MeTTa atom generator. Not part of the shipped bundle; index.ts does not
// export it.

import { S, V, E, ValueAtom, type Atom } from "@mettascript/hyperon";

/** A seeded linear-congruential PRNG returning values in [0, 1). */
export function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** A random atom up to `depth` deep: symbols, variables, grounded integers, and nested expressions (1 to
 *  3 children). Every leaf kind round-trips through the bridge, which is what the fuzz tests assert. */
export function randomAtom(rnd: () => number, depth: number): Atom {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  if (depth <= 0 || rnd() < 0.5) {
    const r = rnd();
    if (r < 0.4) return S(pick(["foo", "bar", "+", "map", "Cons", "if"] as const));
    if (r < 0.7) return V(pick(["x", "y", "z"] as const));
    return ValueAtom(Math.floor(rnd() * 100));
  }
  return E(...Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => randomAtom(rnd, depth - 1)));
}
