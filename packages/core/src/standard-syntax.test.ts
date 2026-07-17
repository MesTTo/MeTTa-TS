// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  expr,
  gbool,
  gfloat,
  gint,
  gnd,
  gstr,
  makeVariableId,
  scopedVariable,
  sym,
  variable,
} from "./atom";
import { parseTransportAtom, tryFormatTransportAtom } from "./standard-syntax";
import { RuntimeIdAllocator } from "./trace";

describe("standard source transport", () => {
  it("round-trips the supported value and program atoms", () => {
    const values = [
      sym("safe-name"),
      gint(42),
      gint(9_007_199_254_740_992n),
      gfloat(1.5),
      gstr("quoted\ntext"),
      gbool(true),
      expr([sym("pair"), gint(1), gstr("two")]),
    ];
    for (const value of values) {
      const source = tryFormatTransportAtom(value, "value");
      expect(source).toBeDefined();
      expect(parseTransportAtom(source!, "value")).toEqual(value);
    }
    expect(tryFormatTransportAtom(variable("x"), "program")).toBe("$x");
    expect(parseTransportAtom("$x", "program")?.kind).toBe("var");
  });

  it.each(["True", "False", "123", "1.5", "$x", "A B", ";comment", "()", "!(x)"])(
    "rejects the symbol spelling %j when standard parsing changes its atom kind or shape",
    (name) => {
      expect(tryFormatTransportAtom(sym(name), "value")).toBeUndefined();
    },
  );

  it("rejects values whose grounded behavior or type is not encoded", () => {
    expect(tryFormatTransportAtom(gnd({ g: "int", n: 1 }, sym("Custom")), "value")).toBeUndefined();
    expect(
      tryFormatTransportAtom(
        gnd({ g: "int", n: 1 }, sym("Number"), () => []),
        "value",
      ),
    ).toBeUndefined();
    expect(
      tryFormatTransportAtom(
        gnd({ g: "int", n: 1 }, sym("Number"), undefined, () => []),
        "value",
      ),
    ).toBeUndefined();
    for (const value of [-0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      expect(tryFormatTransportAtom(gfloat(value), "value")).toBeUndefined();
  });

  it("rejects variables in values and scoped variables in programs", () => {
    const scope = new RuntimeIdAllocator("transport-test").next("scope");
    const scoped = scopedVariable("x", makeVariableId(scope, 0));
    expect(tryFormatTransportAtom(variable("x"), "value")).toBeUndefined();
    expect(tryFormatTransportAtom(scoped, "program")).toBeUndefined();
  });

  it.each(["", ";comment", "A B", "!(two)", "$x", " True", "True "])(
    "rejects malformed or noncanonical value source %j",
    (source) => {
      expect(parseTransportAtom(source, "value")).toBeUndefined();
    },
  );

  it("never accepts a symbol source that reparses to a different symbol", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (name) => {
        const source = tryFormatTransportAtom(sym(name), "value");
        if (source === undefined) return;
        const parsed = parseTransportAtom(source, "value");
        expect(parsed?.kind).toBe("sym");
        if (parsed?.kind === "sym") expect(parsed.name).toBe(name);
      }),
      { numRuns: 1_000 },
    );
  });
});
