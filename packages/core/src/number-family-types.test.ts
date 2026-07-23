// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { format } from "./parser";
import { runProgram } from "./runner";

// Number-family aliasing (NUMBER_FAMILY_TYPE_NAMES): `Int`/`Integer`/`Double`/`Float` signatures are
// interchangeable with `Number` in both directions of the argument check. A dialect superset: Hyperon
// 0.2.10 knows only `Number`, treats the alias names as undefined symbols, and raises BadArgType on
// every accepting case below. Non-family user types keep the strict rejection.

const program = (source: string): string[][] =>
  runProgram(source).map((result) => result.results.map(format));
const query = (source: string): string[] => program(source)[0]!;

const INC = `
  (: f (-> Int Int))
  (= (f $x) (+ $x 1))`;

describe("number-family type aliasing", () => {
  it("accepts a Number literal where Int is declared", () => {
    expect(query(`${INC}\n!(f 5)`)).toEqual(["6"]);
  });

  it("accepts a float where Int is declared (one numeric family, not a width check)", () => {
    expect(query(`${INC}\n!(f 3.5)`)).toEqual(["4.5"]);
  });

  it("feeds an Int-typed result into a Number parameter", () => {
    const source = `
      (: ev (-> Atom Atom Int))
      (= (ev (Lit $n) $env) $n)
      (= (ev (Add $a $b) $env) (+ (ev $a $env) (ev $b $env)))
      !(ev (Add (Lit 2) (Add (Lit 3) (Lit 4))) empty)`;
    expect(query(source)).toEqual(["9"]);
  });

  it("accepts every alias name", () => {
    for (const alias of ["Integer", "Double", "Float"]) {
      const source = `
        (: g (-> ${alias} ${alias}))
        (= (g $x) (* $x 2))
        !(g 21)`;
      expect(query(source), alias).toEqual(["42"]);
    }
  });

  it("chains alias-typed functions through each other", () => {
    const source = `
      (: f (-> Int Int))
      (= (f $x) (+ $x 1))
      (: g (-> Number Number))
      (= (g $x) (* $x 10))
      !(g (f 3))`;
    expect(query(source)).toEqual(["40"]);
  });

  it("keeps rejecting a non-family user type", () => {
    const source = `
      (: MyInt Type)
      (: h (-> MyInt MyInt))
      (= (h $x) $x)
      !(h 5)`;
    expect(query(source)).toEqual(["(Error (h 5) (BadArgType 1 MyInt Number))"]);
  });

  it("keeps the strict arity error on an Int-signed function", () => {
    expect(query(`${INC}\n!(f 1 2)`)).toEqual(["(Error (f 1 2) IncorrectNumberOfArguments)"]);
  });

  it("still reports the declared alias from get-type", () => {
    expect(query(`${INC}\n!(get-type (f 5))`)).toEqual(["Int"]);
  });
});
