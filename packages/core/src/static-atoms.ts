// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Slot-stable storage for the static `&self` atoms. Occurrence ids (positions in the static atom list)
// are baked into the nested match index and define the observable `get-atoms` enumeration order, so
// compaction must never renumber or reorder slots. A slot holds either the Atom object (rules, types,
// non-compactable facts) or a fact id into the shared `StaticCompactBase`, decoded on access through the
// base's memoized decoder so repeated reads return the identical object (the evaluated-atoms cache and
// the freshen caches key on object identity).

import { type Atom, atomEq } from "./atom";
import { StaticCompactBase } from "./static-base";

const OBJECT_SLOT = -1;

export class StaticAtomStore {
  private readonly slots: (Atom | undefined)[] = [];
  private ids: Int32Array | undefined;
  private base: StaticCompactBase | undefined;
  // toArray memo: full enumerations (get-atoms, get-doc, variable-headed scans) can recur on an
  // unchanged store; the list is rebuilt only after a push or a compaction change. Callers must not
  // mutate the result (the selfAtoms contract).
  private arr: Atom[] | undefined;

  get length(): number {
    return this.slots.length;
  }

  /** The compact base, when a compaction sweep installed one. */
  get compactBase(): StaticCompactBase | undefined {
    return this.base;
  }

  push(atom: Atom): void {
    this.slots.push(atom);
    this.arr = undefined;
  }

  get(index: number): Atom {
    const object = this.slots[index];
    if (object !== undefined) return object;
    return this.base!.factAtom(this.ids![index]!);
  }

  /** Install the compaction result: `factIds[slot]` is the base fact id for compacted slots and
   *  OBJECT_SLOT elsewhere. Compacted slots release their object references. */
  adoptCompact(base: StaticCompactBase, factIds: Int32Array): void {
    this.base = base;
    this.ids = factIds;
    this.arr = undefined;
    for (let slot = 0; slot < factIds.length; slot++)
      if (factIds[slot] !== OBJECT_SLOT) this.slots[slot] = undefined;
  }

  /** De-compaction for one functor: restore the given slots to plain object storage (the atoms are
   *  decoded through the memoized base, so identity stays stable for anything already handed out). */
  restoreSlots(slots: Int32Array): void {
    this.arr = undefined;
    for (const slot of slots) {
      this.slots[slot] = this.get(slot);
      this.ids![slot] = OBJECT_SLOT;
    }
  }

  /** Membership by structural equality. Object slots compare directly; compacted facts resolve through
   *  the base's interned term table without decoding. */
  hasAtom(atom: Atom): boolean {
    if (this.base?.hasFact(atom) === true) return true;
    for (const object of this.slots) if (object !== undefined && atomEq(object, atom)) return true;
    return false;
  }

  /** `some` over the OBJECT slots only. Used by the custom-matcher scan: a compacted fact passed
   *  `canCompactAtom`, so it cannot contain a custom grounded matcher and never satisfies that scan. */
  someObject(predicate: (atom: Atom) => boolean): boolean {
    for (const object of this.slots) if (object !== undefined && predicate(object)) return true;
    return false;
  }

  *[Symbol.iterator](): Iterator<Atom> {
    for (let slot = 0; slot < this.slots.length; slot++) yield this.get(slot);
  }

  /** Materialize the full slot-order list (the `get-atoms` / variable-headed-pattern enumeration).
   *  Memoized until the store changes; callers must not mutate the result. */
  toArray(): Atom[] {
    if (this.arr === undefined) {
      const out: Atom[] = new Array(this.slots.length);
      for (let slot = 0; slot < this.slots.length; slot++) out[slot] = this.get(slot);
      this.arr = out;
    }
    return this.arr;
  }
}

export { OBJECT_SLOT };
