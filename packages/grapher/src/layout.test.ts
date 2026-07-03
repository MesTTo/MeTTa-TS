// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { Graph } from "./model";
import { layout } from "./layout";
import { nodeWidth } from "./measure";

describe("layout", () => {
  it("places a single node's top at the origin row, centered by its width", () => {
    const g = new Graph();
    const n = g.add({ name: "x" });
    layout(g, { originX: 5, originY: 7 });
    expect(n.y).toBe(7);
    expect(n.x).toBe(5 + nodeWidth(n) / 2);
  });

  it("maps depth to y and spreads siblings without overlapping", () => {
    const g = new Graph();
    const head = g.add({ name: "+" });
    const a = g.add({ name: "1" });
    const b = g.add({ name: "2" });
    const c = g.add({ name: "3" });
    g.connect(head.id, a.id);
    g.connect(head.id, b.id);
    g.connect(head.id, c.id);
    layout(g);
    // depth: head above its children
    expect(head.y).toBeLessThan(a.y);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    // leaves get distinct, increasing x in insertion order
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    // the parent is centered over its children
    expect(head.x).toBeCloseTo((a.x + c.x) / 2, 6);
  });

  it("is deterministic", () => {
    const build = (): Graph => {
      const g = new Graph();
      const r = g.add({ name: "f", id: "r" });
      const x = g.add({ name: "g", id: "x" });
      const y = g.add({ name: "1", id: "y" });
      const z = g.add({ name: "2", id: "z" });
      g.connect(r.id, x.id);
      g.connect(x.id, y.id);
      g.connect(x.id, z.id);
      return g;
    };
    const g1 = build();
    const g2 = build();
    layout(g1);
    layout(g2);
    for (const id of ["r", "x", "y", "z"]) {
      expect([g1.nodes.get(id)!.x, g1.nodes.get(id)!.y]).toEqual([
        g2.nodes.get(id)!.x,
        g2.nodes.get(id)!.y,
      ]);
    }
  });
});
