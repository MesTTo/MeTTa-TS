// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Head-to-head SCALING benchmark: MeTTa-TS vs PeTTa on the core list operations `size-atom`, `map-atom`,
// `filter-atom`, and `foldl-atom` over lists of growing length N. It is the scaling companion to
// `corpus-bench.mjs`
// (which runs fixed-size examples): here N sweeps so the per-engine growth curve is visible, not just one
// point. Each case is a literal list of N integers plus one `(test <expr> <expected>)` self-check that
// reduces to a NUMBER (so the expected form is identical on both engines), run as a black-box subprocess.
//
// PeTTa implements these as native Prolog predicates (`length/2`, and O(N) recursion under an 8 GB stack),
// so they are O(N) there. MeTTa-TS reduces them through its own evaluator; a grounded `size-atom` and
// grounded `map-atom`/`filter-atom`/`foldl-atom` keep them O(N) with O(1) native stack. The `r` column is
// t(N)/t(N/10): ~10 is linear, ~100 is quadratic. The point of the sweep is to show MeTTa-TS stays linear
// (no O(n^2)/O(n^3) evaluator tax) AND stays faster than PeTTa as N grows.
//
// Requirements: a PeTTa checkout with a working `run.sh` (PETTA_DIR, default sibling ../PeTTa), and MeTTa-TS
// built (`pnpm -r build` so `packages/node/dist/cli.js` exists).
//
// Usage:
//   PETTA_DIR=/path/to/PeTTa node packages/node/bench/listops-scale.mjs [options]
//     --sizes=1000,10000,100000   comma-separated N values (default 1000,10000,100000)
//     --runs=<n>                  runs per case; the minimum wall-clock is kept (default 3)
//     --timeout=<sec>             per-run cap for each engine (default 120)
//     --engine=ts|petta|both      run one engine or both (default both)
//     --out=<file>                Markdown output path (default bench/RESULTS-listops.md)

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { arg, benchDir as here, cliPath } from "./bench-common.mjs";

const PETTA_DIR = resolve(process.env.PETTA_DIR ?? resolve(here, "../../../../PeTTa"));
const RUN_SH = join(PETTA_DIR, "run.sh");
const SIZES = arg("sizes", "1000,10000,100000")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const RUNS = Number(arg("runs", "3"));
const TIMEOUT_MS = Number(arg("timeout", "120")) * 1000;
const ENGINE = arg("engine", "both");
const OUT = resolve(arg("out", join(here, "RESULTS-listops.md")));
const TMP = mkdtempSync(join(tmpdir(), "listops-scale-"));

// A literal list `(0 1 2 ... n-1)`.
const listLiteral = (n) => {
  const parts = new Array(n);
  for (let i = 0; i < n; i++) parts[i] = i;
  return "(" + parts.join(" ") + ")";
};
const sumLiteral = (n) => String((BigInt(n) * BigInt(n - 1)) / 2n);

// Each op reduces to a number via size-atom, so the (test ..) expected form is engine-agnostic.
function caseSource(op, n) {
  const list = listLiteral(n);
  if (op === "size-atom") return `!(test (size-atom ${list}) ${n})\n`;
  if (op === "map-atom")
    return `(= (dbl $x) (* $x 2))\n!(test (size-atom (map-atom ${list} $x (dbl $x))) ${n})\n`;
  if (op === "filter-atom")
    return `(= (ev $x) (== 0 (% $x 2)))\n!(test (size-atom (filter-atom ${list} $x (ev $x))) ${Math.ceil(n / 2)})\n`;
  if (op === "foldl-atom")
    return `(= (fadd $a $b) (+ $a $b))\n!(test (foldl-atom ${list} 0 $a $b (fadd $a $b)) ${sumLiteral(n)})\n`;
  throw new Error("unknown op " + op);
}

function classify(res, ms) {
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  const timedOut = res.signal === "SIGTERM" || res.error?.code === "ETIMEDOUT";
  const pass = (out.match(/✅/g) ?? []).length;
  const fail = (out.match(/❌/g) ?? []).length;
  let status = "ran";
  if (timedOut) status = "timeout";
  else if (res.status !== 0 || res.error) status = "error";
  else if (fail > 0) status = "fail";
  else if (pass > 0) status = "pass";
  return { status, ms };
}

