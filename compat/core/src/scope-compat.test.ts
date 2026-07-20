// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { format as canonicalFormat, runProgram as canonicalRunProgram } from "@mettascript/core";
import { format as compatFormat, runProgram as compatRunProgram } from "@metta-ts/core";
import { composeHostInterops as canonicalComposeHostInterops } from "@mettascript/core/host";
import { composeHostInterops as compatComposeHostInterops } from "@metta-ts/core/host";

describe("scope compatibility shims", () => {
  it("resolves both core scopes to the same implementation", () => {
    expect(compatRunProgram).toBe(canonicalRunProgram);
    expect(compatFormat).toBe(canonicalFormat);

    const source = "(= (double $x) (* 2 $x))\n!(double 21)";
    const canonical = canonicalRunProgram(source)[0]!.results.map(canonicalFormat);
    const compat = compatRunProgram(source)[0]!.results.map(compatFormat);

    expect(compat).toEqual(canonical);
    expect(canonical).toEqual(["42"]);
  });

  it("re-exports subpath symbols from the canonical package", () => {
    expect(compatComposeHostInterops).toBe(canonicalComposeHostInterops);
  });
});
