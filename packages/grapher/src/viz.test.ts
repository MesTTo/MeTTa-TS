// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa } from "@metta-ts/hyperon";
import { parseProgram } from "./parse";
import { bindVizSpace, readViz, colorOf, textOf, normalizeRange } from "./viz";
import { heatColor } from "./color";

describe("viz directives via the &grapher space", () => {
  it("reads directives after LeaTTa add-atom argument evaluation", () => {
    const m = new MeTTa();
    bindVizSpace(m);
    m.run("(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))");
    m.run("!(add-atom &grapher (color (fact 5) red))");
    m.run("!(add-atom &grapher (highlight if))");
    m.run("!(add-atom &grapher (focus (fact 5)))");
    m.run('!(add-atom &grapher (label (fact 5) "answer"))');
    const ds = readViz(m).directives;
    const first = (k: string) => ds.find((d) => d.kind === k)!;
    expect(first("color").target.toString()).toBe("120");
    expect(colorOf(first("color").arg!)).toBe("#f85149");
    expect(first("highlight").target.toString()).toBe("if");
    expect(first("focus").target.toString()).toBe("120");
    expect(textOf(first("label").arg!)).toBe("answer");
  });

  it("is empty for an empty space", () => {
    const m = new MeTTa();
    bindVizSpace(m);
    expect(readViz(m)).toEqual({ directives: [], mappers: [], background: null });
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

  it("parses (size ...) and (shade ...) with their numeric value, dropping non-numbers", () => {
    const m = new MeTTa();
    bindVizSpace(m);
    m.run("(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))");
    m.run("!(add-atom &grapher (size (fact 5) 42))");
    m.run("!(add-atom &grapher (shade if -9.32))");
    m.run("!(add-atom &grapher (size foo bar))"); // non-numeric value -> no directive
    const ds = readViz(m).directives;
    const size = ds.find((d) => d.kind === "size")!;
    const shade = ds.find((d) => d.kind === "shade")!;
    expect(size.target.toString()).toBe("120");
    expect(size.value).toBe(42);
    expect(shade.target.toString()).toBe("if");
    expect(shade.value).toBe(-9.32);
    expect(ds.filter((d) => d.kind === "size")).toHaveLength(1); // (size foo bar) dropped
  });

  it("parses (shade-by ...) and (size-by ...) as data-driven mappers", () => {
    const m = new MeTTa();
    bindVizSpace(m);
    m.run("!(add-atom &grapher (shade-by energy))");
    m.run("!(add-atom &grapher (size-by weight))");
    const { mappers } = readViz(m);
    expect(mappers).toHaveLength(2);
    expect(mappers.find((x) => x.property === "shade")!.func.toString()).toBe("energy");
    expect(mappers.find((x) => x.property === "size")!.func.toString()).toBe("weight");
  });

  it("normalizeRange maps min to lo, max to hi, and no-spread to the midpoint", () => {
    const out = normalizeRange(
      [
        ["a", 0],
        ["b", 5],
        ["c", 10],
      ],
      0.8,
      2,
    );
    expect(out.map(([id]) => id)).toEqual(["a", "b", "c"]);
    expect(out[0]![1]).toBeCloseTo(0.8);
    expect(out[1]![1]).toBeCloseTo(1.4);
    expect(out[2]![1]).toBeCloseTo(2);
    // a single value, or all-equal, carries no spread and lands at the midpoint
    expect(normalizeRange([["x", 7]], 0.8, 2)[0]![1]).toBeCloseTo(1.4);
    expect(
      normalizeRange(
        [
          ["x", 3],
          ["y", 3],
        ],
        0,
        1,
      ).map(([, v]) => v),
    ).toEqual([0.5, 0.5]);
    expect(normalizeRange([], 0, 1)).toEqual([]);
  });

  it("heatColor runs green to red across [0,1] and clamps outside it", () => {
    const chan = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    });
    const lo = chan(heatColor(0));
    const hi = chan(heatColor(1));
    expect(lo.g).toBeGreaterThan(lo.r); // green end
    expect(hi.r).toBeGreaterThan(hi.g); // red end
    expect(heatColor(-1)).toBe(heatColor(0));
    expect(heatColor(2)).toBe(heatColor(1));
  });
});
