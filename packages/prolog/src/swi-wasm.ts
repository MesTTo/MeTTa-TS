// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import * as core from "@mettascript/core";
import { emptyExpr, type Atom as CoreAtom } from "@mettascript/core";
import { type HostInterop, type HostTextLoader } from "@mettascript/core/host";
import { Atom, E, ExpressionAtom, S, ValueAtom, VariableAtom } from "@mettascript/hyperon";
import defaultLoadSwipl from "swipl-wasm";
import {
  PROLOG_METTA_SRC,
  atomToPrologTerm,
  prologCoreAsyncOps,
  type PrologBridge,
  type PrologTermJson,
} from "./prolog";

export interface SwiWasmFs {
  writeFile(path: string, data: string, opts?: { readonly encoding?: "utf8" }): void;
  mkdirTree?(path: string): void;
  analyzePath?(path: string): { readonly exists: boolean };
  mkdir?(path: string): void;
}

export interface SwiWasmQuery {
  next(): unknown;
  once(): unknown;
}

export interface SwiWasmProlog {
  query(goal: string, input?: Record<string, unknown>): SwiWasmQuery;
}

export interface SwiWasmRuntime {
  readonly FS: SwiWasmFs;
  readonly prolog: SwiWasmProlog;
}

export interface SwiWasmLoadOptions {
  readonly arguments?: readonly string[];
  readonly locateFile?: (path: string, prefix?: string) => string;
}

export type SwiWasmLoader = (options?: SwiWasmLoadOptions) => Promise<SwiWasmRuntime>;

export interface SwiWasmBridgeOptions {
  readonly loadText?: HostTextLoader;
  readonly baseUrl?: string | URL;
  readonly files?: ReadonlyMap<string, string>;
}

export interface SwiWasmInteropOptions extends SwiWasmBridgeOptions {
  readonly prolog?: SwiWasmRuntime;
  readonly loadSwipl?: SwiWasmLoader;
  readonly locateFile?: (path: string, prefix?: string) => string;
  readonly arguments?: readonly string[];
  readonly preload?: readonly string[];
}

const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

interface PrologObject {
  readonly [key: string]: unknown;
}

interface QueryStep {
  done?: boolean;
  value?: unknown;
  error?: boolean;
  message?: string;
}

class SourceVariables {
  readonly sourceToOriginal = new Map<string, string>();
  private readonly originalToSource = new Map<string, string>();

  sourceName(original: string): string {
    let source = this.originalToSource.get(original);
    if (source === undefined) {
      source = `V${this.originalToSource.size}`;
      this.originalToSource.set(original, source);
      this.sourceToOriginal.set(source, original);
    }
    return source;
  }
}

function fileCandidates(path: string): string[] {
  if (path.endsWith(".pl")) return [path, path.slice(0, -".pl".length)];
  return [path, `${path}.pl`];
}

function globalBaseUrl(): string | undefined {
  const location = (globalThis as { readonly location?: { readonly href?: string } }).location;
  return typeof location?.href === "string" ? location.href : undefined;
}

function createDefaultTextLoader(options: SwiWasmBridgeOptions): HostTextLoader {
  const files = options.files ?? new Map<string, string>();
  return async (path, from) => {
    for (const candidate of fileCandidates(path)) {
      const text = files.get(candidate);
      if (text !== undefined) return text;
    }
    const base = from ?? options.baseUrl ?? globalBaseUrl();
    if (base === undefined) throw new Error(`swi-wasm import: ${path}: no base URL`);
    const url = new URL(path, base);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`swi-wasm import: ${path}: ${response.status} ${url.href}`);
    return response.text();
  };
}

const toPosix = (path: string): string => path.replaceAll("\\", "/");

