// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The graph playthrough morph: shared subterms glide, appearing/vanishing ones fade, the viewport eases.
// The interpolation is pure, so it is checked here at fixed points without a frame clock (the rAF loop that
// drives it is a thin wrapper). Matches the block view's morph, in the spirit of Manim's matching transforms.

import { describe, it, expect } from "vitest";
import { atomToGraph } from "./atom";
import { parseProgram } from "./parse";
import { traceFrame, interpolateTrace, type TraceFrame } from "./render";
import type { Viewport } from "./viewport";

const VP: Viewport = { scale: 1, panX: 0, panY: 0 };
const frame = (src: string): TraceFrame => traceFrame(atomToGraph(parseProgram(src)), VP);
const opsSorted = (f: TraceFrame, g: TraceFrame, t: number): number[] =>
  interpolateTrace(f, g, t)
    .nodes.map((n) => n.op)
    .sort((a, b) => a - b);

describe("trace morph interpolation", () => {
  it("shows the from-step at t=0 and the to-step at t=1", () => {
    const a = frame("(fact 5)");
    const b = frame("(if (> 5 0) (* 5 (fact (- 5 1))) 1)");
    expect(interpolateTrace(a, b, 0).nodes.length).toBe(a.slots.length);
    expect(interpolateTrace(a, b, 1).nodes.length).toBe(b.slots.length);
  });

  it("keeps shared nodes opaque and fades a new one in by t", () => {
    // (f 5) -> (f 5 7): the `7` is new at the h0.1 slot; f and 5 are shared.
    expect(opsSorted(frame("(f 5)"), frame("(f 5 7)"), 0.5)).toEqual([0.5, 1, 1]);
  });

  it("keeps a consumed node solid while it merges in, fading only at the very end", () => {
    // (f 5 7) -> (f 5): the 7 is drawn into the parent, so it stays opaque through the merge rather than
    // fading out, and only dissolves right at the end.
    const ops = (t: number) =>
      interpolateTrace(frame("(f 5 7)"), frame("(f 5)"), t).nodes.map((n) => n.op);
    expect(ops(0.5).filter((o) => o > 0.99)).toHaveLength(3); // f, 5, and the merging 7 all solid
    expect(Math.min(...ops(0.95))).toBeLessThan(0.5); // fades only near the end
  });

  it("draws a consumed subterm straight toward the parent it merges into", () => {
    const a = frame("(f 5 7)"); // f=h0, 5=h0.0, 7=h0.1
    const b = frame("(f 5)"); // 7 is consumed; f and 5 survive
    const parent = b.slots.find((s) => s.key === "h0")!;
    const gone7 = a.slots.find((s) => s.key === "h0.1")!;
    // the 7 is somewhere along the straight line from its own spot toward the parent, closer than it started
    const near = (n: { x: number; y: number }) =>
      Math.hypot(n.x - (gone7.x + parent.x) / 2, n.y - (gone7.y + parent.y) / 2);
    const merging = interpolateTrace(a, b, 0.5).nodes.reduce((best, n) =>
      near(n) < near(best) ? n : best,
    );
    expect(Math.hypot(merging.x - parent.x, merging.y - parent.y)).toBeLessThan(
      Math.hypot(gone7.x - parent.x, gone7.y - parent.y),
    );
  });

  it("moves a shared node from its old place to its new one, arriving exactly", () => {
    const a = frame("(f 5)");
    const b: TraceFrame = {
      ...a,
      slots: a.slots.map((s) => ({ ...s, x: s.x + 100, y: s.y + 40 })),
    };
    const xs = (f: TraceFrame) => f.slots.map((s) => s.x).sort((p, q) => p - q);
    const atX = (t: number) =>
      interpolateTrace(a, b, t)
        .nodes.map((n) => n.x)
        .sort((p, q) => p - q);
    expect(atX(0)).toEqual(xs(a)); // arc offset is zero at both ends
    expect(atX(1)).toEqual(xs(b));
  });

  it("morphs an operation into its result in place (the diamond becomes the value)", () => {
    // (* 1 1) -> 1: the * expression at the root matches the value and morphs into it, so its shape and text
    // interpolate (two texts crossfading in one node) rather than the * dissolving while a separate value
    // fades in beside it. A leaf becoming an expression is still blocked; an expression becoming a value is not.
    const mid = interpolateTrace(frame("(* 1 1)"), frame("1"), 0.5).nodes;
    expect(mid.some((n) => n.texts.length === 2)).toBe(true);
  });

  it("keeps a repeated value in place instead of gliding it to another copy", () => {
    // (g 3 (h 3)) -> (g 3 (k 3)): the outer 3 at h0.0 is unchanged; it must not be sent to the inner 3
    const a = frame("(g 3 (h 3))");
    const b = frame("(g 3 (k 3))");
    const outer = a.slots.find((s) => s.key === "h0.0")!; // the unchanged outer 3
    const mid = interpolateTrace(a, b, 0.5).nodes;
    expect(mid.some((n) => Math.hypot(n.x - outer.x, n.y - outer.y) < 1e-6)).toBe(true);
  });

  it("fills a hollow variable in as it becomes its bound value", () => {
    const a = frame("(f $n)"); // $n is a hollow slot
    const b = frame("(f 3)"); // it becomes the solid value 3
    // the arg node's fill opacity ramps 0 (hollow) -> 1 (solid) across the morph
    expect(interpolateTrace(a, b, 0).nodes.some((n) => n.fillOp === 0)).toBe(true);
    expect(interpolateTrace(a, b, 0.5).nodes.some((n) => Math.abs(n.fillOp - 0.5) < 1e-6)).toBe(
      true,
    );
    expect(interpolateTrace(a, b, 1).nodes.every((n) => n.fillOp === 1)).toBe(true);
  });

  it("spotlights the redex early in the step, fading it out by the end", () => {
    const a = frame("(f (g 1))"); // f=h0, (g 1)=h0.0, 1=h0.0.0
    const b = frame("(f 2)"); // (g 1) reduced to 2; the redex is (g 1) at h0.0
    const redexRoot = a.slots.find((s) => s.key === "h0.0")!;
    const early = interpolateTrace(a, b, 0.1).redex;
    expect(early).toBeDefined();
    expect(Math.hypot(early!.x - redexRoot.x, early!.y - redexRoot.y)).toBeLessThan(40);
    expect(early!.op).toBeGreaterThan(0.5);
    expect(interpolateTrace(a, b, 1).redex).toBeUndefined(); // gone once the step settles
  });

  it("eases the viewport between the two fits", () => {
    const a = frame("(f 5)");
    const from: TraceFrame = { ...a, viewport: { scale: 1, panX: 0, panY: 0 } };
    const to: TraceFrame = { ...a, viewport: { scale: 2, panX: 10, panY: 20 } };
    expect(interpolateTrace(from, to, 0.5).viewport).toEqual({ scale: 1.5, panX: 5, panY: 10 });
  });
});
