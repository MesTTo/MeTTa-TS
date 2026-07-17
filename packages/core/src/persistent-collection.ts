// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { emptyPMap, pmGet, pmSet, type PMap } from "./pmap";
import { readEnv } from "./env";
import {
  orderTreeDelete,
  orderTreeSet,
  orderTreeValues,
  type PersistentOrderTree,
} from "./persistent-order-tree";

export type PersistentKey = string | number;

interface StoredEntry<K extends PersistentKey, V> {
  readonly key: K;
  readonly value: V;
  readonly order: number;
}

interface OrderEntry<K extends PersistentKey> {
  readonly key: K;
  readonly encoded: string;
}

function encodeKey(key: PersistentKey): string {
  return typeof key === "string" ? `s:${key}` : `n:${String(key === 0 ? 0 : key)}`;
}

interface SmallEntry<K extends PersistentKey, V> {
  readonly key: K;
  readonly value: V;
  readonly encoded: string;
}

// Below this entry count the map is one immutable array instead of a hash trie plus an order
// tree: a linear scan over a few encoded keys beats hashing into either structure, and a write
// copies one small array instead of allocating trie and tree spines (Clojure's
// PersistentArrayMap pattern). A map that grows past the threshold promotes and never demotes,
// so large maps always take the O(log n) trie. 32 is measured, not assumed: on the frame-shaped
// mix (fork + write + reads + iterate) the array leads at every size up to 64, and on the
// build-only worst case (n fresh inserts, where each array write copies O(n)) the curves cross
// near n = 200 (array about 1.9*n^2 ns, trie about 392*n ns), so 32 keeps at least a 2x lead on
// both curves with a wide margin before the quadratic tail. `METTA_SMALL_MAP_MAX` overrides the
// threshold for A/B measurement (0 disables the array mode entirely).
const SMALL_MAX = (() => {
  const raw = readEnv("METTA_SMALL_MAP_MAX");
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 32;
})();

/**
 * A Map-compatible mutable handle over an immutable snapshot: an array below `SMALL_MAX`
 * entries, a hash-trie plus order-tree above it.
 *
 * `fork` allocates one handle and shares the complete snapshot. A later write
 * replaces only the writing handle's storage root (copy-on-write in the array
 * representation). Iteration walks only live entries and retains JavaScript Map
 * insertion order.
 */
export class ForkableMap<K extends PersistentKey, V> implements Map<K, V> {
  #small: readonly SmallEntry<K, V>[] | null = [];
  #entries: PMap<StoredEntry<K, V>> = emptyPMap;
  #order: PersistentOrderTree<OrderEntry<K>> | null = null;
  #size = 0;
  #nextOrder = 0;

  constructor(entries?: Iterable<readonly [K, V]> | null) {
    if (entries !== undefined && entries !== null)
      for (const [key, value] of entries) this.set(key, value);
  }

  get size(): number {
    return this.#size;
  }

  get [Symbol.toStringTag](): string {
    return "Map";
  }

  /** Return an independently mutable handle sharing this handle's immutable storage. */
  fork(): ForkableMap<K, V> {
    const fork = new ForkableMap<K, V>();
    fork.#small = this.#small;
    fork.#entries = this.#entries;
    fork.#order = this.#order;
    fork.#size = this.#size;
    fork.#nextOrder = this.#nextOrder;
    return fork;
  }

  clear(): void {
    this.#small = [];
    this.#entries = emptyPMap;
    this.#order = null;
    this.#size = 0;
    this.#nextOrder = 0;
  }

