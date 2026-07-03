// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa } from "@metta-ts/hyperon";
import { parseProgram } from "./parse";
import { bindVizSpace, readViz, colorOf, textOf } from "./viz";

describe("viz directives via the &grapher space", () => {
  it("reads directives verbatim, with targets left unevaluated", () => {
    const m = new MeTTa();
    bindVizSpace(m);
    m.run("(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))");
    m.run("!(add-atom &grapher (color (fact 5) red))");
    m.run("!(add-atom &grapher (highlight if))");
    m.run("!(add-atom &grapher (focus (fact 5)))");
    m.run('!(add-atom &grapher (label (fact 5) "answer"))');
    const ds = readViz(m).directives;
    const first = (k: string) => ds.find((d) => d.kind === k)!;
    // the target of `(fact 5)` is kept literal, not reduced to 120
    expect(first("color").target.toString()).toBe("(fact 5)");
    expect(colorOf(first("color").arg!)).toBe("#f85149");
    expect(first("highlight").target.toString()).toBe("if");
    expect(first("focus").target.toString()).toBe("(fact 5)");
    expect(textOf(first("label").arg!)).toBe("answer");
  });

  it("is empty for an empty space", () => {
    const m = new MeTTa();
    bindVizSpace(m);
    expect(readViz(m)).toEqual({ directives: [], background: null });
  });

  it("reads a global background directive as a resolved color", () => {
    const m = new MeTTa();
    bindVizSpace(m);
    m.run('!(add-atom &grapher (background "#1e1e1e"))');
    expect(readViz(m).background).toBe("#1e1e1e");
    // a color name resolves too
    const m2 = new MeTTa();
    bindVizSpace(m2);
    m2.run("!(add-atom &grapher (background blue))");
    expect(readViz(m2).background).toBe("#58a6ff");
  });

  it("resolves color names and hex, falling back to yellow", () => {
    expect(colorOf(parseProgram("blue")[0]!)).toBe("#58a6ff");
    expect(colorOf(parseProgram('"#123456"')[0]!)).toBe("#123456");
    expect(colorOf(parseProgram("chartreuse")[0]!)).toBe("#f2cc60"); // unknown name -> yellow
  });
});
