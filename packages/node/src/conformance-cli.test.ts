// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cliPath, mettaFixture } from "./cli-test-utils";

const CLI = cliPath(import.meta.url);
const fixture = (content: string): string => mettaFixture("conformance-cli-", content);

describe("metta-ts --conformance", () => {
  it("prints one bracketed result list per top-level directive", () => {
    const out = execFileSync(
      process.execPath,
      [
        CLI,
        "--conformance",
        fixture(`
          (foo 1 2)
          !(match &self (foo $x $y) ($x $y))
        `),
      ],
      { timeout: 60_000 },
    ).toString();

    expect(out).toBe("[]\n[(1 2)]\n");
  });

  it("leaves normal CLI output query-only", () => {
    const file = fixture(`
      (foo 1 2)
      !(match &self (foo $x $y) ($x $y))
    `);

    const out = execFileSync(process.execPath, [CLI, file], { timeout: 60_000 }).toString();

    expect(out).toBe("[(1 2)]\n");
  });

  it("reports type declarations and equations as empty directives", () => {
    const out = execFileSync(
      process.execPath,
      [
        CLI,
        "--conformance",
        fixture(`
          (: f (-> Number Number))
          (= (f $x) (+ $x 1))
          !(f 2)
        `),
      ],
      { timeout: 60_000 },
    ).toString();

    expect(out).toBe("[]\n[]\n[3]\n");
  });

  it("keeps literal Error atoms in the harness result bucket", () => {
    const out = execFileSync(
      process.execPath,
      [CLI, "--conformance", fixture("!(Error foo BadType)")],
      { timeout: 60_000 },
    ).toString();

    expect(out).toBe("[( Error foo BadType)]\n");
  });

  it("leaves normal CLI Error formatting canonical", () => {
    const out = execFileSync(process.execPath, [CLI, fixture("!(Error foo BadType)")], {
      timeout: 60_000,
    }).toString();

    expect(out).toBe("[(Error foo BadType)]\n");
  });
});
