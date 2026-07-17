// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { E, S, ValueAtom, type Atom } from "./atoms";
import { IncorrectArgumentError, MeTTa } from "./base";

const fmt = (results: Atom[][]): string[][] => results.map((r) => r.map((a) => a.toString()));

describe("MeTTa.registerStreamingOperation", () => {
  it("streams answers in order and materializes the full bag", () => {
    const metta = new MeTTa();
    metta.registerStreamingOperation("nums", function* () {
      yield ValueAtom(0);
      yield ValueAtom(1);
      yield ValueAtom(2);
    });
    expect(fmt(metta.run("!(nums)"))).toEqual([["0", "1", "2"]]);
  });

  it("pulls lazily so once advances the producer exactly once", () => {
    const metta = new MeTTa();
    let produced = 0;
    metta.registerStreamingOperation("lazy-nums", function* () {
      for (let index = 0; index < 8192; index += 1) {
        produced += 1;
        yield ValueAtom(index);
      }
    });
    expect(fmt(metta.run("!(once (lazy-nums))"))).toEqual([["0"]]);
    expect(produced).toBe(1);
  });

  it("applies per-answer bindings to the answer atom", () => {
    const metta = new MeTTa();
    metta.registerStreamingOperation("pick", function* (args) {
      yield { atom: args[0]!, bindings: { x: ValueAtom(42) } };
      yield { atom: args[0]!, bindings: { x: ValueAtom(7) } };
    });
    expect(fmt(metta.run("!(pick $x)"))).toEqual([["42", "7"]]);
  });

  it("threads a binding into the surrounding alternative", () => {
    const metta = new MeTTa();
    metta.registerStreamingOperation("assign", function* (args) {
      yield { atom: S("bound"), bindings: { n: ValueAtom(5) } };
      void args;
    });
    expect(fmt(metta.run("!(let bound (assign $n) (Pair $n))"))).toEqual([["(Pair 5)"]]);
  });

  it("turns a mid-stream throw into an Error atom after earlier answers", () => {
    const metta = new MeTTa();
    metta.registerStreamingOperation("half-broken", function* () {
      yield ValueAtom(1);
      throw new Error("boom");
    });
    const [results] = fmt(metta.run("!(half-broken)"));
    expect(results![0]).toBe("1");
    expect(results![1]).toContain("Error");
    expect(results![1]).toContain("boom");
  });

  it("leaves the expression unevaluated on IncorrectArgumentError", () => {
    const metta = new MeTTa();
    metta.registerStreamingOperation("typed-op", (args) => {
      if (args[0]?.metatype() !== "Grounded") throw new IncorrectArgumentError("want a value");
      return [ValueAtom(1)];
    });
    expect(fmt(metta.run("!(typed-op sym)"))).toEqual([["(typed-op sym)"]]);
  });

  it("applies per-answer effects to the knowledge base", () => {
    const metta = new MeTTa();
    metta.registerStreamingOperation("record", function* () {
      yield {
        atom: E(),
        effects: [{ kind: "addAtom" as const, space: S("&self"), atom: E(S("fact"), S("a")) }],
      };
    });
    expect(fmt(metta.run("!(record)\n!(match &self (fact $x) $x)"))).toEqual([["()"], ["a"]]);
  });
});

describe("MeTTa.registerAsyncStreamingOperation", () => {
  it("streams asynchronously produced answers in order", async () => {
    const metta = new MeTTa();
    metta.registerAsyncStreamingOperation("fetch-rows", async function* () {
      for (const row of ["alpha", "beta"]) {
        await Promise.resolve();
        yield S(row);
      }
    });
    expect(fmt(await metta.runAsync("!(fetch-rows)"))).toEqual([["alpha", "beta"]]);
  });

  it("closes the tail so once stops the async producer", async () => {
    const metta = new MeTTa();
    let produced = 0;
    metta.registerAsyncStreamingOperation("slow-nums", async function* () {
      for (let index = 0; index < 1000; index += 1) {
        await Promise.resolve();
        produced += 1;
        yield ValueAtom(index);
      }
    });
    expect(fmt(await metta.runAsync("!(once (slow-nums))"))).toEqual([["0"]]);
    expect(produced).toBeLessThanOrEqual(2);
  });

  it("supports bindings and effects from an async producer", async () => {
    const metta = new MeTTa();
    metta.registerAsyncStreamingOperation("mark", async function* (args) {
      await Promise.resolve();
      yield {
        atom: args[0]!,
        bindings: { v: S("marked") },
        effects: [{ kind: "addAtom" as const, space: S("&self"), atom: E(S("saw"), S("it")) }],
      };
    });
    expect(fmt(await metta.runAsync("!(mark $v)\n!(match &self (saw $y) $y)"))).toEqual([
      ["marked"],
      ["it"],
    ]);
  });

  it("reports unknown binding names as an Error atom", () => {
    const metta = new MeTTa();
    metta.registerStreamingOperation("bad-bind", function* () {
      yield { atom: S("x"), bindings: { nope: ValueAtom(1) } };
    });
    const [results] = fmt(metta.run("!(bad-bind $x)"));
    expect(results![0]).toContain("Error");
    expect(results![0]).toContain("nope");
  });

  it("instantiates an answer atom that embeds a caller variable", () => {
    const metta = new MeTTa();
    metta.registerStreamingOperation("pair-var", function* (args) {
      yield { atom: E(S("Got"), args[0]!), bindings: { q: args[1]! } };
    });
    expect(fmt(metta.run("!(pair-var $q seven)"))).toEqual([["(Got seven)"]]);
  });
});
