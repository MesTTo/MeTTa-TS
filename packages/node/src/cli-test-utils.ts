// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function cliPath(metaUrl: string): string {
  return join(dirname(fileURLToPath(metaUrl)), "..", "dist", "cli.js");
}

export function mettaFixture(prefix: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const file = join(dir, "p.metta");
  writeFileSync(file, content);
  return file;
}
