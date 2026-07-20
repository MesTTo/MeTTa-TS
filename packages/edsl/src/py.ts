// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Pure eDSL builders for the optional Python host interop surface. These
// construct the same MeTTa atoms that the Python runtime package registers.
import { E, S, type Atom, type ExpressionAtom } from "@mettascript/hyperon";
import { ground, type Term } from "./term";

function symbolOrTerm(name: string | Term): Atom {
  return typeof name === "string" ? S(name) : ground(name);
}

function expressionOrCall(spec: string | Term, args: readonly Term[]): Atom {
  return typeof spec === "string" ? E(S(spec), ...args.map(ground)) : ground(spec);
}

/** `(py-call (<path> ...args))`. A string path is a Python builtin, module function, or method head. */
export function pyCall(path: string, ...args: Term[]): ExpressionAtom;
/** `(py-call <spec>)` for a fully-built call expression. */
export function pyCall(spec: Term): ExpressionAtom;
export function pyCall(spec: string | Term, ...args: Term[]): ExpressionAtom {
  return E(S("py-call"), expressionOrCall(spec, args));
}

/** `(py-eval source)`: evaluate a Python expression string through the registered host bridge. */
export const pyEval = (source: Term): ExpressionAtom => E(S("py-eval"), ground(source));

/** `(py-import module-or-path)`: import a Python module or file through the registered host bridge. */
export const pyImport = (moduleOrPath: Term): ExpressionAtom =>
  E(S("py-import"), ground(moduleOrPath));

/** `(py-atom path [type])`: resolve a Python path into an applicable grounded atom or value. */
export function pyAtom(path: string | Term, type?: Term): ExpressionAtom {
  const items = [S("py-atom"), symbolOrTerm(path)];
  if (type !== undefined) items.push(ground(type));
  return E(...items);
}

/** `(py-dot object attr [type])`: resolve an attribute from a live Python object. */
export function pyDot(object: Term, attr: string | Term, type?: Term): ExpressionAtom {
  const items = [S("py-dot"), ground(object), symbolOrTerm(attr)];
  if (type !== undefined) items.push(ground(type));
  return E(...items);
}

/** `(py-list (...items))`: build a Python list from a MeTTa expression. */
export function pyList(items: readonly Term[] | Term): ExpressionAtom {
  return E(S("py-list"), Array.isArray(items) ? E(...items.map(ground)) : ground(items));
}

/** `(py-tuple (...items))`: build a Python tuple from a MeTTa expression. */
export function pyTuple(items: readonly Term[] | Term): ExpressionAtom {
  return E(S("py-tuple"), Array.isArray(items) ? E(...items.map(ground)) : ground(items));
}

/** `(py-dict ((key value) ...))`: build a Python dict from MeTTa key-value pairs. */
export function pyDict(pairs: ReadonlyArray<readonly [Term, Term]> | Term): ExpressionAtom {
  return E(
    S("py-dict"),
    Array.isArray(pairs)
      ? E(...pairs.map(([key, value]) => E(ground(key), ground(value))))
      : ground(pairs),
  );
}

/** `(py-chain (...items))`: fold Python truthiness with `operator.or_`. */
export function pyChain(items: readonly Term[] | Term): ExpressionAtom {
  return E(S("py-chain"), Array.isArray(items) ? E(...items.map(ground)) : ground(items));
}
