// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, expr } from "./atom";

export interface MinimalInstructionFault {
  readonly code: "incorrect-arguments";
  readonly message: string;
}

export type MinimalInstructionResult =
  | { readonly ok: true; readonly atom: Atom }
  | { readonly ok: false; readonly fault: MinimalInstructionFault };

const fault = (message: string): MinimalInstructionResult => ({
  ok: false,
  fault: { code: "incorrect-arguments", message },
});

/** Construct an expression from one head and one expression tail. */
export function applyConsAtom(args: readonly Atom[]): MinimalInstructionResult {
  if (args.length !== 2 || args[1]!.kind !== "expr")
    return fault("cons-atom: expected a head and an expression tail");
  return { ok: true, atom: expr([args[0]!, ...args[1]!.items]) };
}

/** Split one non-empty expression into its head and expression tail. */
export function applyDeconsAtom(args: readonly Atom[]): MinimalInstructionResult {
  if (args.length !== 1 || args[0]!.kind !== "expr" || args[0]!.items.length === 0)
    return fault("decons-atom: expected one non-empty expression");
  const [head, ...tail] = args[0]!.items;
  return { ok: true, atom: expr([head!, expr(tail)]) };
}
