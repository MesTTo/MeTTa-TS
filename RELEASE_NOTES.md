# MeTTa TS 1.1.2

A pure-TypeScript implementation of [MeTTa](https://metta-lang.dev), the
OpenCog Hyperon language. The core engine runs in the browser, Node, Deno, Bun,
edge runtimes, and TypeScript-based agents with no native addon and no required
WASM. Optional host adapters can load Python or Prolog runtimes when a program
asks for them.

## Tested on Linux

This release is prepared on Linux with Node 22 and pnpm 11. The release gate
builds every package, typechecks the workspace, runs the full Vitest suite,
builds the GitHub Pages documentation, runs the oracle checks, and runs the
benchmark suite before tagging. Optional Python, Pyodide, SWI-Prolog, and
SWI-WASM adapters are built and covered by their available tests, with live
runtime checks depending on the host tools installed in the release
environment.

The current conformance rerun reports Core/ST at 431 passed, 77 failed, 60
expected failures, and 0 skipped. Full/ST with `fileio,json,random` reports 470
passed, 174 failed, 4 expected failures, and 26 skipped. The remaining gaps are
the tracked parser/directive, kernel, typing, stdlib, feature, and concurrency
divergences, so this release should not be described as full Hyperon
conformance.

## What's new

### Integrated host interop release train

This release includes the full local host-interop train that followed 1.1.0:
browser host adapters, Python and Prolog runtime splits, SWI-WASM, Pyodide,
source runners, async effects, CLI checks, and the eDSL host builders.

### Browser Python and Prolog

`@metta-ts/browser/host` composes optional host runtimes into the browser
runner. A browser app can now run the same `.metta` program shape as Node:

```metta
!(import! &self "math.py")
!(py-call (math.add 40 2))

!(import! &self "facts.pl")
!(prolog-call (edge alice $x))
```

Python runs through `@metta-ts/py/pyodide`. Prolog runs through
`@metta-ts/prolog/swi-wasm`. The base `@metta-ts/browser` package stays
runtime-agnostic; Pyodide and SWI-WASM are only included when their adapter
subpaths are imported.

### Prolog interop package

`@metta-ts/prolog` is now part of the release. The root package contains the
generic bridge and MeTTa-side helper source. Runtime adapters live on subpaths:

- `@metta-ts/prolog/swi-node` talks to a local `swipl` executable.
- `@metta-ts/prolog/swi-wasm` runs through `swipl-wasm`.

The supported surface follows PeTTa where the operation is a host Prolog bridge:
`Predicate`, `callPredicate`, `assertaPredicate`, `assertzPredicate`,
`retractPredicate`, `prolog-call`, `prolog-consult`, and
`import_prolog_function`.

MeTTa TS keeps Hyperon-style evaluation. There is no PeTTa mode and no curry
mode. Plain `.pl` imports and predicate calls are host capabilities, not a
second evaluator.

### Runtime adapter split

The Python and Prolog roots no longer import runtime backends from their package
roots. Node-specific adapters are explicit subpaths:

- `@metta-ts/py/pythonia`
- `@metta-ts/prolog/swi-node`

Browser adapters are explicit subpaths:

- `@metta-ts/py/pyodide`
- `@metta-ts/prolog/swi-wasm`

That keeps default imports browser-clean and leaves optional dependencies behind
their adapter subpaths.

### eDSL host helpers

`@metta-ts/edsl/py` and `@metta-ts/edsl/prolog` provide dependency-free builders
for the host interop forms. They build ordinary atoms such as `py-call`,
`py-atom`, `prolog-call`, `Predicate`, and `import_prolog_function`. They do
not load Python, Prolog, Pyodide, SWI-WASM, or Node adapters.

```ts
import { vars } from "@metta-ts/edsl";
import { pyCall } from "@metta-ts/edsl/py";
import { prologCall } from "@metta-ts/edsl/prolog";

const { x } = vars();

pyCall("math.add", 40, 2); // (py-call (math.add 40 2))
prologCall(["edge", "alice", x]); // (prolog-call (edge alice $x))
```

### Bounded structural tabling

Automatic tabling now uses structural token keys and a bounded table space
instead of recursive printed-form keys. Pure overlapping-recursive calls can be
memoized without table growth being unbounded:

- completed pure entries are capped and LRU-evictable;
- interner resets invalidate old opaque table keys;
- runtime rules are version-keyed;
- impure, meta, state, import, `match`, `collapse`, and concurrency paths stay
  outside the table cache;
- direct active variant recursion uses local-linear completion for finite answer
  sets;
- non-cyclic calls keep exact ordered-bag memoization.

The stale-key path reported during release review is covered by a regression:
old tail-call pending keys cannot write into a new interner generation after a
table-space reset.

## Install

```bash
npm install @metta-ts/core
npm install -g @metta-ts/node
npm install @metta-ts/py pythonia
npm install @metta-ts/prolog
```

Browser projects that use optional host runtimes should also install the runtime
adapter they import:

```bash
npm install pyodide swipl-wasm
```

## Provenance

- Semantics: [hyperon-experimental](https://github.com/trueagi-io/hyperon-experimental).
- Python interop surface: PeTTa's `py-call` and Hyperon's
  [`py-atom`](https://trueagi-io.github.io/hyperon-experimental/reference/atoms/)
  family.
- Prolog interop surface: PeTTa-compatible predicate bridge forms where they do
  not depend on PeTTa's evaluator.
- Verified spec and differential oracle:
  [LeaTTa](https://github.com/MesTTo/LeaTTa).
- License: [MIT](LICENSE).
