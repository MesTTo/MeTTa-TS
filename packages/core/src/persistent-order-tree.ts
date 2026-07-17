// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

/** Immutable AVL node keyed by a JavaScript safe integer. */
export interface PersistentOrderTree<V> {
  readonly key: number;
  readonly value: V;
  readonly height: number;
  readonly left: PersistentOrderTree<V> | null;
  readonly right: PersistentOrderTree<V> | null;
}

const height = <V>(node: PersistentOrderTree<V> | null): number => node?.height ?? 0;

function node<V>(
  key: number,
  value: V,
  left: PersistentOrderTree<V> | null,
  right: PersistentOrderTree<V> | null,
): PersistentOrderTree<V> {
  return { key, value, left, right, height: Math.max(height(left), height(right)) + 1 };
}

function rotateLeft<V>(root: PersistentOrderTree<V>): PersistentOrderTree<V> {
  const pivot = root.right;
  if (pivot === null) return root;
  return node(
    pivot.key,
    pivot.value,
    node(root.key, root.value, root.left, pivot.left),
    pivot.right,
  );
}

function rotateRight<V>(root: PersistentOrderTree<V>): PersistentOrderTree<V> {
  const pivot = root.left;
  if (pivot === null) return root;
  return node(
    pivot.key,
    pivot.value,
    pivot.left,
    node(root.key, root.value, pivot.right, root.right),
  );
}

function balance<V>(root: PersistentOrderTree<V>): PersistentOrderTree<V> {
  const skew = height(root.left) - height(root.right);
  if (skew > 1) {
    const left = root.left!;
    return rotateRight(
      height(left.left) >= height(left.right)
        ? root
        : node(root.key, root.value, rotateLeft(left), root.right),
    );
  }
  if (skew < -1) {
    const right = root.right!;
    return rotateLeft(
      height(right.right) >= height(right.left)
        ? root
        : node(root.key, root.value, root.left, rotateRight(right)),
    );
  }
  return root;
}

/** Insert or replace one key, copying only the root-to-leaf path. */
export function orderTreeSet<V>(
  root: PersistentOrderTree<V> | null,
  key: number,
  value: V,
): PersistentOrderTree<V> {
  if (!Number.isSafeInteger(key) || key < 0)
    throw new RangeError("persistent order key must be a non-negative safe integer");
  if (root === null) return node(key, value, null, null);
  if (key === root.key) return node(key, value, root.left, root.right);
  return balance(
    key < root.key
      ? node(root.key, root.value, orderTreeSet(root.left, key, value), root.right)
      : node(root.key, root.value, root.left, orderTreeSet(root.right, key, value)),
  );
}

function minimum<V>(root: PersistentOrderTree<V>): PersistentOrderTree<V> {
  let current = root;
  while (current.left !== null) current = current.left;
  return current;
}

/** Remove one key, copying and rebalancing only the affected search path. */
export function orderTreeDelete<V>(
  root: PersistentOrderTree<V> | null,
  key: number,
): PersistentOrderTree<V> | null {
  if (root === null) return null;
  if (key < root.key)
    return balance(node(root.key, root.value, orderTreeDelete(root.left, key), root.right));
  if (key > root.key)
    return balance(node(root.key, root.value, root.left, orderTreeDelete(root.right, key)));
  if (root.left === null) return root.right;
  if (root.right === null) return root.left;
  const successor = minimum(root.right);
  return balance(
    node(successor.key, successor.value, root.left, orderTreeDelete(root.right, successor.key)),
  );
}

/** Enumerate live values in ascending key order with O(tree height) iterator state. */
export function* orderTreeValues<V>(root: PersistentOrderTree<V> | null): Generator<V> {
  const stack: PersistentOrderTree<V>[] = [];
  let current = root;
  while (current !== null || stack.length > 0) {
    while (current !== null) {
      stack.push(current);
      current = current.left;
    }
    const next = stack.pop()!;
    yield next.value;
    current = next.right;
  }
}
