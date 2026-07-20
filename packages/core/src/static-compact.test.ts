// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Differential gate for the compact static fact storage (eval.ts compactStaticFacts). buildEnv with
// staticCompact on must be byte-identical (same atoms, same order, same trailing gensym counter) to the
// plain object environment for every query surface: full-bucket and bound-argument matches over every
// column kind, conjunctions (routed and WCO), range templates, get-atoms enumeration, runtime adds,
// static removals, de-compaction on a later static add, and property fuzzing. The threshold drops to 1
// here so every eligible functor compacts.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { type Atom } from "./atom";
import { StaticCompactBase } from "./static-base";
import {
  addAtomToEnv,
  buildEnv,
  initSt,
  mettaEval,
  setStaticCompactThresholdForTests,
  type MinEnv,
} from "./eval";
import { format, parseAll } from "./parser";
import { pettaStdlibAtoms } from "./petta-stdlib";
import { preludeAtoms, runProgram, standardTokenizer } from "./runner";
import { stdTable } from "./builtins";
import { stdlibAtoms } from "./stdlib";

let prevThreshold = 64;
beforeAll(() => {
  prevThreshold = setStaticCompactThresholdForTests(1);
});
afterAll(() => {
  setStaticCompactThresholdForTests(prevThreshold);
});

function parseAtoms(src: string): Atom[] {
  return parseAll(src, standardTokenizer()).map((t) => t.atom);
}

function envFor(kbSrc: string, staticCompact: boolean): MinEnv {
  return buildEnv(
    [...preludeAtoms(), ...stdlibAtoms(), ...pettaStdlibAtoms(), ...parseAtoms(kbSrc)],
    stdTable(),
    staticCompact,
  );
}

// Evaluate the queries in order against one env (world effects thread forward), returning every
// result's format. The trailing counter sensitivity is covered by ending query lists with a
// gensym-revealing call where it matters.
function answers(env: MinEnv, queries: readonly string[]): string[] {
  const out: string[] = [];
  let st = initSt();
  for (const q of queries) {
    const query = parseAtoms(q)[0]!;
    const [pairs, next] = mettaEval(env, 100_000_000, st, [], query);
    st = next;
    for (const [atom] of pairs) out.push(format(atom));
  }
  return out;
}

function sameBothWays(kbSrc: string, queries: readonly string[]): void {
  const on = answers(envFor(kbSrc, true), queries);
  const off = answers(envFor(kbSrc, false), queries);
  expect(on).toEqual(off);
}

const KB = [
  "(edge 1 10 20 0)",
  "(edge 2 10 30 1)",
  "(edge 3 12.5 20 2)",
  "(edge 4 20 40 0)",
  "(edge 5 -4 50 1)",
  "(edge 6 30 40 0)",
  "(edge 7 30 20 2)",
  "(edge 8 40 10 1)",
  '(named a "left" red True)',
  '(named b "right" blue False)',
  '(named c "left" red True)',
  "(tiny 1 2)",
].join("\n");

const GENSYM = "(= (gen) (pair $u $u))";

