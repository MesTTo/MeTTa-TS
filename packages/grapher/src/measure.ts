// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Node sizing, shared by the layout (to pack nodes without overlap) and the renderer (to draw them). Kept
// small and dense, following the original's proportions: a short box whose width follows its text.

import type { GraphNode } from "./model";
import { displayGlyph } from "./color";

/** Node box height in world units. */
export const NODE_H = 22;
const CHAR_W = 7;
const PAD_X = 12;
const MIN_W = 24;

/** The text drawn inside a node: `( )` for a list, a dot for a passthrough, otherwise the name rendered as
 *  its math glyph (`*` as ×, `->` as →, …). */
export function displayText(node: GraphNode): string {
  if (node.kind === "list") return "( )";
  if (node.kind === "dot") return "•";
  return node.name.length > 0 ? displayGlyph(node.name) : "?";
}

/** A node's box width, from its display text. */
export function nodeWidth(node: GraphNode): number {
  return Math.max(MIN_W, displayText(node).length * CHAR_W + PAD_X);
}
