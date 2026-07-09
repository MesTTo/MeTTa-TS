// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { arrow, e, ground, m, names, vars } from "./index";
import { pyAtom, pyCall, pyChain, pyDict, pyDot, pyEval, pyImport, pyList, pyTuple } from "./py";
import {
  Predicate,
  assertaPredicate,
  assertzPredicate,
  callPredicate,
  importPrologFunction,
  importPrologFunctionsFromFile,
  prologCall,
  prologConsult,
  prologFunction,
  prologMatch,
  retractPredicate,
} from "./prolog";

const same = (actual: unknown, expected: unknown): void =>
  expect(String(actual)).toBe(String(expected));

describe("Python interop eDSL builders", () => {
  it("build py-call forms from a dotted path", () => {
    same(pyCall("math.add", 40, 2), m`(py-call (math.add 40 2))`);
    same(pyCall("operator.add", "ab", "cd"), m`(py-call (operator.add "ab" "cd"))`);
  });

  it("accepts a fully-built py-call spec", () => {
    same(pyCall(m`(quote (eval "2 ** 10" 0 0))`), m`(py-call (quote (eval "2 ** 10" 0 0)))`);
  });

  it("builds py-eval, py-import, py-atom, and py-dot", () => {
    const { Number } = names();
    same(pyEval("2 ** 10"), m`(py-eval "2 ** 10")`);
    same(pyImport("math.py"), m`(py-import "math.py")`);
    same(
      pyAtom("operator.add", arrow(Number, Number, Number)),
      m`(py-atom operator.add (-> Number Number Number))`,
    );
    same(
      pyDot(pyCall("sample.point", 3, 4), "magnitude"),
      m`(py-dot (py-call (sample.point 3 4)) magnitude)`,
    );
  });

  it("builds Python collection helpers", () => {
    const { a } = names();
    same(pyList([1, e(2, 3), 4]), m`(py-list (1 (2 3) 4))`);
    same(pyTuple([1, 2]), m`(py-tuple (1 2))`);
    same(
      pyDict([
        [a, 1],
        ["b", 2],
      ]),
      m`(py-dict ((a 1) ("b" 2)))`,
    );
    same(pyChain([0, 1, 2]), m`(py-chain (0 1 2))`);
  });
});

describe("Prolog interop eDSL builders", () => {
  it("treats strings in goal arrays as Prolog atoms", () => {
    const { x } = vars();
    same(prologCall(["edge", "alice", x]), m`(prolog-call (edge alice $x))`);
  });

  it("accepts ordinary eDSL terms as goals", () => {
    const { edge, alice } = names();
    const { x } = vars();
    same(prologCall(edge(alice, x)), m`(prolog-call (edge alice $x))`);
  });

  it("builds PeTTa-compatible predicate wrappers", () => {
    const { x } = vars();
    same(Predicate(["hello", x]), m`(Predicate (hello $x))`);
    same(callPredicate(Predicate(["hello", x])), m`(callPredicate (Predicate (hello $x)))`);
    same(
      assertaPredicate(Predicate(["hello", "world"])),
      m`(assertaPredicate (Predicate (hello world)))`,
    );
    same(
      assertzPredicate(Predicate(["hello", "mars"])),
      m`(assertzPredicate (Predicate (hello mars)))`,
    );
    same(
      retractPredicate(Predicate(["hello", "world"])),
      m`(retractPredicate (Predicate (hello world)))`,
    );
  });

  it("builds Prolog function and import forms", () => {
    const { x } = vars();
    same(prologMatch(["edge", "alice", x], x), m`(prolog-match (edge alice $x) $x)`);
    same(prologFunction("edge", ["alice"]), m`(prolog-function edge (alice))`);
    same(importPrologFunction("edge"), m`(import_prolog_function edge)`);
    same(prologConsult("facts.pl"), m`(prolog-consult "facts.pl")`);
    same(
      importPrologFunctionsFromFile("facts.pl", ["edge", "path"]),
      m`(import_prolog_functions_from_file "facts.pl" (edge path))`,
    );
  });

  it("preserves grounded strings when explicitly requested", () => {
    same(prologCall(["label", ground("alice")]), m`(prolog-call (label "alice"))`);
  });
});
