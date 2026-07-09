// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { alphaEq } from "./alpha";
import { type Atom, expr, gfloat, gint, sym, variable } from "./atom";
import { dedupAlphaStable, dedupExact } from "./atom-set";
import { format } from "./parser";

const atomArb: fc.Arbitrary<Atom> = fc.letrec<{ atom: Atom }>((tie) => ({
  atom: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom("a", "b", "c", "pair").map(sym),
    fc.constantFrom("x", "y", "z").map(variable),
    fc.integer({ min: -20, max: 20 }).map(gint),
    fc.integer({ min: -20, max: 20 }).map(gfloat),
    fc.array(tie("atom"), { maxLength: 4 }).map(expr),
  ),
})).atom;

function naiveAlphaDedup(atoms: readonly Atom[]): Atom[] {
  const out: Atom[] = [];
  for (const atom of atoms) if (!out.some((candidate) => alphaEq(candidate, atom))) out.push(atom);
  return out;
}

describe("stable atom sets", () => {
  it("matches a quadratic alpha-equivalence oracle over random atoms", () => {
    fc.assert(
      fc.property(fc.array(atomArb, { maxLength: 80 }), (atoms) => {
        const expected = naiveAlphaDedup(atoms).map(format);
        const actual = dedupAlphaStable(atoms).map(format);
        return JSON.stringify(actual) === JSON.stringify(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps the first alpha-equivalent variable pattern", () => {
    const first = expr([sym("pair"), variable("x"), variable("x")]);
    const renamed = expr([sym("pair"), variable("y"), variable("y")]);
    const distinct = expr([sym("pair"), variable("y"), variable("z")]);

    expect(dedupAlphaStable([first, renamed, distinct]).map(format)).toEqual([
      "(pair $x $x)",
      "(pair $y $z)",
    ]);
  });

  it("uses the evaluator's numeric equality for exact grounded atoms", () => {
    expect(dedupExact([gint(3), gfloat(3), gint(4)]).map(format)).toEqual(["3", "4"]);
  });
});
