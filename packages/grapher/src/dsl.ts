// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A fluent way to mount and drive the visualizer, in the style of the eDSL: `grapher(el)` returns a
// chainable handle. Load a program from source or from atoms, so eDSL output (or any grounded atoms) feeds
// it directly; choose the node graph or the blocks; recolor; fit; evaluate; or play the reduction. Then
// read the source or export the animation as a GIF. Each building step returns the handle, so a call reads
// as one sentence; `source`, `gif`, and `destroy` end the chain, and `.grapher` is the escape hatch to the
// full instance.
//
//   grapher("#app")
//     .atoms([rule(Fact(n), If(gt(n, 0), mul(n, Fact(sub(n, 1))), 1))])
//     .blocks()
//     .play();

import { type Atom } from "@metta-ts/hyperon";
import { MeTTaGrapher, type GrapherOptions } from "./editor";
import { SITE_PALETTE, TEAL_PALETTE, type BlockPalette } from "./block/settings";
import { type GifEncoderLib, type GifOptions } from "./block/gif";

/** A built-in palette name, or a custom palette. */
export type PaletteChoice = "site" | "teal" | BlockPalette;

function toPalette(p: PaletteChoice): BlockPalette {
  if (p === "site") return SITE_PALETTE;
  if (p === "teal") return TEAL_PALETTE;
  return p;
}

/** A fluent handle over a mounted {@link MeTTaGrapher}. Building steps return the handle; `source`, `gif`,
 *  and `destroy` end the chain. The full instance is on `.grapher`. */
export interface Grapher {
  readonly grapher: MeTTaGrapher;
  /** Replace the program from MeTTa source. */
  load(source: string): Grapher;
  /** Replace the program from atoms (for example built with the eDSL). */
  atoms(atoms: readonly Atom[]): Grapher;
  /** Show the node graph. */
  graph(): Grapher;
  /** Show the nested blocks. */
  blocks(): Grapher;
  /** Recolor the blocks (a built-in name or a custom palette). */
  palette(palette: PaletteChoice): Grapher;
  /** Lay the program out and frame it. */
  fit(): Grapher;
  /** Evaluate every query and label the result. */
  evaluate(): Grapher;
  /** Initialize the last query's reduction trace at its first state. */
  play(): Grapher;
  /** The current program as source, reflecting edits and reductions. */
  source(): string;
  /** Encode the reduction as an animated GIF, using a caller-supplied encoder (gifenc). */
  gif(encoder: GifEncoderLib, opts?: GifOptions): Promise<Blob | null>;
  /** Detach listeners and remove the editor. */
  destroy(): void;
}

/** Mount the visualizer on an element (or a CSS selector) and return a fluent handle. */
export function grapher(target: string | HTMLElement, opts: GrapherOptions = {}): Grapher {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (el === null) throw new Error(`grapher: no element matches ${JSON.stringify(target)}`);
  const g = new MeTTaGrapher(el, opts);
  const handle: Grapher = {
    grapher: g,
    load(source) {
      g.loadSource(source);
      return handle;
    },
    atoms(atoms) {
      g.loadAtoms(atoms);
      return handle;
    },
    graph() {
      g.setViewMode("graph");
      return handle;
    },
    blocks() {
      g.setViewMode("block");
      return handle;
    },
    palette(palette) {
      g.setBlockPalette(toPalette(palette));
      return handle;
    },
    fit() {
      g.tidy();
      return handle;
    },
    evaluate() {
      g.evaluateAll();
      return handle;
    },
    play() {
      g.playTrace();
      return handle;
    },
    source() {
      return g.viewMode === "block" ? g.blockSource() : g.toSource();
    },
    gif(encoder, opts) {
      return g.exportReductionGif(encoder, opts);
    },
    destroy() {
      g.destroy();
    },
  };
  return handle;
}
