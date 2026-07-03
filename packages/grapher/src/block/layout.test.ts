// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { parseProgram } from "../parse";
import { makeSettings } from "./settings";
import { layoutAtom, placeProgram, type BlockBox } from "./layout";

const S = makeSettings(17, 10); // unitWidth 10 keeps the arithmetic easy to read
const atom = (src: string) => parseProgram(src)[0]!;
const box = (src: string) => layoutAtom(atom(src), S);

/** Every box in the subtree. */
function all(b: BlockBox): BlockBox[] {
  return b.kind === "expr" ? [b, ...b.children.flatMap(all)] : [b];
}

describe("layoutAtom leaves", () => {
  it("sizes a number and colors it as a literal", () => {
    const b = box("42");
    expect(b.kind).toBe("atom");
    expect(b.w).toBe(20); // two chars
    if (b.kind === "atom") expect(b.color).toBe(S.literalColor);
  });

  it("draws a variable as a hole", () => {
    const b = box("$n");
    expect(b.kind).toBe("hole");
    if (b.kind === "hole") expect(b.text).toBe("$n");
  });

  it("colors a bare symbol as an identifier", () => {
    const b = box("Tom");
    if (b.kind === "atom") expect(b.color).toBe(S.identifierColor);
  });
});

describe("layoutAtom rows", () => {
  it("lays a small application out horizontally with an operator head", () => {
    const b = box("(+ 1 2)");
    expect(b.kind).toBe("expr");
    if (b.kind !== "expr") return;
    expect(b.orient).toBe("h");
    expect(b.children).toHaveLength(3);
    const head = b.children[0]!;
    expect(head.kind).toBe("atom");
    if (head.kind === "atom") {
      expect(head.text).toBe("+"); // + has no distinct glyph
      expect(head.color).toBe(S.operatorColor);
    }
    // children are placed left to right without overlap
    expect(b.children[1]!.x).toBeLessThan(b.children[2]!.x);
  });

  it("keeps a small if on one line", () => {
    const b = box("(if (> 1 0) a b)");
    if (b.kind === "expr") expect(b.orient).toBe("h");
  });
});

describe("layoutAtom stacking", () => {
  it("stacks a wide rule definition, head and lhs on the first line", () => {
    const b = box("(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))");
    expect(b.kind).toBe("expr");
    if (b.kind !== "expr") return;
    expect(b.orient).toBe("v");
    // = , (fact $n) , (if ...)
    expect(b.children).toHaveLength(3);
    // one profile row for the header, one for the single body child
    expect(b.rightProfile).toHaveLength(2);
    // the body child sits below the header
    const header = b.children[1]!;
    const body = b.children[2]!;
    expect(body.y).toBeGreaterThan(header.y);
    // the branch is itself stacked
    expect(body.kind).toBe("expr");
    if (body.kind === "expr") expect(body.orient).toBe("v");
  });

  it("stacks a collecting form with the head alone on the first line", () => {
    // case has the head alone (cond-like): header profile row is just the head width.
    const b = box("(case (foo bar baz) ((1 one) (2 two) (3 three) (4 four) (5 five)))");
    if (b.kind === "expr") {
      expect(b.orient).toBe("v");
      // flush left (straight-left), so the left profile is all zero
      expect(b.leftProfile.every((r) => r.x === 0)).toBe(true);
    }
  });
});

describe("placeProgram", () => {
  it("stacks heads down the canvas and keeps every coordinate finite", () => {
    const atoms = parseProgram("(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))\n(fact 5)");
    const boxes = placeProgram(atoms, S);
    expect(boxes).toHaveLength(2);
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
    for (const root of boxes)
      for (const b of all(root))
        expect(
          Number.isFinite(b.x) &&
            Number.isFinite(b.y) &&
            Number.isFinite(b.w) &&
            Number.isFinite(b.h),
        ).toBe(true);
  });

  it("gives each head its index as the root of every path", () => {
    const atoms = parseProgram("(foo 1)\n(bar 2)");
    const boxes = placeProgram(atoms, S);
    for (const b of all(boxes[0]!)) expect(b.path[0]).toBe(0);
    for (const b of all(boxes[1]!)) expect(b.path[0]).toBe(1);
  });
});
