// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  type Atom,
  type ExprAtom,
  type VarAtom,
  makeVariableId,
  scopedVariable,
  variableIdentity,
  variableKey,
} from "./atom";
import { mapExpressionChildren } from "./map-expression";
import { RuntimeIdAllocator, type ScopeId } from "./trace";

/** Allocates the repeated source names in one expression to stable local slots. */
export class VariableScope {
  readonly #variablesByName = new Map<string, VarAtom>();
  #nextSlot = 0;

  constructor(readonly id: ScopeId) {}

  /** Repeated calls with the same name return variables with the same identity. */
  variable(name: string): VarAtom {
    let result = this.#variablesByName.get(name);
    if (result !== undefined) return result;
    const slot = this.#nextSlot++;
    result = scopedVariable(name, makeVariableId(this.id, slot));
    this.#variablesByName.set(name, result);
    return result;
  }

  /** Allocate a distinct variable even when another variable has the same display name. */
  fresh(name: string): VarAtom {
    return scopedVariable(name, makeVariableId(this.id, this.#nextSlot++));
  }

  get size(): number {
    return this.#nextSlot;
  }
}

/** Creates disjoint expression scopes from the runtime's scope ID stream. */
export class VariableScopeAllocator {
  constructor(readonly ids: RuntimeIdAllocator) {}

  next(): VariableScope {
    return new VariableScope(this.ids.next("scope"));
  }

  fork(lane: string): VariableScopeAllocator {
    return new VariableScopeAllocator(this.ids.fork(lane));
  }
}

function mapExpression(
  atom: ExprAtom,
  mapVariable: (variable: VarAtom) => VarAtom,
  memo: Map<ExprAtom, Atom>,
): Atom {
  return mapExpressionChildren(atom, memo, (item) => mapAtomVariables(item, mapVariable, memo));
}

function mapAtomVariables(
  atom: Atom,
  mapVariable: (variable: VarAtom) => VarAtom,
  memo: Map<ExprAtom, Atom>,
): Atom {
  if (atom.ground) return atom;
  if (atom.kind === "var") return mapVariable(atom);
  if (atom.kind === "expr") return mapExpression(atom, mapVariable, memo);
  return atom;
}

/**
 * Admit legacy variables into one syntax scope. Variables already carrying an identity are preserved.
 * Repeated legacy names inside the atom receive the same slot.
 */
export function scopeAtom(atom: Atom, scope: VariableScope): Atom {
  return mapAtomVariables(
    atom,
    (variable) =>
      variableIdentity(variable) === undefined ? scope.variable(variable.name) : variable,
    new Map(),
  );
}

/** Scope several roots together, as required for a rule LHS and RHS that share variables. */
export function scopeAtoms(atoms: readonly Atom[], scope: VariableScope): Atom[] {
  const memo = new Map<ExprAtom, Atom>();
  return atoms.map((atom) =>
    mapAtomVariables(
      atom,
      (variable) =>
        variableIdentity(variable) === undefined ? scope.variable(variable.name) : variable,
      memo,
    ),
  );
}

/**
 * Copy every variable into a fresh target scope while preserving sharing shape. Two source variables with
 * the same display name but different identities stay distinct.
 */
export function freshenAtom(atom: Atom, target: VariableScope): Atom {
  return freshenAtoms([atom], target)[0]!;
}

/** Freshen several roots through one old-to-new map. */
export function freshenAtoms(atoms: readonly Atom[], target: VariableScope): Atom[] {
  const replacements = new Map<string, VarAtom>();
  const memo = new Map<ExprAtom, Atom>();
  const replace = (variable: VarAtom): VarAtom => {
    const key = variableKey(variable);
    let replacement = replacements.get(key);
    if (replacement === undefined) {
      replacement = target.fresh(variable.name);
      replacements.set(key, replacement);
    }
    return replacement;
  };
  return atoms.map((atom) => mapAtomVariables(atom, replace, memo));
}
