// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import type { AsyncGroundFn } from "@mettascript/core";
import * as core from "@mettascript/core";
import {
  Atom,
  type AsyncOperationEffect,
  type AsyncOperationResult,
  type AsyncOperationReturn,
  E,
  ExpressionAtom,
  GroundedAtom,
  MeTTa,
  S,
  SymbolAtom,
  ValueAtom,
  VariableAtom,
  asyncOperationReturnToReduceResult,
} from "@mettascript/hyperon";

export type PrologTermJson =
  | { readonly type: "atom"; readonly name: string }
  | { readonly type: "int"; readonly value: string }
  | { readonly type: "float"; readonly value: number }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "var"; readonly name: string }
  | {
      readonly type: "compound";
      readonly functor: string;
      readonly args: readonly PrologTermJson[];
    };

export interface PrologBridge {
  query(goal: Atom): Promise<Atom[]>;
  asserta(term: Atom): Promise<void>;
  assertz(term: Atom): Promise<void>;
  retract(term: Atom): Promise<boolean>;
  consult(path: string): Promise<void>;
  predicateArities(name: string): Promise<number[]>;
  dispose(): Promise<void> | void;
}

export interface PrologInteropOptions {
  readonly resolvePath?: (path: string) => string;
}

export type PrologEffect = AsyncOperationEffect;
export type PrologOperationResult = AsyncOperationResult;
export type PrologOperationReturn = AsyncOperationReturn;

const TRUE = S("True");
const FALSE = S("False");
const SELF = S("&self");
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

export const PROLOG_METTA_SRC = `
(: prolog-call (-> Atom Atom))
(= (prolog-match $goal $template)
   (let $answer (prolog-call $goal)
        (let $goal $answer $template)))
(: Predicate (-> Atom %Undefined%))
(= (Predicate $goal) $goal)
(: callPredicate (-> Atom Bool))
(= (callPredicate $goal) (prolog-match $goal True))
(: assertaPredicate (-> Atom Bool))
(= (assertaPredicate $goal) (prolog-asserta $goal))
(: assertzPredicate (-> Atom Bool))
(= (assertzPredicate $goal) (prolog-assertz $goal))
(: retractPredicate (-> Atom Bool))
(= (retractPredicate $goal) (prolog-retract $goal))
(: prolog-function (-> Atom Expression Atom))
(: import_prolog_function (-> Atom Bool))
(: prolog-consult (-> Atom Bool))
(: import_prolog_functions_from_file (-> Atom Expression Bool))
`;

function atomName(atom: Atom | undefined, ctx: string): string {
  if (atom instanceof SymbolAtom) return atom.name();
  if (atom instanceof GroundedAtom) {
    const content = atom.object().content;
    if (typeof content === "string") return content;
  }
  throw new Error(`${ctx}: expected a Symbol or String`);
}

function pathName(atom: Atom | undefined, ctx: string): string {
  if (atom instanceof ExpressionAtom) {
    const children = atom.children();
    if (
      children.length === 2 &&
      children[0] instanceof SymbolAtom &&
      children[0].name() === "library"
    )
      return atomName(children[1], ctx);
  }
  return atomName(atom, ctx);
}

function expressionItems(atom: Atom | undefined, ctx: string): Atom[] {
  if (atom instanceof ExpressionAtom) return atom.children();
  throw new Error(`${ctx}: expected an expression`);
}

function bigintAtom(value: string): Atom {
  const n = BigInt(value);
  if (n >= SAFE_MIN && n <= SAFE_MAX) return ValueAtom(Number(n));
  return Atom.fromCAtom(core.gint(n));
}

export function atomToPrologTerm(atom: Atom): PrologTermJson {
  if (atom instanceof VariableAtom) return { type: "var", name: atom.name() };
  if (atom instanceof SymbolAtom) return { type: "atom", name: atom.name() };
  if (atom instanceof GroundedAtom) {
    const content = atom.object().content;
    if (typeof content === "bigint") return { type: "int", value: String(content) };
    if (typeof content === "number") {
      return Number.isInteger(content)
        ? { type: "int", value: String(content) }
        : { type: "float", value: content };
    }
    if (typeof content === "string") return { type: "string", value: content };
    if (typeof content === "boolean") return { type: "atom", name: content ? "true" : "false" };
    if (content === undefined || content === null) return { type: "atom", name: "[]" };
    return { type: "atom", name: atom.toString() };
  }
  if (atom instanceof ExpressionAtom) {
    const children = atom.children();
    if (children.length === 0) return { type: "atom", name: "[]" };
    const [head, ...args] = children;
    if (head instanceof SymbolAtom && head.name() === "Predicate" && args.length === 1) {
      return atomToPrologTerm(args[0]!);
    }
    if (!(head instanceof SymbolAtom))
      throw new Error(`prolog: compound head must be a Symbol, got ${head?.toString() ?? "()"}`);
    return {
      type: "compound",
      functor: head.name(),
      args: args.map((arg) => atomToPrologTerm(arg)),
    };
  }
  return { type: "atom", name: atom.toString() };
}

