// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Save and load. JSON is the source of truth (a flat node list plus edges plus positions), and the graph
// also imports from and exports to MeTTa source through the bridge. The Lisp `.lire` format is out of
// scope; this is a clean JSON of the same nodes and positions.

import { Graph, type GraphNode } from "./model";
import { graphToAtoms, atomToGraph } from "./atom";
import { parseProgram } from "./parse";

/** A serialized graph: every node with its position, and every `[parent, child]` edge in order. */
export interface GraphJson {
  nodes: GraphNode[];
  edges: [string, string][];
}

/** Snapshot a graph to JSON. */
export function toJson(graph: Graph): GraphJson {
  const nodes = [...graph.nodes.values()].map((n) => ({ ...n }));
  const edges: [string, string][] = [];
  for (const n of graph.nodes.values())
    for (const c of graph.childrenOf(n.id)) edges.push([n.id, c]);
  return { nodes, edges };
}

/** Rebuild a graph from JSON, preserving ids, positions, and edge order. */
export function fromJson(json: GraphJson): Graph {
  const graph = new Graph();
  for (const n of json.nodes) graph.add({ ...n });
  for (const [parent, child] of json.edges) graph.connect(parent, child);
  return graph;
}

/** Render a graph as MeTTa source, one head per line. */
export function toSource(graph: Graph): string {
  return graphToAtoms(graph)
    .map((a) => a.toString())
    .join("\n");
}

/** Parse MeTTa source into a laid-out graph. */
export function fromSource(src: string): Graph {
  return atomToGraph(parseProgram(src));
}
