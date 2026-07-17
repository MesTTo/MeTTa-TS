// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Program runner: sequential top-to-bottom evaluation of a MeTTa program, a faithful port of
// LeaTTa `Stdlib.lean` (`evalSequential`, `oracleReport`). Each `!`-query is evaluated against the
// prelude plus the KB atoms that precede it; world effects (add-atom, bind!, state) thread forward.
import { type Atom, createInternTable } from "./atom";
import { parseAll, format } from "./parser";
import {
  type St,
  type MinEnv,
  type AsyncGroundFn,
  type HostImportFn,
  buildEnv,
  addAtomToEnv,
  initSt,
  mettaEval,
  mettaEvalAsyncOwned,
  registerAsyncGroundedOperation,
} from "./eval";
import { stdTable } from "./builtins";
import { analyzeModedPurity, analyzePurity, analyzeTableWorth } from "./tabling";
import { PRELUDE_SRC } from "./prelude";
import { withBuiltinModules } from "./extensions";
import { stdlibAtoms } from "./stdlib";
import { pettaStdlibAtoms } from "./petta-stdlib";
import { RevisionMap, RevisionSet } from "./revision-collection";
import { TableSpace } from "./table-space";
import { analyzeWorkerReplaySafety } from "./worker-replay";
import {
  isWorkerQuiescenceError,
  WorkerProtocolError,
  WorkerQuiescenceError,
} from "./worker-protocol";
import { parseTransportAtom, standardTokenizer, tryFormatTransportAtom } from "./standard-syntax";

export { parseTransportAtom, standardTokenizer, tryFormatTransportAtom } from "./standard-syntax";

let preludeCache: Atom[] | undefined;
/** The prelude's atoms (parsed once and cached). */
export function preludeAtoms(): Atom[] {
  if (preludeCache === undefined)
    preludeCache = parseAll(PRELUDE_SRC, standardTokenizer())
      .filter((t) => !t.bang)
      .map((t) => t.atom);
  return preludeCache;
}

export interface QueryResult {
  readonly query: Atom;
  readonly results: Atom[];
}

export interface ProgramRunResult {
  readonly results: QueryResult[];
  readonly state: St;
}

export interface StatefulParallelBranchHostResult {
  readonly results: readonly string[];
  readonly counterDelta: number;
}

/** Legacy atom-only branch bags lack a state delta and cannot be consumed as worker answers. */
export type ParallelBranchHostResult = StatefulParallelBranchHostResult | readonly string[];

/** The host declined before accepting ownership of any branch. Local evaluation is safe. */
export interface ParallelEvaluationDeclined {
  readonly status: "declined";
}

/** Every accepted branch has completed or been joined, so failed branch results may be replayed locally. */
export interface ParallelEvaluationCompleted {
  readonly status: "completed";
  readonly branches: readonly (ParallelBranchHostResult | null)[];
}

/** Every accepted branch has been joined, but the owned batch failed. */
export interface ParallelEvaluationFailed {
  readonly status: "failed";
  readonly error: unknown;
}

export type ParallelEvaluationHostOutcome =
  | ParallelEvaluationDeclined
  | ParallelEvaluationCompleted
  | ParallelEvaluationFailed;

/** Legacy arrays may supply complete valid answers, but cannot authorize local replay. */
export type ParallelEvaluationHostResponse =
  | ParallelEvaluationHostOutcome
  | readonly (ParallelBranchHostResult | null)[];

function statefulParallelBranchHostResult(
  result: ParallelBranchHostResult,
): StatefulParallelBranchHostResult | null {
  try {
    if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
    if (!Object.prototype.hasOwnProperty.call(result, "results")) return null;
    if (!Object.prototype.hasOwnProperty.call(result, "counterDelta")) return null;
    const { results, counterDelta } = result as {
      readonly results: unknown;
      readonly counterDelta: unknown;
    };
    if (!Array.isArray(results) || !results.every((source) => typeof source === "string"))
      return null;
    if (typeof counterDelta !== "number" || !Number.isSafeInteger(counterDelta) || counterDelta < 0)
      return null;
    return { results: results.slice() as string[], counterDelta };
  } catch {
    // Host values are an untrusted protocol boundary. A throwing getter declines the worker result.
    return null;
  }
}

export const DEFAULT_FUEL = 100_000;
const DEFAULT_TABLING = true;
const DEFAULT_FLAT_ATOMSPACE = true;

