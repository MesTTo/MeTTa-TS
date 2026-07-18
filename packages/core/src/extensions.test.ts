// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The built-in module registry (extensions.ts). The native host modules ship with the engine; the standard
// libraries live in @metta-ts/libraries and are NOT bundled into core, so a bare-core program that imports
// one gets an unresolved module. This is the intended engine/batteries split: registerBuiltinModule adds an
// external module source, native module names are reserved, and the app-layer packages (node/hyperon/browser)
// register @metta-ts/libraries so their users keep the batteries.

import { describe, expect, it } from "vitest";
import { builtinModules, registerBuiltinModule } from "./extensions";
import { runProgram } from "./runner";
import { format } from "./parser";

const NATIVE = ["concurrency", "json", "catalog", "fileio", "git"];
const LIBRARIES = [
  "vector",
  "roman",
  "combinatorics",
  "patrick",
  "datastructures",
  "spaces",
  "nars",
  "pln",
];

describe("built-in module registry", () => {
  it("ships the native host modules but not the extracted standard libraries", () => {
    const names = new Set(builtinModules().keys());
    for (const native of NATIVE) expect(names.has(native)).toBe(true);
    for (const lib of LIBRARIES) expect(names.has(lib)).toBe(false);
  });

  it("leaves a library import unresolved on bare core (the engine carries no batteries)", () => {
    const out = runProgram("!(import! &self vector)\n!(dot (1.0 2.0 3.0) (4.0 5.0 6.0))").map((g) =>
      g.results.map(format),
    );
    // Without the vector library, `dot` has no rule, so it stays an unevaluated expression, not 32.0.
    expect(out.at(-1)).toEqual(["(dot (1.0 2.0 3.0) (4.0 5.0 6.0))"]);
  });

  it("resolves a module registered through registerBuiltinModule", () => {
    registerBuiltinModule("regtest", "(= (regtest-answer) 42)");
    const out = runProgram("!(import! &self regtest)\n!(regtest-answer)").map((g) =>
      g.results.map(format),
    );
    expect(out.at(-1)).toEqual(["42"]);
  });

  it("refuses to shadow a reserved native module name", () => {
    expect(() => registerBuiltinModule("json", "(= (x) 1)")).toThrow(/reserved/);
  });
});
