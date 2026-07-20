// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export async function runCanonicalBin(fileName: string): Promise<void> {
  const packageJsonPath = require.resolve("@mettascript/node/package.json");
  await import(pathToFileURL(join(dirname(packageJsonPath), "dist", fileName)).href);
}
