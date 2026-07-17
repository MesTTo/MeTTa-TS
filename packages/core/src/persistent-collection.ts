// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { emptyPMap, pmGet, pmSet, type PMap } from "./pmap";
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

/**
 * A Map-compatible mutable handle over an immutable hash-trie snapshot.
 *
 * `fork` allocates one handle and shares the complete snapshot. A later write
 * replaces only the writing handle's trie and order-tree roots. Iteration walks
 * only live order entries and retains JavaScript Map insertion order.
 */
export class ForkableMap<K extends PersistentKey, V> implements Map<K, V> {
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
    fork.#entries = this.#entries;
    fork.#order = this.#order;
    fork.#size = this.#size;
    fork.#nextOrder = this.#nextOrder;
    return fork;
  }

  clear(): void {
    this.#entries = emptyPMap;
    this.#order = null;
    this.#size = 0;
    this.#nextOrder = 0;
  }

  delete(key: K): boolean {
    const encoded = encodeKey(key);
    if (pmGet(this.#entries, encoded) === undefined) return false;
    const current = pmGet(this.#entries, encoded)!;
    this.#entries = pmSet(this.#entries, encoded, undefined);
    this.#order = orderTreeDelete(this.#order, current.order);
    this.#size -= 1;
    return true;
  }

  get(key: K): V | undefined {
    return pmGet(this.#entries, encodeKey(key))?.value;
  }

  has(key: K): boolean {
    return pmGet(this.#entries, encodeKey(key)) !== undefined;
  }

  set(key: K, value: V): this {
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

  *#orderedEntries(): Generator<StoredEntry<K, V>> {
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
