// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Scale gate for real MeTTa programs. The generated cases exercise large static spaces, runtime-added
// spaces, named spaces, count aggregation, conjunctive joins, removals, and the Hyperon-valid corpus
// workloads touched by the audit fixes.

import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "../../core/dist/index.js";
import { runFile, runSource } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "corpus-mettats");
const FUEL = 100_000_000;
const sizeArg = process.argv.find((a) => a.startsWith("--size="));
const SIZE = sizeArg === undefined ? 30_000 : Number(sizeArg.slice("--size=".length));
if (!Number.isInteger(SIZE) || SIZE < 1) {
  console.error("--size must be a positive integer");
  process.exit(2);
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const fmtMs = (n) => n.toFixed(1);
const rows = [];

function runCase(name, src, expected, limitMs) {
  const t0 = performance.now();
  const out = runSource(src, FUEL);
  const ms = performance.now() - t0;
  const got = out.at(-1)?.results.map(format) ?? [];
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  rows.push({ name, ms, limitMs, got: got.join(" "), ok });
  if (!ok) throw new Error(`${name}: expected ${expected.join(" ")} got ${got.join(" ")}`);
  if (ms > limitMs) throw new Error(`${name}: ${fmtMs(ms)}ms exceeded ${limitMs}ms`);
}

function runCorpusCase(file, expected, limitMs) {
  const path = resolve(corpus, file);
  const t0 = performance.now();
  const out = runFile(path, FUEL);
  const ms = performance.now() - t0;
  const got = out.at(-1)?.results.map(format) ?? [];
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  rows.push({ name: basename(file, ".metta"), ms, limitMs, got: got.join(" "), ok });
  if (!ok) throw new Error(`${file}: expected ${expected.join(" ")} got ${got.join(" ")}`);
  if (ms > limitMs) throw new Error(`${file}: ${fmtMs(ms)}ms exceeded ${limitMs}ms`);
}

function facts(n, f) {
  let out = "";
  for (let i = 0; i < n; i++) out += f(i) + "\n";
  return out;
}

const mid = Math.floor(SIZE / 2);
const staticSpace =
  facts(SIZE, (i) => `(edge ${i} ${i + 1})`) +
  `!(collapse (match &self (edge ${mid} $y) $y))\n` +
  `!(collapse (match &self (edge $x ${mid}) $x))`;
runCase("static arg-index", staticSpace, [`(, ${mid - 1})`], 8_000);

const runtimeSpace =
  facts(SIZE, (i) => `!(add-atom &self (rt ${i} ${i + 1}))`) +
  `!(collapse (match &self (rt ${mid} $y) $y))`;
runCase("runtime arg-index", runtimeSpace, [`(, ${mid + 1})`], 12_000);

const countAggregate =
  facts(SIZE, (i) => `(num ${i})`) + `!(length (collapse (match &self (num $x) $x)))`;
runCase("collapse count", countAggregate, [String(SIZE)], 8_000);

const namedSpace =
  `!(bind! &s (new-space))\n` +
  facts(SIZE, (i) => `!(add-atom &s (seen ${i}))`) +
  `!(collapse (match &s (seen ${mid}) ok))`;
runCase("named exact-space", namedSpace, ["(, ok)"], 12_000);

const tri = Math.min(180, Math.max(60, Math.floor(SIZE / 200)));
const triangles =
  facts(tri, (i) => `(e a${i} b${i})\n(e b${i} c${i})\n(e c${i} a${i})`) +
  `!(length (collapse (match &self (, (e $x $y) (e $y $z) (e $z $x)) ($x $y $z))))`;
runCase("conjunctive count", triangles, [String(tri * 3)], 8_000);

const staticRemoval =
  facts(SIZE, (i) => `(gone ${i} ${i + 1})`) +
  `!(remove-atom &self (gone ${mid} ${mid + 1}))\n` +
  `!(test (collapse (match &self (gone ${mid} $y) $y)) (,))\n` +
  `!(test (collapse (match &self (gone ${mid - 1} $y) $y)) (, ${mid}))`;
runCase("static removal-index", staticRemoval, ["()"], 8_000);

const runtimeRemoval =
  facts(SIZE, (i) => `!(add-atom &self (keep ${i} ${i + 1}))`) +
  `!(add-atom &self (= (dyn) old))\n` +
  `!(remove-atom &self (= (dyn) old))\n` +
  `!(test (dyn) (dyn))\n` +
  `!(collapse (match &self (keep ${mid} $y) $y))`;
runCase("runtime removal-index", runtimeRemoval, [`(, ${mid + 1})`], 15_000);

const CORPUS_PROOF_CASES = [
  "foldall.metta",
  "foldallmatch.metta",
  "foldallspacecount.metta",
  "forall.metta",
  "streamops.metta",
  "parse.metta",
  "hyperpose_primes.metta",
  "matchnested.metta",
  "matchnested2.metta",
  "spaces2.metta",
  "spaces3.metta",
  "supercollapse.metta",
  "superpose_nested.metta",
  "tests.metta",
  "selfprog.metta",
  "multiset_operations.metta",
  "permutations.metta",
  "peano.metta",
  "matespacefast.metta",
  "tilepuzzle.metta",
];

for (const file of CORPUS_PROOF_CASES) {
  runCorpusCase(file, ["()"], file === "matespacefast.metta" ? 12_000 : 8_000);
}

console.log(`MeTTa-TS scale proof, size=${SIZE}`);
console.log(pad("case", 24), padL("ms", 10), padL("limit", 10), " result");
console.log("-".repeat(66));
for (const r of rows)
  console.log(
    pad(r.name, 24),
    padL(fmtMs(r.ms), 10),
    padL(String(r.limitMs), 10),
    ` ${r.ok ? "pass" : "fail"} ${r.got}`,
  );
