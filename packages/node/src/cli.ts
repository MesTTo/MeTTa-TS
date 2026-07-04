#!/usr/bin/env node

// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// MeTTa TS command-line runner: `metta-ts <file.metta>` prints each !-query's results.
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { format, setOutputSink, setRawSink, type RunOptions } from "@metta-ts/core";
import { runFile } from "./index";

// Deep effectful MeTTa recursion can exceed V8's default call stack. Re-exec once with a larger stack,
// matching the reference interpreter's iterative driver. Set METTA_TS_STACK to skip (e.g. when embedding).
function reexecWithLargerStack(): void {
  const res = spawnSync(
    process.execPath,
    ["--stack-size=8000", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, METTA_TS_STACK: "1" } },
  );
  process.exit(res.status ?? 1);
}

/** Run the file, buffering every byte it would print (query results plus eval-time `println!`/`print!`),
 *  and return it as one string. Buffering lets the optimistic default-stack attempt be discarded and
 *  retried under a bigger stack without a program that printed before overflowing double-printing. */
function runToBuffer(file: string, fuel: number | undefined, opts: RunOptions | undefined): string {
  const buf: string[] = [];
  const prevOut = setOutputSink((line) => buf.push(line + "\n"));
  const prevRaw = setRawSink((text) => buf.push(text));
  try {
    for (const r of runFile(file, fuel, opts))
      buf.push("[" + r.results.map(format).join(", ") + "]\n");
    return buf.join("");
  } finally {
    setOutputSink(prevOut);
    setRawSink(prevRaw);
  }
}

function main(): void {
  // CLI resource limits: `--max-steps` is the step ceiling, and `--max-stack-depth` seeds the interpreter
  // stack-depth bound a program can further tighten with `pragma!`.
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      "max-steps": { type: "string" },
      "max-stack-depth": { type: "string" },
      "hash-cons": { type: "boolean" },
      "flat-atomspace": { type: "boolean" },
    },
  });
  const file = positionals[0];
  if (file === undefined) {
    process.stderr.write(
      "usage: metta-ts [--max-steps=N] [--max-stack-depth=N] [--hash-cons] [--flat-atomspace] <file.metta>\n",
    );
    process.exit(2);
  }
  const fuel = values["max-steps"] !== undefined ? Number(values["max-steps"]) : undefined;
  const maxStackDepth =
    values["max-stack-depth"] !== undefined ? Number(values["max-stack-depth"]) : undefined;
  const hashCons =
    values["hash-cons"] === true ||
    process.env.METTA_TS_HASHCONS === "1" ||
    process.env.METTA_TS_HASHCONS === "true";
  const flatAtomspace =
    values["flat-atomspace"] === true ||
    process.env.METTA_TS_FLAT_ATOMSPACE === "1" ||
    process.env.METTA_TS_FLAT_ATOMSPACE === "true";
  const opts: RunOptions | undefined =
    maxStackDepth !== undefined || hashCons || flatAtomspace
      ? {
          ...(maxStackDepth !== undefined ? { maxStackDepth } : {}),
          ...(hashCons || flatAtomspace
            ? {
                experimental: {
                  ...(hashCons ? { hashCons: true } : {}),
                  ...(flatAtomspace ? { flatAtomspace: true } : {}),
                },
              }
            : {}),
        }
      : undefined;
  // The child of a big-stack reexec (METTA_TS_STACK=1) already has the room, so it just runs. Otherwise
  // try on V8's default stack first: most programs fit, and skipping the second node startup is worth ~80ms
  // on a short run. Only a genuine stack overflow reexecs once with an 8 MB stack, re-running from the
  // buffered start so nothing prints twice.
  if (process.env.METTA_TS_STACK !== undefined) {
    process.stdout.write(runToBuffer(file, fuel, opts));
    return;
  }
  try {
    process.stdout.write(runToBuffer(file, fuel, opts));
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    reexecWithLargerStack();
  }
}

main();
