// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { type Atom, atomEq, expr, gbool, gfloat, gint, gnd, gstr, sym, variable } from "./atom";
import { compareNumbers, stdTable } from "./builtins";
import { format } from "./parser";
import { StaticCompactBase } from "./static-base";

const A = (...items: Atom[]): Atom => expr(items);
const BIG_A = 9_007_199_254_740_992n;
const BIG_B = 9_007_199_254_740_993n;
const BIG_FLOAT = 9_007_199_254_740_992;

function mustBase(atoms: readonly Atom[]): StaticCompactBase {
  const base = StaticCompactBase.fromAtoms(atoms);
  if (base === undefined) throw new Error("StaticCompactBase unexpectedly rejected test atoms");
  return base;
}

function headKey(atom: Atom): string | undefined {
  return atom.kind === "expr" && atom.items.length > 0 && atom.items[0]!.kind === "sym"
    ? atom.items[0]!.name
    : undefined;
}

function argument(atom: Atom, argPos: number): Atom | undefined {
  return atom.kind === "expr" ? atom.items[argPos] : undefined;
}

function isNumeric(atom: Atom): boolean {
  return atom.kind === "gnd" && (atom.value.g === "int" || atom.value.g === "float");
}

function numericSelfComparable(atom: Atom): boolean {
  const c = compareNumbers(atom, atom);
  return c !== undefined && !Number.isNaN(c);
}

function equalValue(a: Atom, b: Atom): boolean {
  if (isNumeric(a) && isNumeric(b)) {
    const c = compareNumbers(a, b);
    return c === 0;
  }
  return atomEq(a, b);
}

function expectedEqual(
  atoms: readonly Atom[],
  wantedHead: string,
  argPos: number,
  value: Atom,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]!;
    const arg = argument(atom, argPos);
    if (headKey(atom) === wantedHead && arg !== undefined && equalValue(arg, value)) out.push(i);
  }
  return out;
}

function validBound(bound: Atom | undefined): boolean {
  if (bound === undefined) return true;
  return numericSelfComparable(bound);
}

function passesBound(
  value: Atom,
  bound: Atom | undefined,
  inclusive: boolean,
  side: "low" | "high",
): boolean {
  if (bound === undefined) return true;
  const c = compareNumbers(value, bound);
  if (c === undefined || Number.isNaN(c)) return false;
  return side === "low" ? (inclusive ? c >= 0 : c > 0) : inclusive ? c <= 0 : c < 0;
}

function expectedNumericRange(
  atoms: readonly Atom[],
  wantedHead: string,
  argPos: number,
  low: Atom | undefined,
  high: Atom | undefined,
  incLow: boolean,
  incHigh: boolean,
): readonly number[] | undefined {
  let present = 0;
  for (const atom of atoms) {
    if (headKey(atom) !== wantedHead) continue;
    const arg = argument(atom, argPos);
    if (arg === undefined) continue;
    present += 1;
    if (!isNumeric(arg)) return undefined;
  }
  if (present === 0) return undefined;
  if (!validBound(low) || !validBound(high)) return [];

  const out: number[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]!;
    const arg = argument(atom, argPos);
    if (
      headKey(atom) === wantedHead &&
      arg !== undefined &&
      numericSelfComparable(arg) &&
      passesBound(arg, low, incLow, "low") &&
      passesBound(arg, high, incHigh, "high")
    )
      out.push(i);
  }
  return out;
}

function expectEqualProbe(
  base: StaticCompactBase,
  atoms: readonly Atom[],
  wantedHead: string,
  argPos: number,
  value: Atom,
): void {
  const expected = expectedEqual(atoms, wantedHead, argPos, value);
  expect(base.equalRange(wantedHead, argPos, value)).toEqual(expected);
  expect(base.bucketSize(wantedHead, argPos, value)).toBe(expected.length);
}

function expectRangeProbe(
  base: StaticCompactBase,
  atoms: readonly Atom[],
  wantedHead: string,
  argPos: number,
  low: Atom | undefined,
  high: Atom | undefined,
  incLow: boolean,
  incHigh: boolean,
): void {
  expect(base.numericRange(wantedHead, argPos, low, high, incLow, incHigh)).toEqual(
    expectedNumericRange(atoms, wantedHead, argPos, low, high, incLow, incHigh),
  );
}

