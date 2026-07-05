// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { FuzzyMatcher } from "./fuzzy";

describe("FuzzyMatcher", () => {
  it("suggests the closest known name for a one-edit typo", () => {
    const m = new FuzzyMatcher(["fibonacci", "factorial", "map"]);
    expect(m.suggest("fibonaci")).toEqual(["fibonacci"]);
  });
  it("ranks a nearer match first", () => {
    // "color" is one edit from "colour" (delete the u); "colon" is two (u->n, delete r). Both are within
    // the length-6 query's distance bound of 2, so the nearer one must sort ahead.
    const m = new FuzzyMatcher(["color", "colon", "list"]);
    expect(m.suggest("colour")[0]).toBe("color");
  });
  it("returns nothing for a query with no near match", () => {
    const m = new FuzzyMatcher(["fibonacci", "map"]);
    expect(m.suggest("zzzzzz")).toEqual([]);
  });
  it("ignores very short queries to avoid noise", () => {
    const m = new FuzzyMatcher(["if", "in"]);
    expect(m.suggest("ig")).toEqual([]);
  });
});
