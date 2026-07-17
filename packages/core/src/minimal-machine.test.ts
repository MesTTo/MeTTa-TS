// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  type Atom,
  type Bindings,
  atomEq,
  buildEnv,
  expr,
  format,
  gint,
  gnd,
  interpretMinimal,
  interpretMinimalAsync,
  makeValRel,
  parseAll,
  registerAsyncGroundedOperation,
  registerGroundedOperation,
  runProgram,
  standardTokenizer,
  stdTable,
  sym,
} from "./index";
import { applyConsAtom, applyDeconsAtom } from "./minimal-instruction";
import { RuntimeIdAllocator } from "./trace";
import { VariableScopeAllocator } from "./variable-scope";

const minimalAtomArbitrary: fc.Arbitrary<Atom> = fc.letrec<{ atom: Atom }>((tie) => ({
  atom: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.stringMatching(/^[a-z][a-z0-9-]{0,5}$/).map(sym),
    fc.integer({ min: -100, max: 100 }).map(gint),
    fc.array(tie("atom"), { maxLength: 3 }).map(expr),
  ),
})).atom;

function parseAtom(source: string): Atom {
  const parsed = parseAll(source, standardTokenizer());
  expect(parsed).toHaveLength(1);
  return parsed[0]!.atom;
}

function makeEnv(rules = "") {
  const atoms = rules === "" ? [] : parseAll(rules, standardTokenizer()).map((item) => item.atom);
  return buildEnv(atoms, stdTable());
}

function run(source: string, rules = "", bindings: Bindings = []): string[] {
  const [pairs] = interpretMinimal(makeEnv(rules), parseAtom(source), { bindings });
  return pairs.map(([atom]) => format(atom));
}

describe("direct Minimal MeTTa control", () => {
  it("performs exactly one rule or grounded reduction", () => {
    const rules = `
      (= (one) (eval (two)))
      (= (two) final)
    `;
    expect(run("(eval (one))", rules)).toEqual(["(eval (two))"]);
    expect(run("(eval missing)", rules)).toEqual(["NotReducible"]);

    const env = makeEnv();
    registerGroundedOperation(env, "many", () => ({
      tag: "ok",
      results: [sym("first"), sym("second")],
    }));
    registerGroundedOperation(env, "none", () => ({ tag: "ok", results: [] }));
    registerGroundedOperation(env, "stuck", () => ({ tag: "noReduce" }));
    registerGroundedOperation(env, "broken", () => ({
      tag: "runtimeError",
      msg: "grounded failure",
    }));

    expect(
      interpretMinimal(env, parseAtom("(eval (many))"))[0].map(([atom]) => format(atom)),
    ).toEqual(["first", "second"]);
    expect(interpretMinimal(env, parseAtom("(eval (none))"))[0]).toEqual([]);
    expect(
      interpretMinimal(env, parseAtom("(eval (stuck))"))[0].map(([atom]) => format(atom)),
    ).toEqual(["NotReducible"]);
    expect(
      interpretMinimal(env, parseAtom("(eval (broken))"))[0].map(([atom]) => format(atom)),
    ).toEqual(["(Error (broken) grounded failure)"]);

    const executable = gnd(
      { g: "ext", kind: "minimal-test", id: "executable-head" },
      sym("Grounded"),
      (args) => [expr([sym("seen"), ...args])],
    );
    expect(
      interpretMinimal(env, expr([sym("eval"), expr([executable, sym("argument")])]))[0].map(
        ([atom]) => format(atom),
      ),
    ).toEqual(["(seen argument)"]);
  });

  it("admits returned function wrappers but delivers other instruction-shaped rule results", () => {
    const rules = `
      (= (wrapped) (function (return complete)))
      (= (code) (eval (never-run)))
    `;
    expect(run("(eval (wrapped))", rules)).toEqual(["complete"]);
    expect(run("(eval (code))", rules)).toEqual(["(eval (never-run))"]);
  });

  it("keeps constructed and deconstructed instruction forms as data", () => {
    expect(run("(cons-atom eval ((missing)))")).toEqual(["(eval (missing))"]);
    expect(run("(decons-atom (eval (missing)))")).toEqual(["(eval ((missing)))"]);
    expect(run("(return (eval (missing)))")).toEqual(["(return (eval (missing)))"]);
  });

  it("keeps Hyperpose outside the direct Minimal instruction set", () => {
    expect(run("(hyperpose (A B))")).toEqual(["(hyperpose (A B))"]);
    expect(run("(eval (hyperpose (A B)))")).toEqual(["A", "B"]);
    expect(runProgram("!(hyperpose (A B))")[0]?.results.map(format)).toEqual(["A", "B"]);
  });
});

