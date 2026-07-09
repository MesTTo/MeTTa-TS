// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Shared motion primitives for both views' reduction animations, so the graph and the blocks move with the
// same feel. The easing and the arced travel are the vocabulary math-animation tools use to make a rewrite
// read as one part flowing into the next (Manim's rate functions and its path_arc for matched parts).

/** Linear interpolation. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smootherstep (Perlin): zero first, second, and third derivatives at both ends, so motion starts and
 *  stops with no visible jerk. This is the rate function math animations reach for to get a settled feel. */
export function ease(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** How long one reduction step's morph runs (ms) unless a host retimes it with setTraceDuration. Long
 *  enough that a rewrite reads as one part flowing into the next at the default playback pace, and the
 *  GIF exporters derive their frame counts from the same span, so an export glides like the live view. */
export const DEFAULT_TRACE_MS = 550;

/** A point along a gentle arc from (ax,ay) to (bx,by), bowed to the side, so a moving part curves into its
 *  place rather than sliding straight, the way an equation's terms rotate when it is rearranged. The bow is
 *  zero at both ends and capped so long moves do not swing wildly. */
export function arcPoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  t: number,
): { x: number; y: number } {
  const mx = lerp(ax, bx, t);
  const my = lerp(ay, by, t);
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { x: mx, y: my };
  const off = Math.sin(Math.PI * t) * Math.min(dist * 0.16, 36);
  return { x: mx + (-dy / dist) * off, y: my + (dx / dist) * off };
}
