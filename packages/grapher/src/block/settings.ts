// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The palette and metrics for the block view. The metrics derive from one number, the font size, plus the
// measured advance of the monospace font: a row is a little over one and a half line-heights tall, the
// block corner radius is about half a row (so a one-line block is a stadium), and atom backings use a
// smaller radius. The palette is swappable. Two are built in: `SITE_PALETTE` matches the site's syntax
// highlighting (the GitHub-dark theme, so a block program looks like the code around it) and is the
// default; `TEAL_PALETTE` is a plain teal scheme. Pass your own to recolor.

/** The colors of the block view. */
export interface BlockPalette {
  canvas: string;
  bkgColor: string;
  backgroundBlockColor: string;
  outlineBlockColor: string;
  formColor: string;
  identifierColor: string;
  literalColor: string;
  stringColor: string;
  operatorColor: string;
  spacerefColor: string;
  atColor: string;
  holeFill: string;
  holeSide: string;
  holeText: string;
  selectedColor: string;
  selectedAtomColor: string;
}

/** Colors and sizes for one render, all in pixels. */
export interface BlockSettings extends BlockPalette {
  fontSize: number;
  /** Advance width of one monospace character; measured by the renderer. */
  unitWidth: number;
  /** Row height; a glyph is centered within it. */
  unitHeight: number;
  /** Block corner radius. */
  radius: number;
  /** Atom and hole backing radius (smaller than the block radius). */
  radiusAdj: number;
  /** Below this many characters of children, a block stays on one line even if it is a stacking form. */
  cutoff: number;
}

/** The site's own syntax palette (GitHub dark), so a block program matches the code blocks around it:
 *  variables and space-refs orange, numbers blue, strings light blue, control operators red, at-atoms
 *  purple, everything else the neutral light text. Nesting is shown by two dark surfaces and a lighter
 *  outline, on the same dark canvas as the node graph. */
export const SITE_PALETTE: BlockPalette = {
  canvas: "#1b1d23",
  bkgColor: "#21262d",
  backgroundBlockColor: "#2b313b",
  outlineBlockColor: "#3d444d",
  formColor: "#e6edf3",
  identifierColor: "#e6edf3",
  literalColor: "#79c0ff",
  stringColor: "#a5d6ff",
  operatorColor: "#ff7b72",
  spacerefColor: "#ffa657",
  atColor: "#d2a8ff",
  holeFill: "#ffa657",
  holeSide: "#ffa657",
  holeText: "#1b1d23",
  selectedColor: "#f2cc60",
  selectedAtomColor: "#1b1d23",
};

/** A plain teal scheme. */
export const TEAL_PALETTE: BlockPalette = {
  canvas: "#002F36",
  bkgColor: "#002F36",
  backgroundBlockColor: "#003A42",
  outlineBlockColor: "#005A65",
  formColor: "#0082D6",
  identifierColor: "#30A1B6",
  literalColor: "#FFC732",
  stringColor: "#79E7B0",
  operatorColor: "#0082D6",
  spacerefColor: "#30A1B6",
  atColor: "#30A1B6",
  holeFill: "#FCE13E",
  holeSide: "#C17317",
  holeText: "#002F36",
  selectedColor: "#E60000",
  selectedAtomColor: "#FFFFFF",
};

/** The character-count cutoff below which a stacking form stays on one line. */
export const CUTOFF = 14;

/** Build settings from a font size, the measured monospace advance, and a palette (the site's by
 *  default). */
export function makeSettings(
  fontSize: number,
  unitWidth: number,
  palette: BlockPalette = SITE_PALETTE,
): BlockSettings {
  const unitHeight = Math.round(fontSize * 1.55);
  const radius = Math.max(2, Math.round(unitHeight / 2) - 1);
  const radiusAdj = Math.max(2, Math.round((radius * 5) / 7));
  return { fontSize, unitWidth, unitHeight, radius, radiusAdj, cutoff: CUTOFF, ...palette };
}