export function prologTermToAtom(term: PrologTermJson): Atom {
  switch (term.type) {
    case "atom":
      return term.name === "[]" ? E() : S(term.name);
    case "int":
      return bigintAtom(term.value);
    case "float":
      return ValueAtom(term.value);
    case "string":
      return ValueAtom(term.value);
    case "var":
      return VariableAtom.parseName(term.name);
    case "compound":
      return E(S(term.functor), ...term.args.map(prologTermToAtom));
  }
}

function functionRuleEffects(name: string, arities: readonly number[]): PrologEffect[] {
  const usable = [...new Set(arities)].filter((arity) => arity >= 1).sort((a, b) => a - b);
  if (usable.length === 0)
    throw new Error(`import_prolog_function: no predicate arity found for ${name}`);
  const effects: PrologEffect[] = [];
  for (const arity of usable) {
    const vars = Array.from({ length: arity - 1 }, (_, i) =>
      VariableAtom.parseName(`prolog_arg_${i}`),
    );
    effects.push({
      kind: "addAtom",
      space: SELF,
      atom: E(S("="), E(S(name), ...vars), E(S("prolog-function"), S(name), E(...vars))),
    });
  }
  return effects;
}

async function importFunctionEffects(bridge: PrologBridge, name: string): Promise<PrologEffect[]> {
  return functionRuleEffects(name, await bridge.predicateArities(name));
}

function namesFromAtom(atom: Atom | undefined, ctx: string): string[] {
  if (atom instanceof ExpressionAtom) return atom.children().map((child) => atomName(child, ctx));
  return [atomName(atom, ctx)];
}

async function callFunction(bridge: PrologBridge, name: string, argsAtom: Atom): Promise<Atom[]> {
  const args = expressionItems(argsAtom, "prolog-function");
  const output = VariableAtom.parseName("prolog_result");
  const goal = E(S(name), ...args, output);
  const answers = await bridge.query(goal);
  return answers.map((answer) => {
    const children = expressionItems(answer, "prolog-function result");
    const value = children[children.length - 1];
    if (value === undefined) throw new Error(`prolog-function: ${name} returned an empty answer`);
    return value;
  });
}

export function prologOps(
  bridge: PrologBridge,
  opts: PrologInteropOptions = {},
): Map<string, (args: Atom[]) => Promise<PrologOperationReturn>> {
  const resolvePath = opts.resolvePath ?? ((path: string) => path);
  return new Map<string, (args: Atom[]) => Promise<PrologOperationReturn>>([
    ["prolog-call", async (args) => await bridge.query(args[0] ?? E())],
    [
      "prolog-function",
      async (args) =>
        await callFunction(bridge, atomName(args[0], "prolog-function"), args[1] ?? E()),
    ],
    [
      "prolog-asserta",
      async (args) => {
        await bridge.asserta(args[0] ?? E());
        return [TRUE];
      },
    ],
    [
      "prolog-assertz",
      async (args) => {
        await bridge.assertz(args[0] ?? E());
        return [TRUE];
      },
    ],
    ["prolog-retract", async (args) => [(await bridge.retract(args[0] ?? E())) ? TRUE : FALSE]],
    [
      "prolog-consult",
      async (args) => {
        await bridge.consult(resolvePath(pathName(args[0], "prolog-consult")));
        return [TRUE];
      },
    ],
    [
      "import_prolog_function",
      async (args) => ({
        results: [TRUE],
        effects: await importFunctionEffects(bridge, atomName(args[0], "import_prolog_function")),
      }),
    ],
    [
      "import_prolog_functions_from_file",
      async (args) => {
        await bridge.consult(resolvePath(pathName(args[0], "import_prolog_functions_from_file")));
        const effects: PrologEffect[] = [];
        for (const name of namesFromAtom(args[1], "import_prolog_functions_from_file")) {
          effects.push(...(await importFunctionEffects(bridge, name)));
        }
        return { results: [TRUE], effects };
      },
    ],
  ]);
}

export function registerPrologInterop(
  m: MeTTa,
  bridge: PrologBridge,
  opts: PrologInteropOptions = {},
): void {
  for (const [name, fn] of prologOps(bridge, opts)) m.registerAsyncOperation(name, fn);
  m.run(PROLOG_METTA_SRC);
}

export function prologCoreAsyncOps(
  bridge: PrologBridge,
  opts: PrologInteropOptions = {},
): Map<string, AsyncGroundFn> {
  const out = new Map<string, AsyncGroundFn>();
  for (const [name, fn] of prologOps(bridge, opts))
    out.set(name, async (args) => {
      try {
        const raw = await fn(args.map((a) => Atom.fromCAtom(a)));
        return asyncOperationReturnToReduceResult(raw);
      } catch (e) {
        return { tag: "runtimeError", msg: e instanceof Error ? e.message : String(e) };
      }
    });
  return out;
}
