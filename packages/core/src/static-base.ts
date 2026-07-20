// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, type Ground, expr, gnd, groundType, sym, variable } from "./atom";
import { FlatAtomSpaceTable } from "./flat-atomspace";

type FactId = number;
type TermId = number;
type NumericGround = Extract<Ground, { readonly g: "int" | "float" }>;
type SymAtom = Extract<Atom, { readonly kind: "sym" }>;
type SymbolHeadedExprAtom = Extract<Atom, { readonly kind: "expr" }> & {
  readonly items: readonly [SymAtom, ...Atom[]];
};

const TERM_SYM = 1;
const TERM_GND = 2;
const TERM_VAR = 3;
const TERM_EXPR = 4;

const COLUMN_SEP = "\x1f";
const VALUE_SEP = "\x00";
const NOT_COMPACT_MESSAGE = "flat-atomspace: grounded metadata is not compactable";
const EMPTY_IDS: readonly number[] = [];
const EMPTY_FACT_IDS = new Int32Array(0);

interface TableRawAccess {
  // FlatAtomSpaceTable does not expose an uncached decoder or leaf pools. StaticCompactBase reads the
  // intern pools structurally so the public `factAtom` path can return fresh objects without filling
  // FlatAtomSpaceTable's term decode cache.
  readonly symbols: readonly string[];
  readonly grounds: readonly Ground[];
  readonly vars: readonly string[];
}

interface FactIdView {
  readonly count: number;
  ids(): Iterable<number>;
}

interface TermValue {
  readonly key: string | undefined;
  readonly numeric: NumericGround | undefined;
  readonly numberKey: number;
  readonly unsafeInt: boolean;
}

interface NumericColumn {
  readonly kind: "numeric";
  readonly ids: Int32Array;
  readonly keys: Float64Array;
  // Present only when exact bigint values can collide under Number. Searches take a broad rounded slice,
  // then filter with the same exact-int and int-float rules as compareNumbers.
  readonly values: readonly NumericGround[] | undefined;
}

interface KeyColumn {
  readonly kind: "key";
  readonly ids: Int32Array;
  readonly keys: readonly string[];
  readonly numericValues: readonly (NumericGround | undefined)[] | undefined;
}

type Column = NumericColumn | KeyColumn;

interface NumericRow {
  readonly fact: FactId;
  readonly key: number;
  readonly value: NumericGround;
}

interface KeyRow {
  readonly fact: FactId;
  readonly key: string;
  readonly numeric: NumericGround | undefined;
}

function columnKey(headKey: string, argPos: number): string {
  return headKey + COLUMN_SEP + String(argPos);
}

