#!/usr/bin/env node

// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// `metta-debug`: compatibility alias for `metta debug`. A thin executable over the shared debugger logic in
// debug-main.ts, so importing that logic never triggers a run.
import { runDebugMain } from "./debug-main";

try {
  runDebugMain(process.argv.slice(2), "metta-debug");
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}
