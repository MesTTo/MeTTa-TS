// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The graph data model. Nodes form a cycle-guarded DAG: a node can feed several parents, but no cycle can
// form. Two ideas shape it:
//   - argument order is screen order: `sortedChildren` orders a node's children left to right, ties
//     broken top to bottom, so `(- 5 3)` is the `-` node with `5` placed left of `3`.
//   - a node without parents is a "head" (a root), the unit that gets composed into an atom and evaluated.
// This module is pure data and operations, no DOM.

import { nextId } from "./ids";

/** A node's role in the s-expression:
 *  - `symbol`: a named atom. With children it is `(name child...)`; without, a bare symbol/variable/value.
 *  - `list`: a headless expression `(child...)`.
 *  - `dot`: a build-time passthrough (a single child composes to that child). */
export type NodeKind = "symbol" | "list" | "dot";

/** One node: its identity, its text, its role, and its position on the canvas. */
export interface GraphNode {
  id: string;
  name: string;
  kind: NodeKind;
  x: number;
  y: number;
}

/** Two children within this horizontal distance are treated as vertically stacked, so ties in x sort by
 *  y. */
const X_EPSILON = 0.01;

/** A cycle-guarded DAG of {@link GraphNode}s with parent/child edges. */
export class Graph {
  readonly nodes = new Map<string, GraphNode>();
  private readonly childIds = new Map<string, string[]>(); // parent -> ordered child ids
  private readonly parentIds = new Map<string, string[]>(); // child -> parent ids

  /** Add a node. An explicit `id` is preserved (for loading); otherwise a fresh one is minted. Defaults:
   *  kind `symbol`, position `(0, 0)`. */
  add(spec: { name: string; kind?: NodeKind; x?: number; y?: number; id?: string }): GraphNode {
    const node: GraphNode = {
      id: spec.id ?? nextId(),
      name: spec.name,
      kind: spec.kind ?? "symbol",
      x: spec.x ?? 0,
      y: spec.y ?? 0,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  /** Remove a node and every edge touching it. */
  remove(id: string): void {
    for (const p of this.parentsOf(id)) this.disconnect(p, id);
    for (const c of this.childrenOf(id)) this.disconnect(id, c);
    this.nodes.delete(id);
    this.childIds.delete(id);
    this.parentIds.delete(id);
  }

  /** Move a node to a new position. */
  move(id: string, x: number, y: number): void {
    const node = this.nodes.get(id);
    if (node) {
      node.x = x;
      node.y = y;
    }
  }

  /** This node's child ids, in insertion order. */
  childrenOf(id: string): string[] {
    return [...(this.childIds.get(id) ?? [])];
  }

  /** This node's parent ids, in insertion order. */
  parentsOf(id: string): string[] {
    return [...(this.parentIds.get(id) ?? [])];
  }

  /** Whether `parent -> child` would be a legal edge: not a self-loop, a duplicate, an unknown node, or a
   *  cycle (the parent already sitting below the child). Lets the editor reject a drag before committing it. */
  canConnect(parentId: string, childId: string): boolean {
    if (parentId === childId) return false;
    if (!this.nodes.has(parentId) || !this.nodes.has(childId)) return false;
    if ((this.childIds.get(parentId) ?? []).includes(childId)) return false;
    if (this.reaches(childId, parentId)) return false; // parent is below child, so this would cycle
    return true;
  }

  /** Connect `parent` to `child`. Returns false and does nothing when the edge would be illegal (see
   *  {@link canConnect}). */
  connect(parentId: string, childId: string): boolean {
    if (!this.canConnect(parentId, childId)) return false;
    this.childIds.set(parentId, [...(this.childIds.get(parentId) ?? []), childId]);
    this.parentIds.set(childId, [...(this.parentIds.get(childId) ?? []), parentId]);
    return true;
  }

  /** Remove the `parent -> child` edge if present. */
  disconnect(parentId: string, childId: string): void {
    const kids = this.childIds.get(parentId);
    if (kids)
      this.childIds.set(
        parentId,
        kids.filter((k) => k !== childId),
      );
    const parents = this.parentIds.get(childId);
    if (parents)
      this.parentIds.set(
        childId,
        parents.filter((p) => p !== parentId),
      );
  }

  /** Children of `id` in screen order: by x, ties (within {@link X_EPSILON}) broken by y. This is how
   *  argument order is read off the canvas. */
  sortedChildren(id: string): GraphNode[] {
    const kids = this.childrenOf(id)
      .map((k) => this.nodes.get(k))
      .filter((n): n is GraphNode => n !== undefined);
    return kids.sort((a, b) => (Math.abs(a.x - b.x) < X_EPSILON ? a.y - b.y : a.x - b.x));
  }

  /** The roots (parentless nodes) reachable by walking up from `id`. A parentless node is its own head. */
  findHeads(id: string): GraphNode[] {
    const heads = new Map<string, GraphNode>();
    const seen = new Set<string>();
    const visit = (cur: string): void => {
      if (seen.has(cur)) return;
      seen.add(cur);
      const parents = this.parentIds.get(cur) ?? [];
      if (parents.length === 0) {
        const node = this.nodes.get(cur);
        if (node) heads.set(cur, node);
      } else {
        for (const p of parents) visit(p);
      }
    };
    visit(id);
    return [...heads.values()];
  }

  /** Every root in the graph (nodes with no parents). */
  heads(): GraphNode[] {
    return [...this.nodes.values()].filter((n) => (this.parentIds.get(n.id) ?? []).length === 0);
  }

  /** A deep copy: same node ids, positions, and edges. */
  clone(): Graph {
    const g = new Graph();
    for (const n of this.nodes.values()) g.add({ ...n });
    for (const [p, kids] of this.childIds) for (const c of kids) g.connect(p, c);
    return g;
  }

  /** Can `from` reach `to` by following child edges downward? */
  private reaches(from: string, to: string): boolean {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) break;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const c of this.childIds.get(cur) ?? []) stack.push(c);
    }
    return false;
  }
}
