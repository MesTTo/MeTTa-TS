// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { format } from "@metta-ts/core";
import { createBrowserRunner, createBrowserTextLoader } from "@metta-ts/browser/host";
import { createPyodideInterop } from "@metta-ts/py/pyodide";
import { createSwiWasmInterop } from "@metta-ts/prolog/swi-wasm";

export interface BrowserInteropOptions {
  readonly baseUrl?: string | URL;
  readonly pyodideIndexURL?: string;
  readonly swiplLocateFile?: (path: string, prefix?: string) => string;
}

export interface BrowserInteropResult {
  readonly python: readonly string[];
  readonly prologCall: readonly string[];
  readonly prologFunction: readonly string[];
}

function defaultBaseUrl(): string | URL | undefined {
  const location = (globalThis as { readonly location?: { readonly href?: string } }).location;
  return location?.href;
}

const files = new Map<string, string>([
  ["math.py", "def add(a, b):\n    return a + b\n"],
  ["facts.pl", "edge(alice, bob).\nedge(alice, mars).\n"],
]);

export async function runBrowserInteropDemo(
  options: BrowserInteropOptions = {},
): Promise<BrowserInteropResult> {
  const loadText = createBrowserTextLoader({
    files,
    baseUrl: options.baseUrl ?? defaultBaseUrl(),
  });
  const py = await createPyodideInterop({
    loadText,
    ...(options.pyodideIndexURL !== undefined ? { indexURL: options.pyodideIndexURL } : {}),
  });
  const prolog = await createSwiWasmInterop({
    loadText,
    ...(options.swiplLocateFile !== undefined ? { locateFile: options.swiplLocateFile } : {}),
  });
  const runner = createBrowserRunner({ files, interops: [py, prolog] });
  try {
    const results = await runner.run(`
      !(import! &self "math.py")
      !(py-call (math.add 40 2))

      !(import! &self "facts.pl")
      !(prolog-call (edge alice $x))
      !(import_prolog_function edge)
      !(edge alice)
    `);
    return {
      python: results[1]!.results.map(format),
      prologCall: results[3]!.results.map(format),
      prologFunction: results[5]!.results.map(format),
    };
  } finally {
    await runner.dispose();
  }
}

async function render(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;
  root.textContent = "Running...";
  try {
    const result = await runBrowserInteropDemo();
    root.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    root.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
}

if (typeof document !== "undefined") void render();
