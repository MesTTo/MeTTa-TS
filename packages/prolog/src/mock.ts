// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import * as core from "@mettascript/core";
import { Atom, ExpressionAtom, SymbolAtom } from "@mettascript/hyperon";
import type { PrologBridge } from "./prolog";

function predicateNameAndArity(
  atom: Atom,
): { readonly name: string; readonly arity: number } | undefined {
  if (!(atom instanceof ExpressionAtom)) return undefined;
  const children = atom.children();
  const head = children[0];
  if (!(head instanceof SymbolAtom)) return undefined;
  return { name: head.name(), arity: children.length - 1 };
}

export class MockPrologBridge implements PrologBridge {
  readonly consulted: string[] = [];
  private readonly facts: Atom[] = [];

  constructor(facts: readonly Atom[] = []) {
    this.facts.push(...facts);
  }

  query(goal: Atom): Promise<Atom[]> {
    const out: Atom[] = [];
    for (const fact of this.facts) {
      for (const bindings of core.matchAtoms(goal.catom, fact.catom)) {
        out.push(Atom.fromCAtom(core.instantiate(bindings, goal.catom)));
      }
    }
    return Promise.resolve(out);
  }

  asserta(term: Atom): Promise<void> {
    this.facts.unshift(term);
    return Promise.resolve();
  }

  assertz(term: Atom): Promise<void> {
    this.facts.push(term);
    return Promise.resolve();
  }

  retract(term: Atom): Promise<boolean> {
    const index = this.facts.findIndex(
      (fact) => core.matchAtoms(term.catom, fact.catom).length > 0,
    );
    if (index === -1) return Promise.resolve(false);
    this.facts.splice(index, 1);
    return Promise.resolve(true);
  }

  consult(path: string): Promise<void> {
    this.consulted.push(path);
    return Promise.resolve();
  }

  predicateArities(name: string): Promise<number[]> {
    const arities = new Set<number>();
    for (const fact of this.facts) {
      const pred = predicateNameAndArity(fact);
      if (pred?.name === name) arities.add(pred.arity);
    }
    return Promise.resolve([...arities].sort((a, b) => a - b));
  }

  dispose(): void {
    // No external process.
  }
}
