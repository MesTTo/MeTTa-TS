// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const benchDir = dirname(fileURLToPath(import.meta.url));

export const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

export const flag = (name) => process.argv.includes(`--${name}`);

export const cliPath = resolve(benchDir, "../dist/cli.js");

export const hashConsEnabled = () =>
  flag("hash-cons") ||
  process.env.METTA_TS_HASHCONS === "1" ||
  process.env.METTA_TS_HASHCONS === "true";
