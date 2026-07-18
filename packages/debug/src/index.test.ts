// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  evalSequential,
  parseAll,
  runProgram,
  standardTokenizer,
  type TraceEvent,
} from "@metta-ts/core";
import { assembleQuery, collectTrace, explainCall, summarize, type TraceRunner } from "./index";

const sequentialRunner: TraceRunner = (program, fuel, imports, opts) =>
  evalSequential(parseAll(program, standardTokenizer()), fuel, imports, opts);

const programRunner: TraceRunner = (program, fuel, imports, opts) =>
  runProgram(program, fuel, imports, opts);

const QUEUE_SOURCE = `
  (: Score (-> Expression Number))
  (= (Score (item $name $score)) $score)
  (= (Score ()) -99999.0)
  (: LimitSize (-> Expression Number Expression))
  (= (LimitSize $L $size)
     (top-k-by-atom Score $size $L))`;

describe("@metta-ts/debug", () => {
  it("summarizes trace events with grounded counts and stable lists", () => {
    const events: TraceEvent[] = [
      { kind: "reduce", atom: "(main)" },
      { kind: "grounded", op: "top-k-by-atom" },
      { kind: "grounded", op: "top-k-by-atom" },
      { kind: "grounded", op: "max-by-atom" },
      { kind: "specialize", from: "twice", to: "twice$inc" },
      { kind: "specialize", from: "twice", to: "twice$inc" },
      { kind: "overflow", atom: "(loop 0)" },
      { kind: "overflow", atom: "(loop 1)" },
      { kind: "reduce", atom: "(done)" },
    ];

    expect(summarize(events)).toEqual({
      grounded: {
        "top-k-by-atom": 2,
        "max-by-atom": 1,
      },
      specialized: ["twice -> twice$inc"],
      overflow: ["(loop 0)", "(loop 1)"],
      reductions: 2,
    });
  });

  it("explains a call through an injected core runner", () => {
    const explanation = explainCall(sequentialRunner, "(= (double $x) (* $x 2))", "(double 21)");

    expect(explanation.result).toEqual(["42"]);
    expect(explanation.trace).toContainEqual({ kind: "reduce", atom: "(double 21)" });
    expect(explanation.summary.reductions).toBeGreaterThan(0);
  });

  it("summarizes grounded reducers from an injected program runner", () => {
    const explanation = explainCall(
      programRunner,
      QUEUE_SOURCE,
      "(LimitSize ((item a 1) (item b 3) (item c 2)) 2)",
    );

    expect(explanation.result).toEqual(["((item b 3))"]);
    expect(explanation.summary.grounded["top-k-by-atom"]).toBe(1);
  });

  it("collects trace events for an already assembled program", () => {
    const trace = collectTrace(
      programRunner,
      assembleQuery(QUEUE_SOURCE, "(LimitSize ((item a 1) (item b 3) (item c 2)) 2)"),
    );

    expect(trace.some((e) => e.kind === "grounded" && e.op === "top-k-by-atom")).toBe(true);
  });
});
