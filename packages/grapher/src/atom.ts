// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The bridge between a node graph and MeTTa atoms. This is where "a node graph is a MeTTa atom" becomes
// literal, and it round-trips: importing an atom and composing it back yields the same atom.
//
// Compose (node -> atom), children taken in screen order (sortedChildren):
//   - symbol node with children -> (name child...); without children -> the leaf (symbol/variable/value),
//     reconstructed from its text by the reader so `42` is grounded, `$x` a variable, `foo` a symbol.
//   - list node -> a headless expression (child...).
//   - dot node -> a build-time passthrough: one child composes to that child, none to nothing, several
//     to a list.
//
// Import (atom -> nodes), the mirror, so compose-after-import is the identity:
//   - E(c0, c1, ..., cN) with N >= 1 and c0 atomic -> a symbol node named after c0, children c1..cN.
//   - any other expression (compound head, a lone head E(c0), or empty E()) -> a list node of all items.
//     This keeps `(f)` distinct from `f`.
//   - a leaf atom -> a symbol node named by its source rendering.

import {
  Atom,
  SymbolAtom,
  VariableAtom,
  ExpressionAtom,
  GroundedAtom,
  S,
  E,
} from "@metta-ts/hyperon";
import { Graph, type GraphNode } from "./model";
import { parseLeaf } from "./parse";
import { layout } from "./layout";

/** Compose one node (with its subtree) into an atom, children in screen order. Returns null for a dot
 *  node that contributes nothing. */
function compose(graph: Graph, node: GraphNode): Atom | null {
  const kids = graph
    .sortedChildren(node.id)
    .map((c) => compose(graph, c))
    .filter((a): a is Atom => a !== null);
  switch (node.kind) {
    case "list":
      return E(...kids);
    case "dot":
      return kids.length === 0 ? null : kids.length === 1 ? kids[0]! : E(...kids);
    case "symbol": {
      const leaf = parseLeaf(node.name) ?? S(node.name);
      return kids.length > 0 ? E(leaf, ...kids) : leaf;
    }
  }
}

/** Compose the atom rooted at one node, or null if the node is unknown or contributes nothing. */
export function composeAtom(graph: Graph, nodeId: string): Atom | null {
  const node = graph.nodes.get(nodeId);
  return node ? compose(graph, node) : null;
}

/** Compose one atom per head (a parentless node), children in screen order. Dot nodes that contribute
 *  nothing are dropped. */
export function graphToAtoms(graph: Graph): Atom[] {
  return graph
    .heads()
    .map((h) => compose(graph, h))
    .filter((a): a is Atom => a !== null);
}

/** Build nodes and edges from atoms, then lay them out as tidy trees. Adds to `graph` if given. */
export function atomToGraph(atoms: Atom[], graph: Graph = new Graph()): Graph {
  for (const atom of atoms) buildNode(graph, atom);
  layout(graph);
  return graph;
}

/** A symbol, variable, or grounded value, the atoms that can head a `(name child...)` node. */
function isAtomic(atom: Atom): boolean {
  return atom instanceof SymbolAtom || atom instanceof VariableAtom || atom instanceof GroundedAtom;
}

/** A leaf's node name is its MeTTa source rendering: the symbol name, `$x` for a variable, or the
 *  grounded literal. `parseLeaf` reverses this exactly. */
function leafName(atom: Atom): string {
  return atom.toString();
}

/** Create the node (and its subtree) for `atom`, returning the new node's id. */
function buildNode(graph: Graph, atom: Atom): string {
  if (atom instanceof ExpressionAtom) {
    const items = atom.children();
    const head = items[0];
    if (items.length >= 2 && head !== undefined && isAtomic(head)) {
      const node = graph.add({ name: leafName(head), kind: "symbol" });
      for (const child of items.slice(1)) graph.connect(node.id, buildNode(graph, child));
      return node.id;
    }
    const node = graph.add({ name: "", kind: "list" });
    for (const child of items) graph.connect(node.id, buildNode(graph, child));
    return node.id;
  }
  return graph.add({ name: leafName(atom), kind: "symbol" }).id;
}
