// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import type { Atom } from "./atom";
import { literalImportTarget, type ImportMap, type ImportModule } from "./eval";
import { parseAll } from "./parser";
import { standardTokenizer } from "./runner";

interface ParsedModule {
  readonly defs: Atom[];
  readonly imports: string[];
}

export interface ResolvedModule {
  /** Canonical identity used for graph edges, deduplication, and cycle detection. */
  readonly id: string;
  /** Source text for a readable module. Unloadable modules omit this field. */
  readonly source?: string;
  /** Host-defined context used to resolve this module's nested imports. */
  readonly contextId?: string;
}

export type ResolveModule = (name: string, fromContextId: string | undefined) => ResolvedModule;

function parseModule(src: string): ParsedModule {
  const defs: Atom[] = [];
  const imports: string[] = [];
  for (const top of parseAll(src, standardTokenizer())) {
    if (top.bang) {
      const name = literalImportTarget(top.atom);
      if (name !== undefined) imports.push(name);
    } else {
      defs.push(top.atom);
    }
  }
  return { defs, imports };
}

/** Resolve the readable transitive import graph without assuming how modules are stored. */
export function resolveImportGraph(
  entrySrc: string,
  resolveModule: ResolveModule,
  entryContextId?: string,
): ImportMap {
  const imports: ImportMap = new Map();
  if (!entrySrc.includes("import!")) return imports;
  const visited = new Set<string>();

  const collectModule = (resolved: ResolvedModule): void => {
    if (resolved.source === undefined || visited.has(resolved.id)) return;
    visited.add(resolved.id);
    let parsed: ParsedModule;
    try {
      parsed = parseModule(resolved.source);
    } catch {
      return;
    }
    const nested: string[] = [];
    const module: ImportModule = { id: resolved.id, defs: parsed.defs, imports: nested };
    imports.set(resolved.id, module);
    for (const name of parsed.imports) {
      const child = resolveModule(name, resolved.contextId);
      nested.push(child.id);
      collectModule(child);
    }
  };

  for (const name of parseModule(entrySrc).imports) {
    const resolved = resolveModule(name, entryContextId);
    if (resolved.source === undefined) continue;
    collectModule(resolved);
    const module = imports.get(resolved.id);
    if (module !== undefined) imports.set(name, module);
  }
  return imports;
}