function flatAtomspaceEnabled(opts: RunOptions): boolean {
  return opts.experimental?.flatAtomspace ?? DEFAULT_FLAT_ATOMSPACE;
}

interface TablingAnalysis {
  readonly pureFunctors: Set<string>;
  readonly modedPureFunctors: Set<string>;
  readonly tableWorth: Set<string>;
  readonly modedTableWorth: Set<string>;
}

let defaultTablingAnalysis: TablingAnalysis | undefined;
let defaultProgramTemplate: MinEnv | undefined;

function baseProgramTemplate(): MinEnv {
  if (defaultProgramTemplate !== undefined) return defaultProgramTemplate;
  const env = buildEnv([...preludeAtoms(), ...stdlibAtoms(), ...pettaStdlibAtoms()], stdTable());
  env.sharedContextAtoms = env.atoms;
  defaultProgramTemplate = env;
  return env;
}

function baseTablingAnalysis(env: MinEnv): TablingAnalysis {
  if (defaultTablingAnalysis === undefined) {
    const pureFunctors = analyzePurity(env);
    const modedPureFunctors = analyzeModedPurity(env);
    defaultTablingAnalysis = {
      pureFunctors,
      modedPureFunctors,
      tableWorth: analyzeTableWorth(env, pureFunctors),
      modedTableWorth: analyzeTableWorth(env, modedPureFunctors),
    };
  }
  return defaultTablingAnalysis;
}

/** A fresh environment preloaded with the prelude and standard library, with `imports` seeded by the
 *  built-in extension modules (e.g. `concurrency`). The env is built once and extended per non-bang
 *  atom; built-in modules apply only when a program actually `(import! ...)`s them, so the Hyperon
 *  oracle baseline is unaffected. */
function buildDefaultEnv(
  imports: Map<string, Atom[]>,
  tabling: boolean,
  opts: RunOptions = {},
): MinEnv {
  const experimental = opts.experimental;
  const template = baseProgramTemplate();
  // Static program indexes are immutable between top-level additions. Share the cached image and detach all
  // mutable indexes together on the first write, while keeping per-run effects and semantic caches private.
  const env: MinEnv = {
    ...template,
    staticProgramShared: true,
    imports: new RevisionMap(),
    agt: new RevisionMap(),
    groundedEffects: new RevisionMap(template.groundedEffects),
    capabilities: new RevisionSet(template.capabilities),
    mutexes: new Map(),
    evaluatedAtoms: new WeakSet(),
  };
  env.imports = new RevisionMap(withBuiltinModules(imports));
  if (opts.hostImport !== undefined) env.hostImport = opts.hostImport;
  if (experimental?.hashCons === true) env.intern = createInternTable();
  if (experimental?.trail === true) env.useTrail = true;
  if (flatAtomspaceEnabled(opts)) env.useFlatAtomspace = true;
  if (tabling) {
    env.tableSpace = new TableSpace();
    const base = baseTablingAnalysis(env);
    env.pureFunctors = base.pureFunctors;
    env.modedPureFunctors = base.modedPureFunctors;
    env.tableWorth = base.tableWorth;
    env.modedTableWorth = base.modedTableWorth;
    env.tablingDirty = false;
    env.compiled = new Map();
    env.compileDirty = true;
    env.compiledComplete = false;
  }
  return env;
}

export interface RunOptions {
  // Cancels the active async query and waits for its generator and owned resources to finish unwinding.
  // Sync runners ignore this option because JavaScript cannot preempt synchronous evaluation.
  readonly signal?: AbortSignal;
  readonly tabling?: boolean;
  readonly experimental?: {
    readonly hashCons?: boolean;
    // Compact interned runtime `&self` store (typed-array term columns + a decode cache): default on.
    // It lowers peak RSS on add-heavy runs and stays byte-identical to the plain AtomLog path. The `false`
    // value is kept for differential tests and profiling. Atoms that cannot be encoded (a grounded
    // executor, matcher, or non-default grounded type) fall back to the log automatically.
    readonly flatAtomspace?: boolean;
    // Trail-based zero-allocation conjunctive matching (eval.ts matchConjTrail). Byte-identical to the
    // immutable matcher, differential-gated; off by default.
    readonly trail?: boolean;
  };
  // Initial interpreter stack-depth bound; 0 (the default) means unlimited, matching Hyperon. A program can
  // tighten it in-language with `(pragma! max-stack-depth N)`. This is the embedder's knob: it sets the
  // starting bound but is not a hard ceiling; the `fuel` argument is the resource ceiling. Left to the
  // developer rather than hardcoded so a host embedding untrusted programs can pick its own policy.
  readonly maxStackDepth?: number;
  // Optional parallel branch evaluator for `(once (hyperpose …))`. A typed `declined` response proves that
  // no work was accepted. A typed `completed` response proves every accepted task has been joined. A typed
  // `failed` response proves the same join and propagates its error. Legacy arrays can supply valid answers,
  // but cannot authorize local replay.
  readonly parEvalImpl?: (
    rulesSrc: string,
    branchSrcs: string[],
    firstOnly: boolean,
    remainingFuel?: number,
    initialCounter?: number,
  ) => ParallelEvaluationHostResponse;
  // Async equivalent for hosts such as browsers where Web Workers report back through messages. Used only by
  // the async runner; the sync runner still falls back unless `parEvalImpl` is present.
  readonly parEvalAsyncImpl?: (
    rulesSrc: string,
    branchSrcs: string[],
    firstOnly: boolean,
    signal?: AbortSignal,
    remainingFuel?: number,
    initialCounter?: number,
  ) => Promise<ParallelEvaluationHostResponse>;
  readonly hostImport?: HostImportFn;
}

