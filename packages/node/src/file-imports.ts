// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// File-backed MeTTa import resolution shared by the package API and the CLI.
// Register the Node package's standard libraries before classifying graph edges as files or built-ins.
import "@mettascript/libraries";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import {
  builtinModules,
  literalImportTarget,
  parseAll,
  standardTokenizer,
  type Atom,
  type ImportMap,
  type ImportModule,
} from "@mettascript/core";

interface ParsedModule {
  readonly defs: Atom[];
  readonly imports: string[];
}

interface ResolvedModule {
  readonly id: string;
  readonly path?: string;
}

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

function withinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Pre-read every `import!` target referenced in `src`, resolving names against `baseDir`. */
export function readImports(src: string, baseDir: string, importRoot = baseDir): ImportMap {
  const imports: ImportMap = new Map();
  if (!src.includes("import!")) return imports;
  const base = resolve(baseDir);
  const root = resolve(importRoot);
  const canonicalRoot = canonicalPath(root);
  const builtinNames = new Set(builtinModules().keys());
  const visited = new Set<string>();

  const resolveModule = (name: string, fromDir: string): ResolvedModule => {
    if (builtinNames.has(name)) return { id: name };
    const candidate = resolve(fromDir, name.endsWith(".metta") ? name : name + ".metta");
    // `runFile` uses the file directory's parent so a corpus file can share a sibling `../lib`
    // directory without allowing imports above that tree.
    if (!withinRoot(candidate, root) || !existsSync(candidate)) return { id: candidate };
    const canonical = canonicalPath(candidate);
    return withinRoot(canonical, canonicalRoot)
      ? { id: canonical, path: canonical }
      : { id: canonical };
  };

  const collectModule = (path: string): void => {
    if (visited.has(path)) return;
    visited.add(path);
    let parsed: ParsedModule;
    try {
      parsed = parseModule(readFileSync(path, "utf8"));
    } catch {
      return;
    }
    const nested: string[] = [];
    const module: ImportModule = { id: path, defs: parsed.defs, imports: nested };
    imports.set(path, module);
    for (const name of parsed.imports) {
      const resolved = resolveModule(name, dirname(path));
      nested.push(resolved.id);
      if (resolved.path !== undefined) collectModule(resolved.path);
    }
  };

  for (const name of parseModule(src).imports) {
    const resolved = resolveModule(name, base);
    if (resolved.path === undefined) continue;
    collectModule(resolved.path);
    const module = imports.get(resolved.id);
    if (module !== undefined) imports.set(name, module);
  }
  return imports;
}
