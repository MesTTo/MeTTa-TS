// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "compat/*/src/**/*.test.ts",
      "website/.vitepress/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "compat/*/src/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});