function timeCmd(cmd, args, env, cwd) {
  let best = null;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const res = spawnSync(cmd, args, {
      cwd,
      timeout: TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 1 << 28,
      env: { ...process.env, ...env },
    });
    const c = classify(res, performance.now() - t0);
    if (best === null || c.ms < best.ms) best = c;
    if (c.status === "timeout" || c.status === "error" || c.status === "fail") break;
  }
  return best;
}

const runPetta = (file) => timeCmd("sh", [RUN_SH, file], {});
const runTs = (file) =>
  timeCmd(process.execPath, ["--stack-size=8000", cliPath, "--max-steps=1000000000", file], {
    METTA_TS_STACK: "1",
  });

const OPS = ["size-atom", "map-atom", "filter-atom", "foldl-atom"];
const rows = [];
console.log(
  `sizes=${SIZES.join(",")} runs=${RUNS} timeout=${TIMEOUT_MS / 1000}s engine=${ENGINE}\n`,
);
for (const op of OPS) {
  let prevTs = null;
  let prevPt = null;
  for (const n of SIZES) {
    const file = join(TMP, `${op}-${n}.metta`);
    wf(file, caseSource(op, n));
    const ts = ENGINE === "petta" ? null : runTs(file);
    const pt = ENGINE === "ts" ? null : runPetta(file);
    const tsR = ts && prevTs ? (ts.ms / prevTs).toFixed(1) : "-";
    const ptR = pt && prevPt ? (pt.ms / prevPt).toFixed(1) : "-";
    const speedup =
      ts && pt && ts.status === "pass" && pt.status === "pass" ? (pt.ms / ts.ms).toFixed(2) : "-";
    const row = {
      op,
      n,
      ts: ts?.ms,
      tsStatus: ts?.status,
      pt: pt?.ms,
      ptStatus: pt?.status,
      tsR,
      ptR,
      speedup,
    };
    rows.push(row);
    console.log(
      `${op.padEnd(12)} N=${String(n).padStart(7)}  ` +
        `TS ${ts ? ts.ms.toFixed(0).padStart(7) + "ms(" + ts.status + ",r=" + tsR + ")" : "-"}  ` +
        `PeTTa ${pt ? pt.ms.toFixed(0).padStart(7) + "ms(" + pt.status + ",r=" + ptR + ")" : "-"}  ` +
        `speedup ${speedup}x`,
    );
    if (ts) prevTs = ts.ms;
    if (pt) prevPt = pt.ms;
  }
  console.log("");
}

const md = [];
md.push("# MeTTa-TS vs PeTTa — list-operation scaling\n");
md.push(
  "Wall-clock for `size-atom`, `map-atom`, `filter-atom`, `foldl-atom` over a literal list of N integers, as a black-box\n" +
    "subprocess (each engine's startup included). `r` = t(N)/t(previous N); with a 10x size step, ~10 is\n" +
    "linear and ~100 is quadratic. `speedup` = PeTTa / MeTTa-TS.\n",
);
md.push(`- sizes ${SIZES.join(", ")}, runs ${RUNS} (min), timeout ${TIMEOUT_MS / 1000}s\n`);
md.push("| op | N | MeTTa-TS (ms) | r | PeTTa (ms) | r | speedup |");
md.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of rows) {
  const ts = r.ts === undefined ? "-" : `${r.ts.toFixed(0)}${r.tsStatus === "pass" ? "" : "*"}`;
  const pt = r.pt === undefined ? "-" : `${r.pt.toFixed(0)}${r.ptStatus === "pass" ? "" : "*"}`;
  md.push(`| ${r.op} | ${r.n} | ${ts} | ${r.tsR} | ${pt} | ${r.ptR} | ${r.speedup}x |`);
}
md.push("\n`*` marks a non-pass run (timeout/error/failed assertion).\n");
writeFileSync(OUT, md.join("\n"));
console.log(`wrote ${OUT}`);
