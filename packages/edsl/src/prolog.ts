// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Pure eDSL builders for the optional Prolog host interop surface. Strings in
// goal arrays are Prolog atoms; pass `ground("text")` when a Prolog string is
// required instead.
import { E, S, type Atom, type ExpressionAtom } from "@metta-ts/hyperon";
import { ground, type Term } from "./term";

export type PrologGoal = Term | readonly Term[];

function prologAtom(x: Term): Atom {
  return typeof x === "string" ? S(x) : ground(x);
}

function goalAtom(goal: PrologGoal): Atom {
  if (!Array.isArray(goal)) return ground(goal);
  const [head, ...args] = goal;
  if (head === undefined) return E();
  return E(prologAtom(head), ...args.map(prologAtom));
}

function symbolOrTerm(x: Term): Atom {
  return typeof x === "string" ? S(x) : ground(x);
}

function nameList(names: readonly Term[] | Term): Atom {
  return Array.isArray(names) ? E(...names.map(symbolOrTerm)) : ground(names);
}

function pathTerm(path: Term): Atom {
  return ground(path);
}

/** `(prolog-call goal)`: query the registered Prolog bridge and return solved goals. */
export const prologCall = (goal: PrologGoal): ExpressionAtom => E(S("prolog-call"), goalAtom(goal));

/** `(Predicate goal)`: PeTTa-compatible wrapper for relation-style Prolog predicates. */
export const Predicate = (goal: PrologGoal): ExpressionAtom => E(S("Predicate"), goalAtom(goal));

/** `(callPredicate goal)`: true/empty predicate call over the registered Prolog bridge. */
export const callPredicate = (goal: PrologGoal): ExpressionAtom =>
  E(S("callPredicate"), goalAtom(goal));

/** `(assertaPredicate goal)`: add a Prolog fact or rule at the front of the Prolog database. */
export const assertaPredicate = (goal: PrologGoal): ExpressionAtom =>
  E(S("assertaPredicate"), goalAtom(goal));

/** `(assertzPredicate goal)`: add a Prolog fact or rule at the end of the Prolog database. */
export const assertzPredicate = (goal: PrologGoal): ExpressionAtom =>
  E(S("assertzPredicate"), goalAtom(goal));

/** `(retractPredicate goal)`: retract one matching Prolog fact or rule. */
export const retractPredicate = (goal: PrologGoal): ExpressionAtom =>
  E(S("retractPredicate"), goalAtom(goal));

/** `(prolog-match goal template)`: bind the solved goal into a MeTTa template. */
export const prologMatch = (goal: PrologGoal, template: Term): ExpressionAtom =>
  E(S("prolog-match"), goalAtom(goal), ground(template));

/** `(prolog-function name (args...))`: call a Prolog predicate imported as a MeTTa function. */
export const prologFunction = (name: Term, args: readonly Term[] | Term): ExpressionAtom =>
  E(
    S("prolog-function"),
    symbolOrTerm(name),
    Array.isArray(args) ? E(...args.map(prologAtom)) : ground(args),
  );

/** `(import_prolog_function name)`: add MeTTa rules for a predicate whose last arg is output. */
export const importPrologFunction = (name: Term): ExpressionAtom =>
  E(S("import_prolog_function"), symbolOrTerm(name));

/** `(prolog-consult path)`: consult a Prolog file through the registered host bridge. */
export const prologConsult = (path: Term): ExpressionAtom => E(S("prolog-consult"), pathTerm(path));

/** `(import_prolog_functions_from_file path (names...))`: consult a file and import predicates. */
export const importPrologFunctionsFromFile = (
  path: Term,
  names: readonly Term[] | Term,
): ExpressionAtom => E(S("import_prolog_functions_from_file"), pathTerm(path), nameList(names));