describe("chain relational bind", () => {
  it("admits the source and each selected template", () => {
    const rules = `
      (= color red)
      (= color green)
      (= red warm)
      (= green cool)
    `;
    expect(run("(chain (eval color) $x (eval $x))", rules)).toEqual(["warm", "cool"]);
  });

  it("keeps the chain binder local and respects scoped variable identity", () => {
    expect(run("(chain A $x (pair $y))", "", [makeValRel("y", sym("B"))])).toEqual(["(pair B)"]);
    expect(run("(chain A $x (pair $x))", "", [makeValRel("x", sym("B"))])).toEqual(["(pair A)"]);

    const scopes = new VariableScopeAllocator(new RuntimeIdAllocator("minimal-chain"));
    const binder = scopes.next().variable("x");
    const other = scopes.next().variable("x");
    const control = expr([sym("chain"), sym("A"), binder, expr([sym("pair"), binder, other])]);
    const [pairs] = interpretMinimal(makeEnv(), control);
    expect(pairs).toHaveLength(1);
    expect(atomEq(pairs[0]![0], expr([sym("pair"), sym("A"), other]))).toBe(true);
  });

  it("executes an instruction-shaped value only when the chain template admits it", () => {
    expect(run("(chain (cons-atom eval ((missing))) $code $code)")).toEqual(["NotReducible"]);
  });
});

describe("function and return delimiters", () => {
  it("accepts any body atom and attributes NoReturn to the stable call", () => {
    expect(run("(function terminal)")).toEqual(["(Error (function terminal) NoReturn)"]);
    expect(run("(eval (foo))", "(= (foo) (function terminal))")).toEqual([
      "(Error (foo) NoReturn)",
    ]);
  });

  it("returns from the nearest delimiter and never executes the payload", () => {
    expect(run("(function (chain (function (return inner)) $x (return (outer $x))))")).toEqual([
      "(outer inner)",
    ]);
    expect(run("(function (return (eval missing)))")).toEqual(["(eval missing)"]);
    expect(run("(return A B)")).toEqual(["(return A B)"]);
  });

  it("keeps successful and NoReturn branches independent", () => {
    const body = `(function
      (chain (eval color) $x
        (unify $x A (return ok) terminal)))`;
    expect(run(body, "(= color A) (= color B)")).toEqual([
      "ok",
      "(Error (function (chain (eval color) $x (unify $x A (return ok) terminal))) NoReturn)",
    ]);
  });

  it("keeps exhausted and malformed-return exits distinct", () => {
    const env = makeEnv();
    registerGroundedOperation(env, "none", () => ({ tag: "ok", results: [] }));
    expect(interpretMinimal(env, parseAtom("(function (eval (none)))"))[0]).toEqual([]);
    expect(run("(function (return A B))")).toEqual(["(Error (function (return A B)) NoReturn)"]);
  });
});

describe("total minimal instruction contracts", () => {
  it("round-trips constructor operands for arbitrary atoms and expression tails", () => {
    fc.assert(
      fc.property(
        minimalAtomArbitrary,
        fc.array(minimalAtomArbitrary, { maxLength: 5 }),
        (head, tailItems) => {
          const tail = expr(tailItems);
          const constructed = applyConsAtom([head, tail]);
          if (!constructed.ok) return false;
          const deconstructed = applyDeconsAtom([constructed.atom]);
          return deconstructed.ok && atomEq(deconstructed.atom, expr([head, tail]));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("uses the same constructor fault on embedded and grounded paths", () => {
    for (const [direct, grounded] of [
      ["(cons-atom A)", "(eval (cons-atom A))"],
      ["(cons-atom A B)", "(eval (cons-atom A B))"],
      ["(decons-atom)", "(eval (decons-atom))"],
      ["(decons-atom ())", "(eval (decons-atom ()))"],
    ] as const) {
      const directAtom = interpretMinimal(makeEnv(), parseAtom(direct))[0][0]![0];
      const groundedAtom = interpretMinimal(makeEnv(), parseAtom(grounded))[0][0]![0];
      expect(atomEq(directAtom, groundedAtom)).toBe(true);
    }
  });

  it("returns one language fault for every malformed core instruction", () => {
    expect(run("(eval)")).toEqual(['(Error (eval) "eval: expected one atom")']);
    expect(run("(chain A B C)")).toEqual([
      '(Error (chain A B C) "chain: expected a source, variable, and template")',
    ]);
    expect(run("(function A B)")).toEqual(['(Error (function A B) "function: expected one body")']);
    expect(run("(unify A B C)")).toEqual([
      '(Error (unify A B C) "unify: expected an atom, pattern, then branch, and else branch")',
    ]);
  });

  it("keeps unify symmetric, total, and branch-local", () => {
    expect(run("(unify (A $x) ($y B) ($x $y) no)")).toEqual(["(B A)"]);
    expect(run("(unify (A C) (B C) yes no)")).toEqual(["no"]);
  });

  it("awaits asynchronous groundeds at the same one-step boundary", async () => {
    const env = makeEnv();
    registerAsyncGroundedOperation(env, "later", async () => ({
      tag: "ok",
      results: [sym("done")],
    }));
    const [pairs] = await interpretMinimalAsync(env, parseAtom("(eval (later))"));
    expect(pairs.map(([atom]) => format(atom))).toEqual(["done"]);
  });
});
