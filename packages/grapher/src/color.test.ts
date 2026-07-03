// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { roleOf, colorFor, displayGlyph, lerpColor } from "./color";
import type { GraphNode } from "./model";

const node = (name: string, kind: GraphNode["kind"] = "symbol"): GraphNode => ({
  id: "n",
  name,
  kind,
  x: 0,
  y: 0,
});

describe("color", () => {
  it("classifies names like the syntax highlighter", () => {
    expect(roleOf("$x")).toBe("variable");
    expect(roleOf("&self")).toBe("spaceref");
    expect(roleOf("@doc")).toBe("at");
    expect(roleOf("42")).toBe("number");
    expect(roleOf("-3.5")).toBe("number");
    expect(roleOf('"hi"')).toBe("string");
    expect(roleOf("=")).toBe("operator");
    expect(roleOf("->")).toBe("operator");
    expect(roleOf(":")).toBe("operator");
    // branching forms are decisions, drawn as flowchart diamonds
    expect(roleOf("if")).toBe("control");
    expect(roleOf("case")).toBe("control");
    // arithmetic, comparison, and logic heads are operators too (shown as math glyphs)
    expect(roleOf("+")).toBe("operator");
    expect(roleOf("*")).toBe("operator");
    expect(roleOf("and")).toBe("operator");
    // the boolean constants are their own category
    expect(roleOf("True")).toBe("boolean");
    expect(roleOf("False")).toBe("boolean");
    expect(roleOf("fact")).toBe("symbol");
  });

  it("renders operator heads as math glyphs, leaving other names alone", () => {
    expect(displayGlyph("*")).toBe("×");
    expect(displayGlyph("-")).toBe("−");
    expect(displayGlyph("->")).toBe("→");
    expect(displayGlyph(">=")).toBe("≥");
    expect(displayGlyph("and")).toBe("∧");
    expect(displayGlyph("=")).toBe("≡");
    expect(displayGlyph("fact")).toBe("fact");
  });

  it("blends colors in OKLab: exact endpoints and a vivid, non-gray midpoint", () => {
    expect(lerpColor("#ff0000", "#00ff00", 0)).toBe("#ff0000");
    expect(lerpColor("#ff0000", "#00ff00", 1)).toBe("#00ff00");
    // blue -> yellow: a raw RGB midpoint is a muddy gray (all channels ~equal); OKLab keeps it colorful.
    const mid = lerpColor("#0000ff", "#ffff00", 0.5);
    const r = parseInt(mid.slice(1, 3), 16);
    const g = parseInt(mid.slice(3, 5), 16);
    const b = parseInt(mid.slice(5, 7), 16);
    const nearGray = Math.abs(r - g) < 24 && Math.abs(g - b) < 24 && Math.abs(r - b) < 24;
    expect(nearGray).toBe(false);
  });

  it("gives each role a valid hex fill and text color", () => {
    for (const c of [
      colorFor(node("$x")),
      colorFor(node("42")),
      colorFor(node("=")),
      colorFor(node("if")),
      colorFor(node("fact")),
      colorFor(node("", "list")),
      colorFor(node("", "dot")),
    ]) {
      expect(c.fill).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("colors match the highlighter palette and are stable", () => {
    expect(colorFor(node("$x")).fill).toBe("#ffa657"); // variable orange
    expect(colorFor(node("7")).fill).toBe("#79c0ff"); // number blue
    expect(colorFor(node("=")).fill).toBe("#ff7b72"); // operator red
    expect(colorFor(node("", "list")).fill).toBe("#7ee787"); // paren green
    // a plain symbol is the neutral default, distinct from a variable
    expect(colorFor(node("fact")).fill).not.toBe(colorFor(node("$n")).fill);
    // variables and numbers ignore the specific name
    expect(colorFor(node("$a")).fill).toBe(colorFor(node("$b")).fill);
    expect(colorFor(node("1")).fill).toBe(colorFor(node("2")).fill);
  });
});
