// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Contribution-specific benchmark for the static nested argument-head index. Each case runs in a fresh
// process so retained-memory measurements do not overlap. The worker validates the complete ordered result
// sequence and evaluator counter outside the timed region.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  addAtomToEnv,
  buildEnv,
  expr,
  format,
  gint,
  initSt,
  mettaEval,
  preludeAtoms,
  stdTable,
  stdlibAtoms,
  sym,
  variable,
} from "../../core/dist/index.js";

const self = fileURLToPath(import.meta.url);
const workerMode = process.argv.includes("--worker");
const arg = (name, fallback) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};
const A = (...items) => expr(items);

function expectedValue(mode, factCount, resultIndex) {
  return mode === "needle" ? Math.floor(factCount / 2) : resultIndex * 2;
}

function runWorker() {
  const factCount = Number(arg("facts", "100000"));
  const mode = arg("mode", "needle");
  const indexEnabled = arg("index", "on") === "on";
  if (!Number.isInteger(factCount) || factCount < 1) throw new Error("--facts must be positive");
  if (mode !== "needle" && mode !== "dense") throw new Error("--mode must be needle or dense");

  const selected = (index) =>
    mode === "needle" ? index === Math.floor(factCount / 2) : index % 2 === 0;
  const expectedCount = mode === "needle" ? 1 : Math.ceil(factCount / 2);
  const warmupRuns = mode === "needle" ? 8 : 3;
  const sampleRuns = mode === "needle" ? 15 : 5;

  global.gc?.();
  const env = buildEnv([...preludeAtoms(), ...stdlibAtoms()], stdTable());
  if (!indexEnabled) env.nestedMatchIndex = undefined;
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const buildStart = performance.now();
  for (let index = 0; index < factCount; index++) {
    addAtomToEnv(env, A(sym("nested"), A(sym(selected(index) ? "M" : "W"), gint(index))));
  }
  const buildMs = performance.now() - buildStart;
  global.gc?.();
  const retainedHeapDeltaMiB = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;

  const pattern = A(sym("nested"), A(sym("M"), variable("value")));
  const query = A(sym("match"), sym("&self"), pattern, variable("value"));
  const run = () => {
    const start = process.hrtime.bigint();
    const [pairs, end] = mettaEval(env, factCount * 3 + 100_000, initSt(), [], query);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { elapsedMs, values: pairs.map(([atom]) => format(atom)), counter: end.counter };
  };
  const check = ({ values, counter }) => {
    if (values.length !== expectedCount)
      throw new Error(`expected ${expectedCount} results, received ${values.length}`);
    for (let index = 0; index < values.length; index++) {
      const expected = String(expectedValue(mode, factCount, index));
      if (values[index] !== expected)
        throw new Error(`result ${index}: expected ${expected}, received ${values[index]}`);
    }
    if (counter !== factCount)
      throw new Error(`expected counter ${factCount}, received ${counter}`);
  };

  for (let index = 0; index < warmupRuns; index++) check(run());
  const samples = Array.from({ length: sampleRuns }, () => {
    const result = run();
    check(result);
    return result.elapsedMs;
  });
  const nestedBucketCount = env.nestedMatchIndex?.byHead.get(`nested\x011\x01M`)?.length ?? null;
  const expectedBucketCount = indexEnabled ? expectedCount : null;
  if (nestedBucketCount !== expectedBucketCount)
    throw new Error(`expected nested bucket ${expectedBucketCount}, received ${nestedBucketCount}`);

  process.stdout.write(
    JSON.stringify({
      factCount,
      mode,
      indexEnabled,
      selectedCount: expectedCount,
      nestedBucketCount,
      medianQueryMs: median(samples),
      buildMs,
      retainedHeapDeltaMiB,
      finalCounter: factCount,
    }),
  );
}

function runProcess(factCount, mode, indexEnabled) {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--max-old-space-size=4096",
      self,
      "--worker",
      `--facts=${factCount}`,
      `--mode=${mode}`,
      `--index=${indexEnabled ? "on" : "off"}`,
    ],
    { encoding: "utf8", maxBuffer: 1 << 20 },
  );
  if (result.status !== 0)
    throw new Error(
      `worker failed for ${factCount}/${mode}/${indexEnabled ? "index" : "scan"}:\n${result.stderr}`,
    );
  return JSON.parse(result.stdout);
}

function runMatrix() {
  const cases = [
    { factCount: 10_000, mode: "needle", processRuns: 1 },
    { factCount: 100_000, mode: "needle", processRuns: 1 },
    { factCount: 1_000_000, mode: "needle", processRuns: 3 },
    { factCount: 100_000, mode: "dense", processRuns: 1 },
  ];
  const rows = [];
  for (const benchmarkCase of cases) {
    const indexed = [];
    const scanned = [];
    for (let run = 0; run < benchmarkCase.processRuns; run++) {
      indexed.push(runProcess(benchmarkCase.factCount, benchmarkCase.mode, true));
      scanned.push(runProcess(benchmarkCase.factCount, benchmarkCase.mode, false));
    }
    rows.push({
      ...benchmarkCase,
      selectedCount: indexed[0].selectedCount,
      indexedQueryMs: median(indexed.map((result) => result.medianQueryMs)),
      scannedQueryMs: median(scanned.map((result) => result.medianQueryMs)),
      indexedBuildMs: median(indexed.map((result) => result.buildMs)),
      scannedBuildMs: median(scanned.map((result) => result.buildMs)),
      indexedHeapMiB: median(indexed.map((result) => result.retainedHeapDeltaMiB)),
      scannedHeapMiB: median(scanned.map((result) => result.retainedHeapDeltaMiB)),
    });
  }

  console.log("Static nested argument-head index");
  console.log("facts      selected      complete scan      nested index");
  for (const row of rows)
    console.log(
      `${String(row.factCount).padStart(7)}  ${String(row.selectedCount).padStart(12)}  ` +
        `${row.scannedQueryMs.toFixed(6).padStart(14)} ms  ` +
        `${row.indexedQueryMs.toFixed(6).padStart(12)} ms`,
    );

  const million = rows.find((row) => row.factCount === 1_000_000);
  console.log("\n1,000,000-fact construction and retained heap, median of 3 processes");
  console.log(
    `complete scan: ${million.scannedBuildMs.toFixed(6)} ms, ${million.scannedHeapMiB.toFixed(6)} MiB`,
  );
  console.log(
    `nested index: ${million.indexedBuildMs.toFixed(6)} ms, ${million.indexedHeapMiB.toFixed(6)} MiB`,
  );
}

if (workerMode) runWorker();
else runMatrix();
