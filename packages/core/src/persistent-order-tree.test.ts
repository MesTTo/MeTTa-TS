// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  orderTreeDelete,
  orderTreeSet,
  orderTreeValues,
  type PersistentOrderTree,
} from "./persistent-order-tree";

function assertBalanced<V>(root: PersistentOrderTree<V> | null): number {
  if (root === null) return 0;
  const left = assertBalanced(root.left);
  const right = assertBalanced(root.right);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  expect(root.height).toBe(Math.max(left, right) + 1);
  return root.height;
}

describe("persistent order tree", () => {
  it("matches an ordered Map through generated insert and delete histories", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom("set" as const, "delete" as const),
            key: fc.integer({ min: 0, max: 200 }),
            value: fc.integer(),
          }),
          { maxLength: 1_000 },
        ),
        (operations) => {
          let tree: PersistentOrderTree<number> | null = null;
          const oracle = new Map<number, number>();
          for (const operation of operations) {
            if (operation.kind === "set") {
              tree = orderTreeSet(tree, operation.key, operation.value);
              oracle.set(operation.key, operation.value);
            } else {
              tree = orderTreeDelete(tree, operation.key);
              oracle.delete(operation.key);
            }
          }
          assertBalanced(tree);
          expect([...orderTreeValues(tree)]).toEqual(
            [...oracle.entries()].sort(([left], [right]) => left - right).map((entry) => entry[1]),
          );
        },
      ),
      { numRuns: 250 },
    );
  });

  it("keeps old roots unchanged after later updates", () => {
    const first = orderTreeSet(orderTreeSet(null, 1, "one"), 2, "two");
    const second = orderTreeDelete(orderTreeSet(first, 3, "three"), 1);

    expect([...orderTreeValues(first)]).toEqual(["one", "two"]);
    expect([...orderTreeValues(second)]).toEqual(["two", "three"]);
  });
});
