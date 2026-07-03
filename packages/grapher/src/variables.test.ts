// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { atomToGraph } from "./atom";
import { parseProgram } from "./parse";
import { variableLinks } from "./variables";

describe("variableLinks", () => {
  it("chains the occurrences of a variable within a rule", () => {
    // $n appears four times in the factorial rule; a chain through them is three links.
    const graph = atomToGraph(parseProgram("(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))"));
    const links = variableLinks(graph);
    expect(links.length).toBe(3);
    // every linked node is a $n
    for (const [a, b] of links) {
      expect(graph.nodes.get(a)!.name).toBe("$n");
      expect(graph.nodes.get(b)!.name).toBe("$n");
    }
  });

  it("does not link a variable that appears once, nor across different rules", () => {
    const graph = atomToGraph(
      parseProgram("(= (id $x) $x)\n(= (const $y) 1)"), // $x twice (one rule), $y once
    );
    const links = variableLinks(graph);
    // $x is linked once (two occurrences in the id rule); $y not at all
    expect(links.length).toBe(1);
    expect(graph.nodes.get(links[0]![0])!.name).toBe("$x");
  });
});
