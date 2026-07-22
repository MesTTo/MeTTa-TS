// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compiledEnvWith, evalQuery, parseOne } from "./compile-test-utils";
import { format } from "./parser";
import { runProgram } from "./runner";

const COUNTDOWN = `(= (count $n) (if (== $n 0) done (count (- $n 1))))`;
const GUARDED_MULTI_RULE_COUNTDOWN = `(= (count 0) done)
(= (count $n) (if (> $n 0) (count (- $n 1)) (empty)))`;
const ISOLATED_FUEL = 500_000_000;
const NONTERMINATION_TIMEOUT_MS = 1_500;

type IsolatedOutcome =
  | {
      readonly outcome: "result" | "stack-overflow-error";
      readonly results: string[];
      readonly counter: number;
      readonly holders: Record<string, string>;
    }
  | {
      readonly outcome: "timeout";
      readonly holders: Record<string, string>;
    }
  | {
      readonly outcome: "thrown";
      readonly name: string;
      readonly message: string;
      readonly holders: Record<string, string>;
    };

interface IsolatedCase {
  readonly rules: string;
  readonly query: string;
}

function runIsolated(
  testCase: IsolatedCase,
  mode: "on" | "off" | "interpreted",
  timeoutMs = NONTERMINATION_TIMEOUT_MS,
): IsolatedOutcome {
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL("./tail-trampoline-worker.mjs", import.meta.url))],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: JSON.stringify({ ...testCase, mode, fuel: ISOLATED_FUEL }),
      timeout: timeoutMs,
      killSignal: "SIGTERM",
      maxBuffer: 1 << 20,
    },
  );
  const messages = run.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IsolatedOutcome & { kind: string });
  const holders = messages.find((message) => message.kind === "started")?.holders ?? {};
  if (
    (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ||
    run.signal === "SIGTERM"
  )
    return { outcome: "timeout", holders };
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0)
    throw new Error(
      `tail trampoline worker exited ${run.status}${run.stderr.length > 0 ? `: ${run.stderr}` : ""}`,
    );
  const result = messages.at(-1);
  if (result === undefined || result.kind === "started")
    throw new Error("tail trampoline worker returned no outcome");
  return result;
}

function runMode(rules: string, query: string, flatten: boolean) {
  const env = compiledEnvWith(rules);
  env.useCompiledTailContinuation = flatten;
  return evalQuery(env, parseOne(query));
}

function expectByteIdentical(rules: string, query: string): void {
  expect(runMode(rules, query, true), query).toEqual(runMode(rules, query, false));
}

describe("compiled tail-call trampoline", () => {
  it("counts down 100000 evaluated arguments without exhausting the native stack", () => {
    const result = runProgram(`${COUNTDOWN}\n!(count 100000)`, 500_000_000, new Map(), {});

    expect(result[0]!.results.map(format)).toEqual(["done"]);
  }, 30_000);

  it("flattens the deterministic branch of a multi-rule count-down", () => {
    const result = runProgram(
      `${GUARDED_MULTI_RULE_COUNTDOWN}\n!(count 2000)`,
      500_000_000,
      new Map(),
      {},
    );

    expect(result[0]!.results.map(format)).toEqual(["done"]);
  });

  it("is byte-identical to recursive normalization on ground and adversarial calls", () => {
    const cases = [
      {
        rules: COUNTDOWN,
        query: "(count 80)",
      },
      {
        rules: GUARDED_MULTI_RULE_COUNTDOWN,
        query: "(count 80)",
      },
      {
        rules: `
          (= (walk Z) done)
          (= (walk (S $n)) (walk $n))
          (= (walk (T $n)) alternate)`,
        query: "(walk (S (S (S Z))))",
      },
      {
        rules: `
          (= (pick 0) exact)
          (= (pick $n) general)`,
        query: "(pick 0)",
      },
      {
        rules: `(= (sum $n) (if (== $n 0) 0 (+ $n (sum (- $n 1)))))`,
        query: "(sum 20)",
      },
      {
        rules: `
          (= (choices 0) base)
          (= (choices $n)
             (if (== $n 0)
                 base
                 (superpose ((choices (- $n 1)) alternate))))`,
        query: "(choices 4)",
      },
      {
        rules: `
          (= (even $n) (if (== $n 0) True (odd (- $n 1))))
          (= (odd $n) (if (== $n 0) False (even (- $n 1))))`,
        query: "(even 40)",
      },
      {
        rules: `
          (= (classify Z) zero)
          (= (classify (S $x)) (successor $x))`,
        query: "(classify $query)",
      },
      {
        rules: `
          (= (source) (superpose (1 2)))
          (= (relay $x) (output $x))`,
        query: "(relay (source))",
      },
    ];

    for (const testCase of cases) expectByteIdentical(testCase.rules, testCase.query);
  });

  it("stays byte-identical across generated count-down depths", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 80 }), (depth) => {
        expectByteIdentical(COUNTDOWN, `(count ${depth})`);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});

