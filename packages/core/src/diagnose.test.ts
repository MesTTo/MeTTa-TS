// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { analyzeSource } from "./diagnose";
import { DiagnosticSeverity } from "./diagnostic";

const cfg = { undefinedSymbols: false };

describe("analyzeSource — arity", () => {
  it("flags too many arguments to a signed builtin", () => {
    // car-atom : (-> Expression %Undefined%), one parameter
    const diags = analyzeSource("!(car-atom (a b) (c d))", cfg);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("arity-mismatch");
    expect(diags[0]!.severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0]!.message).toContain("car-atom");
    expect(diags[0]!.message).toContain("1 argument");
    // primary span is the whole call
    const src = "!(car-atom (a b) (c d))";
    const r = diags[0]!.range;
    expect(r.start).toEqual({ line: 0, character: 1 });
    expect(r.end).toEqual({ line: 0, character: src.length });
  });

  it("accepts a correct-arity call", () => {
    expect(analyzeSource("!(car-atom (a b))", cfg)).toEqual([]);
  });

  it("reads != arity from the shared core environment", () => {
    expect(analyzeSource("!(!= 1 2)", { undefinedSymbols: true })).toEqual([]);
    const diags = analyzeSource("!(!= 1)", cfg);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("arity-mismatch");
    expect(diags[0]!.message).toBe("!= expects 2 arguments, got 1");
  });

  it("does not flag an op that has no declared signature", () => {
    // `foo` is unknown; with undefinedSymbols off, nothing is reported
    expect(analyzeSource("!(foo 1 2 3)", cfg)).toEqual([]);
  });

  it("reports every arity error in one pass, sorted by position", () => {
    const diags = analyzeSource("!(car-atom 1 2)\n!(cdr-atom 1 2)", cfg);
    expect(diags.map((d) => d.code)).toEqual(["arity-mismatch", "arity-mismatch"]);
    expect(diags[0]!.range.start.line).toBe(0);
    expect(diags[1]!.range.start.line).toBe(1);
  });
});

describe("analyzeSource — undefined head (gated)", () => {
  const on = { undefinedSymbols: true };

  it("does not flag an unknown head when the gate is off", () => {
    expect(analyzeSource("!(fibonaci 10)", { undefinedSymbols: false })).toEqual([]);
  });

  it("warns on an unknown head with a near-miss to a defined symbol", () => {
    const src = "(= (fibonacci $n) $n)\n!(fibonaci 10)";
    const diags = analyzeSource(src, on);
    const warn = diags.find((d) => d.code === "unknown-symbol");
    expect(warn).toBeDefined();
    expect(warn!.severity).toBe(DiagnosticSeverity.Warning);
    expect(warn!.message).toContain("fibonaci");
    expect(warn!.suggestions?.[0]?.replacement).toBe("fibonacci");
    // primary span underlines just the head, not the whole call
    expect(warn!.range.start.line).toBe(1);
    expect(warn!.range.start.character).toBe(2); // after "!("
  });

  it("stays silent for an unknown head with no near match", () => {
    const diags = analyzeSource("!(totallyunrelated 1)", on);
    expect(diags.find((d) => d.code === "unknown-symbol")).toBeUndefined();
  });

  it("does not warn on a known stdlib op", () => {
    const diags = analyzeSource("!(car-atom (a b))", on);
    expect(diags.find((d) => d.code === "unknown-symbol")).toBeUndefined();
  });
});
