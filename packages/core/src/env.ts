// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Read an environment variable without a bare `process` reference that would crash where there is no
// Node process, such as a browser. In Node it returns `process.env[key]` unchanged; elsewhere it returns
// undefined, so an env toggle read as `readEnv("X") !== "0"` keeps its default. The whole interpreter is
// pure TypeScript and runs in the browser, so no module may touch `process` at load time.

export function readEnv(key: string): string | undefined {
  return typeof process !== "undefined" && process.env ? process.env[key] : undefined;
}
