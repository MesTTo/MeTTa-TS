<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Browser Interop Example

This example wires the browser runner to Pyodide and SWI-Prolog WASM through the
shared host interop API.

Run the Node smoke check after building the packages:

```sh
pnpm --filter @metta-ts/examples browser-interop
```

Check that a pure browser bundle does not include host runtimes:

```sh
pnpm --filter @metta-ts/examples browser-interop:bundle-check
```

The HTML entry is meant for Vite-style dev servers that can serve TypeScript
module imports and the WASM assets required by `pyodide` and `swipl-wasm`.
