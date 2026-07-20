// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom } from "./atom";
import { compareNumbers } from "./builtins";

const RANGE_KEY_SEP = "\x1f";

export interface RangeEntry {
  readonly value: Atom;
  readonly occurrence: number;
  readonly atom: Atom;
}

interface ArityColumn {
  readonly total: number;
  readonly entries: readonly RangeEntry[];
}

export interface SortedColumn {
  readonly functor: string;
  readonly argPosition: number;
  readonly totalCandidates: number;
  readonly arities: ReadonlyMap<number, ArityColumn>;
}

export interface RangeIndexEnv {
  readonly factIndex: Map<string, Atom[]>;
  numericRangeIndexCache?: Map<string, SortedColumn | null> | undefined;
}

function columnKey(functor: string, argPosition: number): string {
  return functor + RANGE_KEY_SEP + String(argPosition);
}

function isNumberAtom(atom: Atom): boolean {
  return atom.kind === "gnd" && (atom.value.g === "int" || atom.value.g === "float");
}

function isUnorderedNumber(atom: Atom): boolean {
  const c = compareNumbers(atom, atom);
  return c !== undefined && Number.isNaN(c);
}

function compareEntries(a: RangeEntry, b: RangeEntry): number {
  const c = compareNumbers(a.value, b.value);
  if (c !== undefined && !Number.isNaN(c) && c !== 0) return c;
  return a.occurrence - b.occurrence;
}

function buildColumn(
  functor: string,
  argPosition: number,
  facts: readonly Atom[],
): SortedColumn | undefined {
  const byArity = new Map<number, { total: number; entries: RangeEntry[] }>();
  for (let occurrence = 0; occurrence < facts.length; occurrence++) {
    const atom = facts[occurrence]!;
    if (atom.kind !== "expr" || atom.items.length <= argPosition) continue;
    if (!atom.ground) return undefined;
    const value = atom.items[argPosition]!;
    if (!isNumberAtom(value)) return undefined;

    const arity = atom.items.length;
    let column = byArity.get(arity);
    if (column === undefined) {
      column = { total: 0, entries: [] };
      byArity.set(arity, column);
    }
    column.total += 1;
    if (!isUnorderedNumber(value)) column.entries.push({ value, occurrence, atom });
  }
  for (const column of byArity.values()) column.entries.sort(compareEntries);
  return {
    functor,
    argPosition,
    totalCandidates: facts.length,
    arities: byArity,
  };
}

export function numericColumnIndex(
  env: RangeIndexEnv,
  functor: string,
  argPosition: number,
): SortedColumn | undefined {
  const key = columnKey(functor, argPosition);
  const cache = (env.numericRangeIndexCache ??= new Map());
  if (cache.has(key)) return cache.get(key) ?? undefined;
  const facts = env.factIndex.get(functor) ?? [];
  const column = buildColumn(functor, argPosition, facts);
  cache.set(key, column ?? null);
  return column;
}

function arityColumn(column: SortedColumn, arity: number): ArityColumn {
  return column.arities.get(arity) ?? { total: 0, entries: [] };
}

function invalidBound(bound: Atom | undefined): boolean {
  if (bound === undefined) return false;
  const c = compareNumbers(bound, bound);
  return c === undefined || Number.isNaN(c);
}

function firstMatching(
  entries: readonly RangeEntry[],
  bound: Atom,
  accepts: (comparison: number) => boolean,
): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const c = compareNumbers(entries[mid]!.value, bound);
    if (c === undefined || Number.isNaN(c)) throw new Error("range index held unordered value");
    if (accepts(c)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function rangeBounds(
  entries: readonly RangeEntry[],
  low: Atom | undefined,
  high: Atom | undefined,
  incLow: boolean,
  incHigh: boolean,
): readonly [number, number] {
  if (invalidBound(low) || invalidBound(high)) return [0, 0];
  const start =
    low === undefined ? 0 : firstMatching(entries, low, (c) => (incLow ? c >= 0 : c > 0));
  const end =
    high === undefined
      ? entries.length
      : firstMatching(entries, high, (c) => (incHigh ? c > 0 : c >= 0));
  return [start, Math.max(start, end)];
}

export function inRange(
  column: SortedColumn,
  arity: number,
  low: Atom | undefined,
  high: Atom | undefined,
  incLow: boolean,
  incHigh: boolean,
): RangeEntry[] {
  const entries = arityColumn(column, arity).entries;
  const [start, end] = rangeBounds(entries, low, high, incLow, incHigh);
  return entries.slice(start, end);
}

export function countInRange(
  column: SortedColumn,
  arity: number,
  low: Atom | undefined,
  high: Atom | undefined,
  incLow: boolean,
  incHigh: boolean,
): number {
  const entries = arityColumn(column, arity).entries;
  const [start, end] = rangeBounds(entries, low, high, incLow, incHigh);
  return end - start;
}

export function numericFactCount(column: SortedColumn, arity: number): number {
  return arityColumn(column, arity).total;
}
