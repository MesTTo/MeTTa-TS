// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { offsetToPosition, spanToRange, DiagnosticSeverity } from "./diagnostic";

describe("offsetToPosition", () => {
  it("maps an offset on the first line", () => {
    expect(offsetToPosition("hello", 2)).toEqual({ line: 0, character: 2 });
  });
  it("maps an offset after newlines", () => {
    // "a\nbc\nd", offset 5 is the 'd' on line 2
    expect(offsetToPosition("a\nbc\nd", 5)).toEqual({ line: 2, character: 0 });
  });
});

describe("spanToRange", () => {
  it("builds a range from start/end offsets", () => {
    expect(spanToRange("(foo bar)", 1, 4)).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 4 },
    });
  });
});

describe("DiagnosticSeverity", () => {
  it("uses LSP numbering", () => {
    expect(DiagnosticSeverity.Error).toBe(1);
    expect(DiagnosticSeverity.Hint).toBe(4);
  });
});
