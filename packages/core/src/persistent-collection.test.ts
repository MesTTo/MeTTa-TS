// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ForkableMap, ForkableSet } from "./persistent-collection";

describe("forkable persistent collections", () => {
  it("forks maps without sharing later writes", () => {
    const base = new ForkableMap<string, number>([
      ["a", 1],
      ["b", 2],
    ]);
    const left = base.fork();
    const right = base.fork();

    left.set("a", 3).set("c", 4);
    right.delete("b");

    expect([...base]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect([...left]).toEqual([
      ["a", 3],
      ["b", 2],
      ["c", 4],
    ]);
    expect([...right]).toEqual([["a", 1]]);
  });

  it("matches Map insertion order across update, delete, and reinsert", () => {
    const actual = new ForkableMap<string, number>();
    actual.set("a", 1).set("b", 2).set("a", 3).delete("a");
    actual.set("a", 4);
    expect([...actual]).toEqual([
      ["b", 2],
      ["a", 4],
    ]);
  });

  it("agrees with Map over random mutation histories", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant("set" as const), key: fc.string(), value: fc.integer() }),
            fc.record({ kind: fc.constant("delete" as const), key: fc.string() }),
            fc.record({ kind: fc.constant("clear" as const) }),
          ),
          { maxLength: 500 },
        ),
        (operations) => {
          const expected = new Map<string, number>();
          const actual = new ForkableMap<string, number>();
          for (const operation of operations) {
            switch (operation.kind) {
              case "set":
                expected.set(operation.key, operation.value);
                actual.set(operation.key, operation.value);
                break;
              case "delete":
                expect(actual.delete(operation.key)).toBe(expected.delete(operation.key));
                break;
              case "clear":
                expected.clear();
                actual.clear();
                break;
            }
            expect([...actual]).toEqual([...expected]);
            expect(actual.size).toBe(expected.size);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("forks sets with Map-compatible insertion order", () => {
    const base = new ForkableSet<string>(["a", "b"]);
    const branch = base.fork();
    branch.delete("a");
    branch.add("a");

    expect([...base]).toEqual(["a", "b"]);
    expect([...branch]).toEqual(["b", "a"]);
  });
});