  delete(key: K): boolean {
    const small = this.#small;
    if (small !== null) {
      const encoded = encodeKey(key);
      const index = small.findIndex((entry) => entry.encoded === encoded);
      if (index < 0) return false;
      this.#small = [...small.slice(0, index), ...small.slice(index + 1)];
      this.#size -= 1;
      return true;
    }
    const encoded = encodeKey(key);
    const current = pmGet(this.#entries, encoded);
    if (current === undefined) return false;
    this.#entries = pmSet(this.#entries, encoded, undefined);
    this.#order = orderTreeDelete(this.#order, current.order);
    this.#size -= 1;
    return true;
  }

  get(key: K): V | undefined {
    const small = this.#small;
    if (small !== null) {
      const encoded = encodeKey(key);
      for (const entry of small) if (entry.encoded === encoded) return entry.value;
      return undefined;
    }
    return pmGet(this.#entries, encodeKey(key))?.value;
  }

  has(key: K): boolean {
    const small = this.#small;
    if (small !== null) {
      const encoded = encodeKey(key);
      for (const entry of small) if (entry.encoded === encoded) return true;
      return false;
    }
    return pmGet(this.#entries, encodeKey(key)) !== undefined;
  }

  set(key: K, value: V): this {
    const small = this.#small;
    if (small !== null) {
      const encoded = encodeKey(key);
      const index = small.findIndex((entry) => entry.encoded === encoded);
      if (index >= 0) {
        const next = small.slice();
        next[index] = { key, value, encoded };
        this.#small = next;
        return this;
      }
      if (small.length < SMALL_MAX) {
        this.#small = [...small, { key, value, encoded }];
        this.#size += 1;
        return this;
      }
      this.#promote(small);
    }
    const encoded = encodeKey(key);
    const current = pmGet(this.#entries, encoded);
    if (current !== undefined) {
      this.#entries = pmSet(this.#entries, encoded, { ...current, value });
      return this;
    }
    if (this.#nextOrder === Number.MAX_SAFE_INTEGER) this.#compactOrder();
    const order = this.#nextOrder++;
    this.#entries = pmSet(this.#entries, encoded, { key, value, order });
    this.#order = orderTreeSet(this.#order, order, { key, encoded });
    this.#size += 1;
    return this;
  }

  #promote(small: readonly SmallEntry<K, V>[]): void {
    this.#small = null;
    for (const entry of small) {
      const order = this.#nextOrder++;
      this.#entries = pmSet(this.#entries, entry.encoded, {
        key: entry.key,
        value: entry.value,
        order,
      });
      this.#order = orderTreeSet(this.#order, order, { key: entry.key, encoded: entry.encoded });
    }
  }

  *entries(): MapIterator<[K, V]> {
    for (const entry of this.#orderedEntries()) yield [entry.key, entry.value];
  }

  *keys(): MapIterator<K> {
    for (const entry of this.#orderedEntries()) yield entry.key;
  }

  *values(): MapIterator<V> {
    for (const entry of this.#orderedEntries()) yield entry.value;
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) callbackfn.call(thisArg, value, key, this);
  }

  *#orderedEntries(): Generator<StoredEntry<K, V> | SmallEntry<K, V>> {
    const small = this.#small;
    if (small !== null) {
      yield* small;
      return;
    }
    for (const ordered of orderTreeValues(this.#order)) {
      const current = pmGet(this.#entries, ordered.encoded);
      if (current !== undefined) yield current;
    }
  }

  #compactOrder(): void {
    let entries: PMap<StoredEntry<K, V>> = emptyPMap;
    let orderTree: PersistentOrderTree<OrderEntry<K>> | null = null;
    let order = 0;
    for (const current of this.#orderedEntries()) {
      const encoded = encodeKey(current.key);
      entries = pmSet(entries, encoded, { key: current.key, value: current.value, order });
      orderTree = orderTreeSet(orderTree, order, { key: current.key, encoded });
      order += 1;
    }
    this.#entries = entries;
    this.#order = orderTree;
    this.#nextOrder = order;
  }
}

/** A Set-compatible handle with the same O(1) fork contract as ForkableMap. */
export class ForkableSet<K extends PersistentKey> implements Set<K> {
  #values: ForkableMap<K, true>;

  constructor(values?: Iterable<K> | null) {
    this.#values = new ForkableMap();
    if (values !== undefined && values !== null) for (const value of values) this.add(value);
  }

  get size(): number {
    return this.#values.size;
  }

  get [Symbol.toStringTag](): string {
    return "Set";
  }

  fork(): ForkableSet<K> {
    const fork = new ForkableSet<K>();
    fork.#values = this.#values.fork();
    return fork;
  }

  add(value: K): this {
    this.#values.set(value, true);
    return this;
  }

  clear(): void {
    this.#values.clear();
  }

  delete(value: K): boolean {
    return this.#values.delete(value);
  }

  has(value: K): boolean {
    return this.#values.has(value);
  }

  *entries(): SetIterator<[K, K]> {
    for (const value of this.#values.keys()) yield [value, value];
  }

  keys(): SetIterator<K> {
    return this.#values.keys();
  }

  values(): SetIterator<K> {
    return this.#values.keys();
  }

  [Symbol.iterator](): SetIterator<K> {
    return this.values();
  }

  forEach(callbackfn: (value: K, value2: K, set: Set<K>) => void, thisArg?: unknown): void {
    for (const value of this) callbackfn.call(thisArg, value, value, this);
  }
}

/** Preserve the fast fork for internal maps while accepting structural Map inputs. */
export function forkMap<K extends PersistentKey, V>(source: Map<K, V>): Map<K, V> {
  return source instanceof ForkableMap ? source.fork() : new ForkableMap(source);
}

/** Preserve the fast fork for internal sets while accepting structural Set inputs. */
export function forkSet<K extends PersistentKey>(source: Set<K>): Set<K> {
  return source instanceof ForkableSet ? source.fork() : new ForkableSet(source);
}