describe("StaticCompactBase encoding", () => {
  it("round-trips every fact by format and keeps source-order head ids", () => {
    const atoms = [
      A(sym("edge"), gint(1), sym("a"), gstr("left"), gbool(true)),
      A(sym("other"), gfloat(1.5), sym("z")),
      A(sym("edge"), gint(2), sym("b"), gstr("right"), gbool(false)),
      A(sym("edge"), gint(2), sym("b"), gstr("right"), gbool(false)),
    ];
    const base = mustBase(atoms);

    expect(base.size).toBe(atoms.length);
    expect([...base.factsForHead("edge").ids()]).toEqual([0, 2, 3]);
    expect(base.factsForHead("edge").count).toBe(3);
    expect([...base.factsForHead("missing").ids()]).toEqual([]);
    for (let i = 0; i < atoms.length; i++) expect(format(base.factAtom(i))).toBe(format(atoms[i]!));
  });

  it("rejects grounded behavior and facts outside the supported symbol-headed expression shape", () => {
    const plus = stdTable().get("+");
    if (plus === undefined) throw new Error("stdTable did not register +");
    const op = gnd({ g: "ext", kind: "operation", id: "+" }, sym("Grounded"), (args) => {
      const result = plus(args);
      return result.tag === "ok" ? result.results : [];
    });
    const good = A(sym("ok"), gint(1));

    expect(StaticCompactBase.fromAtoms([good, A(sym("bad"), op)])).toBeUndefined();
    expect(StaticCompactBase.fromAtoms([good, sym("bare")])).toBeUndefined();
    expect(StaticCompactBase.fromAtoms([good, A(variable("h"), gint(1))])).toBeUndefined();
    expect(StaticCompactBase.fromAtoms([good, A(A(sym("head")), gint(1))])).toBeUndefined();
    expect(StaticCompactBase.fromAtoms([good, A()])).toBeUndefined();
  });

  it("throws on out-of-range fact ids", () => {
    const base = mustBase([A(sym("edge"), gint(1))]);
    expect(() => base.factAtom(-1)).toThrow(RangeError);
    expect(() => base.factAtom(1)).toThrow(RangeError);
  });
});

describe("StaticCompactBase equality probes", () => {
  const atoms = [
    A(sym("edge"), gint(1), gint(2), sym("a"), gstr("left"), gbool(true)),
    A(sym("edge"), gint(2), gfloat(2), sym("a"), gstr("left"), gbool(false)),
    A(sym("edge"), gint(2), gfloat(2), sym("a"), gstr("left"), gbool(false)),
    A(sym("edge"), gint(3), gint(-1), sym("b"), gstr("right"), gbool(true)),
    A(sym("edge"), gint(4), gfloat(2.5), sym("c"), gstr("right"), gbool(false)),
    A(sym("other"), gint(2), gfloat(2), sym("a"), gstr("left"), gbool(true)),
    A(sym("edge"), gint(5), gint(BIG_A), sym("huge"), gstr("big"), gbool(true)),
    A(sym("edge"), gint(6), gint(BIG_B), sym("huge"), gstr("big"), gbool(false)),
    A(sym("edge"), gint(7), gfloat(BIG_FLOAT), sym("huge"), gstr("big"), gbool(true)),
  ];
  const base = mustBase(atoms);

  it("matches naive filtering for symbols, strings, bools, duplicates, absent values, and heads", () => {
    for (const [argPos, values] of [
      [1, [gint(2), gint(999)]],
      [2, [gint(2), gfloat(2), gfloat(2.5), sym("not-number")]],
      [3, [sym("a"), sym("missing")]],
      [4, [gstr("left"), gstr("absent")]],
      [5, [gbool(true), gbool(false)]],
    ] as const)
      for (const value of values) expectEqualProbe(base, atoms, "edge", argPos, value);

    expectEqualProbe(base, atoms, "missing", 1, gint(2));
    expectEqualProbe(base, atoms, "edge", 99, gint(2));
  });

  it("uses the int/float equality bucket and preserves multiplicity", () => {
    expect(base.equalRange("edge", 2, gint(2))).toEqual([0, 1, 2]);
    expect(base.equalRange("edge", 2, gfloat(2))).toEqual([0, 1, 2]);
    expect(base.bucketSize("edge", 2, gfloat(2))).toBe(3);
  });

  it("keeps huge-int exactness when a Float64 key would collide", () => {
    expectEqualProbe(base, atoms, "edge", 2, gint(BIG_A));
    expectEqualProbe(base, atoms, "edge", 2, gint(BIG_B));
    expectEqualProbe(base, atoms, "edge", 2, gfloat(BIG_FLOAT));
    expect(base.equalRange("edge", 2, gint(BIG_A))).toEqual([6, 8]);
    expect(base.equalRange("edge", 2, gint(BIG_B))).toEqual([7, 8]);
    expect(base.equalRange("edge", 2, gfloat(BIG_FLOAT))).toEqual([6, 7, 8]);
  });
});

