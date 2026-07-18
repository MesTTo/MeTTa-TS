// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { registerBuiltinModule } from "@metta-ts/core";
import { LIBRARY_MODULE_SRCS } from "./generated/sources.js";

let done = false;

export function registerLibraries(): void {
  if (done) return;
  for (const [name, src] of Object.entries(LIBRARY_MODULE_SRCS)) {
    registerBuiltinModule(name, src);
  }
  done = true;
}

registerLibraries();

export { LIBRARY_MODULE_SRCS };
