<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Packages

MeTTa TS is a small set of packages under the `@metta-ts` scope. Install only
what you need; everything builds on the core. For the full API of each, see the
detailed reference: [core](/reference/core), [hyperon](/reference/hyperon),
[edsl](/reference/edsl), [node and browser](/reference/node-browser), and
[grapher](/reference/grapher).

| Package                                                                                      | What it is                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`@metta-ts/core`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/core)               | The interpreter, parser, type system, and standard library. Zero platform dependencies, runs in any JavaScript runtime.       |
| [`@metta-ts/hyperon`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/hyperon)         | A TypeScript class API over the core (atoms, spaces, grounded operations).                                                    |
| [`@metta-ts/edsl`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/edsl)               | An ergonomic, typed eDSL: term builders, special-form combinators, and a tagged template.                                     |
| [`@metta-ts/node`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/node)               | The `metta-ts` runner CLI, the `metta-debug` trace CLI, file `import!`, and the `SharedArrayBuffer` worker-thread parallel matcher. |
| [`@metta-ts/browser`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/browser)         | Browser entry point with an in-memory virtual file system for `import!` and optional host-runtime composition.                |
| [`@metta-ts/py`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/py)                   | Python interop: PeTTa's `py-call` and Hyperon's `py-atom`, over pythonia in Node or Pyodide in the browser. Opt-in and async. |
| [`@metta-ts/prolog`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/prolog)           | Prolog interop: PeTTa-compatible predicate calls, `prolog-call`, and `import_prolog_function` over SWI-Prolog or SWI-WASM.    |
| [`@metta-ts/grapher`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/grapher)         | MeTTaGrapher: a visual editor plus browser and headless Node reduction-GIF rendering over the same core trace.                |
| [`@metta-ts/das-client`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/das-client)   | Client for SingularityNET's Distributed AtomSpace.                                                                            |
| [`@metta-ts/das-gateway`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/das-gateway) | A transport-agnostic gateway bridging the browser to a Distributed AtomSpace.                                                 |

## How they fit together

`@metta-ts/core` is the whole language: parse, evaluate, match, type-check, and the standard library. If you only want to run MeTTa, this is all you need.

`@metta-ts/hyperon` and `@metta-ts/edsl` are two TypeScript-facing layers over the core. The hyperon package mirrors the Python API (a `MeTTa` runner, `S`/`V`/`E`/`G` atom constructors, grounded operations). The eDSL is the more idiomatic, typed way to build and run MeTTa from TypeScript.

`@metta-ts/node` and `@metta-ts/browser` are platform entry points: the Node
package adds the CLI, file imports, and the worker-thread matcher; the browser
package adds an in-memory file system. Both re-export the core.

`@metta-ts/grapher` is the visual editor, [MeTTaGrapher](/tools/grapher). It
renders a program as a node graph or nested blocks and runs it on the core, so
it is a view over atoms rather than a second engine. The
[`@metta-ts/grapher/node` entry](/tools/grapher-node-gif) exports the same
reduction as GIF bytes without mounting the editor or creating a browser DOM.

`@metta-ts/py` and `@metta-ts/prolog` are optional host interop packages.
Python reaches CPython through pythonia in Node or Pyodide in the browser.
Prolog reaches SWI-Prolog through a local `swipl` executable in Node or
`swipl-wasm` in the browser. Both run asynchronously, and both keep the normal
interpreter path free of host runtimes. See [Python
interop](/typescript/python-interop) and [Prolog
interop](/typescript/prolog-interop).

`@metta-ts/das-client` and `@metta-ts/das-gateway` are optional, for querying a remote Distributed AtomSpace.

## Versioning and license

All packages are released together under the `@metta-ts` scope and the MIT license.
