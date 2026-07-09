// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "metta-ts-browser-bundle-"));
try {
  const outfile = join(tmp, "pure-browser.js");
  const result = await build({
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints: ["examples/browser-interop/pure-entry.ts"],
    format: "esm",
    logLevel: "silent",
    metafile: true,
    outfile,
    platform: "browser",
  });
  const imports = Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports.map((entry) => entry.path),
  );
  const forbiddenImports = imports.filter(
    (path) =>
      path.startsWith("node:") ||
      ["fs", "child_process", "os", "pyodide", "swipl-wasm", "pythonia"].includes(path),
  );
  if (forbiddenImports.length > 0)
    throw new Error(`pure browser bundle imports ${forbiddenImports.join(", ")}`);

  const bundle = readFileSync(outfile, "utf8");
  const forbidden = /pyodide|swipl-wasm|swipl-web|swipl-bundle|pythonia/;
  const match = bundle.match(forbidden);
  if (match !== null)
    throw new Error(`pure browser bundle contains host runtime marker ${match[0]}`);
  console.log(`pure browser bundle clean: ${bundle.length} bytes`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
