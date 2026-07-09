// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { emptyExpr, type Atom } from "@metta-ts/core";
import { type HostInterop, type HostTextLoader } from "@metta-ts/core/host";
import { loadPyodide as defaultLoadPyodide, type PyodideAPI } from "pyodide";
import { PY_METTA_SRC, pyCoreAsyncOps, type PyBridge, type PyHandle, type PyValue } from "./py";

export interface PyodideBridgeOptions {
  readonly loadText?: HostTextLoader;
  readonly baseUrl?: string | URL;
  readonly files?: ReadonlyMap<string, string>;
}

export interface PyodideInteropOptions extends PyodideBridgeOptions {
  readonly pyodide?: PyodideAPI;
  readonly indexURL?: string;
  readonly loadPyodide?: typeof defaultLoadPyodide;
  readonly packages?: readonly string[];
  readonly micropip?: readonly string[];
}

interface PyodideFs {
  writeFile(path: string, data: string, opts?: { readonly encoding?: "utf8" }): void;
  mkdirTree?(path: string): void;
  analyzePath?(path: string): { readonly exists: boolean };
  mkdir?(path: string): void;
}

interface PyProxyLike {
  destroy?(): void;
  get?(key: unknown): unknown;
  readonly length?: number;
}

function fileCandidates(path: string): string[] {
  if (path.endsWith(".py")) return [path, path.slice(0, -".py".length)];
  return [path, `${path}.py`];
}

function globalBaseUrl(): string | undefined {
  const location = (globalThis as { readonly location?: { readonly href?: string } }).location;
  return typeof location?.href === "string" ? location.href : undefined;
}

function createDefaultTextLoader(options: PyodideBridgeOptions): HostTextLoader {
  const files = options.files ?? new Map<string, string>();
  return async (path, from) => {
    for (const candidate of fileCandidates(path)) {
      const text = files.get(candidate);
      if (text !== undefined) return text;
    }
    const base = from ?? options.baseUrl ?? globalBaseUrl();
    if (base === undefined) throw new Error(`pyodide import: ${path}: no base URL`);
    const url = new URL(path, base);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`pyodide import: ${path}: ${response.status} ${url.href}`);
    return response.text();
  };
}

const toPosix = (path: string): string => path.replaceAll("\\", "/");

