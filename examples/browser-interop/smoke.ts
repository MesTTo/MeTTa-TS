// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { createRequire } from "node:module";
import { dirname } from "node:path";
import { runBrowserInteropDemo } from "./main.js";

function pyodideIndexUrl(): string {
  const require = createRequire(import.meta.url);
  return `${dirname(require.resolve("pyodide/package.json"))}/`;
}

function expectEqual(name: string, actual: readonly string[], expected: readonly string[]): void {
  if (actual.length !== expected.length || actual.some((value, i) => value !== expected[i])) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const result = await runBrowserInteropDemo({
  pyodideIndexURL: pyodideIndexUrl(),
  baseUrl: import.meta.url,
});

expectEqual("python", result.python, ["42"]);
expectEqual("prologCall", result.prologCall, ["(edge alice bob)", "(edge alice mars)"]);
expectEqual("prologFunction", result.prologFunction, ["bob", "mars"]);

console.log(JSON.stringify(result, null, 2));
