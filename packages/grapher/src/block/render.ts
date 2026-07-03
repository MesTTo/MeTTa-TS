// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Draws a laid-out block tree into an <svg>, and animates between frames. Each frame is flattened into
// keyed primitives (a backing, a glyph, a hole, a hit target); a plain render paints them, and an animated
// render tweens from the previous frame so a reduction flows into its next state: backings morph, glyphs
// glide, and the view box eases with them. Every element carries its path so the view can tell which term
// was clicked. The whole program is fit into the view box so it scales to the container.

import type { BlockSettings } from "./settings";
import type { BlockBox } from "./layout";
import { boxesToPrims, interpolate, ease, type Prim } from "./animate";

const SVG_NS = "http://www.w3.org/2000/svg";
const DURATION = 320; // ms

const CSS = `
.blk-svg { width: 100%; height: 100%; display: block; overflow: clip; user-select: none;
  font-family: Iosevka, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.blk-block { stroke-width: 1; }
.blk-glyph { text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.blk-hole-text { text-anchor: middle; dominant-baseline: central; pointer-events: none; font-weight: 600; }
.blk-hit { fill: transparent; }
.blk-sel { fill: none; stroke-width: 2; }
`;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Measure the advance of the monospace font at `fontSize` so layout lines up with what is drawn. */
export function measureUnitWidth(fontSize: number): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx === null) return fontSize * 0.6;
  ctx.font = `${fontSize}px Iosevka, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  const w = ctx.measureText("M").width;
  return w > 0 ? w : fontSize * 0.6;
}

/** Find the box at `path`, or null. */
export function findByPath(boxes: readonly BlockBox[], path: readonly number[]): BlockBox | null {
  const same = (a: readonly number[]): boolean =>
    a.length === path.length && a.every((v, i) => v === path[i]);
  const walk = (box: BlockBox): BlockBox | null => {
    if (same(box.path)) return box;
    if (box.kind === "expr")
      for (const c of box.children) {
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

/** Owns the <svg> for the block view and redraws the whole program, optionally animating from the last
 *  frame. */
export class BlockRenderer {
  readonly svg: SVGSVGElement;
  private readonly scene: SVGGElement;
  private settled: Prim[] = [];
  private pending: Prim[] | null = null;
  private settledRect: Rect | null = null;
  private raf = 0;
  // User zoom/pan, layered on top of the auto-fit view box as a transform on the scene group.
  private readonly viewport = { scale: 1, panX: 0, panY: 0 };
  private shownRect: Rect = { x: 0, y: 0, w: 1, h: 1 };

  constructor(container: HTMLElement) {
    this.svg = el("svg", { class: "blk-svg" });
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = CSS;
    this.svg.appendChild(style);
    this.scene = el("g", { class: "blk-scene" });
    this.svg.appendChild(this.scene);
    container.appendChild(this.svg);
  }

  /** Redraw the program. When `animate` is set and a previous frame exists, tween into the new one. */
  render(
    boxes: readonly BlockBox[],
    s: BlockSettings,
    selectedPath: number[] | null,
    animate = false,
  ): void {
    this.svg.style.background = s.canvas;
    const next = boxesToPrims(boxes, s, selectedPath);
    const nextRect = this.rectFor(boxes, s);
    const canAnimate =
      animate &&
      this.settled.length > 0 &&
      this.settledRect !== null &&
      typeof requestAnimationFrame !== "undefined";

    if (!canAnimate) {
      if (this.raf !== 0) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
      this.paint(next);
      this.setViewBox(nextRect);
      this.settled = next;
      this.settledRect = nextRect;
      this.pending = null;
      return;
    }

    // Snap any in-flight tween to its target, then animate from there to the new frame.
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.pending !== null) this.settled = this.pending;
    }
    const from = this.settled;
    const fromRect = this.settledRect ?? nextRect;
    this.pending = next;
    const start = performance.now();
    const step = (now: number): void => {
      const p = Math.min(1, (now - start) / DURATION);
      const t = ease(p);
      this.paint(interpolate(from, next, t));
      this.setViewBox(lerpRect(fromRect, nextRect, t));
      if (p < 1) {
        this.raf = requestAnimationFrame(step);
      } else {
        this.raf = 0;
        this.paint(next);
        this.setViewBox(nextRect);
        this.settled = next;
        this.settledRect = nextRect;
        this.pending = null;
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  private paint(prims: readonly Prim[]): void {
    const out: SVGElement[] = [];
    for (const p of prims) {
      if (p.t === "path") {
        const attrs: Record<string, string | number> = {
          class: p.key === "sel" ? "blk-sel" : "blk-block",
          d: p.d,
          transform: `translate(${p.tx} ${p.ty})`,
          fill: p.fill,
          stroke: p.stroke,
          opacity: p.op,
        };
        if (p.dataPath !== undefined) attrs["data-path"] = p.dataPath;
        out.push(el("path", attrs));
      } else if (p.t === "text") {
        const node = el("text", {
          class: p.weight ? "blk-hole-text" : "blk-glyph",
          x: p.x,
          y: p.y,
          "font-size": p.size,
          fill: p.fill,
          opacity: p.op,
        });
        node.textContent = p.text;
        out.push(node);
      } else {
        out.push(
          el("rect", {
            class: "blk-hit",
            "data-path": p.dataPath,
            x: p.x,
            y: p.y,
            width: p.w,
            height: p.h,
          }),
        );
      }
    }
    this.scene.replaceChildren(...out);
  }

  private setViewBox(r: Rect): void {
    this.shownRect = r;
    this.svg.setAttribute("viewBox", `${r.x} ${r.y} ${r.w} ${r.h}`);
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    this.applyViewport();
  }

  /** Apply the user zoom/pan as a transform on the scene group, centered on the shown view box so zoom
   *  grows toward the middle rather than a corner. Re-applied on every frame (the group survives a repaint
   *  and keeps its transform), so a zoomed view stays zoomed as the program reduces. */
  private applyViewport(): void {
    const { x, y, w, h } = this.shownRect;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const { scale, panX, panY } = this.viewport;
    const tx = cx - cx * scale + panX;
    const ty = cy - cy * scale + panY;
    this.scene.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
  }

  /** Zoom in (factor > 1) or out (factor < 1), around the center. */
  zoomBy(factor: number): void {
    this.viewport.scale = Math.min(5, Math.max(0.2, this.viewport.scale * factor));
    this.applyViewport();
  }

  /** Pan by a screen-space delta, converted into view-box units through the current fit. */
  panBy(dx: number, dy: number): void {
    const { w, h } = this.shownRect;
    const sw = this.svg.clientWidth || 800;
    const sh = this.svg.clientHeight || 440;
    const fit = Math.min(sw / w, sh / h) || 1;
    this.viewport.panX += dx / fit;
    this.viewport.panY += dy / fit;
    this.applyViewport();
  }

  /** Reset zoom/pan so the auto-fit frames the whole program again. */
  resetViewport(): void {
    this.viewport.scale = 1;
    this.viewport.panX = 0;
    this.viewport.panY = 0;
    this.applyViewport();
  }

  /** The view box that frames the whole program with padding and room for the selection handle. */
  private rectFor(boxes: readonly BlockBox[], s: BlockSettings): Rect {
    if (boxes.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const pad = s.unitHeight;
    const x = minX - pad - s.unitWidth * 2.5;
    const y = minY - pad;
    return { x, y, w: maxX - x + pad, h: maxY - y + pad };
  }

  destroy(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.svg.remove();
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}
