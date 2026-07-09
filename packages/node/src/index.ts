// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// @metta-ts/node: Node adapters for file-backed import! and program runs.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import {
  type Atom,
  parseAll,
  standardTokenizer,
  collectImports,
  type QueryResult,
  type RunOptions,
} from "@metta-ts/core";
import { runSource, runSourceAllDirectives } from "./source";

/** Pre-read every `import!` target referenced in `src`, resolving names against `baseDir`. */
export function readImports(
  src: string,
  baseDir: string,
  importRoot = baseDir,
): Map<string, Atom[]> {
  const m = new Map<string, Atom[]>();
  const base = resolve(baseDir);
  const root = resolve(importRoot);
  for (const name of collectImports(src)) {
    const p = resolve(base, name.endsWith(".metta") ? name : name + ".metta");
    // Keep imports inside the chosen root. `runFile` uses the file directory's parent so a corpus file can
    // share a sibling `../lib` directory without allowing imports above that tree.
    if (p !== root && !p.startsWith(root + sep)) continue;
    if (existsSync(p))
      m.set(
        name,
        parseAll(readFileSync(p, "utf8"), standardTokenizer())
          .filter((t) => !t.bang)
          .map((t) => t.atom),
      );
  }
  return m;
}

/** Run a `.metta` file from disk, resolving `import!` relative to the file's directory. `fuel` is the step
 *  ceiling; `opts` carries interpreter settings such as the initial `maxStackDepth`. */
export function runFile(path: string, fuel?: number, opts?: RunOptions): QueryResult[] {
  const src = readFileSync(path, "utf8");
  const fileDir = dirname(resolve(path));
  return runSource(src, fuel, readImports(src, fileDir, dirname(fileDir)), opts);
}

/** Run a file and return one result entry for every top-level directive. */
export function runFileAllDirectives(
  path: string,
  fuel?: number,
  opts?: RunOptions,
): QueryResult[] {
  const src = readFileSync(path, "utf8");
  const fileDir = dirname(resolve(path));
  return runSourceAllDirectives(src, fuel, readImports(src, fileDir, dirname(fileDir)), opts);
}

export * from "@metta-ts/core";
export {
  runSource,
  runSourceAllDirectives,
  runSourceAsync,
  makeParEvalImpl,
  type ParEvalOptions,
} from "./source";
export { ParallelFlatMatcher } from "./flat-parallel";
