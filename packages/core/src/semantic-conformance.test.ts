// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { sym } from "./atom";
import { format } from "./parser";
import { runProgram } from "./runner";
import { unifyTop } from "./unify";

const program = (source: string): string[][] =>
  runProgram(source).map((result) => result.results.map(format));
const query = (source: string): string[] => program(source)[0]!;
const multiset = (values: readonly string[]): string[] => [...values].sort();

describe("unification", () => {
  it("rejects a symbol clash in symmetric first-order unification", () => {
    // Hyperon 0.2.10: `!(unify A B hit miss)` returns `miss`.
    expect(query("!(unify A B hit miss)")).toEqual(["miss"]);
    expect(unifyTop(sym("A"), sym("B"))).toBeNull();
  });

  it("rejects a recursive type binding during reconciliation", () => {
    const source = `
      (: value ((+ $t Z) $t))
      (: accept (-> ($q $q) Accepted))
      !(case (accept value) (((Error $call $reason) occurs-rejected) ($other occurs-accepted)))`;

    // Hyperon 0.2.10: `[[occurs-rejected]]`.
    expect(query(source)).toEqual(["occurs-rejected"]);
  });

  it("rejects a cyclic binding produced by a space query", () => {
    const source = `
      (R $a $a)
      !(match &self (R $b (S $b)) hit)`;

    // Hyperon 0.2.10: `[[]]`.
    expect(query(source)).toEqual([]);
  });
});

describe("nondeterminism and multiplicity", () => {
  it("keeps every result when case consumes a nondeterministic input", () => {
    // Hyperon 0.2.10 returns both values. MOPS does not specify their enumeration order.
    expect(multiset(query("!(case (superpose (a b)) ((a hit-a) (b hit-b)))"))).toEqual(
      multiset(["hit-a", "hit-b"]),
    );
  });

  it("returns no result when superpose-bind receives an empty result bag", () => {
    // Hyperon 0.2.10: `!(superpose-bind ())` returns an empty result bag, not the atom `Empty`.
    expect(query("!(superpose-bind ())")).toEqual([]);
  });

  it("preserves duplicate matches as separate results", () => {
    const source = `
      (p a)
      (p a)
      (p a)
      !(match &self (p a) hit)`;

    // Hyperon 0.2.10: `[[hit, hit, hit]]`.
    expect(multiset(query(source))).toEqual(multiset(["hit", "hit", "hit"]));
  });
});

describe("spaces", () => {
  it("removes one occurrence from a space containing duplicates", () => {
    const source = `
      !(bind! &bag (new-space))
      !(add-atom &bag (p a))
      !(add-atom &bag (p a))
      !(remove-atom &bag (p a))
      !(match &bag (p a) hit)`;

    // Hyperon 0.2.10: `[[()], [()], [()], [()], [hit]]`.
    expect(program(source)).toEqual([["()"], ["()"], ["()"], ["()"], ["hit"]]);
  });
});

describe("instantiation", () => {
  it("instantiates a space-match template before returning it", () => {
    const source = `
      (p a)
      !(case (match &self (p $x) (seen $x)) (($value $value)))`;

    // Hyperon 0.2.10: `[[(seen a)]]`.
    expect(query(source)).toEqual(["(seen a)"]);
  });
});

describe("specialization", () => {
  it("preserves non-function arguments in a higher-order call", () => {
    const source = `
      (= (twice $f $x) ($f ($f $x)))
      (= (inc $x) (+ $x 1))
      (= (answer $x) (twice inc $x))
      !(answer 1)`;

    // Hyperon 0.2.10: `[[3]]`.
    expect(query(source)).toEqual(["3"]);
  });
});