function virtualPath(path: string): string {
  const normalized = toPosix(path).replace(/^\.\/+/, "");
  return normalized.startsWith("/") ? normalized : `/metta-ts-prolog/${normalized}`;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

function ensureDir(fs: SwiWasmFs, dir: string): void {
  if (dir === "" || dir === "/") return;
  if (fs.mkdirTree !== undefined) {
    fs.mkdirTree(dir);
    return;
  }
  let current = "";
  for (const part of dir.split("/")) {
    if (part === "") continue;
    current += `/${part}`;
    if (fs.analyzePath?.(current).exists === true) continue;
    fs.mkdir?.(current);
  }
}

function quoteAtom(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function termToSource(term: PrologTermJson, vars: SourceVariables): string {
  switch (term.type) {
    case "atom":
      return term.name === "[]" ? "[]" : quoteAtom(term.name);
    case "int":
      return term.value;
    case "float":
      return String(term.value);
    case "string":
      return quoteString(term.value);
    case "var":
      return vars.sourceName(term.name);
    case "compound":
      if (term.args.length === 0) return quoteAtom(term.functor);
      return `${quoteAtom(term.functor)}(${term.args.map((arg) => termToSource(arg, vars)).join(",")})`;
  }
}

function goalSource(term: PrologTermJson, vars = new SourceVariables()): string {
  return `${termToSource(term, vars)}.`;
}

function isObject(value: unknown): value is PrologObject {
  return typeof value === "object" && value !== null;
}

function stringProperty(value: PrologObject, key: string): string | undefined {
  const out = value[key];
  return typeof out === "string" ? out : undefined;
}

function booleanProperty(value: PrologObject, key: string): boolean | undefined {
  const out = value[key];
  return typeof out === "boolean" ? out : undefined;
}

function messageFrom(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function throwIfError(value: unknown): void {
  if (!isObject(value)) return;
  if (booleanProperty(value, "error") === true) {
    throw new Error(stringProperty(value, "message") ?? "SWI-Prolog WASM error");
  }
}

function queryStep(value: unknown): QueryStep {
  if (!isObject(value)) return {};
  const out: QueryStep = {};
  const done = booleanProperty(value, "done");
  if (done !== undefined) out.done = done;
  if (value.value !== undefined) out.value = value.value;
  const error = booleanProperty(value, "error");
  if (error !== undefined) out.error = error;
  const message = stringProperty(value, "message");
  if (message !== undefined) out.message = message;
  return out;
}

function isSuccess(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (booleanProperty(value, "success") === false) return false;
  return booleanProperty(value, "success") === true || value["$tag"] === "bindings";
}

function bigintAtom(value: bigint): Atom {
  if (value >= SAFE_MIN && value <= SAFE_MAX) return ValueAtom(Number(value));
  return Atom.fromCAtom(core.gint(value));
}

function numberAtom(value: number): Atom {
  return Number.isInteger(value) &&
    value >= Number.MIN_SAFE_INTEGER &&
    value <= Number.MAX_SAFE_INTEGER
    ? ValueAtom(value)
    : ValueAtom(value);
}

function prologValueToAtom(value: unknown): Atom {
  if (typeof value === "string") return S(value);
  if (typeof value === "number") return numberAtom(value);
  if (typeof value === "bigint") return bigintAtom(value);
  if (typeof value === "boolean") return S(value ? "true" : "false");
  if (value === null || value === undefined) return VariableAtom.parseName("_");
  if (Array.isArray(value)) return E(...value.map(prologValueToAtom));
  if (!isObject(value)) return S(String(value));

  if (value["$t"] === "s") {
    const text = stringProperty(value, "v");
    return text === undefined ? ValueAtom("") : ValueAtom(text);
  }
  if (value["$t"] === "v") return VariableAtom.parseName("_");
  if (value["$t"] === "t") {
    const functor = stringProperty(value, "functor");
    if (functor === undefined) return S(String(value));
    const rawArgs = value[functor];
    const args =
      Array.isArray(rawArgs) && Array.isArray(rawArgs[0]) ? rawArgs[0].map(prologValueToAtom) : [];
    return E(S(functor), ...args);
  }
  return S(String(value));
}

function instantiate(atom: Atom, bindings: ReadonlyMap<string, Atom>): Atom {
  if (atom instanceof VariableAtom) return bindings.get(atom.name()) ?? atom;
  if (atom instanceof ExpressionAtom)
    return E(...atom.children().map((child) => instantiate(child, bindings)));
  return atom;
}

function bindingsFromAnswer(
  answer: unknown,
  sourceToOriginal: ReadonlyMap<string, string>,
): Map<string, Atom> {
  const out = new Map<string, Atom>();
  if (!isObject(answer)) return out;
  for (const [source, original] of sourceToOriginal) {
    if (Object.hasOwn(answer, source)) out.set(original, prologValueToAtom(answer[source]));
  }
  return out;
}

function importAtomName(atom: CoreAtom | undefined): string | undefined {
  if (atom?.kind === "sym") return atom.name;
  if (atom?.kind === "gnd" && atom.value.g === "str") return atom.value.s;
  if (
    atom?.kind === "expr" &&
    atom.items.length === 2 &&
    atom.items[0]?.kind === "sym" &&
    atom.items[0].name === "library"
  )
    return importAtomName(atom.items[1]);
  return undefined;
}

function collectAnswers(query: SwiWasmQuery): unknown[] {
  const out: unknown[] = [];
  for (;;) {
    const step = queryStep(query.next());
    if (step.error === true) throw new Error(step.message ?? "SWI-Prolog WASM query error");
    if (step.value !== undefined) {
      throwIfError(step.value);
      out.push(step.value);
    }
    if (step.done === true) break;
  }
  return out;
}

export class SwiWasmBridge implements PrologBridge {
  private readonly loadText: HostTextLoader;
  private readonly consulted = new Set<string>();

  constructor(
    private readonly runtime: SwiWasmRuntime,
    options: SwiWasmBridgeOptions = {},
  ) {
    this.loadText = options.loadText ?? createDefaultTextLoader(options);
  }

  async query(goal: Atom): Promise<Atom[]> {
    const vars = new SourceVariables();
    const source = goalSource(atomToPrologTerm(goal), vars);
    const answers = collectAnswers(this.runtime.prolog.query(source));
    return answers.map((answer) =>
      instantiate(goal, bindingsFromAnswer(answer, vars.sourceToOriginal)),
    );
  }

  async asserta(term: Atom): Promise<void> {
    this.runOnce(
      goalSource({ type: "compound", functor: "asserta", args: [atomToPrologTerm(term)] }),
    );
  }

  async assertz(term: Atom): Promise<void> {
    this.runOnce(
      goalSource({ type: "compound", functor: "assertz", args: [atomToPrologTerm(term)] }),
    );
  }

  async retract(term: Atom): Promise<boolean> {
    return this.runOnce(
      goalSource({ type: "compound", functor: "retract", args: [atomToPrologTerm(term)] }),
    );
  }

  async consult(path: string): Promise<void> {
    if (this.consulted.has(path)) return;
    try {
      const source = await this.loadText(path);
      const target = virtualPath(path);
      ensureDir(this.runtime.FS, dirname(target));
      this.runtime.FS.writeFile(target, source, { encoding: "utf8" });
      this.runOnce(`consult(${quoteAtom(target)}).`);
      this.consulted.add(path);
    } catch (error) {
      throw new Error(`swi-wasm consult: ${path}: ${messageFrom(error)}`);
    }
  }

  async predicateArities(name: string): Promise<number[]> {
    const query = this.runtime.prolog.query(`current_predicate(${quoteAtom(name)}/A).`);
    const arities = new Set<number>();
    for (const answer of collectAnswers(query)) {
      if (!isObject(answer)) continue;
      const arity = answer.A;
      if (typeof arity === "number" && Number.isInteger(arity)) arities.add(arity);
    }
    return [...arities].sort((a, b) => a - b);
  }

  dispose(): void {
    this.consulted.clear();
  }

  private runOnce(goal: string): boolean {
    const result = this.runtime.prolog.query(goal).once();
    throwIfError(result);
    return isSuccess(result);
  }
}

export function swiWasmBridge(
  runtime: SwiWasmRuntime,
  options: SwiWasmBridgeOptions = {},
): SwiWasmBridge {
  return new SwiWasmBridge(runtime, options);
}

export async function createSwiWasmInterop(
  options: SwiWasmInteropOptions = {},
): Promise<HostInterop> {
  const loadSwipl = options.loadSwipl ?? (defaultLoadSwipl as unknown as SwiWasmLoader);
  const runtime =
    options.prolog ??
    (await loadSwipl({
      arguments: [...(options.arguments ?? ["-q"])],
      ...(options.locateFile !== undefined ? { locateFile: options.locateFile } : {}),
    }));
  const bridge = swiWasmBridge(runtime, options);
  for (const path of options.preload ?? []) await bridge.consult(path);
  return {
    name: "swi-wasm",
    prelude: PROLOG_METTA_SRC,
    asyncOps: prologCoreAsyncOps(bridge),
    hostImport: async (_space, target) => {
      const name = importAtomName(target);
      if (!name?.endsWith(".pl")) return { tag: "noReduce" };
      try {
        await bridge.consult(name);
        return { tag: "ok", results: [emptyExpr] };
      } catch (error) {
        return { tag: "runtimeError", msg: `import!: ${name}: ${messageFrom(error)}` };
      }
    },
    dispose: () => bridge.dispose(),
  };
}