function numberKey(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

function compareNumberKey(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNumericGrounds(a: NumericGround, b: NumericGround): number {
  if (a.g === "int" && b.g === "int") {
    const x = BigInt(a.n);
    const y = BigInt(b.n);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(a.n);
  const y = Number(b.n);
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  return x < y ? -1 : x > y ? 1 : 0;
}

function isNumericAtom(a: Atom): a is Atom & { readonly value: NumericGround } {
  return a.kind === "gnd" && (a.value.g === "int" || a.value.g === "float");
}

function numericAtomValue(a: Atom): NumericGround | undefined {
  return isNumericAtom(a) ? a.value : undefined;
}

function numericValueUsable(value: NumericGround): boolean {
  return !Number.isNaN(Number(value.n));
}

function numericEqual(a: NumericGround, b: NumericGround): boolean {
  const c = compareNumericGrounds(a, b);
  return c === 0;
}

function numericInRange(
  value: NumericGround,
  low: NumericGround | undefined,
  high: NumericGround | undefined,
  incLow: boolean,
  incHigh: boolean,
): boolean {
  if (!numericValueUsable(value)) return false;
  if (low !== undefined) {
    const c = compareNumericGrounds(value, low);
    if (Number.isNaN(c) || (incLow ? c < 0 : c <= 0)) return false;
  }
  if (high !== undefined) {
    const c = compareNumericGrounds(value, high);
    if (Number.isNaN(c) || (incHigh ? c > 0 : c >= 0)) return false;
  }
  return true;
}

function numericBound(bound: Atom | undefined): NumericGround | undefined | null {
  if (bound === undefined) return undefined;
  const value = numericAtomValue(bound);
  if (value === undefined || !numericValueUsable(value)) return null;
  return value;
}

function firstNumberMatching(
  keys: Float64Array,
  bound: number,
  accepts: (comparison: number) => boolean,
): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (accepts(compareNumberKey(keys[mid]!, bound))) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function numberBounds(
  keys: Float64Array,
  low: NumericGround | undefined,
  high: NumericGround | undefined,
  incLow: boolean,
  incHigh: boolean,
): readonly [number, number] {
  const lowKey = low === undefined ? undefined : numberKey(Number(low.n));
  const highKey = high === undefined ? undefined : numberKey(Number(high.n));
  const start =
    lowKey === undefined ? 0 : firstNumberMatching(keys, lowKey, (c) => (incLow ? c >= 0 : c > 0));
  const end =
    highKey === undefined
      ? keys.length
      : firstNumberMatching(keys, highKey, (c) => (incHigh ? c > 0 : c >= 0));
  return [start, Math.max(start, end)];
}

function firstStringMatching(
  keys: readonly string[],
  bound: string,
  accepts: (comparison: number) => boolean,
): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const key = keys[mid]!;
    const c = key < bound ? -1 : key > bound ? 1 : 0;
    if (accepts(c)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function idsToArray(ids: Int32Array, start: number, end: number): readonly number[] {
  if (start >= end) return EMPTY_IDS;
  const out: number[] = [];
  for (let i = start; i < end; i++) out.push(ids[i]!);
  return out;
}

function sourceOrderedIds(ids: Int32Array, start: number, end: number): readonly number[] {
  if (start >= end) return EMPTY_IDS;
  const out: number[] = [];
  for (let i = start; i < end; i++) out.push(ids[i]!);
  return out.length <= 1 ? out : out.sort((a, b) => a - b);
}

function numericKey(value: NumericGround): string | undefined {
  const key = numberKey(Number(value.n));
  return Number.isNaN(key) ? undefined : "n" + VALUE_SEP + String(key);
}

function groundKey(value: Ground): string | undefined {
  switch (value.g) {
    case "int":
    case "float":
      return numericKey(value);
    case "str":
      return "S" + VALUE_SEP + value.s;
    case "bool":
      return value.b ? "b" + VALUE_SEP + "1" : "b" + VALUE_SEP + "0";
    case "unit":
      return "u";
    case "error":
      return "e" + VALUE_SEP + value.msg;
    case "ext":
      return "x" + VALUE_SEP + value.kind + VALUE_SEP + value.id;
  }
}

function atomKey(
  value: Atom,
): { readonly key: string; readonly numeric: NumericGround | undefined } | undefined {
  if (value.kind === "sym") return { key: "s" + VALUE_SEP + value.name, numeric: undefined };
  if (value.kind !== "gnd") return undefined;
  const key = groundKey(value.value);
  if (key === undefined) return undefined;
  return {
    key,
    numeric: value.value.g === "int" || value.value.g === "float" ? value.value : undefined,
  };
}

function supportedFact(atom: Atom): atom is SymbolHeadedExprAtom {
  return atom.kind === "expr" && atom.items.length > 0 && atom.items[0]!.kind === "sym";
}

function sortedInt32(facts: readonly number[]): Int32Array {
  return Int32Array.from(facts);
}

/** Compact storage for static symbol-headed expression facts.
 *
 * Fact ids are the source positions passed to `fromAtoms`. Head keys use the evaluator's `headKey`
 * format for the supported fact shape: the symbol name at expression position 0.
 */
export class StaticCompactBase {
  private readonly columnCache = new Map<string, Column | null>();
  private readonly factMemo: Atom[] = [];
  private memoizeFactDecode = false;

  private constructor(
    private readonly table: FlatAtomSpaceTable,
    private readonly headFacts: ReadonlyMap<string, Int32Array>,
    readonly size: number,
  ) {}

  /** Encode all atoms as facts 0..n-1. The batch is rejected if any fact is not compactable or is
   *  not a symbol-headed expression. */
  static fromAtoms(atoms: readonly Atom[]): StaticCompactBase | undefined {
    const table = new FlatAtomSpaceTable();
    const byHead = new Map<string, number[]>();
    try {
      for (let fact = 0; fact < atoms.length; fact++) {
        const atom = atoms[fact]!;
        if (!supportedFact(atom)) return undefined;
        const head = atom.items[0]!;
        table.insertFact(atom);
        const facts = byHead.get(head.name);
        if (facts === undefined) byHead.set(head.name, [fact]);
        else facts.push(fact);
      }
    } catch (e) {
      if (e instanceof Error && e.message === NOT_COMPACT_MESSAGE) return undefined;
      throw e;
    }

    const compactHeadFacts = new Map<string, Int32Array>();
    for (const [head, facts] of byHead) compactHeadFacts.set(head, sortedInt32(facts));
    return new StaticCompactBase(table, compactHeadFacts, atoms.length);
  }

  factAtom(id: number): Atom {
    if (!Number.isInteger(id) || id < 0 || id >= this.size)
      throw new RangeError(`static-base: bad fact id ${id}`);
    if (!this.memoizeFactDecode) return this.decodeTermFresh(this.table.factRoot.get(id));
    const hit = this.factMemo[id];
    if (hit !== undefined) return hit;
    const atom = this.table.decodeTerm(this.table.factRoot.get(id));
    this.factMemo[id] = atom;
    return atom;
  }

  /** Switch `factAtom` to per-fact memoized decoding: repeated reads of a fact return the identical
   *  object. The evaluator wiring requires this (its evaluated-atoms and freshen caches key on object
   *  identity); the unmemoized default keeps the standalone store's steady heap flat. */
  enableDecodeMemo(): void {
    this.memoizeFactDecode = true;
  }

  /** Structural membership without decoding: whether some stored fact equals `atom`. The interned term
   *  table gives each distinct term one id, so equality is an id lookup plus a per-term fact check. */
  hasFact(atom: Atom): boolean {
    const term = this.table.lookupAtom(atom);
    if (term === undefined) return false;
    return this.table.factsForTerm(term).length > 0;
  }

  /** Whether the functor stores two structurally identical facts. Interning makes duplicate facts share
   *  one root term id, so this is a Set scan over the bucket's root ids, never a decode. */
  hasDuplicateFacts(headKey: string): boolean {
    const facts = this.headFacts.get(headKey);
    if (facts === undefined || facts.length < 2) return false;
    const seen = new Set<number>();
    for (const fact of facts) {
      const root = this.table.factRoot.get(fact);
      if (seen.has(root)) return true;
      seen.add(root);
    }
    return false;
  }

  factsForHead(headKey: string): FactIdView {
    const facts = this.headFacts.get(headKey) ?? EMPTY_FACT_IDS;
    return {
      count: facts.length,
      ids: () => facts.values(),
    };
  }

  equalRange(headKey: string, argPos: number, value: Atom): readonly number[] {
    const column = this.column(headKey, argPos);
    if (column === undefined) return EMPTY_IDS;
    return column.kind === "numeric"
      ? this.equalNumeric(column, value)
      : this.equalKeyed(column, value);
  }

  bucketSize(headKey: string, argPos: number, value: Atom): number {
    const column = this.column(headKey, argPos);
    if (column === undefined) return 0;
    return column.kind === "numeric"
      ? this.countEqualNumeric(column, value)
      : this.countEqualKeyed(column, value);
  }

  numericRange(
    headKey: string,
    argPos: number,
    low: Atom | undefined,
    high: Atom | undefined,
    incLow: boolean,
    incHigh: boolean,
  ): readonly number[] | undefined {
    const column = this.column(headKey, argPos);
    if (column === undefined || column.kind !== "numeric") return undefined;
    const lowValue = numericBound(low);
    const highValue = numericBound(high);
    if (lowValue === null || highValue === null) return EMPTY_IDS;
    const [start, end] =
      column.values === undefined
        ? numberBounds(column.keys, lowValue, highValue, incLow, incHigh)
        : numberBounds(column.keys, lowValue, highValue, true, true);
    if (column.values === undefined) return sourceOrderedIds(column.ids, start, end);

    const out: number[] = [];
    for (let i = start; i < end; i++) {
      const value = column.values[i]!;
      if (numericInRange(value, lowValue, highValue, incLow, incHigh)) out.push(column.ids[i]!);
    }
    return out.length === 0 ? EMPTY_IDS : out.sort((a, b) => a - b);
  }

  private column(headKeyValue: string, argPos: number): Column | undefined {
    const key = columnKey(headKeyValue, argPos);
    if (this.columnCache.has(key)) return this.columnCache.get(key) ?? undefined;
    const column = this.buildColumn(headKeyValue, argPos);
    this.columnCache.set(key, column ?? null);
    return column;
  }

  private buildColumn(headKeyValue: string, argPos: number): Column | undefined {
    const facts = argPos > 0 ? this.headFacts.get(headKeyValue) : undefined;
    if (facts === undefined) return undefined;

    const numericRows: NumericRow[] = [];
    const keyRows: KeyRow[] = [];
    let present = 0;
    let numericPresent = 0;
    let unsafeNumeric = false;

    for (const fact of facts) {
      const term = this.argumentTerm(fact, argPos);
      if (term === undefined) continue;
      present += 1;
      const value = this.termValue(term);
      if (value === undefined) continue;
      if (value.numeric !== undefined) {
        numericPresent += 1;
        if (value.unsafeInt) unsafeNumeric = true;
        if (Number.isNaN(value.numberKey)) continue;
        numericRows.push({ fact, key: value.numberKey, value: value.numeric });
      }
      if (value.key !== undefined) keyRows.push({ fact, key: value.key, numeric: value.numeric });
    }

    if (present === 0)
      return { kind: "key", ids: EMPTY_FACT_IDS, keys: [], numericValues: undefined };
    if (numericPresent === present) return this.buildNumericColumn(numericRows, unsafeNumeric);
    return this.buildKeyColumn(keyRows, unsafeNumeric);
  }

  private buildNumericColumn(rows: NumericRow[], fallback: boolean): NumericColumn {
    rows.sort((a, b) => compareNumberKey(a.key, b.key) || a.fact - b.fact);
    const ids = new Int32Array(rows.length);
    const keys = new Float64Array(rows.length);
    const values: NumericGround[] | undefined = fallback ? [] : undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      ids[i] = row.fact;
      keys[i] = row.key;
      if (values !== undefined) values.push(row.value);
    }
    return { kind: "numeric", ids, keys, values };
  }

  private buildKeyColumn(rows: KeyRow[], fallback: boolean): KeyColumn {
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.fact - b.fact));
    const ids = new Int32Array(rows.length);
    const keys: string[] = [];
    const numericValues: Array<NumericGround | undefined> | undefined = fallback ? [] : undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      ids[i] = row.fact;
      keys.push(row.key);
      if (numericValues !== undefined) numericValues.push(row.numeric);
    }
    return { kind: "key", ids, keys, numericValues };
  }

  private argumentTerm(fact: FactId, argPos: number): TermId | undefined {
    const root = this.table.factRoot.get(fact);
    if (this.table.termKind.get(root) !== TERM_EXPR || this.table.termLen.get(root) <= argPos)
      return undefined;
    return this.table.termData.get(this.table.termStart.get(root) + argPos);
  }

  private termValue(term: TermId): TermValue | undefined {
    const kind = this.table.termKind.get(term);
    const start = this.table.termStart.get(term);
    const raw = this.table as unknown as TableRawAccess;
    if (kind === TERM_SYM) {
      return {
        key: "s" + VALUE_SEP + raw.symbols[start]!,
        numeric: undefined,
        numberKey: Number.NaN,
        unsafeInt: false,
      };
    }
    if (kind !== TERM_GND) return undefined;
    const ground = raw.grounds[start]!;
    const key = groundKey(ground);
    const numeric = ground.g === "int" || ground.g === "float" ? ground : undefined;
    return {
      key,
      numeric,
      numberKey: numeric === undefined ? Number.NaN : numberKey(Number(numeric.n)),
      unsafeInt: numeric?.g === "int" && typeof numeric.n === "bigint",
    };
  }

  private equalNumeric(column: NumericColumn, value: Atom): readonly number[] {
    const numeric = numericAtomValue(value);
    if (numeric === undefined || !numericValueUsable(numeric)) return EMPTY_IDS;
    const [start, end] = numberBounds(column.keys, numeric, numeric, true, true);
    if (column.values === undefined) return idsToArray(column.ids, start, end);
    return this.filteredNumericIds(column, start, end, numeric);
  }

  private countEqualNumeric(column: NumericColumn, value: Atom): number {
    const numeric = numericAtomValue(value);
    if (numeric === undefined || !numericValueUsable(numeric)) return 0;
    const [start, end] = numberBounds(column.keys, numeric, numeric, true, true);
    if (column.values === undefined) return end - start;
    let count = 0;
    for (let i = start; i < end; i++) if (numericEqual(column.values[i]!, numeric)) count += 1;
    return count;
  }

  private filteredNumericIds(
    column: NumericColumn,
    start: number,
    end: number,
    value: NumericGround,
  ): readonly number[] {
    const out: number[] = [];
    for (let i = start; i < end; i++)
      if (numericEqual(column.values![i]!, value)) out.push(column.ids[i]!);
    return out.length === 0 ? EMPTY_IDS : out;
  }

  private equalKeyed(column: KeyColumn, value: Atom): readonly number[] {
    const probe = atomKey(value);
    if (probe === undefined) return EMPTY_IDS;
    const [start, end] = this.keyBounds(column.keys, probe.key);
    if (column.numericValues === undefined || probe.numeric === undefined)
      return idsToArray(column.ids, start, end);
    const out: number[] = [];
    for (let i = start; i < end; i++) {
      const numeric = column.numericValues[i];
      if (numeric !== undefined && numericEqual(numeric, probe.numeric)) out.push(column.ids[i]!);
    }
    return out.length === 0 ? EMPTY_IDS : out;
  }

  private countEqualKeyed(column: KeyColumn, value: Atom): number {
    const probe = atomKey(value);
    if (probe === undefined) return 0;
    const [start, end] = this.keyBounds(column.keys, probe.key);
    if (column.numericValues === undefined || probe.numeric === undefined) return end - start;
    let count = 0;
    for (let i = start; i < end; i++) {
      const numeric = column.numericValues[i];
      if (numeric !== undefined && numericEqual(numeric, probe.numeric)) count += 1;
    }
    return count;
  }

  private keyBounds(keys: readonly string[], key: string): readonly [number, number] {
    const start = firstStringMatching(keys, key, (c) => c >= 0);
    const end = firstStringMatching(keys, key, (c) => c > 0);
    return [start, end];
  }

  private decodeTermFresh(term: TermId): Atom {
    const raw = this.table as unknown as TableRawAccess;
    const kind = this.table.termKind.get(term);
    const start = this.table.termStart.get(term);
    switch (kind) {
      case TERM_SYM:
        return sym(raw.symbols[start]!);
      case TERM_GND: {
        const ground = raw.grounds[start]!;
        return gnd(ground, groundType(ground));
      }
      case TERM_VAR:
        return variable(raw.vars[start]!);
      case TERM_EXPR: {
        const len = this.table.termLen.get(term);
        const items: Atom[] = [];
        for (let i = 0; i < len; i++)
          items.push(this.decodeTermFresh(this.table.termData.get(start + i)));
        return expr(items);
      }
      default:
        throw new Error(`static-base: bad term kind ${kind}`);
    }
  }
}
