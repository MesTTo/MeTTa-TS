// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { format } from "@mettascript/core";
import { createBrowserRunner } from "@mettascript/browser/host";

export async function runPureBrowserEntry(): Promise<string[]> {
  const runner = createBrowserRunner();
  const results = await runner.run("!(+ 40 2)");
  await runner.dispose();
  return results[0]!.results.map(format);
}

void runPureBrowserEntry();
