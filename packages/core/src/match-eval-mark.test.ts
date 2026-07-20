// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Differential gate for experimental.matchEvalMark. A single-pattern match whose pattern, template, and
// candidates are already in normal form yields inert data; pre-marking ground expression results should be
// byte-identical to letting the evaluator reduce each result to itself and cache it afterward.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { format } from "./parser";
import { runProgram } from "./runner";

function formats(src: string, matchEvalMark: boolean): string[] {
  return runProgram(src, 1_000_000, new Map(), { experimental: { matchEvalMark } }).flatMap((r) =>
    r.results.map(format),
  );
}

function sameBothWays(src: string): void {
  expect(formats(src, true)).toEqual(formats(src, false));
}

const EDGES = [
  "(edge 1 10 20 0)",
  "(edge 2 12 30 1)",
  "(edge 3 14 20 2)",
  "(edge 4 15 40 0)",
  "(edge 5 16 50 1)",
  "(edge 6 18 40 0)",
  "(edge 7 20 60 2)",
  "(edge 8 22 10 1)",
  "(edge 9 24 70 1)",
].join("\n");

function groupLookup(template: string): string {
  return `!(match &self (edge $e $from $to 1) ${template})`;
}

describe("experimental.matchEvalMark keeps single-pattern match output byte-identical", () => {
  it("inert ground template over a ground KB preserves source-order results", () => {
    const src = `${EDGES}\n${groupLookup("(Row $e $from $to)")}`;
    const expected = ["(Row 2 12 30)", "(Row 5 16 50)", "(Row 8 22 10)", "(Row 9 24 70)"];
    expect(formats(src, true)).toEqual(expected);
    expect(formats(src, true)).toEqual(formats(src, false));
  });

  it("inert match followed by a gensym-revealing query keeps the counter in step", () => {
    const src = `${EDGES}
(= (gen) (pair $u $u))
${groupLookup("(Row $e $from $to)")}
!(gen)`;
    sameBothWays(src);
  });

  it("reducible template stays byte-identical", () => {
    const src = `${EDGES}
(= (f $x) $x)
${groupLookup("(f $e)")}`;
    sameBothWays(src);
  });

  it("non-ground result template stays byte-identical", () => {
    const src = `${EDGES}\n${groupLookup("(Row $e $missing)")}`;
    sameBothWays(src);
  });
});

describe("experimental.matchEvalMark random inert single-pattern differential (fast-check)", () => {
  const intText = fc.integer({ min: -200, max: 200 }).map(String);
  const groupText = fc.integer({ min: 0, max: 6 });

  it("unique-entity group lookups followed by gensym stay byte-identical", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(intText, intText, groupText), { minLength: 1, maxLength: 90 }),
        groupText,
        (rows, selectedGroup) => {
          const facts = rows
            .map(([from, to, group], index) => `(edge ${index + 1} ${from} ${to} ${group})`)
            .join("\n");
          const src = `${facts}
(= (gen) (pair $u $u))
!(match &self (edge $e $from $to ${selectedGroup}) (Row $e $from $to))
!(gen)`;
          expect(formats(src, true)).toEqual(formats(src, false));
        },
      ),
      { numRuns: 500 },
    );
  });
});
