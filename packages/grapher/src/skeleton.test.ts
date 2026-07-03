// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa, type Atom } from "@metta-ts/hyperon";
import { parseProgram } from "./parse";
import { skeletonize, withSilhouettes } from "./skeleton";

const a = (src: string): Atom => parseProgram(src)[0]!;
const FACT = "(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))";
const mettaWith = (src: string): MeTTa => {
  const m = new MeTTa();
  m.run(src);
  return m;
};

describe("skeleton (silhouette states)", () => {
  it("keeps the rule's variable a slot and body literals literal", () => {
    const m = mettaWith(FACT);
    expect(
      skeletonize(a("(fact 3)"), a("(if (> 3 0) (* 3 (fact (- 3 1))) 1)"), m)?.toString(),
    ).toBe("(if (> $n 0) (* $n (fact (- $n 1))) 1)");
  });

  it("does not mistake a base-case literal for the variable (fact 1)", () => {
    // the argument is 1 and the body has literal 1s (the decrement, the base case); only the real $n is a slot
    const m = mettaWith(FACT);
    expect(
      skeletonize(a("(fact 1)"), a("(if (> 1 0) (* 1 (fact (- 1 1))) 1)"), m)?.toString(),
    ).toBe("(if (> $n 0) (* $n (fact (- $n 1))) 1)");
  });

  it("punches holes only in the reduct, leaving structure outside it literal", () => {
    const m = mettaWith(FACT);
    expect(
      skeletonize(
        a("(* 5 (fact 2))"),
        a("(* 5 (if (> 2 0) (* 2 (fact (- 2 1))) 1))"),
        m,
      )?.toString(),
    ).toBe("(* 5 (if (> $n 0) (* $n (fact (- $n 1))) 1))");
  });

  it("adds no silhouette for a grounded op that binds nothing", () => {
    expect(skeletonize(a("(+ 2 3)"), a("5"), new MeTTa())).toBeNull();
  });

  it("adds no silhouette when the rule body is a bare variable (identity)", () => {
    const m = mettaWith("(= (id $x) $x)");
    expect(skeletonize(a("(id 5)"), a("5"), m)).toBeNull();
  });

  it("splices a silhouette before a rule step, keeping the endpoints", () => {
    const m = mettaWith(FACT);
    const trace = [[a("(fact 1)")], [a("(if (> 1 0) (* 1 (fact (- 1 1))) 1)")]];
    expect(withSilhouettes(trace, m).map((f) => f.map(String))).toEqual([
      ["(fact 1)"],
      ["(if (> $n 0) (* $n (fact (- $n 1))) 1)"],
      ["(if (> 1 0) (* 1 (fact (- 1 1))) 1)"],
    ]);
  });

  it("does not splice into a nondeterministic (wide) frontier", () => {
    const m = mettaWith("(= (coin) Heads)\n(= (coin) Tails)");
    expect(withSilhouettes([[a("(coin)")], [a("Heads"), a("Tails")]], m).length).toBe(2);
  });
});
