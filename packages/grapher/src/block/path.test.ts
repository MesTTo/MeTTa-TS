// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { MeTTa } from "@mettascript/hyperon";
import { parseProgram } from "../parse";
import { atomAtPath, replaceAtPath, reduceAtPath } from "./path";

const atom = (src: string) => parseProgram(src)[0]!;

describe("atomAtPath", () => {
  it("addresses a subterm by child indices", () => {
    // (+ 10 (* 25 2)) -> path [2] is (* 25 2), [2,1] is 25
    const a = atom("(+ 10 (* 25 2))");
    expect(atomAtPath(a, [])!.toString()).toBe("(+ 10 (* 25 2))");
    expect(atomAtPath(a, [2])!.toString()).toBe("(* 25 2)");
    expect(atomAtPath(a, [2, 1])!.toString()).toBe("25");
  });

  it("returns null off the tree", () => {
    const a = atom("(+ 1 2)");
    expect(atomAtPath(a, [9])).toBeNull();
    expect(atomAtPath(a, [1, 0])).toBeNull(); // 1 is a leaf
  });
});

describe("replaceAtPath", () => {
  it("splices a replacement in and leaves the rest intact", () => {
    const a = atom("(+ 10 (* 25 2))");
    const out = replaceAtPath(a, [2], atom("50"));
    expect(out.toString()).toBe("(+ 10 50)");
  });

  it("replaces the whole atom on an empty path", () => {
    expect(replaceAtPath(atom("x"), [], atom("y")).toString()).toBe("y");
  });
});

describe("reduceAtPath", () => {
  it("reduces just the addressed redex in place", () => {
    const m = new MeTTa();
    // reduce (* 25 2) inside (+ 10 (* 25 2)) -> (+ 10 50)
    const out = reduceAtPath(atom("(+ 10 (* 25 2))"), [2], m);
    expect(out!.toString()).toBe("(+ 10 50)");
  });

  it("is null when the addressed subterm is already normal", () => {
    const m = new MeTTa();
    expect(reduceAtPath(atom("(+ 10 (* 25 2))"), [1], m)).toBeNull(); // 10 is normal
  });
});
