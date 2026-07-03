// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa } from "@metta-ts/hyperon";
import { atomToGraph } from "./atom";
import { parseProgram } from "./parse";
import { evaluateHead, evaluateHeadAsync, loadProgram } from "./evaluate";

/** Build a graph from source and return it with its single head id. */
function graphOf(src: string): { graph: ReturnType<typeof atomToGraph>; headId: string } {
  const graph = atomToGraph(parseProgram(src));
  return { graph, headId: graph.heads()[0]!.id };
}

describe("evaluate", () => {
  it("evaluates grounded arithmetic", () => {
    const { graph, headId } = graphOf("(+ 10 (* 25 2))");
    const r = evaluateHead(graph, headId, new MeTTa());
    expect(r.label).toBe("60");
    expect(r.error).toBe(false);
  });

  it("evaluates against rules added to the space", () => {
    const metta = new MeTTa();
    metta.run("(= (double $x) (* $x 2))");
    const { graph, headId } = graphOf("(double 21)");
    const r = evaluateHead(graph, headId, metta);
    expect(r.label).toBe("42");
  });

  it("returns every nondeterministic result", () => {
    const metta = new MeTTa();
    metta.run("(= (coin) 0)\n(= (coin) 1)");
    const { graph, headId } = graphOf("(coin)");
    const r = evaluateHead(graph, headId, metta);
    expect(r.atoms.map(String).sort()).toEqual(["0", "1"]);
  });

  it("async evaluation matches sync for pure programs", async () => {
    const { graph, headId } = graphOf("(+ 1 2)");
    const r = await evaluateHeadAsync(graph, headId, new MeTTa());
    expect(r.label).toBe("3");
  });

  it("loadProgram makes a graph's own rules active for evaluation", () => {
    // A recursive rule and a call, both drawn on one canvas. Evaluating the call must reduce through the
    // rule, which only works once the whole graph is loaded into the space. The rule head's node is named
    // "=" and the call head's node is named "fact".
    const graph = atomToGraph(
      parseProgram("(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))\n(fact 5)"),
    );
    const space = loadProgram(graph);
    const call = graph.heads().find((h) => h.name === "fact")!;
    expect(evaluateHead(graph, call.id, space).label).toBe("120");
  });
});