describe("static compact storage is byte-identical to the object environment", () => {
  it("full-bucket all-variable match, in order, plus trailing gensym", () => {
    sameBothWays(`${KB}\n${GENSYM}`, [
      "(match &self (edge $e $f $t $g) (Row $e $f $t $g))",
      "(gen)",
    ]);
  });

  it("bound numeric argument (int and float keys share a bucket)", () => {
    sameBothWays(KB, [
      "(match &self (edge $e 10 $t $g) (Row $e $t))",
      "(match &self (edge $e 12.5 $t $g) (Row $e $t))",
      "(match &self (edge $e -4 $t $g) (Row $e $t))",
      "(match &self (edge $e 99 $t $g) (Row $e $t))",
    ]);
  });

  it("bound symbol, string, and boolean columns", () => {
    sameBothWays(KB, [
      "(match &self (named $n $s red $b) (Row $n $s))",
      '(match &self (named $n "left" $c $b) (Row $n $c))',
      "(match &self (named $n $s $c True) (Row $n $s $c))",
    ]);
  });

  it("ground membership pattern (exact fact present and absent)", () => {
    sameBothWays(KB, ["(match &self (edge 4 20 40 0) hit)", "(match &self (edge 4 20 40 9) hit)"]);
  });

  it("get-atoms enumerates in the same order", () => {
    sameBothWays(KB, ["(get-atoms &self)"]);
  });

  it("anchored two-hop conjunction (conjNested routing) and cyclic triangle (WCO)", () => {
    sameBothWays(`${KB}\n${GENSYM}`, [
      "(match &self (, (edge $e1 10 $mid $g1) (edge $e2 $mid $to $g2)) (Row $e1 $e2 $to))",
      "(match &self (, (edge $e1 $x $y $g1) (edge $e2 $y $z $g2) (edge $e3 $z $x $g3)) (Tri $x $y $z))",
      "(gen)",
    ]);
  });

  it("a duplicate fact keeps the conjunction on the WCO join", () => {
    const dupKb = `${KB}\n(edge 1 10 20 0)`; // exact duplicate
    sameBothWays(dupKb, [
      "(match &self (, (edge $e1 10 $mid $g1) (edge $e2 $mid $to $g2)) (Row $e1 $e2 $to))",
    ]);
  });

  it("range template over the compact numeric column, with trailing gensym", () => {
    sameBothWays(`${KB}\n${GENSYM}`, [
      "(match &self (edge $e $f $t $g) (if (>= $f 10) (if (< $f 30) (Row $e $f) (empty)) (empty)))",
      "(gen)",
    ]);
  });

  it("range template over a non-numeric column declines identically", () => {
    sameBothWays(`${KB}\n${GENSYM}`, [
      "(match &self (named $n $s $c $b) (if (>= $s 0) (Row $n) (empty)))",
      "(gen)",
    ]);
  });

  it("mixed-arity functor declines the range path but stays identical", () => {
    const mixed = `${KB}\n(edge 9 50)`; // arity-3 edge alongside arity-5
    sameBothWays(`${mixed}\n${GENSYM}`, [
      "(match &self (edge $e $f $t $g) (if (>= $f 10) (if (< $f 30) (Row $e $f) (empty)) (empty)))",
      "(match &self (edge $e $f) (Short $e $f))",
      "(gen)",
    ]);
  });

  it("a rule whose head is the compacted functor keeps results identical", () => {
    // The rule makes a stored fact reducible, so results are not normal form; both modes must agree.
    const ruled = `${KB}\n(= (edge 1 10 20 0) boom)`;
    sameBothWays(ruled, ["(match &self (edge $e 10 $t $g) (Row $e $t))"]);
  });

  it("a rule on a leaf symbol keeps results identical", () => {
    const ruled = `${KB}\n(= red crimson)`;
    sameBothWays(ruled, ["(match &self (named $n $s $c $b) (Row $n $c))"]);
  });

  it("runtime add-atom appends after the compact static facts", () => {
    sameBothWays(KB, [
      "(add-atom &self (edge 9 10 70 3))",
      "(match &self (edge $e 10 $t $g) (Row $e $t))",
      "(match &self (edge $e $f $t $g) (Row $e))",
    ]);
  });

  it("remove-atom of a compacted fact filters it from every later match", () => {
    sameBothWays(KB, [
      "(remove-atom &self (edge 2 10 30 1))",
      "(match &self (edge $e 10 $t $g) (Row $e $t))",
      "(match &self (edge $e $f $t $g) (Row $e))",
    ]);
  });

  it("a nested-argument pattern over the flat compact functor matches nothing, identically", () => {
    sameBothWays(`${KB}\n${GENSYM}`, ["(match &self (edge $e (g 1) $t $g) (Row $e))", "(gen)"]);
  });

  it("a variable-headed fact joins the candidates of a compact functor", () => {
    const withVarHead = `${KB}\n($f 77 78 79 80)`;
    sameBothWays(withVarHead, ["(match &self (edge $e $a $b $c) (Row $e $a))"]);
  });

  it("a static add after compaction de-compacts the functor and stays identical", () => {
    const queries = [
      "(match &self (edge $e 10 $t $g) (Row $e $t))",
      "(match &self (edge $e $f $t $g) (Row $e))",
      "(match &self (edge 9 $f $t $g) (Row $f $t $g))",
    ];
    const build = (staticCompact: boolean): MinEnv => {
      const env = envFor(KB, staticCompact);
      addAtomToEnv(env, parseAtoms("(edge 9 10 70 3)")[0]!);
      return env;
    };
    expect(answers(build(true), queries)).toEqual(answers(build(false), queries));
  });

  it("the runProgram surface stays byte-identical with the sweep available", () => {
    const src = `${KB}\n!(match &self (edge $e 10 $t $g) (Row $e $t))\n!(match &self (edge $e $f $t $g) (Row $e))`;
    const run = (staticCompact: boolean): string[] =>
      runProgram(src, 1_000_000, new Map(), { experimental: { staticCompact } }).flatMap((r) =>
        r.results.map(format),
      );
    expect(run(true)).toEqual(run(false));
  });
});