function virtualPath(path: string): string {
  const normalized = toPosix(path).replace(/^\.\/+/, "");
  return normalized.startsWith("/") ? normalized : `/metta-ts/${normalized}`;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function moduleNameForPath(path: string): string {
  const base = basename(path);
  return base.endsWith(".py") ? base.slice(0, -".py".length) : base;
}

function fsApi(pyodide: PyodideAPI): PyodideFs {
  return pyodide.FS as unknown as PyodideFs;
}

function ensureDir(fs: PyodideFs, dir: string): void {
  if (dir === "" || dir === "/") return;
  if (fs.mkdirTree !== undefined) {
    fs.mkdirTree(dir);
    return;
  }
  let current = "";
  for (const part of dir.split("/")) {
    if (part === "") continue;
    current += `/${part}`;
    if (fs.analyzePath?.(current).exists === true) continue;
    fs.mkdir?.(current);
  }
}

function isPyProxy(pyodide: PyodideAPI, value: unknown): value is PyHandle & PyProxyLike {
  if (value === null || value === undefined) return false;
  try {
    return value instanceof pyodide.ffi.PyProxy;
  } catch {
    return false;
  }
}

async function invoke(fn: unknown, args: readonly unknown[]): Promise<unknown> {
  if (typeof fn !== "function") throw new Error("pyodide: attempted to call a non-callable");
  return await (fn as (...callArgs: readonly unknown[]) => unknown)(...args);
}

function pyErrorText(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function importAtomName(atom: Atom | undefined): string | undefined {
  if (atom?.kind === "sym") return atom.name;
  if (atom?.kind === "gnd" && atom.value.g === "str") return atom.value.s;
  if (
    atom?.kind === "expr" &&
    atom.items.length === 2 &&
    atom.items[0]?.kind === "sym" &&
    atom.items[0].name === "library"
  )
    return importAtomName(atom.items[1]);
  return undefined;
}

export function pyodideBridge(pyodide: PyodideAPI, options: PyodideBridgeOptions = {}): PyBridge {
  const modules = new Map<string, Promise<unknown>>();
  const loadText = options.loadText ?? createDefaultTextLoader(options);
  const mod = (name: string): Promise<unknown> => {
    let module = modules.get(name);
    if (module === undefined) {
      module = Promise.resolve(pyodide.pyimport(name));
      modules.set(name, module);
    }
    return module;
  };
  const builtin = (name: string): Promise<unknown> => mod(`builtins.${name}`);
  const pyGetAttr = async (obj: unknown, name: string): Promise<unknown> =>
    await invoke(await builtin("getattr"), [obj, name]);

  let sequenceTypes: Promise<[unknown, unknown]> | undefined;
  const sequenceTypeHandles = (): Promise<[unknown, unknown]> => {
    sequenceTypes ??= (async () => {
      return [await builtin("list"), await builtin("tuple")];
    })();
    return sequenceTypes;
  };

  async function normalize(value: unknown): Promise<PyValue> {
    if (!isPyProxy(pyodide, value)) return (value ?? null) as PyValue;
    const [listType, tupleType] = await sequenceTypeHandles();
    const isinstance = await builtin("isinstance");
    const isSeq =
      Boolean(await invoke(isinstance, [value, listType])) ||
      Boolean(await invoke(isinstance, [value, tupleType]));
    if (!isSeq) return value as PyHandle;
    const n = Number(await invoke(await builtin("len"), [value]));
    const out: PyValue[] = [];
    for (let i = 0; i < n; i++) {
      const item =
        typeof value.get === "function"
          ? value.get(i)
          : await invoke(await invoke(await builtin("getattr"), [value, "__getitem__"]), [i]);
      out.push(await normalize(item));
    }
    return out;
  }

  async function loadLocalModule(path: string): Promise<void> {
    const source = await loadText(path);
    const target = virtualPath(path);
    const dir = dirname(target);
    const moduleName = moduleNameForPath(target);
    const fs = fsApi(pyodide);
    ensureDir(fs, dir);
    fs.writeFile(target, source, { encoding: "utf8" });
    await pyodide.runPythonAsync(
      `
import importlib
import importlib.util
import sys
_metta_ts_dir = ${JSON.stringify(dir)}
_metta_ts_module = ${JSON.stringify(moduleName)}
_metta_ts_path = ${JSON.stringify(target)}
if _metta_ts_dir not in sys.path:
    sys.path.insert(0, _metta_ts_dir)
importlib.invalidate_caches()
_metta_ts_spec = importlib.util.spec_from_file_location(_metta_ts_module, _metta_ts_path)
if _metta_ts_spec is None or _metta_ts_spec.loader is None:
    raise ImportError(f"cannot load {_metta_ts_module} from {_metta_ts_path}")
_metta_ts_loaded = importlib.util.module_from_spec(_metta_ts_spec)
sys.modules[_metta_ts_module] = _metta_ts_loaded
_metta_ts_spec.loader.exec_module(_metta_ts_loaded)
`,
      { filename: target },
    );
    modules.set(moduleName, Promise.resolve(pyodide.pyimport(moduleName)));
  }

  return {
    async callBuiltin(name, args) {
      return normalize(await invoke(await builtin(name), args));
    },
    async callModule(module, fn, args) {
      return normalize(await invoke(await pyGetAttr(await mod(module), fn), args));
    },
    async callMethod(obj, method, args) {
      return normalize(await invoke(await pyGetAttr(obj, method), args));
    },
    async call(fn, args) {
      return normalize(await invoke(fn, args));
    },
    async import(name) {
      if (name.endsWith(".py")) await loadLocalModule(name);
      else await mod(name);
    },
    isHandle(value): value is PyHandle {
      return isPyProxy(pyodide, value);
    },
    dispose() {
      modules.clear();
    },
  };
}

export async function createPyodideInterop(
  options: PyodideInteropOptions = {},
): Promise<HostInterop> {
  const pyodide =
    options.pyodide ??
    (await (options.loadPyodide ?? defaultLoadPyodide)({
      ...(options.indexURL !== undefined ? { indexURL: options.indexURL } : {}),
    }));
  if (options.packages !== undefined && options.packages.length > 0)
    await pyodide.loadPackage([...options.packages]);
  if (options.micropip !== undefined && options.micropip.length > 0) {
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip") as {
      install(packages: string | readonly string[]): Promise<void>;
      destroy?(): void;
    };
    try {
      await micropip.install([...options.micropip]);
    } finally {
      micropip.destroy?.();
    }
  }
  const bridge = pyodideBridge(pyodide, options);
  return {
    name: "pyodide",
    prelude: PY_METTA_SRC,
    asyncOps: pyCoreAsyncOps(bridge),
    hostImport: async (_space, target) => {
      const name = importAtomName(target);
      if (!name?.endsWith(".py")) return { tag: "noReduce" };
      try {
        await bridge.import(name);
        return { tag: "ok", results: [emptyExpr] };
      } catch (error) {
        return { tag: "runtimeError", msg: `import!: ${name}: ${pyErrorText(error)}` };
      }
    },
    dispose: () => bridge.dispose(),
  };
}
