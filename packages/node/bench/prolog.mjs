// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// SWI-Prolog interop benchmark. The workloads are MeTTa source files under `bench/prolog/`.
// Run after building node and prolog:
//   node packages/node/bench/prolog.mjs
import { run, bench, group } from "mitata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runSourceAsync } from "../dist/source.js";
import { PROLOG_METTA_SRC, prologCoreAsyncOps } from "../../prolog/dist/index.js";
import { swiPrologBridge } from "../../prolog/dist/swi-node.js";

const PROLOG_BENCH = resolve(process.cwd(), "packages/node/bench/prolog");
const benchSource = (name) => readFileSync(resolve(PROLOG_BENCH, name), "utf8");

async function runPrologSource(src) {
  const bridge = swiPrologBridge();
  try {
    return await runSourceAsync(PROLOG_METTA_SRC + "\n" + src, prologCoreAsyncOps(bridge));
  } finally {
    bridge.dispose();
  }
}

const between = benchSource("prolog-between.metta");
const succFunction = benchSource("prolog-succ-function.metta");
const dynamicFacts = benchSource("prolog-dynamic-facts.metta");

group("prolog", () => {
  bench("prolog-match between/3", async () => {
    await runPrologSource(between);
  });
  bench("import_prolog_function succ/2 and call x64", async () => {
    await runPrologSource(succFunction);
  });
  bench("assert facts then query x32", async () => {
    await runPrologSource(dynamicFacts);
  });
});

await run();
