// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { expr, gnd, sym, variable } from "./atom";
import { containsOpaqueApplication, scanReductionDependencies } from "./reduction-dependency";

describe("reduction dependency analysis", () => {
  it("collects expression heads and reducible bare symbols but not constructor data", () => {
    const rules = new Set(["reducible"]);
    const scan = scanReductionDependencies(
      [expr([sym("outer"), sym("reducible"), sym("constructor"), expr([sym("inner")])])],
      (name) => rules.has(name),
    );

    expect([...scan.names].sort()).toEqual(["inner", "outer", "reducible"]);
    expect(scan.hasDynamicApplication).toBe(false);
  });

  it("distinguishes rule-input callees from local binding-pattern variables", () => {
    const localPair = expr([variable("local"), expr([sym("work")])]);
    const body = expr([
      sym("let*"),
      expr([localPair]),
      expr([variable("function"), sym("argument")]),
    ]);

    expect(containsOpaqueApplication(body)).toBe(true);
    expect(containsOpaqueApplication(expr([sym("let*"), expr([localPair]), sym("done")]))).toBe(
      false,
    );
  });

  it("treats an executable grounded head as opaque", () => {
    const executable = gnd({ g: "ext", kind: "test", id: "executor" }, sym("Grounded"), () => []);
    expect(containsOpaqueApplication(expr([executable, sym("argument")]))).toBe(true);
  });

  it("finds every generated reducible symbol regardless of nesting", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/), {
          minLength: 1,
          maxLength: 12,
        }),
        (names) => {
          const ruleNames = new Set(names.filter((_, index) => index % 2 === 0));
          const nested = names.reduceRight(
            (tail, name) => expr([sym("node"), sym(name), tail]),
            sym("end") as ReturnType<typeof sym> | ReturnType<typeof expr>,
          );
          const scan = scanReductionDependencies([nested], (name) => ruleNames.has(name));
          for (const name of ruleNames) expect(scan.names.has(name)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
