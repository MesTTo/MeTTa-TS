// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const print = (line = "") => process.stdout.write(`${line}\n`);
const printErr = (line) => process.stderr.write(`${line}\n`);

export const UPDATE = process.argv.includes("--update");
export const REGRESSION_RATIO = 1.5;
export const REGRESSION_MIN_MS = 1;

export function defaultConcurrencyReportPath(importMetaUrl) {
  return join(dirname(fileURLToPath(importMetaUrl)), "RESULTS-concurrency.md");
}

export function lastResults(results, format) {
  return (results.at(-1)?.results ?? []).map(format);
}

export function expectResults(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${name}: expected ${e}, got ${a}`);
}

function intArg(atom) {
  return atom?.kind === "gnd" && atom.value.g === "int" ? Number(atom.value.n) : 0;
}

export function makeTimerAsyncOps(gint) {
  return new Map([
    [
      "aw",
      async (args) => {
        const n = intArg(args[0]);
        if (n > 0) await new Promise((resolve) => setTimeout(resolve, n));
        return { tag: "ok", results: [gint(n)] };
      },
    ],
  ]);
}

function summarize(times) {
  times.sort((a, b) => a - b);
  return { min: times[0], median: times[Math.floor(times.length / 2)] };
}

export async function measureCases(cases) {
  const rows = [];
  for (const benchmark of cases) {
    await benchmark.run();
    await benchmark.run();
    const times = [];
    for (let i = 0; i < benchmark.runs; i++) {
      const start = performance.now();
      await benchmark.run();
      times.push(performance.now() - start);
    }
    rows.push({ benchmark: benchmark.name, runs: benchmark.runs, ...summarize(times) });
  }
  return rows;
}

const ms = (value) => value.toFixed(2);
const key = (row) => row.benchmark;

export function renderTable(data) {
  const header = "| benchmark | runs | min ms | median ms |\n|---|---:|---:|---:|";
  const body = data
    .map((row) => `| ${row.benchmark} | ${row.runs} | ${ms(row.min)} | ${ms(row.median)} |`)
    .join("\n");
  return `${header}\n${body}`;
}

function parseBaseline(markdown) {
  const medians = new Map();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 6 || cells[1] === "benchmark" || cells[1] === "") continue;
    const median = Number(cells[4]);
    if (Number.isFinite(median)) medians.set(cells[1], median);
  }
  return medians;
}

export function writeOrCheckReport({
  rows,
  out,
  update,
  report,
  createCommand,
  regressionRatio,
  regressionMinMs,
  padWidth = 40,
}) {
  print(report);

  if (update) {
    writeFileSync(out, report);
    print(`\nWrote baseline to ${out}`);
    return;
  }

  if (!existsSync(out)) {
    print(`\nNo baseline at ${out}; run \`${createCommand}\` to create one.`);
    return;
  }

  const baseline = parseBaseline(readFileSync(out, "utf8"));
  const regressions = [];
  for (const row of rows) {
    const before = baseline.get(key(row));
    if (before === undefined) continue;
    const ratio = row.median / before;
    const regressed = ratio > regressionRatio && row.median - before > regressionMinMs;
    const marker = regressed ? " <== REGRESSION" : "";
    if (regressed) regressions.push(key(row));
    print(
      `${key(row).padEnd(padWidth)} ${ms(before)} -> ${ms(row.median)} (${ratio.toFixed(2)}x)${marker}`,
    );
  }

  if (regressions.length > 0) {
    printErr(
      `\n${regressions.length} operation(s) exceeded both ${regressionRatio}x baseline and a ${ms(regressionMinMs)} ms slowdown.`,
    );
    process.exit(1);
  }
  print(
    `\nNo operation exceeded both ${regressionRatio}x baseline and a ${ms(regressionMinMs)} ms slowdown.`,
  );
}
