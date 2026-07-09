// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// --prolog smoke test. Live execution is gated by PROLOG_LIVE=1; the missing-backend branch is
// deterministic and does not need SWI-Prolog.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cliPath, mettaFixture } from "./cli-test-utils";

const CLI = cliPath(import.meta.url);
const fixture = (content: string): string => mettaFixture("prolog-cli-", content);

const LIVE = process.env.PROLOG_LIVE === "1";
const liveDescribe = LIVE ? describe : describe.skip;

liveDescribe("metta-ts --prolog (live)", () => {
  it("runs callPredicate and import_prolog_function from the command line", () => {
    const out = execFileSync(
      process.execPath,
      [
        CLI,
        "--prolog",
        fixture(`
          !(assertzPredicate (Predicate (hello world)))
          !(import_prolog_function hello)
          !(hello)
        `),
      ],
      { timeout: 120_000 },
    ).toString();
    expect(out).toContain("[world]");
  });

  it("consults PeTTa-style Prolog files through import!", () => {
    const file = fixture(`
      !(import! &self "facts.pl")
      !(prolog-call (edge alice $x))
    `);
    writeFileSync(join(dirname(file), "facts.pl"), "edge(alice, bob).\n");
    const out = execFileSync(process.execPath, [CLI, "--prolog", file], {
      timeout: 120_000,
    }).toString();
    expect(out).toContain("[()]");
    expect(out).toContain("[(edge alice bob)]");
  });

  it("resolves import_prolog_functions_from_file relative to the MeTTa file", () => {
    const file = fixture(`
      !(import_prolog_functions_from_file "sample.pl" (myfunc))
      !(myfunc 41)
    `);
    writeFileSync(join(dirname(file), "sample.pl"), "myfunc(X,Y) :- Y is X+1.\n");
    const out = execFileSync(process.execPath, [CLI, "--prolog", file], {
      timeout: 120_000,
    }).toString();
    expect(out).toContain("[42]");
  });

  it("falls back to process cwd for PeTTa-style Prolog paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "metta-prolog-cwd-"));
    const file = fixture(`
      !(import_prolog_functions_from_file "./cwd_sample.pl" (cwdfunc))
      !(cwdfunc 41)
    `);
    writeFileSync(join(cwd, "cwd_sample.pl"), "cwdfunc(X,Y) :- Y is X+1.\n");
    const out = execFileSync(process.execPath, [CLI, "--prolog", file], {
      cwd,
      timeout: 120_000,
    }).toString();
    expect(out).toContain("[42]");
  });
});

describe("metta-ts --prolog (no backend)", () => {
  it("fails with an actionable message when SWI-Prolog is unavailable", () => {
    let msg = "";
    try {
      execFileSync(process.execPath, [CLI, "--prolog", fixture("!(prolog-call (hello world))\n")], {
        env: { ...process.env, METTA_TS_FORCE_NO_SWIPL: "1" },
        timeout: 60_000,
      });
    } catch (e) {
      msg = String((e as { stderr?: Buffer }).stderr ?? "");
    }
    expect(msg).toContain("SWI-Prolog");
  });
});
