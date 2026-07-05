// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { parseAllSpanned } from "./cst";
import { standardTokenizer } from "./runner";
import { format } from "./parser";

describe("parseAllSpanned", () => {
  it("records the span of a nested symbol precisely", () => {
    const src = "(map (fibonaci 10) $xs)";
    const [top] = parseAllSpanned(src, standardTokenizer());
    // top is the whole (map ...) expr
    expect(src.slice(top!.span.start, top!.span.end)).toBe("(map (fibonaci 10) $xs)");
    // children[1] is (fibonaci 10); its children[0] is `fibonaci`
    const fib = top!.children![1]!.children![0]!;
    expect(src.slice(fib.span.start, fib.span.end)).toBe("fibonaci");
  });

  it("marks a top-level !-query and spans the form after the bang", () => {
    const src = "!(car-atom)";
    const [top] = parseAllSpanned(src, standardTokenizer());
    expect(top!.bang).toBe(true);
    expect(src.slice(top!.span.start, top!.span.end)).toBe("(car-atom)");
  });

  it("produces the same atoms as the plain parser", () => {
    const src = "(= (f $x) (+ $x 1))\n!(f 2)";
    const spanned = parseAllSpanned(src, standardTokenizer());
    expect(spanned.map((n) => format(n.atom))).toEqual(["(= (f $x) (+ $x 1))", "(f 2)"]);
  });

  it("spans a string literal including its quotes", () => {
    const src = '(greet "hi")';
    const [top] = parseAllSpanned(src, standardTokenizer());
    const strNode = top!.children![1]!;
    expect(src.slice(strNode.span.start, strNode.span.end)).toBe('"hi"');
  });
});
