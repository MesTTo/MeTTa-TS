// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Atom, S, V, E, ValueAtom } from "@mettascript/hyperon";
import { Graph } from "./model";
import { graphToAtoms, atomToGraph } from "./atom";
import { parseProgram } from "./parse";
import { makeRng, randomAtom } from "./testgen";

/** Import an atom, compose it back, and return the single resulting atom. */
function roundTrip(atom: Atom): Atom {
  const atoms = graphToAtoms(atomToGraph([atom]));
  expect(atoms).toHaveLength(1);
  return atoms[0]!;
}

describe("atom bridge", () => {
  it("composes a hand-built graph into (+ 10 (* 25 2))", () => {
    const g = new Graph();
    const plus = g.add({ name: "+", x: 0 });
    const ten = g.add({ name: "10", x: 10 });
    const times = g.add({ name: "*", x: 100 });
    const a = g.add({ name: "25", x: 90 });
    const b = g.add({ name: "2", x: 110 });
    g.connect(plus.id, times.id); // connect out of order; screen x decides argument order
    g.connect(plus.id, ten.id);
    g.connect(times.id, b.id);
    g.connect(times.id, a.id);
    expect(graphToAtoms(g).map(String)).toEqual(["(+ 10 (* 25 2))"]);
  });

  it("imports (+ 10 (* 25 2)) to nodes with matching argument order", () => {
    const [atom] = parseProgram("(+ 10 (* 25 2))");
    const g = atomToGraph([atom!]);
    const head = g.heads()[0]!;
    expect(head.name).toBe("+");
    expect(g.sortedChildren(head.id).map((n) => n.name)).toEqual(["10", "*"]);
  });

  it("keeps (f) distinct from f", () => {
    expect(roundTrip(E(S("f"))).toString()).toBe("(f)");
    expect(roundTrip(S("f")).toString()).toBe("f");
  });

  it("handles a compound head ((f x) y) as a list node", () => {
    const atom = E(E(S("f"), V("x")), S("y"));
    const g = atomToGraph([atom]);
    expect(g.heads()[0]!.kind).toBe("list");
    expect(roundTrip(atom).equals(atom)).toBe(true);
  });

  it("round-trips leaves: symbol, variable, grounded number", () => {
    expect(roundTrip(S("foo")).equals(S("foo"))).toBe(true);
    expect(roundTrip(V("x")).equals(V("x"))).toBe(true);
    expect(roundTrip(ValueAtom(42)).equals(ValueAtom(42))).toBe(true);
  });

  it("property: import then compose is the identity on random atoms", () => {
    const rnd = makeRng(987654321);
    for (let i = 0; i < 500; i++) {
      const atom = randomAtom(rnd, 4);
      const back = roundTrip(atom);
      expect(back.equals(atom), `failed on ${atom.toString()} -> ${back.toString()}`).toBe(true);
    }
  });
});
