// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { SymbolAtom, VariableAtom, ExpressionAtom, GroundedAtom } from "@mettascript/hyperon";
import { parseProgram, parseLeaf } from "./parse";

describe("parse", () => {
  it("parses several top-level atoms", () => {
    const atoms = parseProgram("(parent Tom Bob)\n(parent Tom Liz)");
    expect(atoms).toHaveLength(2);
    expect(atoms[0]).toBeInstanceOf(ExpressionAtom);
    expect(atoms[0]!.toString()).toBe("(parent Tom Bob)");
  });

  it("parses nested expressions", () => {
    const [atom] = parseProgram("(+ 10 (* 25 2))");
    expect(atom!.toString()).toBe("(+ 10 (* 25 2))");
  });

  it("parseLeaf reconstructs each leaf kind from its token", () => {
    expect(parseLeaf("foo")).toBeInstanceOf(SymbolAtom);
    expect(parseLeaf("$x")).toBeInstanceOf(VariableAtom);
    expect(parseLeaf("42")).toBeInstanceOf(GroundedAtom);
    expect(parseLeaf("")).toBeUndefined();
  });
});
