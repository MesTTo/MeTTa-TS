// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { shapePoints } from "./shapes";
import type { GraphNode } from "./model";

const node = (name: string, kind: GraphNode["kind"] = "symbol"): GraphNode => ({
  id: "n",
  name,
  kind,
  x: 0,
  y: 0,
});

describe("node shape sampling (for the morph)", () => {
  it("samples a fixed number of boundary points for every shape", () => {
    for (const n of [node("*"), node("42"), node("$x"), node("if"), node("fact"), node("True")])
      expect(shapePoints(n, 40)).toHaveLength(40);
  });

  it("puts a diamond's right vertex at angle 0", () => {
    const d = shapePoints(node("+"), 40); // operator -> diamond, sample 0 is angle 0 (straight right)
    expect(d[0]![0]).toBeGreaterThan(0); // positive x
    expect(Math.abs(d[0]![1])).toBeLessThan(0.01); // y ~ 0
  });

  it("gives different roles different point sets, so a role change morphs", () => {
    const box = shapePoints(node("aa"), 40); // rounded rect
    const diamond = shapePoints(node("if"), 40); // control -> diamond (same 2-char width)
    const identical = box.every((p, i) => p[0] === diamond[i]![0] && p[1] === diamond[i]![1]);
    expect(identical).toBe(false);
  });
});
