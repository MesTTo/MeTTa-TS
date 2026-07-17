// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  format,
  runProgramAsync,
  setOutputSink,
  setRawSink,
  type QueryResult,
  type RunOptions,
  WorkerQuiescenceError,
} from "./index";
import { importsForBaseDir } from "./oracle-corpus";

const CORPUS_DIR = resolve(process.cwd(), "packages/node/bench/corpus-mettats");
const DIFF_FUEL = 100_000;
const requireForTest = createRequire(import.meta.url);
// These corpus programs are already tracked as non-terminating or Stage 4 symbolic-search outliers in
// the benchmark harness; Stage 1 verifies byte identity on the terminating corpus plus targeted slow cases.
const CORE_TIMEOUT_CORPUS = new Set([
  "matespace.metta",
  "matespace2.metta",
  "matespacefast.metta",
  "spaces_removeallatoms.metta",
  "tilepuzzle.metta",
]);
const WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  try {
    const m = await import(workerData.coreUrl);
    m.setOutputSink(() => {});
    m.setRawSink(() => {});
    const query = workerData.firstOnly
      ? "!(once " + workerData.branchSrc + ")"
      : "!" + workerData.branchSrc;
    const execution = m.runProgramWithState(
      workerData.rulesSrc + "\\n" + query,
      workerData.fuel,
      new Map(),
      {
        experimental: {
          hashCons: workerData.hashCons,
          flatAtomspace: workerData.flatAtomspace,
        },
      },
      workerData.initialCounter,
    );
    const last = execution.results[execution.results.length - 1];
    const results = [];
    for (const atom of last?.results ?? []) {
      const source = m.tryFormatTransportAtom(atom, "value");
      if (source === undefined) throw new Error("differential worker result is not transportable");
      results.push(source);
    }
    parentPort.postMessage({
      status: "result",
      results,
      counterDelta: execution.state.counter - workerData.initialCounter,
    });
  } catch {
    parentPort.postMessage({ status: "failure" });
  } finally {
    parentPort.close();
  }
})();
`;

const ADVERSARIAL: Array<readonly [string, string]> = [
  ["duplicate-producing superpose", "(= (dup) (superpose (a a b)))\n!(dup)"],
  [
    "nested collapse",
    "!(collapse (superpose ((collapse (superpose (a b))) (collapse (superpose (a b))))))",
  ],
  ["same-head multi-match", "(p a 1)\n(p a 2)\n(p b 3)\n!(match &self (p a $x) $x)"],
  ["deep recursion", "(= (down $n) (if (== $n 0) Z (S (down (- $n 1)))))\n!(down 20)"],
  ["cyclic-binding unify", "!(unify $x (f $x) ok fail)"],
];

type PrintedResult = readonly [query: string, results: readonly string[]];
type Esbuild = {
  readonly buildSync: (options: {
    readonly bundle: boolean;
    readonly entryPoints: readonly string[];
    readonly format: "esm";
    readonly logLevel: "silent";
    readonly outfile: string;
    readonly platform: "node";
    readonly target: "node20";
  }) => void;
};

let bundledCoreUrl: string | undefined;

function currentCoreBundleUrl(): string {
  if (bundledCoreUrl !== undefined) return bundledCoreUrl;
  const outfile = resolve(
    process.cwd(),
    "ai-tmp",
    `metta-ts-hashcons-diff-core-${process.pid}.mjs`,
  );
  mkdirSync(dirname(outfile), { recursive: true });
  const { buildSync } = requireForTest("esbuild") as Esbuild;
  buildSync({
    entryPoints: [resolve(process.cwd(), "packages/core/src/index.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  });
  bundledCoreUrl = pathToFileURL(outfile).href;
  return bundledCoreUrl;
}

interface DifferentialWorkerResult {
  readonly results: string[];
  readonly counterDelta: number;
}

interface DifferentialWorkerTask {
  readonly worker: Worker;
  readonly completion: Promise<DifferentialWorkerResult | null>;
}

let activeDifferentialWorkers = 0;

function validDifferentialWorkerResult(value: unknown): value is DifferentialWorkerResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as {
    readonly status?: unknown;
    readonly results?: unknown;
    readonly counterDelta?: unknown;
  };
  return (
    result.status === "result" &&
    Array.isArray(result.results) &&
    result.results.every((item) => typeof item === "string") &&
    typeof result.counterDelta === "number" &&
    Number.isSafeInteger(result.counterDelta) &&
    result.counterDelta >= 0
  );
}

function startDifferentialWorker(workerData: Record<string, unknown>): DifferentialWorkerTask {
  const worker = new Worker(WORKER_SRC, { eval: true, workerData });
  activeDifferentialWorkers += 1;
  const completion = new Promise<DifferentialWorkerResult | null>((resolve) => {
    let result: DifferentialWorkerResult | null = null;
    let failed = false;
    worker.on("message", (message: unknown) => {
      result = validDifferentialWorkerResult(message) ? message : null;
    });
    worker.once("messageerror", () => {
      failed = true;
    });
    worker.once("error", () => {
      failed = true;
    });
    worker.once("exit", (code) => {
      activeDifferentialWorkers -= 1;
      resolve(!failed && code === 0 ? result : null);
    });
  });
  return { worker, completion };
}

async function terminateDifferentialWorkers(
  entries: readonly [number, DifferentialWorkerTask][],
): Promise<void> {
  const terminations = await Promise.allSettled(entries.map(([, task]) => task.worker.terminate()));
  const joinable = entries.filter((_, index) => terminations[index]?.status === "fulfilled");
  await Promise.all(joinable.map(([, task]) => task.completion));
  const failures = terminations.flatMap((termination) =>
    termination.status === "rejected" ? [termination.reason] : [],
  );
  if (failures.length > 0)
    throw new WorkerQuiescenceError("differential worker termination failed", {
      cause: failures.length === 1 ? failures[0] : new AggregateError(failures),
    });
}

async function evalBranches(
  rulesSrc: string,
  branchSrcs: string[],
  firstOnly: boolean,
  hashCons: boolean,
  flatAtomspace: boolean,
  remainingFuel = DIFF_FUEL,
  initialCounter = 0,
): Promise<{
  readonly status: "completed";
  readonly branches: readonly (DifferentialWorkerResult | null)[];
}> {
  const results: (DifferentialWorkerResult | null)[] = new Array(branchSrcs.length).fill(null);
  const pending = new Map<number, DifferentialWorkerTask>();
  try {
    for (const [index, branchSrc] of branchSrcs.entries())
      pending.set(
        index,
        startDifferentialWorker({
          coreUrl: currentCoreBundleUrl(),
          rulesSrc,
          branchSrc,
          firstOnly,
          fuel: remainingFuel,
          initialCounter,
          hashCons,
          flatAtomspace,
        }),
      );
  } catch {
    await terminateDifferentialWorkers([...pending]);
    return { status: "completed", branches: results };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ readonly timeout: true }>((resolve) => {
    timeout = setTimeout(() => resolve({ timeout: true }), 60_000);
  });
  try {
    while (pending.size > 0) {
      const settled = await Promise.race([
        ...[...pending].map(([index, task]) =>
          task.completion.then((result) => ({ index, result })),
        ),
        deadline,
      ]);
      if ("timeout" in settled) {
        await terminateDifferentialWorkers([...pending]);
        return { status: "completed", branches: results };
      }
      pending.delete(settled.index);
      results[settled.index] = settled.result;
      if (settled.result === null) {
        await terminateDifferentialWorkers([...pending]);
        return { status: "completed", branches: results };
      }
      if (firstOnly && settled.result.results.length > 0) {
        for (const index of pending.keys()) results[index] = { results: [], counterDelta: 0 };
        await terminateDifferentialWorkers([...pending]);
        return { status: "completed", branches: results };
      }
    }
    return { status: "completed", branches: results };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function printed(rs: QueryResult[]): PrintedResult[] {
  return rs.map((r) => [format(r.query), r.results.map(format)]);
}

async function runExperimental(
  src: string,
  experimental: NonNullable<RunOptions["experimental"]>,
  baseDir = process.cwd(),
): Promise<PrintedResult[]> {
  const hashCons = experimental.hashCons === true;
  const flatAtomspace = experimental.flatAtomspace === true;
  const opts: RunOptions = {
    experimental,
    // The differential harness used runProgram before it gained the async worker adapter. Preserve that
    // runner's compiled and tabled default while comparing only the requested experimental switch.
    tabling: true,
    parEvalAsyncImpl: (rulesSrc, branchSrcs, firstOnly, _signal, remainingFuel, initialCounter) =>
      evalBranches(
        rulesSrc,
        branchSrcs,
        firstOnly,
        hashCons,
        flatAtomspace,
        remainingFuel,
        initialCounter,
      ),
  };
  const restoreOutput = setOutputSink(() => {});
  const restoreRaw = setRawSink(() => {});
  try {
    return printed(
      await runProgramAsync(src, new Map(), DIFF_FUEL, importsForBaseDir(src, baseDir), opts),
    );
  } finally {
    setOutputSink(restoreOutput);
    setRawSink(restoreRaw);
  }
}

async function expectByteIdentical(
  name: string,
  src: string,
  baseDir = process.cwd(),
): Promise<void> {
  const off = await runExperimental(src, { hashCons: false }, baseDir);
  const on = await runExperimental(src, { hashCons: true }, baseDir);
  expect(on, `${name} changed results with experimental.hashCons`).toEqual(off);
}

export async function assertHashConsByteIdentical(): Promise<void> {
  for (const file of corpusFiles()) {
    const path = resolve(CORPUS_DIR, file);
    await expectByteIdentical(file, readFileSync(path, "utf8"), dirname(path));
  }
  for (const [name, src] of ADVERSARIAL) await expectByteIdentical(name, src);
}

async function expectFlatAtomspaceByteIdentical(
  name: string,
  src: string,
  baseDir = process.cwd(),
): Promise<void> {
  const off = await runExperimental(src, { flatAtomspace: false }, baseDir);
  const on = await runExperimental(src, { flatAtomspace: true }, baseDir);
  expect(on, `${name} changed results with experimental.flatAtomspace`).toEqual(off);
}

function corpusFiles(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".metta") && !CORE_TIMEOUT_CORPUS.has(f))
    .sort();
}

describe("owned differential worker adapter", () => {
  it("reports the real state-counter delta and joins natural worker exits", async () => {
    const baseline = activeDifferentialWorkers;
    const outcome = await evalBranches(
      "(= (down-u6 $n) (if (== $n 0) done (down-u6 (- $n 1))))",
      ["(down-u6 5)"],
      false,
      false,
      false,
      DIFF_FUEL,
      17,
    );

    expect(outcome.status).toBe("completed");
    expect(outcome.branches[0]?.results).toEqual(["done"]);
    expect(outcome.branches[0]?.counterDelta).toBeGreaterThan(0);
    expect(activeDifferentialWorkers).toBe(baseline);
  });

  it("joins the losing worker before returning a first answer", async () => {
    const baseline = activeDifferentialWorkers;
    const outcome = await evalBranches(
      "(= (burn-u6 0 $value) $value)\n(= (burn-u6 $n $value) (burn-u6 (- $n 1) $value))",
      ["(burn-u6 500000 slow)", "ready"],
      true,
      false,
      false,
      1_000_000,
    );

    expect(outcome.branches[0]).toEqual({ results: [], counterDelta: 0 });
    expect(outcome.branches[1]?.results).toEqual(["ready"]);
    expect(activeDifferentialWorkers).toBe(baseline);
  });
});

describe("experimental.hashCons is byte-identical", () => {
  for (const file of corpusFiles()) {
    it(
      file,
      async () => {
        const path = resolve(CORPUS_DIR, file);
        await expectByteIdentical(file, readFileSync(path, "utf8"), dirname(path));
      },
      120_000,
    );
  }

  for (const [name, src] of ADVERSARIAL) {
    it(name, async () => expectByteIdentical(name, src), 120_000);
  }
});

describe("experimental.flatAtomspace is byte-identical", () => {
  for (const file of corpusFiles()) {
    it(
      file,
      async () => {
        const path = resolve(CORPUS_DIR, file);
        await expectFlatAtomspaceByteIdentical(file, readFileSync(path, "utf8"), dirname(path));
      },
      120_000,
    );
  }

  for (const [name, src] of ADVERSARIAL) {
    it(name, async () => expectFlatAtomspaceByteIdentical(name, src), 120_000);
  }

  it("runtime multiplicity, remove, and rollback", async () => {
    await expectFlatAtomspaceByteIdentical(
      "runtime multiplicity, remove, and rollback",
      `
        !(add-atom &self (p a))
        !(add-atom &self (p a))
        !(match &self (p a) hit)
        !(remove-atom &self (p a))
        !(match &self (p a) hit)
        !(import! &self concurrency)
        !(transaction (let $u (add-atom &self (p aborted)) (superpose ())))
        !(match &self (p $x) $x)
      `,
    );
  });
});
