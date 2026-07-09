// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Head-to-head subprocess benchmark for nondeterministic workloads reported against MeTTa TS.
// Inputs retain the reported query shapes. The harness validates direct output after timing so a
// benchmark assertion cannot trigger a different evaluator optimization.
//
// Usage:
//   pnpm bench:nondeterminism
//   PETTA_DIR=/path/to/PeTTa node packages/node/bench/nondeterminism.mjs --runs=5
//   node packages/node/bench/nondeterminism.mjs --engine=ts --filter=fib

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { arg, benchDir, cliPath } from "./bench-common.mjs";

const casesDir = resolve(benchDir, "nondeterminism");
const pettaDir = resolve(process.env.PETTA_DIR ?? resolve(benchDir, "../../../../PeTTa"));
const pettaRunner = join(pettaDir, "run.sh");
const requestedEngine = arg("engine", "both");
const runs = Math.max(1, Number(arg("runs", "5")));
const timeoutMs = Number(arg("timeout", "120")) * 1000;
const maxSteps = arg("max-steps", "1000000000");
const filter = arg("filter", "");

if (!existsSync(cliPath)) {
  console.error(`Missing MeTTa TS CLI: ${cliPath}`);
  console.error(
    "Build it first with: pnpm -r --filter @metta-ts/core --filter @metta-ts/node build",
  );
  process.exit(2);
}

if (!new Set(["both", "ts", "petta"]).has(requestedEngine)) {
  console.error(`Invalid --engine=${requestedEngine}; expected both, ts, or petta`);
  process.exit(2);
}

