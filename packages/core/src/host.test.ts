// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { emptyExpr, sym, type ReduceResult } from "./index";
import { composeHostInterops, type HostInterop } from "./host";

const noReduce: ReduceResult = { tag: "noReduce" };
const okUnit: ReduceResult = { tag: "ok", results: [emptyExpr] };

describe("composeHostInterops", () => {
  it("concatenates preludes and merges async ops", () => {
    const opA = async (): Promise<ReduceResult> => okUnit;
    const opB = async (): Promise<ReduceResult> => noReduce;
    const composed = composeHostInterops([
      { name: "a", prelude: "(= (a) 1)", asyncOps: new Map([["a-op", opA]]) },
      { name: "b", prelude: "\n(= (b) 2)\n", asyncOps: new Map([["b-op", opB]]) },
    ]);
    expect(composed.name).toBe("a+b");
    expect(composed.prelude).toBe("(= (a) 1)\n(= (b) 2)");
    expect(composed.asyncOps?.get("a-op")).toBe(opA);
    expect(composed.asyncOps?.get("b-op")).toBe(opB);
  });

  it("rejects duplicate async operation names by default", () => {
    const op = async (): Promise<ReduceResult> => okUnit;
    expect(() =>
      composeHostInterops([
        { name: "a", asyncOps: new Map([["same", op]]) },
        { name: "b", asyncOps: new Map([["same", op]]) },
      ]),
    ).toThrow(/same/);
  });

  it("dispatches host imports in order and stops at the first owner", async () => {
    const calls: string[] = [];
    const composed = composeHostInterops([
      {
        name: "miss",
        hostImport: () => {
          calls.push("miss");
          return noReduce;
        },
      },
      {
        name: "hit",
        hostImport: async () => {
          calls.push("hit");
          return okUnit;
        },
      },
      {
        name: "later",
        hostImport: () => {
          calls.push("later");
          return okUnit;
        },
      },
    ]);
    await expect(composed.hostImport?.(sym("&self"), sym("x"))).resolves.toBe(okUnit);
    expect(calls).toEqual(["miss", "hit"]);
  });

  it("returns noReduce when no host import owns the target", () => {
    const composed = composeHostInterops([
      { name: "a", hostImport: () => noReduce },
      { name: "b", hostImport: () => noReduce },
    ]);
    expect(composed.hostImport?.(sym("&self"), sym("x"))).toEqual(noReduce);
  });

  it("disposes interops in reverse order", async () => {
    const calls: string[] = [];
    const interops: HostInterop[] = [
      { name: "a", dispose: () => void calls.push("a") },
      { name: "b", dispose: async () => void calls.push("b") },
    ];
    await composeHostInterops(interops).dispose?.();
    expect(calls).toEqual(["b", "a"]);
  });
});
