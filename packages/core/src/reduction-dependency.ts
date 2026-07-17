// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom } from "./atom";

export interface ReductionDependencyScan {
  readonly names: Set<string>;
  readonly hasDynamicApplication: boolean;
}

/** Collect every named reduction that can be reached while evaluating the supplied atoms. Expression
 *  heads are calls. A bare symbol is a dependency only when an equality rule can reduce that symbol. */
export function scanReductionDependencies(
  roots: readonly Atom[],
  hasRule: (name: string) => boolean,
  names: Set<string> = new Set(),
): ReductionDependencyScan {
  let hasDynamicApplication = false;
  const pending = [...roots];
  while (pending.length > 0) {
    const atom = pending.pop()!;
    if (atom.kind === "sym") {
      if (hasRule(atom.name)) names.add(atom.name);
      continue;
    }
    if (atom.kind !== "expr" || atom.items.length === 0) continue;
    const head = atom.items[0]!;
    if (head.kind === "sym") names.add(head.name);
    else hasDynamicApplication = true;
    for (let index = atom.items.length - 1; index >= 0; index--) pending.push(atom.items[index]!);
  }
  return { names, hasDynamicApplication };
}

function pushLetBindings(bindings: Atom, pending: Atom[]): boolean {
  if (bindings.kind !== "expr") return true;
  for (const binding of bindings.items) {
    if (binding.kind !== "expr" || binding.items.length !== 2) return false;
    pending.push(binding.items[1]!);
  }
  return true;
}

function pushCaseTemplates(cases: Atom, pending: Atom[]): boolean {
  if (cases.kind !== "expr") return true;
  for (const entry of cases.items) {
    if (entry.kind !== "expr" || entry.items.length !== 2) return false;
    pending.push(entry.items[1]!);
  }
  return true;
}

/** Detect a call whose callee cannot be classified from a symbolic name. Binder and case patterns are
 *  syntax, so the walk follows the expressions those forms evaluate rather than treating pattern pairs as
 *  applications. Executable grounded, variable, and reducible expression heads remain opaque. */
export function containsOpaqueApplication(root: Atom): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const atom = pending.pop()!;
    if (atom.kind !== "expr" || atom.items.length === 0) continue;
    const head = atom.items[0]!;
    if (head.kind !== "sym") return true;
    switch (head.name) {
      case "let":
        if (atom.items[2] !== undefined) pending.push(atom.items[2]!);
        if (atom.items[3] !== undefined) pending.push(atom.items[3]!);
        continue;
      case "let*":
        if (atom.items[1] === undefined || !pushLetBindings(atom.items[1], pending)) return true;
        if (atom.items[2] !== undefined) pending.push(atom.items[2]!);
        continue;
      case "chain":
        if (atom.items[1] !== undefined) pending.push(atom.items[1]!);
        if (atom.items[3] !== undefined) pending.push(atom.items[3]!);
        continue;
      case "unify":
        if (atom.items[3] !== undefined) pending.push(atom.items[3]!);
        if (atom.items[4] !== undefined) pending.push(atom.items[4]!);
        continue;
      case "match":
        if (atom.items[3] !== undefined) pending.push(atom.items[3]!);
        continue;
      case "case":
      case "switch":
      case "switch-minimal":
        if (atom.items[1] !== undefined) pending.push(atom.items[1]!);
        if (atom.items[2] === undefined || !pushCaseTemplates(atom.items[2], pending)) return true;
        continue;
      case "superpose":
      case "hyperpose": {
        const alternatives = atom.items[1];
        if (alternatives === undefined || alternatives.kind !== "expr") return true;
        for (const alternative of alternatives.items) pending.push(alternative);
        continue;
      }
      case "format-args":
      case "repr":
      case "sealed":
        continue;
      default:
        for (let index = atom.items.length - 1; index >= 1; index--)
          pending.push(atom.items[index]!);
    }
  }
  return false;
}

/** A recursively variable-headed pattern can match a call under any named functor. */
export function isVariableHeadedPattern(atom: Atom): boolean {
  if (atom.kind === "var") return true;
  return atom.kind === "expr" && atom.items.length > 0 && isVariableHeadedPattern(atom.items[0]!);
}
