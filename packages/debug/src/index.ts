// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  format,
  type Atom,
  type QueryResult,
  type RunOptions,
  type TraceEvent,
} from "@metta-ts/core";

export type { TraceEvent } from "@metta-ts/core";

export interface TraceSummary {
  readonly grounded: Record<string, number>;
  readonly specialized: string[];
  readonly overflow: string[];
  readonly reductions: number;
}

export type TraceRunner = (
  program: string,
  fuel: number | undefined,
  imports: Map<string, Atom[]>,
  opts?: RunOptions,
) => QueryResult[];

export interface DebugRunOptions {
  readonly fuel?: number | undefined;
  readonly imports?: Map<string, Atom[]> | undefined;
  readonly runOptions?: Omit<RunOptions, "trace"> | undefined;
}

export interface CallExplanation {
  readonly result: string[];
  readonly trace: TraceEvent[];
  readonly summary: TraceSummary;
}

interface TraceRun {
  readonly groups: QueryResult[];
  readonly trace: TraceEvent[];
}

export function summarize(events: readonly TraceEvent[]): TraceSummary {
  const grounded: Record<string, number> = {};
  const specialized = new Set<string>();
  const overflow: string[] = [];
  let reductions = 0;
  for (const e of events) {
    if (e.kind === "grounded") grounded[e.op] = (grounded[e.op] ?? 0) + 1;
    else if (e.kind === "specialize") specialized.add(`${e.from} -> ${e.to}`);
    else if (e.kind === "overflow") overflow.push(e.atom);
    else reductions++;
  }
  return { grounded, specialized: [...specialized], overflow, reductions };
}

export function assembleQuery(source: string, call: string): string {
  const trimmed = call.trim();
  const q = trimmed.startsWith("!") ? trimmed : `!${trimmed}`;
  return `${source}\n${q}`;
}

function runWithTrace(runner: TraceRunner, program: string, opts: DebugRunOptions = {}): TraceRun {
  const trace: TraceEvent[] = [];
  const runOptions: RunOptions = {
    ...(opts.runOptions ?? {}),
    trace: (e) => trace.push(e),
  };
  const groups = runner(program, opts.fuel, opts.imports ?? new Map(), runOptions);
  return { groups, trace };
}

export function collectTrace(
  runner: TraceRunner,
  program: string,
  opts?: DebugRunOptions,
): TraceEvent[] {
  return runWithTrace(runner, program, opts).trace;
}

export function explainCall(
  runner: TraceRunner,
  source: string,
  call: string,
  opts?: DebugRunOptions,
): CallExplanation {
  const { groups, trace } = runWithTrace(runner, assembleQuery(source, call), opts);
  return {
    result: groups.at(-1)?.results.map(format) ?? [],
    trace,
    summary: summarize(trace),
  };
}
