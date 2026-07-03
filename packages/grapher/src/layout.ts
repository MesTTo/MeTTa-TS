// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// A tidy tree layout for imported programs, evaluation results, and the manual "tidy" command. It is the
// classic first pass (Knuth / Reingold-Tilford): each leaf takes the next slot and each internal node
// centers over its children, so depth maps to y and no two subtrees overlap. Leaves are packed by their
// actual width, which keeps the tree dense (a short gap between boxes) rather than spread on a fixed grid.
// Children are taken in insertion order (positions are being assigned, so screen order is not meaningful
// yet), which keeps the visual order equal to the atom's argument order after import. Shared nodes in a
// DAG are placed once, under the first parent that reaches them.

import type { Graph } from "./model";
import { nodeWidth, NODE_H } from "./measure";

const ROW = NODE_H + 26; // vertical distance between depths
const GAP = 14; // horizontal gap between adjacent leaves
const HEAD_GAP = 3 * NODE_H; // wider gap between separate trees (heads), so nondeterministic results read apart

/** Assign `x` and `y` to every node so the graph reads as tidy top-down trees. Mutates the graph. */
export function layout(graph: Graph, opts?: { originX?: number; originY?: number }): void {
  const originX = opts?.originX ?? 0;
  const originY = opts?.originY ?? 0;
  const visited = new Set<string>();
  let cursorX = originX; // left edge of the next leaf

  const place = (id: string, depth: number): number => {
    const node = graph.nodes.get(id);
    if (node === undefined) return cursorX;
    if (visited.has(id)) return node.x; // shared subtree: keep its first placement
    visited.add(id);
    node.y = originY + depth * ROW;
    const kids = graph.childrenOf(id);
    if (kids.length === 0) {
      const w = nodeWidth(node);
      node.x = cursorX + w / 2;
      cursorX += w + GAP;
      return node.x;
    }
    const xs = kids.map((k) => place(k, depth + 1));
    node.x = (Math.min(...xs) + Math.max(...xs)) / 2;
    return node.x;
  };

  // Lay out each head's tree in turn. cursorX already packs them left to right; the extra HEAD_GAP after each
  // keeps independent trees (the branches of a nondeterministic result) clearly apart rather than touching.
  for (const root of graph.heads()) {
    place(root.id, 0);
    cursorX += HEAD_GAP;
  }
}
