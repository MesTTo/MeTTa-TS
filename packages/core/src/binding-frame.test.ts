// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { type Atom, expr, sym, variable, variableKey } from "./atom";
import { alphaEq } from "./alpha";
import { addEqRaw, addValRaw, eqRelations, relations } from "./bindings";
import {
  BindingFrame,
  bindingFrameFromLegacy,
  bindingFrameToLegacy,
  type BindingClassSnapshot,
} from "./binding-frame";
import { format } from "./parser";
import { RuntimeIdAllocator } from "./trace";
import { unifyTop } from "./unify";
import { VariableScopeAllocator } from "./variable-scope";

function expectFrame(result: ReturnType<BindingFrame["unify"]>): BindingFrame {
  expect(result.ok, result.ok ? undefined : result.fault.message).toBe(true);
  if (!result.ok) throw new Error(result.fault.message);
  return result.value;
}

function classSignature(bindingClass: BindingClassSnapshot): string {
  const members = bindingClass.members
    .map((member) =>
      member.id === undefined
        ? `legacy:${member.displayName}`
        : `${member.id.scope}/${member.id.slot}:${member.displayName}`,
    )
    .join("=");
  return `${members}${bindingClass.value === undefined ? "" : `<-${format(bindingClass.value)}`}`;
}

function frameSignature(frame: BindingFrame): string[] {
  return frame.classes().map(classSignature);
}

