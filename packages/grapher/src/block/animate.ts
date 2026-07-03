// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Fluid transitions between two frames. A frame is flattened into keyed primitives (a backing path, a
// glyph, a hole, a hit target), and two frames are tweened by key: a primitive present in both is
// interpolated (its backing path morphs coordinate by coordinate, its glyph glides), one only in the new
// frame fades in, and one only in the old frame fades out. Because the layout is computed here, the block
// shapes are recomputed and interpolated directly rather than faked with a scale transform, so a reduction
// reads as the tree flowing into its next state instead of a hard cut. Terms whose text or shape changes
// (a variable becoming a value, a form folding up) cross-fade in place.

import { roundedRectPath, roundedBackingPath } from "./geometry";
import type { BlockSettings } from "./settings";
import type { BlockBox } from "./layout";
import { lerp, ease } from "../anim";

export { ease };

/** A backing or hole outline. */
export interface PathPrim {
  t: "path";
  key: string;
  d: string;
  tx: number;
  ty: number;
  fill: string;
  stroke: string;
  op: number;
  dataPath?: string;
}

/** A glyph. */
export interface TextPrim {
  t: "text";
  key: string;
  x: number;
  y: number;
  text: string;
  fill: string;
  size: number;
  weight: boolean;
  op: number;
}

/** An invisible click target over a leaf. */
export interface HitPrim {
  t: "hit";
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  dataPath: string;
}

export type Prim = PathPrim | TextPrim | HitPrim;

const backingD = (box: Extract<BlockBox, { kind: "expr" }>, s: BlockSettings): string =>
  box.orient === "h"
    ? roundedRectPath(box.w, box.h, s.radius)
    : roundedBackingPath(box.rightProfile, box.leftProfile, s.radius, box.headerException);

/** Flatten a laid-out program into keyed primitives, in draw order (a block's backing before its
 *  contents), followed by the selection outline and handle. */
export function boxesToPrims(
  boxes: readonly BlockBox[],
  s: BlockSettings,
  selectedPath: number[] | null,
): Prim[] {
  const out: Prim[] = [];
  const draw = (box: BlockBox): void => {
    const pk = JSON.stringify(box.path);
    if (box.kind === "expr") {
      out.push({
        t: "path",
        key: `b:${pk}`,
        d: backingD(box, s),
        tx: box.x,
        ty: box.y,
        fill: box.fill,
        stroke: box.outline,
        op: 1,
        dataPath: pk,
      });
      for (const c of box.children) draw(c);
      return;
    }
    if (box.kind === "hole") {
      const ph = s.fontSize + 6;
      const py = box.y + (box.h - ph) / 2;
      out.push({
        t: "path",
        key: `b:${pk}`,
        d: roundedRectPath(box.w, ph, ph / 2),
        tx: box.x,
        ty: py,
        fill: s.holeFill,
        stroke: "none",
        op: 1,
        dataPath: pk,
      });
      out.push({
        t: "text",
        key: `t:${pk}`,
        x: box.x + box.w / 2,
        y: box.y + box.h / 2,
        text: box.text,
        fill: s.holeText,
        size: s.fontSize,
        weight: true,
        op: 1,
      });
      return;
    }
    out.push({ t: "hit", key: `r:${pk}`, x: box.x, y: box.y, w: box.w, h: box.h, dataPath: pk });
    out.push({
      t: "text",
      key: `t:${pk}`,
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
      text: box.text,
      fill: box.color,
      size: s.fontSize,
      weight: false,
      op: 1,
    });
  };
  for (const b of boxes) draw(b);

  if (selectedPath !== null) {
    const sel = findBox(boxes, selectedPath);
    if (sel !== null) {
      const selD =
        sel.kind === "expr"
          ? backingD(sel, s)
          : roundedRectPath(sel.w, sel.h, sel.kind === "hole" ? s.radiusAdj : s.radius);
      out.push({
        t: "path",
        key: "sel",
        d: selD,
        tx: sel.x,
        ty: sel.y,
        fill: "none",
        stroke: s.selectedColor,
        op: 1,
      });
      const hh = s.unitHeight;
      const hw = s.unitWidth * 1.8;
      const hx = sel.x - hw - s.unitWidth * 0.4;
      const hy = sel.y + sel.h / 2 - hh / 2;
      out.push({
        t: "path",
        key: "hbg",
        d: roundedRectPath(hw, hh, s.radiusAdj),
        tx: hx,
        ty: hy,
        fill: s.selectedColor,
        stroke: "none",
        op: 1,
      });
      out.push({
        t: "text",
        key: "harrow",
        x: hx + hw / 2,
        y: hy + hh / 2,
        text: "→",
        fill: s.selectedAtomColor,
        size: s.fontSize,
        weight: false,
        op: 1,
      });
    }
  }
  return out;
}

