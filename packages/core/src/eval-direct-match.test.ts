// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Differential gate for the direct top-level match fast path (eval.ts tryDirectTopMatch,
// `experimental.directMatch`). A public-entry bare `(match &self pat templ)` answered from its plan
// must be byte-identical to the general interpreter path in every observable: result atoms, their
// ORDER, their BINDINGS (relation-by-relation), the trailing gensym counter, and the evaluated-mark
// stamps. Covered surfaces: the raw buildEnv+mettaEval API (the benchmark path), runProgram with its
// default tabling env, every decline class (they must stay identical THROUGH the general path), and
// property fuzzing with a counter probe.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { type Atom } from "./atom";
import { type Bindings } from "./bindings";
import { buildEnv, initSt, mettaEval, type MinEnv } from "./eval";
import { format, parseAll } from "./parser";
import { pettaStdlibAtoms } from "./petta-stdlib";
import { preludeAtoms, runProgram, standardTokenizer } from "./runner";
import { stdTable } from "./builtins";
import { stdlibAtoms } from "./stdlib";

function parseAtoms(src: string): Atom[] {
  return parseAll(src, standardTokenizer()).map((t) => t.atom);
}

function envFor(kbSrc: string, useDirect: boolean): MinEnv {
  const env = buildEnv(
    [...preludeAtoms(), ...stdlibAtoms(), ...pettaStdlibAtoms(), ...parseAtoms(kbSrc)],
    stdTable(),
  );
  env.useDirectMatch = useDirect;
  return env;
}

function formatBindings(b: Bindings): string {
  return b.map((r) => (r.tag === "val" ? `${r.x}<-${format(r.a)}` : `${r.x}=${r.y}`)).join(",");
}

// Evaluate the queries in order against one env (state threads forward), capturing every result's
// atom AND bindings, plus the final counter. The counter is part of the identity: a fast path that
// freshens differently shifts every later gensym name.
function trace(env: MinEnv, queries: readonly string[]): string[] {
  const out: string[] = [];
  let st = initSt();
  for (const q of queries) {
    const query = parseAtoms(q)[0]!;
    const [pairs, next] = mettaEval(env, 100_000_000, st, [], query);
    st = next;
    for (const [atom, b] of pairs) out.push(`${format(atom)} | ${formatBindings(b)}`);
  }
  out.push(`counter=${st.counter}`);
  return out;
}

function sameBothWays(kbSrc: string, queries: readonly string[]): void {
  const on = trace(envFor(kbSrc, true), queries);
  const off = trace(envFor(kbSrc, false), queries);
  expect(on).toEqual(off);
}

const KB = [
  "(edge 1 10 20 0)",
  "(edge 2 10 30 1)",
  "(edge 3 12 20 2)",
  "(edge 4 20 40 0)",
  "(edge 5 20 50 1)",
  '(named a "left" red True)',
  '(named b "right" blue False)',
  "(tiny 1 2)",
].join("\n");

const GEN = "(= (gen) (pair $u $u))";