describe("static compact storage random differential (fast-check)", () => {
  const num = fc.oneof(
    fc.integer({ min: -20, max: 20 }).map(String),
    fc.integer({ min: -20, max: 20 }).map((n) => `${n}.5`),
  );
  const symArg = fc.constantFrom("a", "b", "c", "red", "blue");
  const arg = fc.oneof(num, symArg);

  it("random flat KBs and probes: on == off, in order, counter included", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arg, arg, arg), { minLength: 1, maxLength: 40 }),
        fc.array(
          fc.oneof(
            arg.map((a) => ({ kind: "bound", value: a })),
            fc.constant({ kind: "all" as const, value: "" }),
          ),
          {
            minLength: 1,
            maxLength: 4,
          },
        ),
        (rows, probes) => {
          // Unique entities keep the conjunction routable; duplicates still appear through repeated arg values.
          const kb = rows.map(([x, y, z], i) => `(rel ${i + 1} ${x} ${y} ${z})`).join("\n");
          const queries = probes.map((p) =>
            p.kind === "bound"
              ? `(match &self (rel $e ${p.value} $b $c) (Row $e $b $c))`
              : "(match &self (rel $e $a $b $c) (Row $e))",
          );
          queries.push("(gen)");
          const src = `${kb}\n${GENSYM}`;
          expect(answers(envFor(src, true), queries)).toEqual(answers(envFor(src, false), queries));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("compaction sweep bail-out", () => {
  // buildEnv plans the compactable heads up front and skips their argIndex postings while adding
  // atoms. If the sweep then declines (encode bail, slot parity mismatch), those heads must get
  // their postings rebuilt: matchCandidates reads an absent posting list as zero candidates, so a
  // bound-argument query on a planned-but-uncompacted head would silently return nothing.
  it("rebuilds skipped argIndex postings when the sweep declines", () => {
    const spy = vi.spyOn(StaticCompactBase, "fromAtoms").mockReturnValue(undefined);
    try {
      const kb = "(edge A B)\n(edge A C)\n(edge B D)";
      const on = envFor(kb, true);
      expect(on.staticBase).toBeUndefined(); // the mock forced the sweep to decline
      const queries = ["!(match &self (edge A $x) $x)", "!(match &self (edge $x D) $x)"];
      expect(answers(on, queries)).toEqual(answers(envFor(kb, false), queries));
      expect(answers(on, ["!(match &self (edge A $x) $x)"])).toEqual(["B", "C"]);
    } finally {
      spy.mockRestore();
    }
  });
});
