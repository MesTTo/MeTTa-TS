// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { emptyExpr, expr, sym, type Atom } from "./atom";
import { emptyBindings, type Bindings } from "./bindings";
import { evalAtom, mettaEval, mettaEvalAsync, type MinEnv, type St } from "./eval";
import {
  answerOutcome,
  exhaustedOutcome,
  infrastructureFaultFromUnknown,
  isEvaluationFault,
  languageFaultOutcome,
  projectLegacyOutcome,
  stuckOutcome,
  type EvaluationOutcome,
} from "./eval-outcome";
import { RuntimeIdAllocator } from "./trace";
import { runProgram, type QueryResult } from "./runner";

type LegacyEval = (
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  atom: Atom,
) => [Array<[Atom, Bindings]>, St];

type LegacyEvalAsync = (
  env: MinEnv,
  fuel: number,
  state: St,
  bindings: Bindings,
  atom: Atom,
  signal?: AbortSignal,
) => Promise<[Array<[Atom, Bindings]>, St]>;

const legacyEval: LegacyEval = mettaEval;
const legacyEvalAsync: LegacyEvalAsync = mettaEvalAsync;
const legacyEvalAtom: (env: MinEnv, atom: Atom, state?: St, fuel?: number) => [Atom[], St] =
  evalAtom;

describe("typed evaluation outcomes", () => {
  it("leaves legacy evaluator and QueryResult shapes unchanged", () => {
    expect(legacyEval).toBe(mettaEval);
    expect(legacyEvalAsync).toBe(mettaEvalAsync);
    expect(legacyEvalAtom).toBe(evalAtom);
    const result: QueryResult = runProgram("! Empty")[0]!;
    expect(Object.keys(result)).toEqual(["query", "results"]);
    expect(result.results).toEqual([sym("Empty")]);
  });

  it("keeps Empty and unit as answers while exhaustion has no pair", () => {
    expect(projectLegacyOutcome(answerOutcome(sym("Empty"), emptyBindings))).toEqual({
      kind: "pairs",
      pairs: [[sym("Empty"), emptyBindings]],
    });
    expect(projectLegacyOutcome(answerOutcome(emptyExpr, emptyBindings))).toEqual({
      kind: "pairs",
      pairs: [[emptyExpr, emptyBindings]],
    });
    expect(projectLegacyOutcome(exhaustedOutcome())).toEqual({ kind: "pairs", pairs: [] });
  });

  it("materializes stuck and language faults using Minimal MeTTa atoms", () => {
    const call = expr([sym("missing")]);
    expect(projectLegacyOutcome(stuckOutcome(call, emptyBindings, "no-rule"))).toEqual({
      kind: "pairs",
      pairs: [[sym("NotReducible"), emptyBindings]],
    });
    const error = expr([sym("Error"), call, sym("NoReturn")]);
    expect(projectLegacyOutcome(languageFaultOutcome(error, emptyBindings))).toEqual({
      kind: "pairs",
      pairs: [[error, emptyBindings]],
    });
  });

  it("does not silently convert a resource fault to logical failure", () => {
    const outcome: EvaluationOutcome = {
      kind: "resource-fault",
      fault: {
        kind: "resource-limit",
        resource: "steps",
        limit: 10,
        consumed: 10,
        requested: 1,
      },
      bindings: emptyBindings,
      subject: sym("query"),
    };
    expect(projectLegacyOutcome(outcome)).toEqual({ kind: "fault", fault: outcome });
    expect(
      projectLegacyOutcome(outcome, {
        resourceFault: (fault) =>
          expr([sym("Error"), fault.subject ?? sym("unknown"), sym("StackOverflow")]),
      }),
    ).toMatchObject({ kind: "pairs" });
    expect(isEvaluationFault(outcome)).toBe(true);
  });

  it("keeps suspension distinct from completion", () => {
    const allocator = new RuntimeIdAllocator("run");
    const outcome: EvaluationOutcome = {
      kind: "suspended",
      token: allocator.next("suspension"),
      reason: "async-grounded-call",
    };
    expect(projectLegacyOutcome(outcome)).toEqual({ kind: "suspended", suspension: outcome });
    expect(isEvaluationFault(outcome)).toBe(false);
  });

  it("normalizes unexpected host failures into infrastructure faults", () => {
    const outcome = infrastructureFaultFromUnknown("grounded-call", new TypeError("bad host"), {
      bindings: emptyBindings,
      subject: sym("foreign"),
    });
    expect(outcome).toMatchObject({
      kind: "infrastructure-fault",
      phase: "grounded-call",
      name: "TypeError",
      message: "bad host",
      bindings: emptyBindings,
      subject: sym("foreign"),
    });
    expect(projectLegacyOutcome(outcome)).toEqual({ kind: "fault", fault: outcome });
    expect(infrastructureFaultFromUnknown("codec", { toString: () => "host object" }).message).toBe(
      "Unknown infrastructure failure",
    );
  });
});
