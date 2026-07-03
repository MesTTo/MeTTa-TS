// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The pan and zoom transform between world coordinates (where nodes live) and screen coordinates (where
// the pointer is). Kept pure and separate from the DOM so the transforms, and the "zoom toward the
// cursor" behavior, can be unit-tested.

/** A pan offset and a scale. Screen = world * scale + pan. */
export interface Viewport {
  panX: number;
  panY: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The identity viewport (no pan, unit scale). */
export function initialViewport(): Viewport {
  return { panX: 0, panY: 0, scale: 1 };
}

/** Screen point to world point. */
export function toWorld(v: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - v.panX) / v.scale, y: (sy - v.panY) / v.scale };
}

/** World point to screen point. */
export function toScreen(v: Viewport, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * v.scale + v.panX, y: wy * v.scale + v.panY };
}

/** Pan by a screen-space delta. */
export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { scale: v.scale, panX: v.panX + dx, panY: v.panY + dy };
}

/** Scale by `factor` while keeping the world point under screen `(sx, sy)` fixed (zoom toward cursor). */
export function zoomAt(v: Viewport, sx: number, sy: number, factor: number): Viewport {
  const world = toWorld(v, sx, sy);
  const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
  return { scale, panX: sx - world.x * scale, panY: sy - world.y * scale };
}
