// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { emptyExpr, format, gstr, runProgramAsync, sym } from "@mettascript/core";
import type { PyodideAPI } from "pyodide";
import { createPyodideInterop, pyodideBridge } from "./pyodide";

class FakePyProxy {}

function fakePyodide(): PyodideAPI & {
  readonly files: Map<string, string>;
  readonly sysPath: string[];
  readonly loadedPackages: string[];
  readonly installedWheels: string[];
} {
  const files = new Map<string, string>();
  const sysPath: string[] = [];
  const loadedPackages: string[] = [];
  const installedWheels: string[] = [];
  const modules = new Map<string, Record<string, unknown>>();
  const builtins = {
    str: (value: unknown) => String(value),
    len: (value: { readonly length: number }) => value.length,
    list: (value: unknown) => value,
    tuple: (value: unknown) => value,
    isinstance: (value: unknown, type: unknown) =>
      (type === builtins.list || type === builtins.tuple) && Array.isArray(value),
    getattr: (obj: Record<string, unknown>, name: string) => obj[name],
    callable: (value: unknown) => typeof value === "function",
    __import__: (name: string) => {
      const module = modules.get(name);
      if (module === undefined) throw new Error(`No module named ${name}`);
      return module;
    },
  };
  modules.set("builtins", builtins);
  modules.set("sample", {
    double: (n: number) => n * 2,
    values: () => [1, 2, "x"],
  });
  modules.set("sys", { path: { insert: (_index: number, path: string) => sysPath.unshift(path) } });
  modules.set("micropip", {
    install: async (packages: readonly string[]) => void installedWheels.push(...packages),
    destroy: () => undefined,
  });

  return {
    files,
    sysPath,
    loadedPackages,
    installedWheels,
    ffi: { PyProxy: FakePyProxy },
    FS: {
      writeFile: (path: string, text: string) => void files.set(path, text),
      mkdirTree: () => undefined,
    },
    loadPackage: async (packages: string | string[]) => {
      loadedPackages.push(...(Array.isArray(packages) ? packages : [packages]));
      return [];
    },
    pyimport: (name: string) => {
      const dot = name.lastIndexOf(".");
      if (dot > 0) {
        const module = modules.get(name.slice(0, dot));
        const value = module?.[name.slice(dot + 1)];
        if (value === undefined) throw new Error(`No module named ${name}`);
        return value;
      }
      const module = modules.get(name);
      if (module === undefined) throw new Error(`No module named ${name}`);
      return module;
    },
    runPythonAsync: async (code: string) => {
      const dir = code.match(/_metta_ts_dir = "([^"]+)"/)?.[1];
      const moduleName = code.match(/_metta_ts_module = "([^"]+)"/)?.[1];
      if (dir !== undefined) sysPath.unshift(dir);
      if (moduleName !== undefined)
        modules.set(moduleName, { add: (a: number, b: number) => a + b });
      return undefined;
    },
  } as unknown as PyodideAPI & {
    readonly files: Map<string, string>;
    readonly sysPath: string[];
    readonly loadedPackages: string[];
    readonly installedWheels: string[];
  };
}

describe("pyodideBridge", () => {
  it("uses existing PyBridge conversions over Pyodide modules and builtins", async () => {
    const bridge = pyodideBridge(fakePyodide());
    await expect(bridge.callBuiltin("str", [42])).resolves.toBe("42");
    await expect(bridge.callModule("sample", "double", [21])).resolves.toBe(42);
    await expect(bridge.callModule("sample", "values", [])).resolves.toEqual([1, 2, "x"]);
  });
});

describe("createPyodideInterop", () => {
  it("loads packages, installs micropip wheels, and imports .py files through hostImport", async () => {
    const pyodide = fakePyodide();
    const interop = await createPyodideInterop({
      pyodide,
      loadText: async (path) => `# ${path}\ndef add(a, b):\n    return a + b\n`,
      packages: ["numpy"],
      micropip: ["snowballstemmer"],
    });
    expect(pyodide.loadedPackages).toEqual(["numpy", "micropip"]);
    expect(pyodide.installedWheels).toEqual(["snowballstemmer"]);
    await expect(interop.hostImport?.(sym("&self"), gstr("math.py"))).resolves.toEqual({
      tag: "ok",
      results: [emptyExpr],
    });
    expect(pyodide.files.get("/metta-ts/math.py")).toContain("def add");
    await expect(interop.hostImport?.(sym("&self"), gstr("notes.txt"))).resolves.toEqual({
      tag: "noReduce",
    });
  });
});

const liveIt = process.env.PYODIDE_LIVE === "1" ? it : it.skip;

function pyodideIndexUrl(): string {
  const require = createRequire(import.meta.url);
  return `${dirname(require.resolve("pyodide/package.json"))}/`;
}

describe("createPyodideInterop live", () => {
  liveIt("imports a Python file and runs py-call through real Pyodide", async () => {
    const { loadPyodide } = await import("pyodide");
    const pyodide = await loadPyodide({ indexURL: pyodideIndexUrl() });
    const interop = await createPyodideInterop({
      pyodide,
      loadText: async () => "def add(a, b):\n    return a + b\n",
    });
    const results = await runProgramAsync(
      `${interop.prelude ?? ""}\n!(import! &self "math.py")\n!(py-call (math.add 40 2))`,
      new Map(interop.asyncOps ?? []),
      undefined,
      new Map(),
      interop.hostImport === undefined ? {} : { hostImport: interop.hostImport },
    );
    expect(results.at(-1)!.results.map(format)).toEqual(["42"]);
  });
});
