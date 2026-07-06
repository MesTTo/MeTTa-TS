// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { parseAllSpanned, parseCst } from "./cst";
import { standardTokenizer } from "./runner";
import { format, parseAll } from "./parser";

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

describe("parseCst — editor CST", () => {
  it("collects line comments with their spans, out of the atom tree", () => {
    const src = "; hi\n(f 1) ; trailing\n(g 2)";
    const cst = parseCst(src, standardTokenizer());
    expect(cst.comments.map((c) => src.slice(c.span.start, c.span.end))).toEqual([
      "; hi",
      "; trailing",
    ]);
    expect(cst.nodes.map((n) => format(n.atom))).toEqual(["(f 1)", "(g 2)"]);
    expect(cst.diagnostics).toEqual([]);
  });

  it("marks a top-level bang and records the ! span separately from the form", () => {
    const src = "!(f 2)";
    const [top] = parseCst(src, standardTokenizer()).nodes;
    expect(top!.bang).toBe(true);
    expect(src.slice(top!.bangSpan!.start, top!.bangSpan!.end)).toBe("!");
    expect(src.slice(top!.span.start, top!.span.end)).toBe("(f 2)");
    expect(format(top!.atom)).toBe("(f 2)");
  });

  it("records open and close paren spans on an expression", () => {
    const src = "(a b)";
    const [top] = parseCst(src, standardTokenizer()).nodes;
    expect(src.slice(top!.open!.start, top!.open!.end)).toBe("(");
    expect(src.slice(top!.close!.start, top!.close!.end)).toBe(")");
  });

  it("classifies leaf kinds from the atom", () => {
    const [top] = parseCst('(f $x 42 "s" True)', standardTokenizer()).nodes;
    expect(top!.children!.map((c) => c.kind)).toEqual([
      "symbol",
      "variable",
      "number",
      "string",
      "symbol",
    ]);
  });

  it("recovers from an unclosed paren without throwing and closes at end of input", () => {
    const cst = parseCst("(f (g 1)", standardTokenizer());
    expect(cst.diagnostics.map((d) => d.code)).toContain("syntax.unclosedDelimiter");
    expect(format(cst.nodes[0]!.atom)).toBe("(f (g 1))");
    expect(cst.nodes[0]!.close).toBeUndefined();
  });

  it("recovers from an unexpected closing paren", () => {
    const cst = parseCst("(f 1)) (g 2)", standardTokenizer());
    expect(cst.diagnostics.map((d) => d.code)).toContain("syntax.unexpectedClose");
    expect(cst.nodes.map((n) => format(n.atom))).toEqual(["(f 1)", "(g 2)"]);
  });

  it("recovers from an unterminated string", () => {
    const cst = parseCst('(f "oops)', standardTokenizer());
    expect(cst.diagnostics.map((d) => d.code)).toContain("syntax.unterminatedString");
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (src) => {
        parseCst(src, standardTokenizer());
      }),
      { numRuns: 2000 },
    );
  });

  it("produces the same atoms and bang flags as parseAll on valid programs", () => {
    const leaf = fc.oneof(
      fc.constantFrom("foo", "bar", "f", "g", "map", "+", "-", "=", ":", "cons"),
      fc.constantFrom("$x", "$y", "$acc", "$xs"),
      fc.integer({ min: -999, max: 999 }).map(String),
      fc.constantFrom('"hi"', '"a b"', '"x"'),
    );
    const { atomSrc } = fc.letrec((tie) => ({
      atomSrc: fc.oneof({ maxDepth: 4 }, leaf, tie("exprSrc")),
      exprSrc: fc
        .array(tie("atomSrc"), { minLength: 0, maxLength: 4 })
        .map((items) => `(${items.join(" ")})`),
    }));
    const programArb = fc
      .array(fc.tuple(fc.boolean(), atomSrc), { minLength: 1, maxLength: 6 })
      .map((tops) => tops.map(([bang, s]) => (bang ? `!${s}` : s)).join("\n"));
    fc.assert(
      fc.property(programArb, (src) => {
        const cst = parseCst(src, standardTokenizer());
        const plain = parseAll(src, standardTokenizer());
        expect(cst.diagnostics).toEqual([]);
        expect(cst.nodes.map((n) => format(n.atom))).toEqual(plain.map((t) => format(t.atom)));
        expect(cst.nodes.map((n) => n.bang === true)).toEqual(plain.map((t) => t.bang));
      }),
      { numRuns: 1000 },
    );
  });
});
