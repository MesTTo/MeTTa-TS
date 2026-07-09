// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Atom } from "./atom";
import { createSampleRepo, hasGit } from "./git-test-utils";
import { format, parseAll } from "./parser";
import { runProgram, standardTokenizer } from "./runner";

const printed = (src: string): string[][] => runProgram(src).map((q) => q.results.map(format));

const moduleAtoms = (src: string): Atom[] =>
  parseAll(src, standardTokenizer())
    .filter((top) => !top.bang)
    .map((top) => top.atom);

const gitIt = hasGit() ? it : it.skip;

describe("git built-in module", () => {
  gitIt("shallow-clones a local repository once and leaves it importable", () => {
    const dir = mkdtempSync(join(tmpdir(), "metta-ts-git-import-"));
    const origin = join(dir, "sample-lib");
    const runtime = join(dir, "runtime");
    const originalCwd = process.cwd();
    try {
      createSampleRepo(origin);
      mkdirSync(runtime);

      process.chdir(runtime);
      const first = printed(`
				!(import! &self git)
				!(git-import! ${JSON.stringify(origin)})
			`);
      const cloneDir = join(runtime, "repos", "sample-lib");
      const clonedMetta = join(cloneDir, "sample-lib.metta");
      expect(first[1]).toEqual(["()"]);
      expect(existsSync(clonedMetta)).toBe(true);
      expect(readFileSync(clonedMetta, "utf8")).toContain("(= (sample-lib-answer) 42)");

      const marker = join(cloneDir, "idempotent-marker.txt");
      writeFileSync(marker, "kept");
      const second = printed(`
				!(import! &self git)
				!(git-import! ${JSON.stringify(origin)})
			`);
      expect(second[1]).toEqual(["()"]);
      expect(readFileSync(marker, "utf8")).toBe("kept");

      const customBase = join(runtime, "vendor");
      const custom = printed(`
				!(import! &self git)
				!(git-import! ${JSON.stringify(origin)} ${JSON.stringify(customBase)})
			`);
      expect(custom[1]).toEqual(["()"]);
      expect(existsSync(join(customBase, "sample-lib", "sample-lib.metta"))).toBe(true);

      const imports = new Map([["sample-lib", moduleAtoms(readFileSync(clonedMetta, "utf8"))]]);
      const imported = runProgram(
        "!(import! &self (library sample-lib))\n!(sample-lib-answer)",
        100_000,
        imports,
      ).map((q) => q.results.map(format));
      expect(imported.at(-1)).toEqual(["42"]);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports git-import! documentation", () => {
    const out = printed(`
			!(import! &self git)
			!(get-doc git-import!)
		`);
    const doc = out[1]![0]!;
    expect(doc).toMatch(/^\(@doc-formal /);
    expect(doc).toContain("(@item git-import!)");
    expect(doc).toContain("(@kind function)");
  });
});
