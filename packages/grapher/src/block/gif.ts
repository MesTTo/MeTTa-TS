// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Export a reduction as an animated GIF. Each frame of the block animation is rendered to an SVG string,
// rasterized on an offscreen canvas, and encoded by a caller-provided GIF encoder. The encoder is passed
// in rather than imported, so this package stays dependency-free: only a consumer that wants GIF export
// installs one (gifenc) and hands it over. The frames are the same morph the live view plays, over a fixed
// view box (the union of every state's bounds) so the animation does not jump or rescale.

import type { Atom } from "@metta-ts/hyperon";
import type { BlockSettings } from "./settings";
import { placeProgram, type BlockBox } from "./layout";
import { boxesToPrims, interpolate, ease, type Prim } from "./animate";

/** The slice of the `gifenc` module this needs. Pass `await import("gifenc")` (or `import * as`) here. */
export interface GifEncoderLib {
  GIFEncoder: () => {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: number[][]; delay: number },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  quantize: (rgba: Uint8Array | Uint8ClampedArray, maxColors: number) => number[][];
  applyPalette: (rgba: Uint8Array | Uint8ClampedArray, palette: number[][]) => Uint8Array;
}

/** How to render the GIF. */
export interface GifOptions {
  /** Output width in pixels (height follows the aspect ratio). Default 720. */
  width?: number;
  /** Morph frames per reduction step. Default 6, reduced to keep under `maxFrames`. */
  framesPerStep?: number;
  /** Cap on the total number of frames. Default 180. */
  maxFrames?: number;
  /** Milliseconds to hold each settled state. Default 260. */
  holdMs?: number;
  /** Milliseconds per morph frame. Default 40. */
  stepMs?: number;
  /** Canvas background color. Used by the graph GIF, which has no block palette to take it from. */
  background?: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The bounding box of a program's blocks, padded. */
export function boundsOf(boxes: readonly BlockBox[], s: BlockSettings): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (b: BlockBox): void => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
    if (b.kind === "expr") for (const c of b.children) walk(c);
  };
  for (const b of boxes) walk(b);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = s.unitHeight;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
export const FONT = "Iosevka, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** One frame of primitives as a self-contained SVG string, filled with the background. */
export function frameSvg(
  prims: readonly Prim[],
  vb: Rect,
  w: number,
  h: number,
  bg: string,
): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${round(vb.x)} ${round(vb.y)} ${round(vb.w)} ${round(vb.h)}">`,
    `<rect x="${round(vb.x)}" y="${round(vb.y)}" width="${round(vb.w)}" height="${round(vb.h)}" fill="${bg}"/>`,
  ];
  for (const p of prims) {
    if (p.t === "path") {
      parts.push(
        `<path d="${p.d}" transform="translate(${round(p.tx)} ${round(p.ty)})" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1" opacity="${round(p.op)}"/>`,
      );
    } else if (p.t === "text") {
      const weight = p.weight ? ' font-weight="600"' : "";
      parts.push(
        `<text x="${round(p.x)}" y="${round(p.y)}" font-size="${p.size}" fill="${p.fill}" opacity="${round(p.op)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}"${weight}>${esc(p.text)}</text>`,
      );
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

/** Encode a sequence of reduction states into an animated GIF, morphing between them. Each state is a
 *  frontier (one or more terms), so a nondeterministic step shows every branch. */
export async function reductionGif(
  states: readonly Atom[][],
  s: BlockSettings,
  lib: GifEncoderLib,
  opts: GifOptions = {},
): Promise<Blob> {
  if (states.length === 0) throw new Error("no reduction states to export");
  const width = opts.width ?? 720;
  const holdMs = opts.holdMs ?? 260;
  const stepMs = opts.stepMs ?? 40;

  const framePrims = states.map((frontier) => boxesToPrims(placeProgram(frontier, s), s, null));
  let vb = boundsOf(placeProgram(states[0]!, s), s);
  for (const frontier of states) vb = union(vb, boundsOf(placeProgram(frontier, s), s));
  const height = Math.max(1, Math.round((width * vb.h) / vb.w));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas context for GIF export");

  const gif = lib.GIFEncoder();
  const addFrame = async (prims: readonly Prim[], delay: number): Promise<void> => {
    const svg = frameSvg(prims, vb, width, height, s.canvas);
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    ctx.fillStyle = s.canvas;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = lib.quantize(data, 256);
    const index = lib.applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay });
  };

  const n = states.length;
  const perStep = Math.max(
    1,
    Math.min(opts.framesPerStep ?? 6, Math.floor((opts.maxFrames ?? 180) / Math.max(1, n - 1))),
  );

  await addFrame(framePrims[0]!, holdMs);
  for (let i = 1; i < n; i++) {
    for (let k = 1; k <= perStep; k++) {
      const prims = interpolate(framePrims[i - 1]!, framePrims[i]!, ease(k / perStep));
      await addFrame(prims, k === perStep ? holdMs : stepMs);
    }
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
}