describe("canonical binding frames", () => {
  it("preserves unvalued aliases and resolves every member after binding", () => {
    const x = variable("x");
    const y = variable("y");
    let frame = expectFrame(new BindingFrame().equate(x, y));
    expect(frame.resolve(x)).toEqual(variable("x"));
    expect(frame.resolve(y)).toEqual(variable("x"));
    frame = expectFrame(frame.bind(y, sym("A")));
    expect(frame.resolve(x)).toEqual(sym("A"));
    expect(frame.resolve(y)).toEqual(sym("A"));
    expect(frame.classes()[0]!.members).toHaveLength(2);
  });

  it("walks aliases and values to a finite normal form", () => {
    const x = variable("x");
    const y = variable("y");
    const z = variable("z");
    let frame = expectFrame(new BindingFrame().bind(x, expr([sym("F"), y])));
    frame = expectFrame(frame.bind(y, expr([sym("G"), z])));
    expect(format(frame.resolve(x)!)).toBe("(F (G $z))");
  });

  it("rejects direct and transitive finite-tree cycles at mutation time", () => {
    const x = variable("x");
    const direct = new BindingFrame().bind(x, expr([sym("S"), x]));
    expect(direct).toMatchObject({ ok: false, fault: { code: "occurs-check" } });

    const y = variable("y");
    const first = expectFrame(new BindingFrame().bind(x, expr([sym("F"), y])));
    const indirect = first.bind(y, expr([sym("G"), x]));
    expect(indirect).toMatchObject({ ok: false, fault: { code: "occurs-check" } });
  });

  it("treats self equality as a no-op rather than a cycle", () => {
    const x = variable("x");
    const frame = expectFrame(new BindingFrame().equate(x, x));
    expect(frame.isEmpty).toBe(true);
    expect(frame.variableCount).toBe(1);
  });

  it("rejects incompatible assignments without mutating the source frame", () => {
    const x = variable("x");
    const base = expectFrame(new BindingFrame().bind(x, sym("A")));
    const conflict = base.bind(x, sym("B"));
    expect(conflict).toMatchObject({ ok: false, fault: { code: "conflict" } });
    expect(base.resolve(x)).toEqual(sym("A"));
  });

  it("unions every member of equal-valued classes", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map(variable);
    let left = expectFrame(new BindingFrame().equate(a!, b!));
    left = expectFrame(left.bind(a!, sym("A")));
    let right = expectFrame(new BindingFrame().equate(c!, d!));
    right = expectFrame(right.bind(c!, sym("A")));
    let merged = expectFrame(left.merge(right));
    merged = expectFrame(merged.equate(a!, c!));

    for (const item of [a!, b!, c!, d!]) expect(merged.resolve(item)).toEqual(sym("A"));
    expect(merged.classes().filter((item) => item.value !== undefined)).toHaveLength(1);
    expect(merged.classes().find((item) => item.value !== undefined)!.members).toHaveLength(4);
  });

  it("distinguishes different alias partitions with the same variable set", () => {
    const [x, y, z, w] = ["x", "y", "z", "w"].map(variable);
    let first = expectFrame(new BindingFrame().equate(x!, y!));
    first = expectFrame(first.equate(z!, w!));
    let second = expectFrame(new BindingFrame().equate(x!, z!));
    second = expectFrame(second.equate(y!, w!));
    expect(frameSignature(first)).not.toEqual(frameSignature(second));
  });

  it("projects requested aliases and unbound value dependencies", () => {
    const x = variable("x");
    const y = variable("y");
    const hidden = variable("hidden");
    const unrelated = variable("unrelated");
    let frame = expectFrame(new BindingFrame().equate(x, y));
    frame = expectFrame(frame.bind(x, expr([sym("F"), hidden])));
    frame = expectFrame(frame.bind(unrelated, sym("ignored")));
    const projectedResult = frame.project([x, y]);
    expect(projectedResult.ok).toBe(true);
    if (!projectedResult.ok) return;
    const projected = projectedResult.value;
    expect(format(projected.resolve(x)!)).toBe("(F $hidden)");
    expect(format(projected.resolve(y)!)).toBe("(F $hidden)");
    expect(projected.resolve(hidden)).toEqual(variable("hidden"));
    expect(projected.resolve(unrelated)).toBeUndefined();
  });

  it("propagates a formal constraint to the caller but isolates an unrelated same-name variable", () => {
    const scopes = new VariableScopeAllocator(new RuntimeIdAllocator("extrusion"));
    const caller = scopes.next().variable("a");
    const formal = scopes.next().variable("b");
    const unrelated = scopes.next().variable("a");
    let frame = expectFrame(new BindingFrame().equate(formal, caller));
    frame = expectFrame(frame.bind(formal, sym("B")));
    expect(frame.resolve(caller)).toEqual(sym("B"));
    expect(frame.resolve(unrelated)).toBeUndefined();
  });

  it("round-trips legacy value and equality relations", () => {
    let legacy = addEqRaw([], "x", "y");
    legacy = addValRaw(legacy, "x", expr([sym("F"), variable("z")]));
    legacy = addValRaw(legacy, "z", sym("A"));
    const decoded = bindingFrameFromLegacy(legacy);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const encoded = bindingFrameToLegacy(decoded.value);
    expect([...eqRelations(encoded)]).toHaveLength(1);
    const again = bindingFrameFromLegacy(encoded);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(format(again.value.resolve(variable("x"))!)).toBe("(F A)");
    expect(format(again.value.resolve(variable("y"))!)).toBe("(F A)");
  });

  it("projects scoped variables to deterministic collision-free legacy names", () => {
    const scopes = new VariableScopeAllocator(new RuntimeIdAllocator("legacy"));
    const first = scopes.next().variable("x");
    const second = scopes.next().variable("x");
    let frame = expectFrame(new BindingFrame().equate(first, second));
    frame = expectFrame(frame.bind(first, sym("A")));
    const one = bindingFrameToLegacy(frame);
    const two = bindingFrameToLegacy(frame);
    expect(one).toEqual(two);
    const names = [...relations(one)].filter((relation) => relation.tag === "val").map((r) => r.x);
    expect(new Set(names).size).toBe(2);
    expect(names.every((name) => name.startsWith("x#"))).toBe(true);
  });

  it("produces stable logical representatives independent of union order", () => {
    const [x, y, z] = ["x", "y", "z"].map(variable);
    let first = expectFrame(new BindingFrame().equate(x!, y!));
    first = expectFrame(first.equate(y!, z!));
    let second = expectFrame(new BindingFrame().equate(z!, y!));
    second = expectFrame(second.equate(y!, x!));
    expect(frameSignature(first)).toEqual(frameSignature(second));
  });

  it("retains alpha-equivalent answers under disjoint scopes", () => {
    const scopes = new VariableScopeAllocator(new RuntimeIdAllocator("alpha"));
    const leftScope = scopes.next();
    const rightScope = scopes.next();
    const leftX = leftScope.variable("x");
    const leftY = leftScope.variable("y");
    const rightX = rightScope.variable("x");
    const rightY = rightScope.variable("y");
    const left = expectFrame(new BindingFrame().bind(leftX, expr([sym("F"), leftY])));
    const right = expectFrame(new BindingFrame().bind(rightX, expr([sym("F"), rightY])));
    expect(alphaEq(left.resolve(leftX)!, right.resolve(rightX)!)).toBe(true);
  });

  it("agrees with the reference finite-tree unifier on randomized legacy terms", () => {
    const makeAtom = (values: readonly number[], offset: number, depth: number): Atom => {
      const value = values[offset % Math.max(values.length, 1)] ?? 0;
      if (depth === 0 || value % 4 !== 0) {
        if (value % 3 === 0) return variable(["x", "y", "z"][value % 3]!);
        return sym(["A", "B", "C"][value % 3]!);
      }
      return expr([
        sym(value % 2 === 0 ? "F" : "G"),
        makeAtom(values, offset + 1, depth - 1),
        makeAtom(values, offset + 3, depth - 1),
      ]);
    };

    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (values, split) => {
          const left = makeAtom(values, split, 3);
          const right = makeAtom(values, split + 7, 3);
          return new BindingFrame().unify(left, right).ok === (unifyTop(left, right) !== null);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("preserves alias resolution for arbitrary class sizes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (count) => {
        const variables = Array.from({ length: count }, (_, index) => variable(`v${index}`));
        let frame = new BindingFrame();
        for (let index = 1; index < variables.length; index++) {
          const result = frame.equate(variables[0]!, variables[index]!);
          if (!result.ok) return false;
          frame = result.value;
        }
        const bound = frame.bind(variables[0]!, sym("value"));
        if (!bound.ok) return false;
        return variables.every((item) => format(bound.value.resolve(item)!) === "value");
      }),
      { numRuns: 100 },
    );
  });

  it("keeps scoped variable keys distinct even with the same display text", () => {
    const scopes = new VariableScopeAllocator(new RuntimeIdAllocator("keys"));
    const variables = Array.from({ length: 100 }, () => scopes.next().variable("x"));
    expect(new Set(variables.map(variableKey)).size).toBe(variables.length);
  });
});