describe("StaticCompactBase numeric range probes", () => {
  const atoms = [
    A(sym("edge"), gint(1), gint(-5)),
    A(sym("edge"), gint(2), gfloat(-1.5)),
    A(sym("edge"), gint(3), gint(0)),
    A(sym("edge"), gint(4), gint(2)),
    A(sym("edge"), gint(5), gfloat(2)),
    A(sym("edge"), gint(6), gint(10)),
    A(sym("edge"), gint(7), gfloat(Number.NaN)),
    A(sym("edge"), gint(8), gint(BIG_A)),
    A(sym("edge"), gint(9), gint(BIG_B)),
    A(sym("edge"), gint(10), gfloat(BIG_FLOAT)),
  ];
  const base = mustBase(atoms);

  it("matches naive compareNumbers filtering for common range shapes", () => {
    expectRangeProbe(base, atoms, "edge", 2, gint(-2), gint(3), true, false);
    expectRangeProbe(base, atoms, "edge", 2, gfloat(-1.5), undefined, true, false);
    expectRangeProbe(base, atoms, "edge", 2, undefined, gint(2), false, true);
    expectRangeProbe(base, atoms, "edge", 2, gint(2), gint(2), true, true);
    expectRangeProbe(base, atoms, "edge", 2, gint(2), gint(2), false, false);
    expectRangeProbe(base, atoms, "edge", 2, undefined, undefined, false, false);
    expectRangeProbe(base, atoms, "edge", 2, gint(100), gint(200), true, true);
  });

  it("excludes NaN values and treats invalid bounds as an empty range", () => {
    expect(base.numericRange("edge", 2, undefined, undefined, false, false)).not.toContain(6);
    expectRangeProbe(base, atoms, "edge", 2, gfloat(Number.NaN), undefined, true, false);
    expectRangeProbe(base, atoms, "edge", 2, undefined, gfloat(Number.NaN), false, true);
  });

  it("uses the exact fallback when unsafe bigints share a Float64 key with floats", () => {
    expectRangeProbe(base, atoms, "edge", 2, gint(BIG_A), gint(BIG_B), true, true);
    expect(base.numericRange("edge", 2, gint(BIG_A), gint(BIG_B), true, true)).toEqual([7, 8, 9]);
  });

  it("returns undefined for non-numeric columns", () => {
    const mixed = mustBase([
      A(sym("edge"), gint(1), gint(2)),
      A(sym("edge"), gint(2), sym("not-number")),
    ]);
    expect(mixed.numericRange("edge", 2, undefined, undefined, false, false)).toBeUndefined();
    expect(mixed.numericRange("missing", 2, undefined, undefined, false, false)).toBeUndefined();
  });
});

describe("StaticCompactBase random differential (fast-check)", () => {
  const smallInt = fc.integer({ min: -20, max: 20 }).map(gint);
  const smallFloat = fc.integer({ min: -20, max: 20 }).map((n) => gfloat(n + 0.5));
  const numericLeaf = fc.oneof(
    smallInt,
    smallFloat,
    fc.constant(gfloat(Number.NaN)),
    fc.constant(gint(BIG_A)),
    fc.constant(gint(BIG_B)),
    fc.constant(gfloat(BIG_FLOAT)),
  );
  const leaf = fc.oneof(
    numericLeaf,
    fc.constantFrom("a", "b", "c", "huge").map(sym),
    fc.constantFrom("left", "right", "").map(gstr),
    fc.boolean().map(gbool),
  );
  const head = fc.constantFrom("edge", "rel", "tag");
  const fact = fc
    .tuple(head, fc.array(leaf, { minLength: 1, maxLength: 4 }))
    .map(([h, args]) => A(sym(h), ...args));

  it("matches naive equality/range filters and decode for random compact facts", () => {
    fc.assert(
      fc.property(
        fc.array(fact, { minLength: 0, maxLength: 80 }),
        fc.constantFrom("edge", "rel", "tag", "missing"),
        fc.integer({ min: 1, max: 4 }),
        leaf,
        fc.option(numericLeaf, { nil: undefined }),
        fc.option(numericLeaf, { nil: undefined }),
        fc.boolean(),
        fc.boolean(),
        (atoms, wantedHead, argPos, value, low, high, incLow, incHigh) => {
          const base = mustBase(atoms);
          for (let i = 0; i < atoms.length; i++)
            expect(format(base.factAtom(i))).toBe(format(atoms[i]!));
          expect(base.equalRange(wantedHead, argPos, value)).toEqual(
            expectedEqual(atoms, wantedHead, argPos, value),
          );
          expect(base.bucketSize(wantedHead, argPos, value)).toBe(
            expectedEqual(atoms, wantedHead, argPos, value).length,
          );
          expect(base.numericRange(wantedHead, argPos, low, high, incLow, incHigh)).toEqual(
            expectedNumericRange(atoms, wantedHead, argPos, low, high, incLow, incHigh),
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
