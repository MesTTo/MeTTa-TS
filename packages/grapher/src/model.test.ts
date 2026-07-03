// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Graph, type GraphNode } from "./model";
import { makeRng } from "./testgen";

/** Add three fresh nodes named a, b, c to a graph. */
function abc(g: Graph): { a: GraphNode; b: GraphNode; c: GraphNode } {
  return { a: g.add({ name: "a" }), b: g.add({ name: "b" }), c: g.add({ name: "c" }) };
}

/** Detect a cycle by DFS over child edges, independently of the graph's own guard. */
function hasCycle(graph: Graph): boolean {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const c of graph.childrenOf(id)) {
      const cc = color.get(c) ?? WHITE;
      if (cc === GRAY) return true;
      if (cc === WHITE && visit(c)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const id of graph.nodes.keys())
    if ((color.get(id) ?? WHITE) === WHITE && visit(id)) return true;
  return false;
}

describe("Graph model", () => {
  it("adds nodes with defaults and an id", () => {
    const g = new Graph();
    const n = g.add({ name: "foo" });
    expect(n.id).toMatch(/^n\d+$/);
    expect(n.kind).toBe("symbol");
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
    expect(g.nodes.get(n.id)).toBe(n);
  });

  it("connects parent to child and records order", () => {
    const g = new Graph();
    const a = g.add({ name: "+" });
    const b = g.add({ name: "1" });
    const c = g.add({ name: "2" });
    expect(g.connect(a.id, b.id)).toBe(true);
    expect(g.connect(a.id, c.id)).toBe(true);
    expect(g.childrenOf(a.id)).toEqual([b.id, c.id]);
    expect(g.parentsOf(b.id)).toEqual([a.id]);
  });

  it("rejects self-edges, duplicates, unknown nodes, and cycles", () => {
    const g = new Graph();
    const { a, b, c } = abc(g);
    expect(g.connect(a.id, a.id)).toBe(false); // self
    expect(g.connect(a.id, "nope")).toBe(false); // unknown
    expect(g.connect(a.id, b.id)).toBe(true);
    expect(g.connect(a.id, b.id)).toBe(false); // duplicate
    expect(g.connect(b.id, c.id)).toBe(true);
    expect(g.connect(c.id, a.id)).toBe(false); // c -> a would close a -> b -> c -> a
    expect(hasCycle(g)).toBe(false);
  });

  it("disconnects both directions", () => {
    const g = new Graph();
    const a = g.add({ name: "a" });
    const b = g.add({ name: "b" });
    g.connect(a.id, b.id);
    g.disconnect(a.id, b.id);
    expect(g.childrenOf(a.id)).toEqual([]);
    expect(g.parentsOf(b.id)).toEqual([]);
  });

  it("removes a node and every edge touching it", () => {
    const g = new Graph();
    const { a, b, c } = abc(g);
    g.connect(a.id, b.id);
    g.connect(b.id, c.id);
    g.remove(b.id);
    expect(g.nodes.has(b.id)).toBe(false);
    expect(g.childrenOf(a.id)).toEqual([]);
    expect(g.parentsOf(c.id)).toEqual([]);
  });

  it("sorts children by x, ties by y (argument order is screen order)", () => {
    const g = new Graph();
    const head = g.add({ name: "-" });
    const left = g.add({ name: "5", x: 10, y: 0 });
    const right = g.add({ name: "3", x: 100, y: 0 });
    const stackedTop = g.add({ name: "top", x: 100, y: -50 }); // same x as right, higher up
    // connect out of visual order to prove the sort, not insertion, decides
    g.connect(head.id, right.id);
    g.connect(head.id, stackedTop.id);
    g.connect(head.id, left.id);
    expect(g.sortedChildren(head.id).map((n: GraphNode) => n.name)).toEqual(["5", "top", "3"]);
  });

  it("finds heads by walking up, deduping shared roots", () => {
    const g = new Graph();
    const root = g.add({ name: "root" });
    const mid = g.add({ name: "mid" });
    const leaf = g.add({ name: "leaf" });
    g.connect(root.id, mid.id);
    g.connect(mid.id, leaf.id);
    expect(g.findHeads(leaf.id).map((n) => n.id)).toEqual([root.id]);
    expect(g.heads().map((n) => n.id)).toEqual([root.id]);

    // a shared child with two roots reports both, once each
    const root2 = g.add({ name: "root2" });
    g.connect(root2.id, leaf.id);
    expect(
      g
        .findHeads(leaf.id)
        .map((n) => n.name)
        .sort(),
    ).toEqual(["root", "root2"]);
  });

  it("clones with the same ids, positions, and edges", () => {
    const g = new Graph();
    const a = g.add({ name: "a", x: 1, y: 2 });
    const b = g.add({ name: "b", x: 3, y: 4 });
    g.connect(a.id, b.id);
    const c = g.clone();
    expect([...c.nodes.values()]).toEqual([...g.nodes.values()]);
    expect(c.childrenOf(a.id)).toEqual([b.id]);
  });

  it("property: a random sequence of connects never creates a cycle", () => {
    const rnd = makeRng(1234567);
    for (let trial = 0; trial < 40; trial++) {
      const g = new Graph();
      const ids = Array.from({ length: 12 }, (_, i) => g.add({ name: `n${i}` }).id);
      for (let op = 0; op < 60; op++) {
        const p = ids[Math.floor(rnd() * ids.length)]!;
        const c = ids[Math.floor(rnd() * ids.length)]!;
        g.connect(p, c);
        expect(hasCycle(g)).toBe(false);
      }
    }
  });
});