interface ParallelEvaluationWiring {
  admitRule(atom: Atom): void;
  prepareQuery(): void;
}

function wireParallelEvaluation(env: MinEnv, opts: RunOptions): ParallelEvaluationWiring {
  if (opts.parEvalImpl === undefined && opts.parEvalAsyncImpl === undefined)
    return { admitRule: () => undefined, prepareQuery: () => undefined };
  // The closure contains only rules admitted before the current query. Future top-level definitions are not
  // visible to a worker any earlier than they are visible to the in-line evaluator.
  const ruleSources: string[] = [];
  let programReplayable = true;
  let purityDirty = true;
  const rulesSrc = (): string => ruleSources.join("\n");
  const parseBranchResults = (
    response: unknown,
    expectedCount: number,
  ): ({ readonly atoms: Atom[]; readonly counterDelta: number } | null)[] => {
    const replay = (): null[] => new Array<null>(expectedCount).fill(null);
    let results: readonly unknown[];
    let quiescenceCertified = false;
    if (Array.isArray(response)) {
      try {
        results = Array.from(response);
      } catch (cause) {
        throw new WorkerProtocolError("legacy parallel host result bag could not be read", {
          cause,
        });
      }
    } else {
      let status: unknown;
      try {
        status = (response as { readonly status?: unknown } | null)?.status;
      } catch (cause) {
        throw new WorkerProtocolError("parallel host outcome status could not be read", { cause });
      }
      if (status === "declined") return replay();
      if (status === "failed") {
        if (!Object.prototype.hasOwnProperty.call(response, "error"))
          throw new WorkerProtocolError("failed parallel host outcome omitted its error");
        let failure: unknown;
        try {
          failure = (response as { readonly error: unknown }).error;
        } catch (cause) {
          throw new WorkerProtocolError("failed parallel host outcome error could not be read", {
            cause,
          });
        }
        if (failure === undefined)
          throw new WorkerProtocolError("failed parallel host outcome carried undefined");
        throw failure;
      }
      if (status !== "completed")
        throw new WorkerProtocolError("parallel host must return declined, completed, or failed");
      quiescenceCertified = true;
      try {
        const branches = (response as { readonly branches?: unknown }).branches;
        if (!Array.isArray(branches)) return replay();
        results = Array.from(branches);
      } catch {
        return replay();
      }
    }
    if (results.length !== expectedCount) {
      if (quiescenceCertified) return replay();
      throw new WorkerProtocolError(
        `legacy parallel host returned ${results.length} branches, expected ${expectedCount}`,
      );
    }
    return results.map((result: unknown, index) => {
      if (result === null) {
        if (quiescenceCertified) return null;
        throw new WorkerProtocolError(`legacy parallel host declined branch ${index}`);
      }
      const stateful = statefulParallelBranchHostResult(result as ParallelBranchHostResult);
      if (stateful === null) {
        if (quiescenceCertified) return null;
        throw new WorkerProtocolError(`legacy parallel host returned invalid branch ${index}`);
      }
      try {
        const atoms: Atom[] = [];
        for (const source of stateful.results) {
          const atom = parseTransportAtom(source, "value");
          if (atom === undefined) {
            if (quiescenceCertified) return null;
            throw new WorkerProtocolError(
              `legacy parallel host returned invalid atom text in branch ${index}`,
            );
          }
          atoms.push(atom);
        }
        return {
          atoms,
          counterDelta: stateful.counterDelta,
        };
      } catch (error) {
        if (error instanceof WorkerProtocolError) throw error;
        if (quiescenceCertified) return null;
        throw new WorkerProtocolError(
          `legacy parallel host result parsing failed in branch ${index}`,
          { cause: error },
        );
      }
    });
  };
  const impl = opts.parEvalImpl;
  if (impl !== undefined) {
    env.parEval = (branchSrcs, firstOnly, remainingFuel, initialCounter) => {
      if (!programReplayable) return new Array<null>(branchSrcs.length).fill(null);
      return parseBranchResults(
        impl(rulesSrc(), branchSrcs, firstOnly, remainingFuel, initialCounter),
        branchSrcs.length,
      );
    };
  }
  const asyncImpl = opts.parEvalAsyncImpl;
  if (asyncImpl !== undefined) {
    env.parEvalAsync = async (branchSrcs, firstOnly, signal, remainingFuel, initialCounter) => {
      if (!programReplayable) return new Array<null>(branchSrcs.length).fill(null);
      let results: ParallelEvaluationHostResponse;
      try {
        results = await asyncImpl(
          rulesSrc(),
          branchSrcs,
          firstOnly,
          signal,
          remainingFuel,
          initialCounter,
        );
      } catch (error) {
        if (isWorkerQuiescenceError(error)) throw error;
        if (signal?.aborted === true) {
          throw new WorkerQuiescenceError(
            "parallel host rejected during cancellation; worker quiescence is unknown",
            { cause: error },
          );
        }
        throw error;
      }
      if (signal?.aborted === true)
        throw signal.reason ?? new Error("parallel evaluation cancelled");
      return parseBranchResults(results, branchSrcs.length);
    };
  }
  return {
    admitRule(atom): void {
      const source = tryFormatTransportAtom(atom, "program");
      if (source === undefined) programReplayable = false;
      else ruleSources.push(source);
      purityDirty = true;
    },
    prepareQuery(): void {
      if (!purityDirty) return;
      env.pureFunctors = analyzePurity(env);
      env.workerReplaySafeFunctors = analyzeWorkerReplaySafety(env);
      purityDirty = false;
    },
  };
}