function findBox(boxes: readonly BlockBox[], path: readonly number[]): BlockBox | null {
  const same = (a: readonly number[]): boolean =>
    a.length === path.length && a.every((v, i) => v === path[i]);
  const walk = (b: BlockBox): BlockBox | null => {
    if (same(b.path)) return b;
    if (b.kind === "expr")
      for (const c of b.children) {
        const hit = walk(c);
        if (hit !== null) return hit;
      }
    return null;
  };
  for (const b of boxes) {
    const hit = walk(b);
    if (hit !== null) return hit;
  }
  return null;
}

const NUM = /-?\d+(\.\d+)?/g;

/** Interpolate two path strings that share command structure (same number of coordinates). */
function lerpD(a: string, b: string, t: number): string {
  const na = a.match(NUM);
  const nb = b.match(NUM);
  if (na === null || nb === null || na.length !== nb.length) return b;
  let i = 0;
  return b.replace(NUM, () => {
    const v = lerp(Number(na[i]!), Number(nb[i]!), t);
    i++;
    return (Math.round(v * 100) / 100).toString();
  });
}

/** Whether two primitives can morph into each other, or must cross-fade. */
function compatible(p: Prim, n: Prim): boolean {
  if (p.t !== n.t) return false;
  if (p.t === "path" && n.t === "path")
    return (p.d.match(NUM)?.length ?? 0) === (n.d.match(NUM)?.length ?? 0);
  if (p.t === "text" && n.t === "text") return p.text === n.text;
  return true;
}

function faded(p: Prim, op: number): Prim {
  return p.t === "hit" ? p : { ...p, op };
}

function morph(p: Prim, n: Prim, t: number): Prim {
  if (p.t === "path" && n.t === "path")
    return {
      ...n,
      d: lerpD(p.d, n.d, t),
      tx: lerp(p.tx, n.tx, t),
      ty: lerp(p.ty, n.ty, t),
      op: lerp(p.op, n.op, t),
    };
  if (p.t === "text" && n.t === "text")
    // Slide straight into place. Nested boxes read best when a glyph moves directly to its slot; an arc here
    // bows a short horizontal move sideways and looks like a hop rather than settling in.
    return {
      ...n,
      x: lerp(p.x, n.x, t),
      y: lerp(p.y, n.y, t),
      size: lerp(p.size, n.size, t),
      op: lerp(p.op, n.op, t),
    };
  return n;
}

function push(m: Map<string, TextPrim[]>, k: string, v: TextPrim): void {
  const arr = m.get(k);
  if (arr === undefined) m.set(k, [v]);
  else arr.push(v);
}

/** The frame at time `t` (already eased, 0..1) between `prev` and `next`. Hit targets are dropped during a
 *  tween; they return once it settles. */
export function interpolate(prev: readonly Prim[], next: readonly Prim[], t: number): Prim[] {
  const prevMap = new Map(prev.map((p) => [p.key, p]));
  const nextKeys = new Set(next.map((n) => n.key));

  // Content matching: an atom glyph that persists but moved (its path, and so its key, changed) glides
  // from its old spot to its new one, the way a matching part of an equation travels to its new position.
  // Match only when the text is unique on both sides, so there is no ambiguity about which went where.
  const exitingByText = new Map<string, TextPrim[]>();
  const enteringByText = new Map<string, TextPrim[]>();
  for (const p of prev)
    if (p.t === "text" && !p.weight && !nextKeys.has(p.key)) push(exitingByText, p.text, p);
  for (const n of next)
    if (n.t === "text" && !n.weight && !prevMap.has(n.key)) push(enteringByText, n.text, n);
  const glideFrom = new Map<string, Prim>();
  const glided = new Set<string>();
  for (const [txt, ns] of enteringByText) {
    const ps = exitingByText.get(txt);
    if (ns.length === 1 && ps !== undefined && ps.length === 1) {
      glideFrom.set(ns[0]!.key, ps[0]!);
      glided.add(ps[0]!.key);
    }
  }

  const out: Prim[] = [];
  for (const n of next) {
    if (n.t === "hit") continue;
    const p = prevMap.get(n.key) ?? glideFrom.get(n.key);
    if (p === undefined) {
      out.push(faded(n, t)); // entering: fade in
    } else if (compatible(p, n)) {
      out.push(morph(p, n, t)); // updating or gliding
    } else {
      out.push(faded(n, t)); // cross-fade: new in over old out
      out.push(faded({ ...p, key: `${p.key}:x` }, 1 - t));
    }
  }
  for (const p of prev) {
    if (p.t === "hit") continue;
    if (!nextKeys.has(p.key) && !glided.has(p.key)) out.push(faded(p, 1 - t)); // exiting: fade out
  }
  return out;
}
