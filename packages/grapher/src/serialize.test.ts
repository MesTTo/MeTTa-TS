// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Graph } from "./model";
import { toJson, fromJson, toSource, fromSource } from "./serialize";
import { graphToAtoms, atomToGraph } from "./atom";
import { makeRng, randomAtom } from "./testgen";

describe("serialize", () => {
  it("round-trips a graph through JSON", () => {
    const g = new Graph();
    const a = g.add({ name: "+", x: 1, y: 2 });
    const b = g.add({ name: "1", x: 3, y: 4 });
    const c = g.add({ name: "2", x: 5, y: 6 });
    g.connect(a.id, b.id);
    g.connect(a.id, c.id);
    const back = fromJson(toJson(g));
    expect([...back.nodes.values()]).toEqual([...g.nodes.values()]);
    expect(back.childrenOf(a.id)).toEqual([b.id, c.id]);
  });

  it("exports and imports MeTTa source", () => {
    const g = fromSource("(+ 10 (* 25 2))");
    expect(toSource(g)).toBe("(+ 10 (* 25 2))");
  });

  it("JSON is stable text (positions and edges included)", () => {
    const g = new Graph();
    const a = g.add({ name: "f", id: "a", x: 0, y: 0 });
    const b = g.add({ name: "x", id: "b", x: 90, y: 80 });
    g.connect(a.id, b.id);
    expect(JSON.parse(JSON.stringify(toJson(g)))).toEqual({
      nodes: [
        { id: "a", name: "f", kind: "symbol", x: 0, y: 0 },
        { id: "b", name: "x", kind: "symbol", x: 90, y: 80 },
      ],
      edges: [["a", "b"]],
    });
  });

  it("property: source and JSON round-trips preserve the atoms", () => {
    const rnd = makeRng(42424242);
    for (let i = 0; i < 300; i++) {
      const atom = randomAtom(rnd, 4);
      const g = atomToGraph([atom]);
      // JSON round-trip preserves the composed atoms
      const viaJson = graphToAtoms(fromJson(toJson(g)));
      expect(viaJson.map(String)).toEqual(graphToAtoms(g).map(String));
      // source round-trip preserves the atom
      expect(graphToAtoms(fromSource(toSource(g)))[0]!.equals(atom)).toBe(true);
    }
  });
});
