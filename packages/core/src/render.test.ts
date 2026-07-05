// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { renderDiagnostic, renderAll } from "./render";
import { analyzeSource } from "./diagnose";

describe("renderDiagnostic", () => {
  it("renders an arity error rustc-style with a caret under the call", () => {
    const src = "!(car-atom (a b) (c d))";
    const [d] = analyzeSource(src, { undefinedSymbols: false });
    const text = renderDiagnostic(src, "prog.metta", d!);
    // `(car-atom (a b) (c d))` is 22 chars, spanning source cols 1..23; build the caret programmatically
    // so the golden string cannot be miscounted.
    const expected = [
      "error[arity-mismatch]: prog.metta:1:2",
      "  |",
      "1 | !(car-atom (a b) (c d))",
      "  | " + " ".repeat(1) + "^".repeat(22) + " car-atom expects 1 argument, got 2",
    ].join("\n");
    expect(text).toBe(expected);
  });

  it("renders a warning with a help line", () => {
    const src = "(= (fibonacci $n) $n)\n!(fibonaci 10)";
    const diags = analyzeSource(src, { undefinedSymbols: true });
    const warn = diags.find((x) => x.code === "unknown-symbol")!;
    const text = renderDiagnostic(src, "p.metta", warn);
    expect(text).toContain("warning[unknown-symbol]: p.metta:2:3");
    expect(text).toContain("^^^^^^^^ unknown symbol `fibonaci`");
    expect(text).toContain("= help: did you mean `fibonacci`?");
  });
});

describe("renderAll", () => {
  it("joins multiple diagnostics with a blank line", () => {
    const src = "!(car-atom 1 2)\n!(cdr-atom 1 2)";
    const diags = analyzeSource(src, { undefinedSymbols: false });
    const text = renderAll(src, "p.metta", diags);
    expect(text.split("\n\n")).toHaveLength(2);
  });
});
