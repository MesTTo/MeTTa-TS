// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
//
// The catalog module: catalog-list!/update!/clear! manage a minimal in-memory module catalog, and each
// operation carries @doc. catalog-list! prints via the output sink, so the test captures it.

import { describe, expect, it } from "vitest";
import { setOutputSink } from "./builtins";
import { format } from "./parser";
import { runProgram } from "./runner";

function listing(src: string): string[] {
  const out: string[] = [];
  const prev = setOutputSink((line) => out.push(line));
  try {
    runProgram(`!(import! &self catalog)\n${src}`);
    return out;
  } finally {
    setOutputSink(prev);
  }
}

function getDoc(name: string): string {
  const last = runProgram(`!(import! &self catalog)\n!(get-doc ${name})`).at(-1);
  return last ? last.results.map(format).join("") : "";
}

describe("catalog module", () => {
  it("lists the built-in catalog and clears it", () => {
    expect(listing("!(catalog-list! all)")).toEqual(["builtin: concurrency, json, catalog, git"]);
    expect(listing("!(catalog-clear! builtin)\n!(catalog-list! all)")).toEqual(["builtin: "]);
  });

  it("documents each catalog operation", () => {
    for (const name of ["catalog-list!", "catalog-update!", "catalog-clear!"])
      expect(getDoc(name).startsWith("(@doc-formal")).toBe(true);
  });
});
