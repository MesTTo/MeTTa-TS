// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { format, parseAll, standardTokenizer, type Atom } from "@metta-ts/core";
import { run, runSource, runSourceAsync, vfsImports } from "./source";

function inertAtoms(src: string): Atom[] {
  return parseAll(src, standardTokenizer())
    .filter((top) => !top.bang)
    .map((top) => top.atom);
}

const lastResults = (rs: ReturnType<typeof runSource>): string[] =>
  rs.at(-1)?.results.map(format) ?? [];

describe("browser source runners", () => {
  it("runs a source string with in-memory imports", () => {
    const imports = new Map<string, Atom[]>([
      [
        "lib",
        inertAtoms(`
          (: inc (-> Number Number))
          (= (inc $x) (+ $x 1))
        `),
      ],
    ]);
    const rs = runSource("!(import! &self lib)\n!(inc 41)", undefined, imports);
    expect(lastResults(rs)).toEqual(["42"]);
  });

  it("runs a source string against a browser VFS", () => {
    const files = new Map([["math", "(= (double $x) (* 2 $x))"]]);
    expect(lastResults(run("!(import! &self math)\n!(double 21)", files))).toEqual(["42"]);
  });

  it("builds import maps from .metta VFS entries", () => {
    const imports = vfsImports("!(import! &self math)", new Map([["math.metta", "(answer 42)"]]));
    expect(imports.get("math")?.map(format)).toEqual(["(answer 42)"]);
  });

  it("uses async evaluation for concurrency module forms", async () => {
    const rs = await runSourceAsync("!(import! &self concurrency)\n!(par (+ 1 1) (+ 2 2))");
    expect(lastResults(rs)).toEqual(["2", "4"]);
  });

  it("passes hyperpose branches through a caller-provided async parallel evaluator", async () => {
    const branchCalls: string[][] = [];
    const rs = await runSourceAsync(
      `
        (: two (-> Number))
        (= (two) 2)
        (: four (-> Number))
        (= (four) 4)
        !(once (hyperpose ((two) (four))))
      `,
      new Map(),
      undefined,
      new Map(),
      {
        parEvalAsyncImpl: async (_rulesSrc, branchSrcs) => {
          branchCalls.push(branchSrcs);
          return [["77"], null];
        },
      },
    );
    expect(branchCalls).toEqual([["(two)", "(four)"]]);
    expect(lastResults(rs)).toEqual(["77"]);
  });
});
