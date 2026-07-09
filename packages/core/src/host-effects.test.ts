// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSampleRepo, hasGit } from "./git-test-utils";
import { format, runProgram, setHostEffectsEnabled } from "./index";

const printed = (src: string): string[][] => runProgram(src).map((q) => q.results.map(format));

afterEach(() => {
  setHostEffectsEnabled(true);
});

describe("host effect capability gate", () => {
  it("blocks fileio effects when disabled even after the host fs is cached", () => {
    const dir = mkdtempSync(join(tmpdir(), "metta-ts-host-effects-"));
    const cacheProbe = join(dir, "cache-probe.txt");
    const blockedPath = join(dir, "blocked.txt");
    const restoredPath = join(dir, "restored.txt");
    try {
      setHostEffectsEnabled(true);
      const probe = printed(`
				!(import! &self fileio)
				!(file-open! ${JSON.stringify(cacheProbe)} "cwt")
			`);
      expect(probe[1]![0]!).not.toContain("(Error ");
      expect(existsSync(cacheProbe)).toBe(true);

      setHostEffectsEnabled(false);
      const blocked = printed(`
				!(import! &self fileio)
				!(file-open! ${JSON.stringify(blockedPath)} "cwt")
			`);
      expect(blocked[1]![0]!).toContain("(Error (file-open!");
      expect(blocked[1]![0]!).toContain("file IO requires a host file system");
      expect(existsSync(blockedPath)).toBe(false);

      setHostEffectsEnabled(true);
      const restored = printed(`
				!(import! &self fileio)
				!(file-open! ${JSON.stringify(restoredPath)} "cwt")
			`);
      expect(restored[1]![0]!).not.toContain("(Error ");
      expect(existsSync(restoredPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const gitIt = hasGit() ? it : it.skip;

  gitIt("blocks git imports when disabled even after the git host is cached", () => {
    const dir = mkdtempSync(join(tmpdir(), "metta-ts-host-effects-git-"));
    const origin = join(dir, "sample-lib");
    const runtime = join(dir, "runtime");
    const cacheBase = join(runtime, "cache");
    const cloneDir = join(runtime, "repos", "sample-lib");
    const originalCwd = process.cwd();
    try {
      createSampleRepo(origin);
      mkdirSync(runtime);
      process.chdir(runtime);

      setHostEffectsEnabled(true);
      const probe = printed(`
				!(import! &self git)
				!(git-import! ${JSON.stringify(origin)} ${JSON.stringify(cacheBase)})
			`);
      expect(probe[1]).toEqual(["()"]);
      expect(readFileSync(join(cacheBase, "sample-lib", "sample-lib.metta"), "utf8")).toContain(
        "(= (sample-lib-answer) 42)",
      );

      setHostEffectsEnabled(false);
      const blocked = printed(`
				!(import! &self git)
				!(git-import! ${JSON.stringify(origin)})
			`);
      expect(blocked[1]![0]!).toContain("(Error (git-import!");
      expect(blocked[1]![0]!).toContain("git-import! requires node:child_process and node:fs");
      expect(existsSync(cloneDir)).toBe(false);

      setHostEffectsEnabled(true);
      const restored = printed(`
				!(import! &self git)
				!(git-import! ${JSON.stringify(origin)})
			`);
      expect(restored[1]).toEqual(["()"]);
      expect(readFileSync(join(cloneDir, "sample-lib.metta"), "utf8")).toContain(
        "(= (sample-lib-answer) 42)",
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
