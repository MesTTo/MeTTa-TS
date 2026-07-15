// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  atomEq,
  createInternTable,
  expr,
  hashOf,
  internAtom,
  makeVariableId,
  scopedVariable,
  sym,
  variable,
  variableIdentity,
  variableKey,
} from "./atom";
import { alphaEq } from "./alpha";
import { format } from "./parser";
import { RuntimeIdAllocator } from "./trace";
import {
  VariableScopeAllocator,
  freshenAtom,
  freshenAtoms,
  scopeAtom,
  scopeAtoms,
} from "./variable-scope";

describe("scoped variable identity", () => {
  it("separates identity from the source display name", () => {
    const scopes = new VariableScopeAllocator(new RuntimeIdAllocator("test"));
    const left = scopes.next().variable("x");
    const right = scopes.next().variable("x");

    expect(format(left)).toBe("$x");
    expect(format(right)).toBe("$x");
    expect(atomEq(left, right)).toBe(false);
    expect(hashOf(left)).not.toBe(hashOf(right));
    expect(variableIdentity(left)).toEqual({ scope: "scope:test:0", slot: 0 });
  });

  it("reuses a local slot for repeated names within one syntax scope", () => {
    const scope = new VariableScopeAllocator(new RuntimeIdAllocator("same-root")).next();
    const first = scope.variable("x");
    const second = scope.variable("x");
    expect(first).toBe(second);
    expect(variableKey(first)).toBe(variableKey(second));
    expect(scope.size).toBe(1);
  });

  it("gives equal scoped identities equal hashes regardless of diagnostic names", () => {
    const scope = new RuntimeIdAllocator("same-id").next("scope");
    const id = makeVariableId(scope, 7);
    const left = scopedVariable("left", id);
    const right = scopedVariable("right", id);
    expect(atomEq(left, right)).toBe(true);
    expect(hashOf(left)).toBe(hashOf(right));
  });

  it("scopes separate parsed roots while preserving alpha equivalence", () => {
    const allocator = new VariableScopeAllocator(new RuntimeIdAllocator("roots"));
    const template = expr([sym("p"), variable("x"), variable("x"), variable("y")]);
    const left = scopeAtom(template, allocator.next());
    const right = scopeAtom(template, allocator.next());
    expect(atomEq(left, right)).toBe(false);
    expect(alphaEq(left, right)).toBe(true);
    expect(format(left)).toBe("(p $x $x $y)");
  });

  it("shares one scope map across a rule LHS and RHS", () => {
    const scope = new VariableScopeAllocator(new RuntimeIdAllocator("rule")).next();
    const [lhs, rhs] = scopeAtoms(
      [expr([sym("f"), variable("x")]), expr([sym("g"), variable("x")])],
      scope,
    );
    expect(lhs?.kind).toBe("expr");
    expect(rhs?.kind).toBe("expr");
    const lhsVar = (lhs as Extract<typeof lhs, { kind: "expr" }>).items[1] as ReturnType<
      typeof variable
    >;
    const rhsVar = (rhs as Extract<typeof rhs, { kind: "expr" }>).items[1] as ReturnType<
      typeof variable
    >;
    expect(variableKey(lhsVar)).toBe(variableKey(rhsVar));
  });

  it("freshens sharing shape and never reuses source identities", () => {
    const allocator = new VariableScopeAllocator(new RuntimeIdAllocator("fresh"));
    const sourceScope = allocator.next();
    const x = sourceScope.variable("x");
    const y = sourceScope.variable("y");
    const source = expr([sym("p"), x, x, y]);
    const first = freshenAtom(source, allocator.next());
    const second = freshenAtom(source, allocator.next());
    expect(alphaEq(source, first)).toBe(true);
    expect(alphaEq(first, second)).toBe(true);
    expect(atomEq(source, first)).toBe(false);
    expect(atomEq(first, second)).toBe(false);
  });

  it("uses one old-to-new map across several copied roots", () => {
    const allocator = new VariableScopeAllocator(new RuntimeIdAllocator("copy-roots"));
    const source = allocator.next();
    const x = source.variable("x");
    const [left, right] = freshenAtoms(
      [expr([sym("left"), x]), expr([sym("right"), x])],
      allocator.next(),
    );
    const leftVar = (left as { items: readonly unknown[] }).items[1] as ReturnType<typeof variable>;
    const rightVar = (right as { items: readonly unknown[] }).items[1] as ReturnType<
      typeof variable
    >;
    expect(variableKey(leftVar)).toBe(variableKey(rightVar));
  });

  it("allocates disjoint worker lanes", () => {
    const root = new VariableScopeAllocator(new RuntimeIdAllocator("session"));
    const workerA = root.fork("worker-a");
    const workerB = root.fork("worker-b");
    expect(variableKey(workerA.next().variable("x"))).not.toBe(
      variableKey(workerB.next().variable("x")),
    );
  });

  it("does not conflate scoped variables in the intern table", () => {
    const scopes = new VariableScopeAllocator(new RuntimeIdAllocator("intern"));
    const table = createInternTable();
    const first = internAtom(table, scopes.next().variable("x"));
    const second = internAtom(table, scopes.next().variable("x"));
    expect(first).not.toBe(second);
  });

  it("keeps legacy JSON and enumerable keys unchanged", () => {
    const legacy = variable("x");
    const scoped = new VariableScopeAllocator(new RuntimeIdAllocator("json")).next().variable("x");
    expect(Object.keys(scoped)).toEqual(Object.keys(legacy));
    expect(JSON.stringify(scoped)).toBe(JSON.stringify(legacy));
  });

  it("preserves the equality pattern for arbitrary repeated source names", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 12 }), { maxLength: 30 }), (names) => {
        const allocator = new VariableScopeAllocator(new RuntimeIdAllocator("property"));
        const scoped = names.map((name) => allocator.next().variable(name));
        const oneScope = allocator.next();
        const local = names.map((name) => oneScope.variable(name));
        for (let left = 0; left < names.length; left++) {
          for (let right = 0; right < names.length; right++) {
            if (left !== right && atomEq(scoped[left]!, scoped[right]!)) return false;
            if (atomEq(local[left]!, local[right]!) !== (names[left] === names[right]))
              return false;
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
