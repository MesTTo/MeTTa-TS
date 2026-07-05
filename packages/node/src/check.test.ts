// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkFile } from "./check";

function fixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "metta-check-"));
  const file = join(dir, "prog.metta");
  writeFileSync(file, content);
  return file;
}

describe("checkFile", () => {
  it("exits 0 with no output on a clean file", () => {
    const r = checkFile(fixture("!(car-atom (a b))"), { json: false, undefinedSymbols: false });
    expect(r.exitCode).toBe(0);
    expect(r.text).toBe("");
  });

  it("exits 1 and renders on an arity error", () => {
    const r = checkFile(fixture("!(car-atom 1 2)"), { json: false, undefinedSymbols: false });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("error[arity-mismatch]");
    expect(r.text).toContain("car-atom expects 1 argument, got 2");
  });

  it("emits valid JSON with --json", () => {
    const r = checkFile(fixture("!(car-atom 1 2)"), { json: true, undefinedSymbols: false });
    const parsed = JSON.parse(r.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].code).toBe("arity-mismatch");
  });
});
