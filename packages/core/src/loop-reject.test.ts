// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Deep variable-loop rejection in the matcher. `matchAtomsWith` admits a cyclic binding (`$x <- (.. $x ..)`)
// with no occurs check — faithful to LeaTTa, whose occurs check lives only in reconcile — so a binding set
// carrying a loop is filtered at the match boundary by `hasLoop`, exactly as Hyperon's `match_atoms`
// filters `!binding.has_loops()` and CeTTa's `bindings_atom_has_loop` rejects a looping bind. `hasLoop` was
// shallow (only the one-hop `$x <- $x` / `$x = $x`), so an indirect cycle like `$x <- (f $y), $y <- (g $x)`
// slipped through; the fixpoint resolver then unrolled it and overflowed the native stack on Nil
// Geisweiller's `bfc-xp` obc proof search (id 4x slower, pm2.43 8x slower and no answer, jarr crashed). The
// design is Alloy-checked in `spec/loop_reject.als` (model MT1). These tests pin the deepened detection and
// the end-to-end proof search that motivated it.
import { describe, it, expect } from "vitest";
import { type Bindings, type BindingRel, hasLoop } from "./bindings";
import { type Atom, sym, variable, expr } from "./atom";
import { runProgram } from "./runner";
import { format } from "./parser";
import { OBC } from "./obc-fixture";

const val = (x: string, a: Atom): Bindings[number] => ({
  tag: "val",
  x,
  a,
  y: undefined,
});
const eq = (x: string, y: string): Bindings[number] => ({ tag: "eq", x, a: undefined, y });
const v = variable;

describe("hasLoop: deep, transitive variable-loop detection", () => {
  it("keeps the trivial one-hop cases (unchanged behaviour)", () => {
    expect(hasLoop([val("x", v("x"))])).toBe(true); // $x <- $x
    expect(hasLoop([eq("x", "x")])).toBe(true); // $x = $x
    expect(hasLoop([])).toBe(false);
    expect(hasLoop([val("x", sym("A"))])).toBe(false);
    expect(hasLoop([eq("x", "y")])).toBe(false); // a plain alias is not a loop
  });

  it("catches a direct value cycle $x <- (f $x) (was missed when shallow)", () => {
    expect(hasLoop([val("x", expr([sym("f"), v("x")]))])).toBe(true);
    // cycle buried deeper in the value
    expect(hasLoop([val("x", expr([sym("f"), expr([sym("g"), v("x")])]))])).toBe(true);
  });

  it("catches an indirect cross-cycle formed by first binds only", () => {
    // $x <- (f $y), $y <- (g $x): each variable bound exactly once, so reconcile's occurs check never
    // fires — this is the exact shape (Alloy firstBindOnlyCycle) that overflowed the obc search.
    const cross: Bindings = [
      val("x", expr([sym("f"), v("y")])),
      val("y", expr([sym("g"), v("x")])),
    ];
    expect(hasLoop(cross)).toBe(true);
    // a 3-cycle
    const three: Bindings = [
      val("x", expr([sym("f"), v("y")])),
      val("y", expr([sym("g"), v("z")])),
      val("z", expr([sym("h"), v("x")])),
    ];
    expect(hasLoop(three)).toBe(true);
  });

  it("does not flag an acyclic chain or a shared-but-acyclic DAG", () => {
    // $x <- (f $y), $y <- A: a chain to a ground leaf.
    expect(hasLoop([val("x", expr([sym("f"), v("y")])), val("y", sym("A"))])).toBe(false);
    // $x <- (f $y $y), $y <- A: $y is shared (a DAG) but there is no cycle.
    expect(hasLoop([val("x", expr([sym("f"), v("y"), v("y")])), val("y", sym("A"))])).toBe(false);
    // a long acyclic chain terminates cleanly (no overflow: the detector is iterative).
    const chain: BindingRel[] = [];
    for (let i = 0; i < 5000; i++) chain.push(val("v" + i, expr([sym("s"), v("v" + (i + 1))])));
    expect(hasLoop(chain)).toBe(false);
  });
});

describe("matcher rejects cyclic unifications end to end", () => {
  const run1 = (src: string): string =>
    runProgram(src, 100_000_000)[0]!.results.map(format).join(" ") || "(empty)";

  it("a first-bind cross-cycle makes the match fail (Hyperon match_atoms parity)", () => {
    // Matching (p $x $y) against (p (f $y) (g $x)) binds $x <- (f $y), $y <- (g $x): a loop, so no match.
    // Without deep detection this returned the unrolled cyclic term (f (g (f (g $x)))).
    expect(run1("!(unify (p $x $y) (p (f $y) (g $x)) $x NO-MATCH)")).toBe("NO-MATCH");
    // a non-cyclic match still succeeds
    expect(run1("!(unify (p $x $y) (p A B) $x NO-MATCH)")).toBe("A");
  });
});

// The proof-size-bounded backward chainer (obc/obc-gtz, shared `OBC` fixture). Its recursive mp rule joins
// two obc subgoals on the shared antecedent `$a`, whose search repeatedly attempts cyclic unifications; deep
// loop rejection is what makes it terminate and find a proof.
describe("bfc-xp proof-size-bounded backward chainer (Nil Geisweiller's benchmark)", () => {
  const proofs = (query: string): string[] =>
    runProgram(OBC + "\n" + query, 100_000_000)[0]!.results.map(format);

  it("id: proves (→ 𝜑 𝜑) at size 5 (was 4x slower)", () => {
    expect(proofs("!(obc 5 (: $x (→ 𝜑 𝜑)))")).toEqual([
      "(MkSized 5 (: (mp (mp ax₂ ax₁) ax₁) (→ 𝜑 𝜑)))",
    ]);
  });

  it("pm2.43: proves (→ (→ 𝜑 (→ 𝜑 𝜓)) (→ 𝜑 𝜓)) at size 7 (previously found no answer)", () => {
    expect(proofs("!(obc 7 (: $x (→ (→ 𝜑 (→ 𝜑 𝜓)) (→ 𝜑 𝜓))))")).toEqual([
      "(MkSized 7 (: (mp (mp ax₂ ax₂) (mp ax₂ ax₁)) (→ (→ 𝜑 (→ 𝜑 𝜓)) (→ 𝜑 𝜓))))",
    ]);
  });

  it("finds no proof below the needed size instead of overflowing the stack", () => {
    // id needs size 5; at size 3 there is genuinely no proof — this must terminate with an empty bag, not
    // crash (sizes ≥ 7 of the jarr goal used to StackOverflow here).
    expect(proofs("!(obc 3 (: $x (→ 𝜑 𝜑)))")).toEqual([]);
  });
});
