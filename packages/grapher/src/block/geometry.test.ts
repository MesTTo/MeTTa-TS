// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  pulledPointsToPath,
  roundedRectPoints,
  roundedRectPath,
  roundedBackingPath,
  type PulledPoint,
} from "./geometry";

/** Pull the numbers out of an SVG path for numeric assertions. */
function nums(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe("pulledPointsToPath", () => {
  it("is empty for no points", () => {
    expect(pulledPointsToPath([])).toBe("");
  });

  it("draws one cubic per edge and closes the loop", () => {
    // A triangle of plain points (no pull) gives three cubics and a Z.
    const pts: PulledPoint[] = [
      { lpull: 0, langle: 0, x: 0, y: 0, rpull: 0, rangle: 0 },
      { lpull: 0, langle: 0, x: 10, y: 0, rpull: 0, rangle: 0 },
      { lpull: 0, langle: 0, x: 0, y: 10, rpull: 0, rangle: 0 },
    ];
    const d = pulledPointsToPath(pts);
    expect((d.match(/C/g) ?? []).length).toBe(3);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.startsWith("M 0 0")).toBe(true);
  });

  it("computes control points by rotating and scaling the edge vector", () => {
    // The first corner of a 100x50 rounded rect (r=10): edge from (0,10) to (10,0),
    // outgoing pull 0.39 at -45 deg, incoming pull 0.39 at +45 deg. Worked by hand:
    // control1 = (0, 4.485), control2 = (4.485, 0), end = (10, 0).
    const d = pulledPointsToPath(roundedRectPoints(100, 50, 10));
    const n = nums(d);
    // n = [Mx, My, c1x, c1y, c2x, c2y, ex, ey, ...]
    expect(n[0]).toBeCloseTo(0, 2); // move-to x (first point is (0, r))
    expect(n[1]).toBeCloseTo(10, 2); // move-to y
    expect(n[2]).toBeCloseTo(0, 2); // control1 x
    expect(n[3]).toBeCloseTo(4.49, 1); // control1 y
    expect(n[4]).toBeCloseTo(4.49, 1); // control2 x
    expect(n[5]).toBeCloseTo(0, 2); // control2 y
    expect(n[6]).toBeCloseTo(10, 2); // end x
    expect(n[7]).toBeCloseTo(0, 2); // end y
  });
});

describe("roundedRectPoints", () => {
  it("has eight points and clamps the radius on a narrow box", () => {
    expect(roundedRectPoints(100, 50, 10)).toHaveLength(8);
    // width 12 < 2*10, so r clamps to floor(12/2)=6; the far corner sits at 2r = 12.
    const pts = roundedRectPoints(12, 40, 10);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(12, 5);
  });

  it("spans the requested size", () => {
    const pts = roundedRectPoints(80, 30, 8);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(80, 5);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(30, 5);
  });

  it("produces only finite coordinates", () => {
    const n = nums(roundedRectPath(24, 22, 11));
    expect(n.every((x) => Number.isFinite(x))).toBe(true);
    expect(n.length).toBeGreaterThan(0);
  });
});

describe("roundedBackingPath", () => {
  it("closes a finite path for a single-row profile", () => {
    const d = roundedBackingPath([{ x: 60, h: 22 }], [{ x: 0, h: 22 }], 10, false);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(nums(d).every((x) => Number.isFinite(x))).toBe(true);
  });

  it("handles a wide-over-narrow staircase without NaNs", () => {
    // A header row wider than the two indented body rows below it (a stacked `if`).
    const right = [
      { x: 120, h: 22 },
      { x: 90, h: 22 },
      { x: 40, h: 22 },
    ];
    const left = [
      { x: 0, h: 22 },
      { x: 16, h: 22 },
      { x: 16, h: 22 },
    ];
    const d = roundedBackingPath(right, left, 10, false);
    const n = nums(d);
    expect(n.length).toBeGreaterThan(0);
    expect(n.every((x) => Number.isFinite(x))).toBe(true);
    // The outline reaches the header's right edge and the full stack height.
    const xs = n.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(90);
  });
});
