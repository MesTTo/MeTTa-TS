// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// @metta-ts/browser: browser entry point. The core interpreter has no Node dependencies, so this build
// re-exports it and adds in-memory source runners for browser hosts.
export * from "@mettascript/core";
export {
  evalBranchesInBrowserWorkers,
  makeBrowserParEvalImpl,
  run,
  runSource,
  runSourceAsync,
  vfsImports,
  type BrowserParEvalOptions,
} from "./source";
export {
  createBrowserRunner,
  createBrowserTextLoader,
  type BrowserRunner,
  type BrowserRunnerOptions,
} from "./host";
