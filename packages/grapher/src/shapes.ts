// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Node shapes as boundary point sets, so a node that changes role during a reduction can morph from one
// shape to another (a rounded box growing into a diamond, a pill rounding into a circle) rather than
// snapping. Following the shape-interpolation technique flubber uses: sample both shapes into the same
// number of points and lerp point-for-point. Our shapes are convex and centered, so sampling by angle
// (a ray cast from the center at N even angles) aligns the two point sets automatically, with no rotation
// matching to do.

import { NODE_H, nodeWidth } from "./measure";
import { roleOf } from "./color";
import type { GraphNode } from "./model";

/** Points per rounded corner: enough that a pill reads as a smooth curve. */
const CORNER_SEG = 6;

type Pt = [number, number];

/** The boundary polygon of a node's shape, centered at the origin, matching the crisp shapes the static
 *  renderer draws. Rounded corners are tessellated so any two shapes are sample-able. */
function shapePolygon(role: string, w: number): Pt[] {
  const hw = w / 2;
  const hh = NODE_H / 2;
  switch (role) {
    case "operator":
    case "control":
      return [
        [0, -hh],
        [hw, 0],
        [0, hh],
        [-hw, 0],
      ]; // diamond
    case "variable":
      return ellipse(hw, hh); // hollow circle
    case "number":
    case "string":
      return roundedRect(hw, hh, hh); // pill
    case "boolean":
      return roundedRect(hw, hh, 3); // square
    case "list":
      return [
        [-hw + 7, -hh],
        [hw - 7, -hh],
        [hw, 0],
        [hw - 7, hh],
        [-hw + 7, hh],
        [-hw, 0],
      ]; // hexagon
    default:
      return roundedRect(hw, hh, 5); // rounded rectangle
  }
}

function ellipse(hw: number, hh: number): Pt[] {
  const n = 24;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([hw * Math.cos(a), hh * Math.sin(a)]);
  }
  return out;
}

function roundedRect(hw: number, hh: number, r: number): Pt[] {
  const rr = Math.min(r, hw, hh);
  const out: Pt[] = [];
  // four corner centers, walked counter-clockwise, each swept through a quarter turn
  const corners: Array<[number, number, number]> = [
    [hw - rr, hh - rr, 0],
    [-(hw - rr), hh - rr, Math.PI / 2],
    [-(hw - rr), -(hh - rr), Math.PI],
    [hw - rr, -(hh - rr), (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= CORNER_SEG; i++) {
      const a = a0 + (i / CORNER_SEG) * (Math.PI / 2);
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  return out;
}

/** Where a ray from the origin at angle `ang` exits the convex boundary `poly`. */
function raycast(poly: Pt[], ang: number): Pt {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  let best = Infinity;
  let hit: Pt = [0, 0];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    const ex = x2 - x1;
    const ey = y2 - y1;
    const det = ex * dy - dx * ey;
    if (Math.abs(det) < 1e-9) continue;
    const t = (ex * y1 - ey * x1) / det; // distance along the ray
    const s = (dx * y1 - dy * x1) / det; // position along the edge
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6 && t < best) {
      best = t;
      hit = [t * dx, t * dy];
    }
  }
  return hit;
}

/** `n` boundary points of a node's shape, sampled at even angles so two shapes align point-for-point and
 *  can be lerped into one another. */
export function shapePoints(node: GraphNode, n: number): Pt[] {
  const role = node.kind === "symbol" ? roleOf(node.name) : node.kind;
  const poly = shapePolygon(role, nodeWidth(node));
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(raycast(poly, (2 * Math.PI * i) / n));
  return out;
}

/** An SVG polygon `points` string from a point set. */
export function pointsAttr(points: readonly Pt[]): string {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}
