// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { format } from "./parser";
import { resolveImportGraph, type ResolveModule, type ResolvedModule } from "./import-graph";
import type { ImportMap, ImportModule } from "./eval";

function moduleAt(imports: ImportMap, name: string): ImportModule {
  const entry = imports.get(name);
  if (entry === undefined || Array.isArray(entry)) throw new Error(`missing module ${name}`);
  return entry;
}

describe("resolveImportGraph", () => {
  it("returns an empty map without consulting the host when import! is absent", () => {
    let called = false;
    const imports = resolveImportGraph("(= (answer) 42)", () => {
      called = true;
      return { id: "unexpected" };
    });

    expect([...imports]).toEqual([]);
    expect(called).toBe(false);
  });

  it("collects a transitive graph once, breaks cycles, and retains unloadable edges", () => {
    const moduleA: ResolvedModule = {
      id: "module:a",
      source: `
        !(import! &self b)
        !(import! &self missing)
        !(ignored-side-effect)
        (= (a-value) a)
      `,
      contextId: "context:a",
    };
    const resolutions = new Map<string, ResolvedModule>([
      ["entry:a", moduleA],
      ["entry:alias-a", moduleA],
      ["entry:builtin", { id: "builtin" }],
      [
        "context:a:b",
        {
          id: "module:b",
          source: "!(import! &self a)\n(= (b-value) b)",
          contextId: "context:b",
        },
      ],
      ["context:a:missing", { id: "missing" }],
      ["context:b:a", moduleA],
    ]);
    const calls: Array<readonly [string, string | undefined]> = [];
    const resolveModule: ResolveModule = (name, fromContextId) => {
      calls.push([name, fromContextId]);
      const resolved = resolutions.get(`${fromContextId}:${name}`);
      if (resolved === undefined) throw new Error(`unexpected resolution ${fromContextId}:${name}`);
      return resolved;
    };

    const imports = resolveImportGraph(
      `
        !(import! &self a)
        !(import! &self alias-a)
        !(import! &self builtin)
      `,
      resolveModule,
      "entry",
    );

    expect([...imports.keys()]).toEqual(["module:a", "module:b", "a", "alias-a"]);
    const a = moduleAt(imports, "module:a");
    const b = moduleAt(imports, "module:b");
    expect(a.imports).toEqual(["module:b", "missing"]);
    expect(b.imports).toEqual(["module:a"]);
    expect(a.defs.map(format)).toEqual(["(= (a-value) a)"]);
    expect(b.defs.map(format)).toEqual(["(= (b-value) b)"]);
    expect(imports.get("a")).toBe(a);
    expect(imports.get("alias-a")).toBe(a);
    expect(imports.has("builtin")).toBe(false);
    expect(imports.has("missing")).toBe(false);
    expect(calls).toEqual([
      ["a", "entry"],
      ["b", "context:a"],
      ["a", "context:b"],
      ["missing", "context:a"],
      ["alias-a", "entry"],
      ["builtin", "entry"],
    ]);
  });
});
