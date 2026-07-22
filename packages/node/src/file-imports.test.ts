// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { format } from "@mettascript/core";
import { runFile } from "./index";

const fixtureDirs: string[] = [];

function fixture(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "mettascript-imports-"));
  fixtureDirs.push(dir);
  for (const [relativePath, source] of Object.entries(files)) {
    const path = join(dir, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return join(dir, "index.metta");
}

function printed(path: string): string[][] {
  return runFile(path).map((group) => group.results.map(format));
}

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("file import parity", () => {
  it("resolves a caller imported before its callee definition", () => {
    const path = fixture({
      "index.metta": `
        !(import! &self uses)
        !(import! &self defines)
        !(import-order-caller)
      `,
      "uses.metta": "(= (import-order-caller) (import-order-callee))\n",
      "defines.metta": "(= (import-order-callee) import-order-ok)\n",
    });

    expect(printed(path).at(-1)).toEqual(["import-order-ok"]);
  });

  it("loads the transitive definition closure", () => {
    const path = fixture({
      "index.metta": "!(import! &self a)\n!(a-fn)\n",
      "a.metta": `
        !(import! &self (library b))
        (= (a-fn) (b-fn))
      `,
      "b.metta": "(= (b-fn) b-ok)\n",
    });

    expect(printed(path).at(-1)).toEqual(["b-ok"]);
  });

  it("treats duplicate canonical module imports as a no-op", () => {
    const path = fixture({
      "index.metta": `
        !(import! &self duplicate)
        !(import! &self "./duplicate.metta")
        !(duplicate-result)
      `,
      "duplicate.metta": "(= (duplicate-result) loaded-once)\n",
    });

    expect(printed(path).at(-1)).toEqual(["loaded-once"]);
  });

  it("terminates cyclic imports and resolves cross-module calls", () => {
    const path = fixture({
      "index.metta": "!(import! &self a)\n!(a-fn)\n!(b-fn)\n",
      "a.metta": `
        !(import! &self b)
        (= (a-fn) (b-value))
        (= (a-value) cycle-a)
      `,
      "b.metta": `
        !(import! &self ./a.metta)
        (= (b-fn) (a-value))
        (= (b-value) cycle-b)
      `,
    });

    expect(printed(path).slice(-2)).toEqual([["cycle-b"], ["cycle-a"]]);
  });

  it("does not execute module bangs or follow computed import targets", () => {
    const path = fixture({
      "index.metta": `
        !(import! &self a)
        !(through-computed)
        !(side-effect)
      `,
      "a.metta": `
        !(import! &self (module-name))
        !(add-atom &self (= (side-effect) ran))
        (= (module-name) nested)
        (= (through-computed) (nested-fn))
      `,
      "nested.metta": "(= (nested-fn) should-not-load)\n",
    });

    expect(printed(path).slice(-2)).toEqual([["(nested-fn)"], ["(side-effect)"]]);
  });

  it("keeps a readable module when one of its nested imports is malformed", () => {
    const path = fixture({
      "index.metta": "!(import! &self a)\n!(a-result)\n",
      "a.metta": "!(import! &self broken)\n(= (a-result) a-ok)\n",
      "broken.metta": "(",
    });

    expect(printed(path).at(-1)).toEqual(["a-ok"]);
  });
});
