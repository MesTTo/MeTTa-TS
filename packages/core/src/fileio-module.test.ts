// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { format } from "./parser";
import { runProgram } from "./runner";

const printed = (src: string): string[][] => runProgram(src).map((q) => q.results.map(format));

const fileioOps = [
  "file-open!",
  "file-close!",
  "file-read-to-string!",
  "file-read-exact!",
  "file-write!",
  "file-seek!",
  "file-get-size!",
] as const;

describe("fileio built-in module", () => {
  it("writes, seeks, reads, and reports size through a FileHandle", () => {
    const dir = mkdtempSync(join(tmpdir(), "metta-ts-fileio-"));
    const path = join(dir, "roundtrip.txt");
    try {
      const out = printed(`
				!(import! &self fileio)
				!(bind! &fh (file-open! ${JSON.stringify(path)} "cwt"))
				!(get-type &fh)
				!(file-write! &fh "hello")
				!(file-seek! &fh 0)
				!(file-read-exact! &fh 2)
        !(file-read-to-string! &fh)
        !(file-seek! &fh 0)
        !(file-read-to-string! &fh)
        !(file-get-size! &fh)
        !(file-close! &fh)
        !(file-read-to-string! &fh)
        !(file-close! &fh)
      `);

      expect(out[1]).toEqual(["()"]);
      expect(out[2]).toEqual(["FileHandle"]);
      expect(out[3]).toEqual(["()"]);
      expect(out[4]).toEqual(["()"]);
      expect(out[5]).toEqual(['"he"']);
      expect(out[6]).toEqual(['"llo"']);
      expect(out[7]).toEqual(["()"]);
      expect(out[8]).toEqual(['"hello"']);
      expect(out[9]).toEqual(["5"]);
      expect(out[10]).toEqual(["()"]);
      expect(out[11]![0]).toContain("file-read-to-string! expects one FileHandle");
      expect(out[12]![0]).toContain("FileHandle is already closed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports FileHandle types and documentation for every file operation", () => {
    const out = printed(`
      !(import! &self fileio)
      !(get-type FileHandle)
      !(get-type file-open!)
      ${fileioOps.map((name) => `!(get-doc ${name})`).join("\n")}
    `);

    expect(out[1]).toEqual(["Type"]);
    expect(out[2]).toEqual(["(-> String String FileHandle)"]);
    for (const [i, name] of fileioOps.entries()) {
      const doc = out[i + 3]![0]!;
      expect(doc).toMatch(/^\(@doc-formal /);
      expect(doc).toContain(`(@item ${name})`);
      expect(doc).toContain("(@kind function)");
    }
  });

  it("keeps a handle usable after a flat atomspace round trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "metta-ts-fileio-space-"));
    const path = join(dir, "stored-handle.txt");
    try {
      const out = printed(`
        !(import! &self fileio)
        !(let $handle (file-open! ${JSON.stringify(path)} "cwt")
          (let $added (add-atom &self (saved-handle $handle))
            (match &self (saved-handle $copy) (file-write! $copy "stored"))))
        !(match &self (saved-handle $copy) (file-close! $copy))
      `);

      expect(out[1]).toEqual(["()"]);
      expect(out[2]).toEqual(["()"]);
      expect(readFileSync(path, "utf8")).toBe("stored");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
