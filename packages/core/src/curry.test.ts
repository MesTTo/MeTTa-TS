// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// PeTTa treats under-application as ordinary partial application. MeTTa TS supports that shape for untyped
// rule-defined functions and grounded ops, without a curry runtime mode or an import-side evaluator switch.
import { describe, it, expect } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";

const last = (src: string): string[] => {
  const r = runProgram(src);
  return r[r.length - 1]!.results.map(format);
};

describe("partial application", () => {
  it("under-applies a user function to a partial closure by default", () => {
    const src = "(= (f $a $b) (+ $a $b))\n!(f 1)";
    expect(last(src)).toEqual(["(partial f (1))"]);
  });

  it("renders PeTTa-shape repr tests for under-applied calls", () => {
    const src = `
      (= (f $a $b) (+ $a $b))
      (= (g $a $b $c) (+ $c (+ $a $b)))
      !(repr (f 1))
      !(repr (g 1 2))`;
    const r = runProgram(src);
    expect(r.at(-2)!.results.map(format)).toEqual([`"(partial f (1))"`]);
    expect(r.at(-1)!.results.map(format)).toEqual([`"(partial g (1 2))"`]);
  });

  it("applies a partial closure to the remaining arguments", () => {
    const src = "(= (f $a $b) (+ $a $b))\n!((f 1) 2)";
    expect(last(src)).toEqual(["3"]);
  });

  it("partially applies a grounded op instead of raising an arity error", () => {
    expect(last("!(+ 1)")).toEqual(["(partial + (1))"]);
    expect(last("!((+ 1) 2)")).toEqual(["3"]);
  });

  it("leaves constructor-style uppercase heads as data when no rule matches", () => {
    const src = "(= (S $x $y $z) ($x $z ($y $z)))\n!(S Z)";
    expect(last(src)).toEqual(["(S Z)"]);
  });

  it("leaves dual-declared data constructors under-applied as data", () => {
    const src = "(: D (-> A B C))\n(: D C)\n!(D a)";
    expect(last(src)).toEqual(["(D a)"]);
  });

  it("a partial threads through maplist as a first-class function", () => {
    const src = "!(maplist (+ 1) (1 2 3))";
    expect(last(src)).toEqual(["(2 3 4)"]);
  });

  it("partially applies an under-applied |-> lambda and completes it on the next application", () => {
    const src = "!(((|-> ($x $y) (42 $x $y)) 43) 44)";
    expect(last(src)).toEqual(["(42 43 44)"]);
  });

  it("appends a tuple argument as a single element (partial over a list builder)", () => {
    const src = "(= (h $a $b) (append ($a) $b))\n!((h 42) (1 2 3))";
    expect(last(src)).toEqual(["(42 1 2 3)"]);
  });

  it("a nullary thunk is still evaluated, not curried", () => {
    const src = "(= (g) 7)\n!(g)";
    expect(last(src)).toEqual(["7"]);
  });
});
