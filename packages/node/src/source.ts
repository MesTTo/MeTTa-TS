// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// In-memory Node source runners. Unlike the package root, this file never imports node:fs; embedders that
// already resolved imports can use it without adding file-backed capabilities to the process.
import {
  DEFAULT_FUEL,
  evalSequential,
  evalSequentialAllDirectives,
  parseAll,
  runProgramAsync,
  runProgramAsyncAllDirectives,
  standardTokenizer,
  type AsyncGroundFn,
  type Atom,
  type QueryResult,
  type RunOptions,
} from "@metta-ts/core";
import { makeParEvalAsyncImpl, type ParEvalOptions } from "./par-hyperpose";

function withSyncDefaults(opts: RunOptions | undefined): RunOptions {
  const base = opts ?? {};
  return {
    ...base,
    tabling: base.tabling ?? true,
  };
}

function withAsyncDefaults(
  fuel: number,
  opts: RunOptions | undefined,
  parOptions?: ParEvalOptions,
): RunOptions {
  const base = withSyncDefaults(opts);
  if (base.parEvalImpl !== undefined || base.parEvalAsyncImpl !== undefined) return base;
  const experimental = base.experimental;
  const workerPolicyCompatible =
    base.tabling === true &&
    experimental?.hashCons !== true &&
    experimental?.trail !== true &&
    experimental?.flatAtomspace !== false;
  if (!workerPolicyCompatible) return base;
  return {
    ...base,
    parEvalAsyncImpl: makeParEvalAsyncImpl(fuel, parOptions),
  };
}

/** Run a MeTTa source string synchronously with an in-memory import map. */
export function runSource(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts?: RunOptions,
): QueryResult[] {
  return evalSequential(parseAll(src, standardTokenizer()), fuel, imports, withSyncDefaults(opts));
}

/** Run a source string and return one result entry for every top-level directive. */
export function runSourceAllDirectives(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts?: RunOptions,
): QueryResult[] {
  return evalSequentialAllDirectives(
    parseAll(src, standardTokenizer()),
    fuel,
    imports,
    withSyncDefaults(opts),
  );
}

/** Async source runner for embedders that register async grounded operations. */
export function runSourceAsync(
  src: string,
  asyncOps: Map<string, AsyncGroundFn> = new Map(),
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts?: RunOptions,
  parOptions?: ParEvalOptions,
): Promise<QueryResult[]> {
  return runProgramAsync(src, asyncOps, fuel, imports, withAsyncDefaults(fuel, opts, parOptions));
}

/** Async source runner that returns one result entry for every top-level directive. */
export function runSourceAllDirectivesAsync(
  src: string,
  asyncOps: Map<string, AsyncGroundFn> = new Map(),
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts?: RunOptions,
  parOptions?: ParEvalOptions,
): Promise<QueryResult[]> {
  return runProgramAsyncAllDirectives(
    src,
    asyncOps,
    fuel,
    imports,
    withAsyncDefaults(fuel, opts, parOptions),
  );
}

export {
  activeHyperposeWorkerCount,
  makeParEvalAsyncImpl,
  makeParEvalImpl,
  type ParEvalOptions,
} from "./par-hyperpose";
