// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// MeTTaGrapher from TypeScript, without a browser. The visual editor is a thin layer over these pieces: a
// graph is a MeTTa atom, so you can parse source into a graph, compose it back, evaluate a head on the
// engine, and serialize, all headless. Run with: npx tsx examples/grapher.ts

import { MeTTa } from "@mettascript/hyperon";
import { fromSource, toSource, toJson, graphToAtoms, evaluateHead } from "@mettascript/grapher";

// Parse a program into a laid-out node graph.
const graph = fromSource("(+ 10 (* 25 2))");
console.log("nodes:", toJson(graph).nodes.length); // nodes: 5
console.log("atoms:", graphToAtoms(graph).map(String)); // atoms: [ '(+ 10 (* 25 2))' ]

// Evaluate the head on the engine.
const head = graph.heads()[0]!;
console.log("eval:", evaluateHead(graph, head.id, new MeTTa()).label); // eval: 60

// Edit the graph, then read it back as source. Move the "10" node to the right of the "(* 25 2)" head so
// argument order (screen order) flips to (+ (* 25 2) 10).
const ten = [...graph.nodes.values()].find((n) => n.name === "10")!;
const times = [...graph.nodes.values()].find((n) => n.name === "*")!;
graph.move(ten.id, times.x + 1000, ten.y);
console.log("reordered:", toSource(graph)); // reordered: (+ (* 25 2) 10)
