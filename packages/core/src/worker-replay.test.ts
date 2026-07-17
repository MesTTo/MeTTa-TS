// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { stdTable } from "./builtins";
import { buildEnv } from "./eval";
import { parseAll } from "./parser";
import { preludeAtoms, standardTokenizer } from "./runner";
import {
  analyzeWorkerReplaySafety,
  isWorkerReplaySafeAtom,
  isWorkerReplaySafeWithoutRuleCalls,
} from "./worker-replay";

const atoms = (source: string) =>
  parseAll(source, standardTokenizer())
    .filter((term) => !term.bang)
    .map((term) => term.atom);

describe("worker replay analysis", () => {
  it("rejects every branch when a variable-headed rule can rewrite it", () => {
    const env = buildEnv([...preludeAtoms(), ...atoms("(= $x (println! leaked))")], stdTable());
    const branch = atoms("(+ 1 2)")[0]!;
    const safeFunctors = analyzeWorkerReplaySafety(env);

    expect(safeFunctors.size).toBe(0);
    expect(isWorkerReplaySafeWithoutRuleCalls(env, branch)).toBe(false);
    expect(isWorkerReplaySafeAtom(env, branch, safeFunctors)).toBe(false);
  });
});
