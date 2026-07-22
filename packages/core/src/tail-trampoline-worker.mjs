// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { initSt, mettaEval } from "./eval.ts";
import { format } from "./parser.ts";
import { compiledEnvWith, envWith, parseOne } from "./compile-test-utils.ts";

const input = JSON.parse(readFileSync(0, "utf8"));
const env = input.mode === "interpreted" ? envWith(input.rules) : compiledEnvWith(input.rules);
if (input.mode !== "interpreted") env.useCompiledTailContinuation = input.mode === "on";

const holders = Object.fromEntries(
  [...(env.compiled?.entries() ?? [])].map(([name, holder]) => [name, holder.kind]),
);
process.stdout.write(JSON.stringify({ kind: "started", holders }) + "\n");

const query = parseOne(input.query);
try {
  const [pairs, state] = mettaEval(env, input.fuel, initSt(), [], query);
  const results = pairs.map(([atom]) => format(atom));
  process.stdout.write(
    JSON.stringify({
      kind: "completed",
      outcome: results.some((result) => result.includes("StackOverflow"))
        ? "stack-overflow-error"
        : "result",
      results,
      counter: state.counter,
      holders,
    }) + "\n",
  );
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      kind: "thrown",
      outcome: "thrown",
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      holders,
    }) + "\n",
  );
}
