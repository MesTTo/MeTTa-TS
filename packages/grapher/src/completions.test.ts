// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa } from "@metta-ts/hyperon";
import { completionsFor } from "./completions";

describe("completions", () => {
  it("surfaces stdlib symbols by prefix", () => {
    const out = completionsFor("car", new MeTTa());
    expect(out).toContain("car-atom");
  });

  it("surfaces != as a standard comparison", () => {
    expect(completionsFor("!=", new MeTTa())).toContain("!=");
  });

  it("surfaces user-defined function names from the space", () => {
    const metta = new MeTTa();
    metta.run("(= (double $x) (* $x 2))");
    expect(completionsFor("dou", metta)).toContain("double");
  });

  it("returns nothing for an empty prefix and respects the limit", () => {
    const metta = new MeTTa();
    expect(completionsFor("", metta)).toEqual([]);
    expect(completionsFor("a", metta, 3).length).toBeLessThanOrEqual(3);
  });

  it("ranks an exact and prefix match above a fuzzy one", () => {
    const metta = new MeTTa();
    const out = completionsFor("if", metta);
    expect(out[0]).toBe("if"); // exact beats any subsequence match
  });
});