function resultsForQuery(pairs: Array<[Atom, unknown]>): Atom[] {
  return pairs.map((p) => p[0]);
}

function evalSequentialStateInternal(
  atoms: readonly { atom: Atom; bang: boolean }[],
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
  includeNonBang: boolean,
  initialCounter = 0,
): ProgramRunResult {
  if (!Number.isSafeInteger(initialCounter) || initialCounter < 0)
    throw new RangeError("initialCounter must be a non-negative safe integer");
  const out: QueryResult[] = [];
  let st: St = { ...initSt(), counter: initialCounter };
  if (opts.maxStackDepth !== undefined) st.world.maxStackDepth = opts.maxStackDepth;
  const env = buildDefaultEnv(imports, opts.tabling ?? DEFAULT_TABLING, opts);
  const parallel = wireParallelEvaluation(env, opts);
  for (const { atom, bang } of atoms) {
    if (!bang) {
      addAtomToEnv(env, atom);
      parallel.admitRule(atom);
      if (includeNonBang) out.push({ query: atom, results: [] });
      continue;
    }
    parallel.prepareQuery();
    const [pairs, st2] = mettaEval(env, fuel, st, [], atom);
    st = st2;
    out.push({ query: atom, results: resultsForQuery(pairs) });
  }
  return { results: out, state: st };
}

function evalSequentialInternal(
  atoms: readonly { atom: Atom; bang: boolean }[],
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
  includeNonBang: boolean,
): QueryResult[] {
  return evalSequentialStateInternal(atoms, fuel, imports, opts, includeNonBang).results;
}

/** Evaluate a parsed program sequentially. `imports` backs `import!` (pre-read by the caller). */
export function evalSequential(
  atoms: readonly { atom: Atom; bang: boolean }[],
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
): QueryResult[] {
  return evalSequentialInternal(atoms, fuel, imports, opts, false);
}

/** Evaluate every top-level directive, including non-`!` atoms as empty result directives. */
export function evalSequentialAllDirectives(
  atoms: readonly { atom: Atom; bang: boolean }[],
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
): QueryResult[] {
  return evalSequentialInternal(atoms, fuel, imports, opts, true);
}

