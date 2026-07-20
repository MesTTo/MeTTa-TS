// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { E, MeTTa, S, ValueAtom, VariableAtom } from "@mettascript/hyperon";
import {
  PROLOG_METTA_SRC,
  atomToPrologTerm,
  prologTermToAtom,
  registerPrologInterop,
} from "./prolog";
import { MockPrologBridge } from "./mock";
import { runLast } from "./testSupport";

function fresh(): { readonly m: MeTTa; readonly bridge: MockPrologBridge } {
  const m = new MeTTa();
  const bridge = new MockPrologBridge();
  registerPrologInterop(m, bridge);
  return { m, bridge };
}

describe("Prolog term conversion", () => {
  it("converts MeTTa predicates, variables, and primitives to Prolog JSON terms", () => {
    expect(atomToPrologTerm(E(S("Predicate"), E(S("hello"), VariableAtom.parseName("x"))))).toEqual(
      {
        type: "compound",
        functor: "hello",
        args: [{ type: "var", name: "x" }],
      },
    );
    expect(atomToPrologTerm(ValueAtom("abc"))).toEqual({ type: "string", value: "abc" });
    expect(atomToPrologTerm(ValueAtom(42))).toEqual({ type: "int", value: "42" });
  });

  it("converts solved Prolog terms back to MeTTa atoms", () => {
    expect(
      prologTermToAtom({
        type: "compound",
        functor: "hello",
        args: [{ type: "atom", name: "world" }],
      }).toString(),
    ).toBe("(hello world)");
  });
});

describe("Prolog interop over the mock bridge", () => {
  it("keeps predicate bindings connected to surrounding MeTTa expressions", async () => {
    const { m } = fresh();
    await m.runAsync("!(assertzPredicate (Predicate (hello world)))");
    await m.runAsync("!(assertzPredicate (Predicate (hello mars)))");
    expect(
      await runLast(m, "!(let $temp (callPredicate (Predicate (hello $what))) $what)"),
    ).toEqual(["world", "mars"]);
    expect(
      await runLast(m, "!(let $temp (callPredicate (Predicate (hello $what))) (seen $temp $what))"),
    ).toEqual(["(seen True world)", "(seen True mars)"]);
  });

  it("returns solved goals from prolog-call", async () => {
    const { m } = fresh();
    await m.runAsync("!(assertzPredicate (Predicate (parent alice bob)))");
    expect(await runLast(m, "!(prolog-call (parent alice $child))")).toEqual([
      "(parent alice bob)",
    ]);
  });

  it("imports Prolog predicates as MeTTa functions through async effects", async () => {
    const { m } = fresh();
    const out = await m.runAsync(`
      !(assertzPredicate (Predicate (hello world)))
      !(assertzPredicate (Predicate (hello mars)))
      !(import_prolog_function hello)
      !(hello)
    `);
    expect(out[1]!.map((atom) => atom.toString())).toEqual(["True"]);
    expect(out[2]!.map((atom) => atom.toString())).toEqual(["True"]);
    expect(out[3]!.map((atom) => atom.toString())).toEqual(["world", "mars"]);
  });

  it("retracts the first matching predicate", async () => {
    const { m } = fresh();
    await m.runAsync("!(assertzPredicate (Predicate (hello world)))");
    expect(await runLast(m, "!(retractPredicate (Predicate (hello world)))")).toEqual(["True"]);
    expect(await runLast(m, "!(callPredicate (Predicate (hello world)))")).toEqual([]);
    expect(await runLast(m, "!(retractPredicate (Predicate (hello world)))")).toEqual(["False"]);
  });

  it("consults a file before importing function wrappers from it", async () => {
    const { m, bridge } = fresh();
    await m.runAsync("!(assertzPredicate (Predicate (myfunc 41 42)))");
    const out = await m.runAsync(`
      !(import_prolog_functions_from_file "sample.pl" (myfunc))
      !(myfunc 41)
    `);
    expect(bridge.consulted).toEqual(["sample.pl"]);
    expect(out[1]!.map((atom) => atom.toString())).toEqual(["42"]);
  });

  it("resolves Prolog file imports through the host option", async () => {
    const m = new MeTTa();
    const bridge = new MockPrologBridge();
    registerPrologInterop(m, bridge, { resolvePath: (path) => `/base/${path}` });
    await m.runAsync('!(prolog-consult "sample.pl")');
    expect(bridge.consulted).toEqual(["/base/sample.pl"]);
  });

  it("core helper source is ordinary MeTTa", () => {
    expect(PROLOG_METTA_SRC).toContain("(let $answer (prolog-call $goal)");
    expect(PROLOG_METTA_SRC).toContain("(let $goal $answer $template)");
  });
});