describe("compiled tail-call nontermination differential", () => {
  const runawayCases: Array<
    IsolatedCase & {
      readonly name: string;
      readonly holderNames: string[];
      readonly expected: Record<"on" | "off" | "interpreted", IsolatedOutcome["outcome"]>;
    }
  > = [
    {
      name: "lone catch-all self rule",
      rules: `(= (self $n) (self (flip-self $n)))
(= (flip-self 0) 1)
(= (flip-self 1) 0)`,
      query: "(self 0)",
      holderNames: ["self", "flip-self"],
      expected: {
        on: "stack-overflow-error",
        off: "stack-overflow-error",
        interpreted: "timeout",
      },
    },
    {
      name: "mutual recursion",
      rules: `(= (a $n) (b $n))
(= (b $n) (a $n))`,
      query: "(a 0)",
      holderNames: ["a", "b"],
      expected: { on: "timeout", off: "stack-overflow-error", interpreted: "timeout" },
    },
    {
      name: "multi-rule tail cycle",
      rules: `(= (phase A) (phase B))
(= (phase B) (phase A))`,
      query: "(phase A)",
      holderNames: ["phase"],
      expected: { on: "timeout", off: "stack-overflow-error", interpreted: "timeout" },
    },
    {
      name: "tail cycle through a compiled operator",
      rules: `(= (spin A) (spin (flip A)))
(= (spin B) (spin (flip B)))
(= (flip A) B)
(= (flip B) A)`,
      query: "(spin A)",
      holderNames: ["spin", "flip"],
      expected: { on: "timeout", off: "stack-overflow-error", interpreted: "timeout" },
    },
  ];

  for (const testCase of runawayCases) {
    for (const mode of ["on", "off", "interpreted"] as const) {
      it(`${testCase.name}: ${mode}`, async () => {
        const outcome = await runIsolated(testCase, mode);
        expect(outcome.outcome).toBe(testCase.expected[mode]);
        if (mode !== "interpreted")
          for (const name of testCase.holderNames) expect(outcome.holders[name]).toBeDefined();
        if (outcome.outcome === "stack-overflow-error") {
          expect(outcome.results).toHaveLength(1);
          expect(outcome.results[0]).toContain("StackOverflow");
        }
      }, 5_000);
    }
  }

  const terminatingCases: Array<IsolatedCase & { readonly name: string }> = [
    {
      name: "deep single-rule count-down",
      rules: COUNTDOWN,
      query: "(count 10000)",
    },
    {
      name: "deep guarded multi-rule count-down",
      rules: GUARDED_MULTI_RULE_COUNTDOWN,
      query: "(count 6000)",
    },
  ];

  for (const testCase of terminatingCases) {
    it(`${testCase.name} restores the interpreted result`, async () => {
      const on = await runIsolated(testCase, "on", 15_000);
      const off = await runIsolated(testCase, "off", 15_000);
      const interpreted = await runIsolated(testCase, "interpreted", 15_000);
      expect(on).toMatchObject({ outcome: "result", results: ["done"] });
      expect(off).toMatchObject({ outcome: "stack-overflow-error" });
      expect(interpreted).toMatchObject({ outcome: "result", results: ["done"] });
    }, 45_000);
  }
});
