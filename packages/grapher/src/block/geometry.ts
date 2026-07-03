// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The block geometry. Blocks are drawn as "pulled
// point" polygons: a closed path whose every corner is a cubic Bezier whose control points are found by
// rotating and scaling the edge vector, so a run of rows becomes one smooth outline that curves outward
// where a row juts out and inward (concave) where it tucks in. Two builders sit on top of that path: a
// plain rounded rectangle (for a single-line block and for atom backings) and a rounded backing that
// follows a stack of rows of differing widths (for a multi-line block).
//
// Coordinates match SVG: x grows right, y grows down. The curve math is the exact port of the source's
// polygon renderer: for the edge from P to Q, control1 = P + rpull(P) * rot(Q-P, rangle(P)) and
// control2 = Q + lpull(Q) * rot(P-Q, langle(Q)), where rot scales-and-rotates a vector (complex
// multiply). Angles are relative to the edge and pulls are fractions of its length.

/** One vertex of a pulled-point polygon: the point, plus the incoming (l) and outgoing (r) Bezier pulls
 *  and angles (degrees). */
export interface PulledPoint {
  lpull: number;
  langle: number;
  x: number;
  y: number;
  rpull: number;
  rangle: number;
}

/** A row of a backing profile: `x` is the edge (right edge for the right profile, left edge for the left)
 *  and `h` is the row height. */
export interface ProfileRow {
  x: number;
  h: number;
}

/** The empirical roundness constant from the source (both here and in the rounded rectangle). */
const T = 0.39;