let engine = requestedEngine;
if ((engine === "both" || engine === "petta") && !existsSync(pettaRunner)) {
  if (engine === "petta") {
    console.error(`Missing PeTTa runner: ${pettaRunner}`);
    console.error("Set PETTA_DIR to a PeTTa checkout containing run.sh");
    process.exit(2);
  }
  console.warn(`PeTTa not found at ${pettaDir}; running MeTTa TS only`);
  engine = "ts";
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function resultRegion(kind, output) {
  if (kind !== "petta") return output;
  const lastDebugReset = output.lastIndexOf("\u001b[0m");
  return lastDebugReset < 0 ? output : output.slice(lastDebugReset + 4);
}

function numericResults(kind, output) {
  return resultRegion(kind, output).match(/-?\d+(?:\.\d+)?/g) ?? [];
}

function firstMismatch(values, expected) {
  if (values.length !== expected.length)
    return `expected ${expected.length} results, found ${values.length}`;
  const index = values.findIndex((value, i) => value !== expected[i]);
  return index < 0
    ? null
    : `result ${index} differs: expected ${expected[index]}, found ${values[index]}`;
}

const crossProductExpected = [];
for (let x = 1; x <= 22; x++)
  for (let y = 1; y <= 22; y++)
    for (let z = 1; z <= 22; z++)
      for (let w = 1; w <= 22; w++) crossProductExpected.push(String(w + x * y * z));

const fibDistinctMemo = new Map();
function fibDistinct(n) {
  const cached = fibDistinctMemo.get(n);
  if (cached !== undefined) return cached;
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const key = String(value);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  if (n < 2) add(BigInt(n));
  else
    for (const left of fibDistinct(n - 1))
      for (const right of fibDistinct(n - 2)) add(left + right);
  add(42n);
  fibDistinctMemo.set(n, out);
  return out;
}

const compareIntegerStrings = (left, right) => {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

const fibExpected = fibDistinct(7).map(String).sort(compareIntegerStrings);

const validators = new Map([
  [
    "superpose-cross-product.metta",
    (kind, output) => firstMismatch(numericResults(kind, output), crossProductExpected),
  ],
  [
    "tuple-concat.metta",
    (kind, output) => {
      const values = numericResults(kind, output);
      const expected = Array.from({ length: 20 }, (_, index) => String(index + 1));
      return values.length === expected.length &&
        values.every((value, index) => value === expected[index])
        ? null
        : `expected distinct values 1..20, found ${values.join(" ").slice(0, 200)}`;
    },
  ],
  [
    "tabled-nondeterministic-fib.metta",
    (kind, output) =>
      firstMismatch(numericResults(kind, output).sort(compareIntegerStrings), fibExpected),
  ],
]);

function classify(kind, file, result, ms) {
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const timedOut = result.signal === "SIGTERM" || result.error?.code === "ETIMEDOUT";
  const checks = (output.match(/✅/g) ?? []).length;
  const failures = (output.match(/❌/g) ?? []).length;
  if (timedOut) return { status: "timeout", ms, detail: `${timeoutMs / 1000}s limit` };
  if (result.error !== undefined)
    return { status: "error", ms, detail: String(result.error.message ?? result.error) };
  if (result.status !== 0)
    return { status: "error", ms, detail: `exit ${result.status}: ${output.trim().slice(-500)}` };
  if (failures > 0) return { status: "fail", ms, detail: `${failures} failed assertion(s)` };
  const validator = validators.get(basename(file));
  const validationError = validator?.(kind, output) ?? null;
  if (validationError !== null) return { status: "fail", ms, detail: validationError };
  if (checks === 0 && validator === undefined)
    return { status: "fail", ms, detail: "no assertion or output validator ran" };
  return {
    status: "pass",
    ms,
    detail: checks > 0 ? `${checks} assertion(s)` : "validated output",
  };
}

function runOnce(kind, file) {
  const command = kind === "ts" ? process.execPath : "sh";
  const args =
    kind === "ts"
      ? ["--stack-size=8000", cliPath, `--max-steps=${maxSteps}`, file]
      : [pettaRunner, file];
  const start = performance.now();
  const result = spawnSync(command, args, {
    cwd: kind === "ts" ? undefined : pettaDir,
    encoding: "utf8",
    env: { ...process.env, ...(kind === "ts" ? { METTA_TS_STACK: "1" } : {}) },
    maxBuffer: 1 << 27,
    timeout: timeoutMs,
  });
  return classify(kind, file, result, performance.now() - start);
}

function runCase(kind, file) {
  const attempts = [];
  for (let i = 0; i < runs; i++) {
    const attempt = runOnce(kind, file);
    attempts.push(attempt);
    if (attempt.status !== "pass") break;
  }
  const successful = attempts.filter((attempt) => attempt.status === "pass");
  const complete = successful.length === runs;
  return {
    attempts,
    status: complete ? "pass" : attempts.at(-1).status,
    detail: complete ? `${runs} pass` : attempts.at(-1).detail,
    medianMs: complete ? median(successful.map((attempt) => attempt.ms)) : null,
  };
}

const files = readdirSync(casesDir)
  .filter((file) => file.endsWith(".metta"))
  .filter((file) => filter === "" || file.includes(filter))
  .sort();

const pad = (value, width) => String(value).padEnd(width);
const padLeft = (value, width) => String(value).padStart(width);
const displayMs = (run) => {
  if (run === null) return "-";
  return run.medianMs === null ? `${run.status}*` : run.medianMs.toFixed(1);
};

console.log("MeTTa TS nondeterminism benchmark");
console.log(`  cases=${files.length} runs=${runs} timeout=${timeoutMs / 1000}s engine=${engine}`);
if (engine !== "ts") console.log(`  PeTTa=${pettaDir}`);
console.log("");
console.log(
  pad("case", 36),
  padLeft("PeTTa ms", 12),
  padLeft("MeTTa TS ms", 14),
  padLeft("speedup", 10),
);
console.log("-".repeat(76));

let failed = false;
for (const file of files) {
  const path = join(casesDir, file);
  const petta = engine === "ts" ? null : runCase("petta", path);
  const ts = engine === "petta" ? null : runCase("ts", path);
  const speedup =
    petta !== null && petta.medianMs !== null && ts !== null && ts.medianMs !== null
      ? petta.medianMs / ts.medianMs
      : null;
  failed ||= petta?.status !== undefined && petta.status !== "pass";
  failed ||= ts?.status !== undefined && ts.status !== "pass";
  console.log(
    pad(basename(file, ".metta"), 36),
    padLeft(displayMs(petta), 12),
    padLeft(displayMs(ts), 14),
    padLeft(speedup === null ? "-" : `${speedup.toFixed(2)}x`, 10),
  );
  if (petta !== null && petta.status !== "pass") console.log(`  PeTTa: ${petta.detail}`);
  if (ts !== null && ts.status !== "pass") console.log(`  MeTTa TS: ${ts.detail}`);
}

console.log(
  "\nTimings are subprocess medians and include runtime startup. speedup = PeTTa / MeTTa TS.",
);
if (failed) process.exitCode = 1;