/** Parse and run a MeTTa source string sequentially. */
export function runProgram(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
): QueryResult[] {
  return evalSequential(parseAll(src, standardTokenizer()), fuel, imports, opts);
}

/** Parse and run a program while retaining the terminal interpreter state for host protocols. */
export function runProgramWithState(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
  initialCounter = 0,
): ProgramRunResult {
  return evalSequentialStateInternal(
    parseAll(src, standardTokenizer()),
    fuel,
    imports,
    opts,
    false,
    initialCounter,
  );
}

/** Parse and run a MeTTa source string, returning one result entry per top-level directive. */
export function runProgramAllDirectives(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
): QueryResult[] {
  return evalSequentialAllDirectives(parseAll(src, standardTokenizer()), fuel, imports, opts);
}

async function runProgramAsyncInternal(
  src: string,
  asyncOps: Map<string, AsyncGroundFn>,
  fuel: number,
  imports: Map<string, Atom[]>,
  opts: RunOptions,
  includeNonBang: boolean,
): Promise<QueryResult[]> {
  const parsed = parseAll(src, standardTokenizer());
  const env = buildDefaultEnv(imports, opts.tabling ?? false, opts);
  const parallel = wireParallelEvaluation(env, opts);
  for (const [k, v] of asyncOps) registerAsyncGroundedOperation(env, k, v);
  const out: QueryResult[] = [];
  let st: St = initSt();
  if (opts.maxStackDepth !== undefined) st.world.maxStackDepth = opts.maxStackDepth;
  for (const { atom, bang } of parsed) {
    if (!bang) {
      addAtomToEnv(env, atom);
      parallel.admitRule(atom);
      if (includeNonBang) out.push({ query: atom, results: [] });
      continue;
    }
    parallel.prepareQuery();
    const [pairs, st2] = await mettaEvalAsyncOwned(env, fuel, st, [], atom, opts.signal);
    st = st2;
    out.push({ query: atom, results: resultsForQuery(pairs) });
  }
  return out;
}

/** Async sequential evaluation: like `runProgram`, but `!`-queries are awaited, so async grounded
 *  operations (registered in `asyncOps`) can perform I/O. Sync programs give identical results to
 *  `runProgram`; the async path only differs when an async op is actually reached. */
export function runProgramAsync(
  src: string,
  asyncOps: Map<string, AsyncGroundFn> = new Map(),
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
): Promise<QueryResult[]> {
  return runProgramAsyncInternal(src, asyncOps, fuel, imports, opts, false);
}

/** Async source runner that returns one result entry for every top-level directive. */
export function runProgramAsyncAllDirectives(
  src: string,
  asyncOps: Map<string, AsyncGroundFn> = new Map(),
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
  opts: RunOptions = {},
): Promise<QueryResult[]> {
  return runProgramAsyncInternal(src, asyncOps, fuel, imports, opts, true);
}

/** Module names referenced by top-level `import!` statements (so a caller can pre-read them). */
export function collectImports(src: string): string[] {
  const out: string[] = [];
  const importName = (atom: Atom): string | undefined => {
    if (atom.kind === "sym") return atom.name;
    if (atom.kind === "gnd" && atom.value.g === "str") return atom.value.s;
    return undefined;
  };
  for (const { atom } of parseAll(src, standardTokenizer())) {
    if (
      atom.kind === "expr" &&
      atom.items.length === 3 &&
      atom.items[0]!.kind === "sym" &&
      atom.items[0]!.name === "import!"
    ) {
      const name = importName(atom.items[2]!);
      if (name !== undefined) out.push(name);
    }
  }
  return out;
}

/** An oracle assertion passes iff its query evaluates to exactly the unit atom `()`. */
export function isOraclePass(r: QueryResult): boolean {
  return (
    r.results.length === 1 && r.results[0]!.kind === "expr" && r.results[0]!.items.length === 0
  );
}

/** Run a test file and report pass/fail counts and the failing queries. */
export function oracleReport(
  src: string,
  fuel = DEFAULT_FUEL,
  imports: Map<string, Atom[]> = new Map(),
): { total: number; passed: number; failures: string[] } {
  const results = runProgram(src, fuel, imports);
  let passed = 0;
  const failures: string[] = [];
  for (const r of results) {
    if (isOraclePass(r)) passed++;
    else
      failures.push(
        `FAIL: ${format(r.query)}\n   got: ${r.results.map(format).join(" ") || "(no results)"}`,
      );
  }
  return { total: results.length, passed, failures };
}
