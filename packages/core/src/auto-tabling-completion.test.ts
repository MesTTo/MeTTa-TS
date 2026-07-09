// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { format } from "./parser";
import { runProgram } from "./runner";

const results = (src: string): string[] =>
  runProgram(src, 100_000, new Map(), { tabling: true })[0]!.results.map(format);

describe("adaptive local-linear tabling", () => {
  it("completes a finite direct left-recursive relation", () => {
    const src = `
      (= (edge a b) b)
      (= (edge b c) c)
      (= (edge c d) d)
      (= (edge $x $y) (empty))
      (= (path $x $z) (chain (path $x $y) $mid (path $mid $z)))
      (= (path $x $y) (edge $x $y))
      !(collapse (path a $z))
    `;

    expect(results(src)).toEqual(["(, b c d)"]);
  });

  it("keeps non-cyclic calls as exact ordered bags", () => {
    const src = `
      (= (choice $x) A)
      (= (choice $x) A)
      (= (choice $x) B)
      !(collapse (choice $x))
    `;

    expect(results(src)).toEqual(["(, A A B)"]);
  });
});
