// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The `metta-debug` CLI (debug-cli.ts). Spawns the built bin like the other CLI tests and checks that
// `run`/`eval` work and that `why` reports the internal decisions it is meant to surface: which grounded
// reducer fired for a queue trim, and higher-order specialization when it happens.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DBG = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "debug-cli.js");
const run = (args: string[]): string =>
  execFileSync(process.execPath, [DBG, ...args], { timeout: 60_000 }).toString();

describe("metta-debug CLI", () => {
  it("run evaluates a program", () => {
    expect(run(["--source", "!(+ 1 2)", "run"])).toContain("3");
  });

  it("eval evaluates one expression", () => {
    expect(run(["--source", "(= (double $x) (* $x 2))", "eval", "(double 21)"])).toContain("42");
  });

  it("why reports the grounded reducer that fired for a queue trim", () => {
    const out = run([
      "--source",
      `!(import! &self nars)
       (= (q) ((Sentence ((--> a b) (stv 1.0 0.9)) (1)) (Sentence ((--> a c) (stv 1.0 0.6)) (2)) (Sentence ((--> a d) (stv 1.0 0.3)) (3))))`,
      "why",
      "(LimitSize (q) 2)",
      "--llm",
    ]);
    const parsed = JSON.parse(out) as { grounded: Record<string, number> };
    expect(parsed.grounded["top-k-by-atom"]).toBeGreaterThan(0);
  });

  it("why surfaces higher-order specialization", () => {
    const out = run([
      "--source",
      `(= (twice $f $x) ($f ($f $x))) (= (inc $n) (+ $n 1)) (= (main) (twice inc 0))`,
      "why",
      "(main)",
      "--llm",
    ]);
    const parsed = JSON.parse(out) as { specialized: string[] };
    expect(parsed.specialized).toContain("twice -> twice$inc");
  });
});