/** Rotate-and-scale a vector by `deg` degrees (the real part of a complex multiply by e^{i deg}). */
function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Trim a number for a compact path string. */
function f(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** Build an SVG path from a closed loop of pulled points: one cubic Bezier per edge, wrapping the last
 *  point back to the first. */
export function pulledPointsToPath(points: readonly PulledPoint[]): string {
  const n = points.length;
  if (n === 0) return "";
  const first = points[0]!;
  let d = `M ${f(first.x)} ${f(first.y)}`;
  for (let i = 0; i < n; i++) {
    const prev = points[i]!;
    const cur = points[(i + 1) % n]!;
    const vx = cur.x - prev.x;
    const vy = cur.y - prev.y;
    const r1 = rot(vx, vy, prev.rangle);
    const c1x = prev.x + prev.rpull * r1.x;
    const c1y = prev.y + prev.rpull * r1.y;
    const r2 = rot(-vx, -vy, cur.langle);
    const c2x = cur.x + cur.lpull * r2.x;
    const c2y = cur.y + cur.lpull * r2.y;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(cur.x)} ${f(cur.y)}`;
  }
  return d + " Z";
}

/** The eight pulled points of a rounded rectangle of the given size and corner radius. The radius is
 *  clamped so a box narrower than two radii stays a stadium rather than self-intersecting. */
export function roundedRectPoints(width: number, height: number, initR: number): PulledPoint[] {
  const r = width < 2 * initR ? Math.floor(width / 2) : Math.round(initR);
  const sl = Math.max(0, width - 2 * r);
  const sh = Math.max(0, height - 2 * r);
  return [
    { lpull: 0, langle: 0, x: 0, y: r, rpull: T, rangle: -45 },
    { lpull: T, langle: 45, x: r, y: 0, rpull: 0, rangle: 0 },
    { lpull: 0, langle: 0, x: r + sl, y: 0, rpull: T, rangle: -45 },
    { lpull: T, langle: 45, x: 2 * r + sl, y: r, rpull: 0, rangle: 0 },
    { lpull: 0, langle: 0, x: 2 * r + sl, y: r + sh, rpull: T, rangle: -45 },
    { lpull: T, langle: 45, x: r + sl, y: 2 * r + sh, rpull: 0, rangle: 0 },
    { lpull: 0, langle: 0, x: r, y: 2 * r + sh, rpull: T, rangle: -45 },
    { lpull: T, langle: 45, x: 0, y: r + sh, rpull: T, rangle: 0 },
  ];
}

/** A rounded rectangle path. */
export function roundedRectPath(width: number, height: number, r: number): string {
  return pulledPointsToPath(roundedRectPoints(width, height, r));
}

interface AugRow {
  w: number;
  h: number;
  ltp: number;
  ltn: number;
}

/** +polarity if a>b, 0 if equal, -polarity if a<b. */
function sign3(a: number, b: number, polarity: number): number {
  if (a > b) return polarity;
  if (a === b) return 0;
  return -polarity;
}

/** Tag each row with whether it is longer than the previous (ltp) and next (ltn) row, so a corner knows
 *  to curve out or in. `init` seeds the comparison at both ends. */
function augment(polarity: number, init: number, rows: readonly ProfileRow[]): AugRow[] {
  const withLtp: AugRow[] = [];
  let prev = init;
  for (const row of rows) {
    withLtp.push({ w: row.x, h: row.h, ltp: sign3(row.x, prev, polarity), ltn: 0 });
    prev = row.x;
  }
  let next = init;
  for (let i = withLtp.length - 1; i >= 0; i--) {
    const row = withLtp[i]!;
    row.ltn = sign3(row.w, next, polarity);
    next = row.w;
  }
  return withLtp;
}

/** The four pulled points of one profile row (its two corners, each split into two points). */
function fourPointRow(
  p: number,
  n: number,
  offset: number,
  ltp: number,
  ltn: number,
  initH: number,
  finalH: number,
  r: number,
): PulledPoint[] {
  const y1 = 2 * n * r + initH;
  const y2 = 2 * n * r + p * r + initH;
  const y3 = 2 * n * r + p * r + finalH;
  const y4 = 2 * n * r + p * 2 * r + finalH;
  const x1 = offset + -p * ltp * r;
  const x2 = offset;
  const x3 = offset;
  const x4 = offset + -p * ltn * r;
  return [
    { lpull: T, langle: 0, x: x1, y: y1, rpull: T, rangle: ltp * -45 },
    { lpull: T, langle: ltp * 45, x: x2, y: y2, rpull: T, rangle: 0 },
    { lpull: T, langle: 0, x: x3, y: y3, rpull: T, rangle: ltn * -45 },
    { lpull: T, langle: ltn * 45, x: x4, y: y4, rpull: T, rangle: 0 },
  ];
}

/** Walk a list of rows top-down (p=+1) or bottom-up (p=-1), accumulating pulled points and the running
 *  row count and height. */
function calcRows(
  p: number,
  init: number,
  numRows: number,
  totalH: number,
  rows: readonly ProfileRow[],
  headerException: boolean,
  r: number,
): { points: PulledPoint[]; numRows: number; totalH: number } {
  const aug = augment(p, init, rows);
  if (headerException && aug.length > 0) aug[0]!.ltn = Math.abs(aug[0]!.ltn);
  const points: PulledPoint[] = [];
  let n = numRows;
  let h = totalH;
  for (const row of aug) {
    points.push(...fourPointRow(p, n, row.w, row.ltp, row.ltn, h, h + p * row.h, r));
    n = n + p;
    h = h + p * row.h;
  }
  return { points, numRows: n, totalH: h };
}

/** The pulled points of a backing that follows a stack of rows: the right profile drawn top-down, then
 *  the left profile drawn bottom-up, closing into one outline. Each row's height is reduced by two radii
 *  first (the corners add them back), so a row is exactly as tall as its content plus its rounding. */
export function roundedBackingPoints(
  rightProfile: readonly ProfileRow[],
  leftProfile: readonly ProfileRow[],
  r: number,
  headerException: boolean,
): PulledPoint[] {
  const srcRight = rightProfile.map((row) => ({ x: row.x, h: row.h - 2 * r }));
  const srcLeft = leftProfile.map((row) => ({ x: row.x, h: row.h - 2 * r }));
  const right = calcRows(1, 0, 0, 0, srcRight, headerException, r);
  const left = calcRows(
    -1,
    Infinity,
    right.numRows,
    right.totalH,
    [...srcLeft].reverse(),
    false,
    r,
  );
  return [...right.points, ...left.points];
}

/** A rounded backing path from its right and left row profiles. */
export function roundedBackingPath(
  rightProfile: readonly ProfileRow[],
  leftProfile: readonly ProfileRow[],
  r: number,
  headerException: boolean,
): string {
  return pulledPointsToPath(roundedBackingPoints(rightProfile, leftProfile, r, headerException));
}
