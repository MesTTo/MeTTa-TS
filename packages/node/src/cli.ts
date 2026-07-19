#!/usr/bin/env node

// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// `metta-ts <file.metta>`: compatibility alias for `metta run`. A thin executable over the shared runner
// in run-main.ts, so importing the runner never triggers a run. New usage is the unified `metta` CLI.
import { runCliMain } from "./run-main";

runCliMain(process.argv.slice(2), "metta-ts").catch((e: unknown) => {
  process.stderr.write((e instanceof Error ? e.message : String(e)) + "\n");
  process.exit(1);
});
