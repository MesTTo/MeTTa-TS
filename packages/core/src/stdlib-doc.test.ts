// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
//
// Every builtin that carries an @doc must produce a full @doc-formal from get-doc — not Empty, not an Error.
// This gate keeps the stdlib documentation honest as builtins are added: a malformed @doc (wrong shape, a
// param/arity mismatch, or an atom that cuts its own branch) fails here instead of silently degrading hovers.

import { describe, expect, it } from "vitest";
import { format } from "./parser";
import { runProgram } from "./runner";
import { STDLIB_SRC } from "./stdlib";

// The concrete names carrying an @doc entry. Excludes the doc-system's own unify patterns like
// `(@doc $name ...)` (a variable head) and the `@doc-formal` constructor.
function documentedNames(): string[] {
  return [...STDLIB_SRC.matchAll(/\(@doc\s+([^\s$)]+)\s/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

function getDoc(name: string): string {
  const last = runProgram(`!(get-doc ${name})`).at(-1);
  return last ? last.results.map(format).join("") : "";
}

describe("stdlib @doc coverage", () => {
  const names = documentedNames();

  it("documents a substantial set of builtins", () => {
    expect(names.length).toBeGreaterThan(100);
  });

  it("every documented builtin returns a full @doc-formal from get-doc", () => {
    const broken = names.filter((name) => !getDoc(name).startsWith("(@doc-formal"));
    expect(broken).toEqual([]);
  });
});
