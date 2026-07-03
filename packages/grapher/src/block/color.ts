// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Glyph and block coloring for the block view, following the source editor's scheme: the head of a form
// is blue, a numeric literal is gold, a string is green, and any other identifier is cyan. Variables are
// drawn as holes elsewhere, so they never reach this function. Blocks alternate between the two teal
// shades by nesting depth and carry a lighter outline, which is what makes the nesting readable.

import { roleOf } from "../color";
import type { BlockSettings } from "./settings";

/** The glyph color for a leaf, given whether it heads its enclosing form. */
export function glyphColor(name: string, isHead: boolean, s: BlockSettings): string {
  switch (roleOf(name)) {
    case "number":
      return s.literalColor;
    case "string":
      return s.stringColor;
    case "operator":
    case "control":
      return s.operatorColor;
    case "spaceref":
      return s.spacerefColor;
    case "at":
      return s.atColor;
    default:
      return isHead ? s.formColor : s.identifierColor;
  }
}

/** The fill and outline of a block at the given nesting depth. The outermost block is the lighter shade so
 *  it stands out from the canvas, and each level alternates. */
export function blockColors(depth: number, s: BlockSettings): { fill: string; outline: string } {
  const fill = depth % 2 === 0 ? s.backgroundBlockColor : s.bkgColor;
  return { fill, outline: s.outlineBlockColor };
}
