// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The opt-in execution trace bus (trace.ts). These tests assert the events fire for the decisions they
// describe, that installing a sink never changes results (trace-off must be byte-identical, which the
// oracle also guards), and that the trace surfaces the higher-order specialization that previously made a
// native fast path silently decline — the class of bug the trace was built to make visible.

import { describe, expect, it } from "vitest";
import { runProgram } from "./runner";
import { format } from "./parser";
import type { TraceEvent } from "./trace";

const QUEUE_TRACE_PROGRAM = `
  (: Score (-> Expression Number))
  (= (Score (item $name $score)) $score)
  (= (Score ()) -99999.0)
  (: BestCandidate (-> Atom %Undefined% Expression %Undefined%))
  (= (BestCandidate $evaluateCandidateFunction $bestCandidate $tuple)
     (max-by-atom $evaluateCandidateFunction $bestCandidate $tuple))
  (: LimitSize (-> Expression Number Expression))
  (= (LimitSize $L $size)
     (top-k-by-atom Score $size $L))
  !(BestCandidate Score () ((item a 1) (item b 3) (item c 2)))
  !(LimitSize ((item a 1) (item b 3) (item c 2)) 2)`;

const collect = (src: string): TraceEvent[] => {
  const events: TraceEvent[] = [];
  runProgram(src, undefined, undefined, { trace: (e) => events.push(e) });
  return events;
};

describe("execution trace bus", () => {
  it("emits grounded and reduce events, and does not specialize the queue reducers", () => {
    const events = collect(QUEUE_TRACE_PROGRAM);
    const groundedOps = new Set(events.flatMap((e) => (e.kind === "grounded" ? [e.op] : [])));
    // The reasoner's queue helpers now run through the general grounded reducers, not a recursive fold.
    expect(groundedOps.has("max-by-atom")).toBe(true);
    expect(groundedOps.has("top-k-by-atom")).toBe(true);
    // BestCandidate/LimitSize pass their key function as an argument, so they are not higher-order functors
    // and are never specialized (the old `BestCandidate$PriorityRankNeg` interaction is gone).
    expect(events.some((e) => e.kind === "specialize" && e.from === "BestCandidate")).toBe(false);
    expect(events.some((e) => e.kind === "reduce")).toBe(true);
  });

  it("surfaces higher-order specialization when it does happen", () => {
    // `twice`'s parameter is applied as a head, so a call in a rule body is monomorphized by its function
    // argument: `(twice inc …)` becomes `twice$inc`. This is exactly the mechanism that used to defeat the
    // name-keyed fast paths; the trace now makes it observable.
    const events = collect(`(= (twice $f $x) ($f ($f $x)))
      (= (inc $n) (+ $n 1))
      (= (main) (twice inc 0))
      !(main)`);
    expect(
      events.some((e) => e.kind === "specialize" && e.from === "twice" && e.to === "twice$inc"),
    ).toBe(true);
  });

  it("emits an overflow event with the cut-point atom on a runaway recursion", () => {
    const events = collect(`(= (loop $n) (loop (+ $n 1)))
      !(loop 0)`);
    expect(events.some((e) => e.kind === "overflow" && e.atom.includes("loop"))).toBe(true);
  });

  it("is byte-identical with tracing on versus off", () => {
    const off = runProgram(QUEUE_TRACE_PROGRAM).map((g) => g.results.map(format));
    const on = runProgram(QUEUE_TRACE_PROGRAM, undefined, undefined, { trace: () => {} }).map((g) =>
      g.results.map(format),
    );
    expect(on).toEqual(off);
  });
});