describe("direct top-level match is byte-identical to the general path", () => {
  it("entity-shaped lookup: one bound arg, ground template values", () => {
    sameBothWays(`${KB}\n${GEN}`, ["(match &self (edge 1 $f $t $g) (Row $f $t $g))", "(gen)"]);
  });

  it("multi-solution lookup keeps order and bindings", () => {
    sameBothWays(`${KB}\n${GEN}`, [
      "(match &self (edge $e 10 $t $g) (Row $e $t))",
      "(match &self (edge $e 20 $t $g) (Row $e $t))",
      "(gen)",
    ]);
  });

  it("all-variable full-bucket match", () => {
    sameBothWays(`${KB}\n${GEN}`, ["(match &self (edge $e $f $t $g) (Row $e))", "(gen)"]);
  });

  it("empty result set", () => {
    sameBothWays(`${KB}\n${GEN}`, ["(match &self (edge 999 $f $t $g) (Row $f))", "(gen)"]);
  });

  it("template that is the bare pattern variable", () => {
    sameBothWays(`${KB}\n${GEN}`, ["(match &self (edge $e 10 $t $g) $e)", "(gen)"]);
  });

  it("symbol, string, and boolean columns", () => {
    sameBothWays(`${KB}\n${GEN}`, [
      "(match &self (named $n $s red $b) (Row $n $s))",
      '(match &self (named $n "left" $c $b) (Row $n $c))',
      "(gen)",
    ]);
  });

  it("range template composes through tryRangeScan identically", () => {
    sameBothWays(`${KB}\n${GEN}`, [
      "(match &self (edge $e $f $t $g) (if (>= $f 10) (if (< $f 20) (Row $e $f) (empty)) (empty)))",
      "(gen)",
    ]);
  });

  it("declines: no query variables (ground pattern, ground template)", () => {
    sameBothWays(`${KB}\n${GEN}`, [
      "(match &self (edge 1 10 20 0) (found it))",
      "(match &self (edge 1 10 20 0) hit)",
      "(gen)",
    ]);
  });

  it("declines: reducible template (head with a rule) stays identical", () => {
    // (dbl $x) has a rule, so template values are not normal: the general path must reduce them and
    // the fast path must decline to it.
    sameBothWays(`${KB}\n(= (dbl $x) (+ $x $x))\n${GEN}`, [
      "(match &self (edge $e 10 $t $g) (dbl $t))",
      "(gen)",
    ]);
  });

  it("declines: non-ground result values (free template variable)", () => {
    sameBothWays(`${KB}\n${GEN}`, ["(match &self (edge $e 10 $t $g) (Row $e $free))", "(gen)"]);
  });

  it("declines: named space stays identical", () => {
    sameBothWays(`${KB}\n${GEN}`, [
      "(bind! &kb (new-space))",
      "(add-atom &kb (edge 7 70 80 3))",
      "(match &kb (edge $e $f $t $g) (Row $e))",
      "(gen)",
    ]);
  });

  it("declines: a user rule on match shadows the builtin identically", () => {
    sameBothWays(`${KB}\n(= (match $a $b $c) shadowed)\n${GEN}`, [
      "(match &self (edge $e 10 $t $g) (Row $e))",
      "(gen)",
    ]);
  });

  it("var-headed expression rules of matching arity leave results identical", () => {
    // One rule matching the 2-item template values, one matching the 4-item match application shape,
    // and one fully-constant head. None fires on a symbol-headed value on either path.
    sameBothWays(
      `${KB}\n(= ($f $x) (VarHit2 $x))\n(= ($g $x $y $z) (VarHit4 $x))\n(= ($h 10 20 0) varhit)\n${GEN}`,
      ["(match &self (edge $e 10 $t $g) (Row $e))", "(gen)"],
    );
  });

  it("a catch-all bare-var rule declines and stays identical", () => {
    sameBothWays(`${KB}\n(= $anything caught)\n${GEN}`, [
      "(match &self (edge $e 10 $t $g) (Row $e))",
      "(gen)",
    ]);
  });

  it("world effects: add-atom then match sees the addition identically", () => {
    sameBothWays(KB, [
      "(add-atom &self (edge 9 10 70 3))",
      "(match &self (edge $e 10 $t $g) (Row $e $t))",
    ]);
  });

  it("world effects: remove-atom then match filters identically", () => {
    sameBothWays(KB, [
      "(remove-atom &self (edge 2 10 30 1))",
      "(match &self (edge $e 10 $t $g) (Row $e $t))",
    ]);
  });

  it("duplicate facts keep multiplicity identically", () => {
    sameBothWays(`${KB}\n(edge 1 10 20 0)`, ["(match &self (edge $e 10 $t $g) (Row $e))"]);
  });

  it("runProgram end to end (default env, tabling on) with a counter probe", () => {
    const src = `${KB}\n${GEN}\n!(match &self (edge $e 10 $t $g) (Row $e $t))\n!(gen)`;
    const on = runProgram(src, undefined, undefined, {
      experimental: { directMatch: true },
    }).map((g) => g.results.map(format));
    const off = runProgram(src, undefined, undefined, {
      experimental: { directMatch: false },
    }).map((g) => g.results.map(format));
    expect(on).toEqual(off);
  });

  it("property: random KBs, patterns, and templates stay identical with the counter probe", () => {
    const symPool = ["A", "B", "C", "red", "blue"] as const;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            e: fc.integer({ min: 1, max: 9 }),
            f: fc.integer({ min: 10, max: 14 }),
            t: fc.constantFrom(...symPool),
            g: fc.integer({ min: 0, max: 2 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.constantFrom(
          "(match &self (rel $e $f $t $g) (Row $e $f $t $g))",
          "(match &self (rel $e 10 $t $g) (Row $e $t))",
          "(match &self (rel $e $f red $g) (Row $e $f))",
          "(match &self (rel 1 $f $t $g) (Row $f $t $g))",
          "(match &self (rel $e $f $t $g) $e)",
          "(match &self (rel $e 12 $t $g) (Pair $e (Inner $t)))",
          "(match &self (rel $e $f $t $g) (Row $e $unbound))",
          "(match &self (rel 1 10 A 0) grounded-hit)",
        ),
        fc.constantFrom(
          "",
          "(= ($f $x) (VarHit2 $x))",
          "(= ($g $a $b $c $d) (VarHit4 $a))",
          "(= (dbl $x) (+ $x $x))",
        ),
        (rows, query, extraRule) => {
          const kb = rows.map((r) => `(rel ${r.e} ${r.f} ${r.t} ${r.g})`).join("\n");
          sameBothWays(`${kb}\n${extraRule}\n${GEN}`, [query, "(gen)"]);
        },
      ),
      { numRuns: 300 },
    );
  });
});
