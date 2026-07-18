// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// @metta-ts/node registers @metta-ts/libraries as a side effect of importing its source runner, so a program
// can `(import! &self <lib>)` with no manual wiring. This is the app-layer half of the engine/batteries split:
// bare @metta-ts/core does not resolve the libraries (see core's extensions.test.ts), but node does.

import { describe, expect, it } from "vitest";
import { format } from "@metta-ts/core";
import { runSource } from "./source";

describe("node auto-registers the standard libraries", () => {
  it("resolves (import! &self vector) with no manual registration", () => {
    const out = runSource("!(import! &self vector)\n!(dot (1.0 2.0 3.0) (4.0 5.0 6.0))").map((g) =>
      g.results.map(format),
    );
    expect(out.at(-1)).toEqual(["32.0"]);
  });

  it("resolves a second library (roman) through the same auto-registration", () => {
    const out = runSource("!(import! &self roman)\n!(fold-flat + 0 (1 2 3 4))").map((g) =>
      g.results.map(format),
    );
    expect(out.at(-1)).toEqual(["10"]);
  });
});
