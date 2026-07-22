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
  resolveImportGraph,
  type ImportMap,
  type ResolveModule,
} from "@mettascript/core";

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
  const base = resolve(baseDir);
  const root = resolve(importRoot);
  const canonicalRoot = canonicalPath(root);
  const builtinNames = new Set(builtinModules().keys());

  const resolveModule: ResolveModule = (name, fromContextId) => {
    if (builtinNames.has(name)) return { id: name };
    const fromDir = fromContextId ?? base;
    const candidate = resolve(fromDir, name.endsWith(".metta") ? name : name + ".metta");
    // `runFile` uses the file directory's parent so a corpus file can share a sibling `../lib`
    // directory without allowing imports above that tree.
    if (!withinRoot(candidate, root) || !existsSync(candidate)) return { id: candidate };
    const canonical = canonicalPath(candidate);
    if (!withinRoot(canonical, canonicalRoot)) return { id: canonical };
    try {
      return {
        id: canonical,
        source: readFileSync(canonical, "utf8"),
        contextId: dirname(canonical),
      };
    } catch {
      return { id: canonical };
    }
  };

  return resolveImportGraph(src, resolveModule, base);
}
