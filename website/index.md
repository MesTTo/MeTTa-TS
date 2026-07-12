---
# SPDX-FileCopyrightText: 2026 MesTTo
# SPDX-License-Identifier: MIT
layout: home

hero:
  name: MeTTa
  text: MeTTa, in pure TypeScript
  tagline: A complete implementation of the OpenCog Hyperon language that runs in the browser, Node, Deno, Bun, edge functions, and TypeScript AI agents. No native addons, no required WASM.
  image:
    src: /search.gif
    alt: MeTTaGrapher playing a generate-and-test search, where candidate selections fan out, are tested, and prune to the answers
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Learn MeTTa
      link: /learn/evaluation/main-concepts
    - theme: alt
      text: GitHub
      link: https://github.com/MesTTo/MeTTa-TS

features:
  - title: Run it anywhere
    details: One core ESM bundle, ~23 KB gzipped. No native addon, no required WASM, no Rust. Import it in a web page, a serverless handler, or an agent loop and go.
  - title: Faithful semantics
    details: A port of hyperon-experimental's minimal interpreter, validated 270/270 against Hyperon's oracle corpus and cross-checked against the Lean-verified LeaTTa semantics.
  - title: TypeScript-native interop
    details: Call your TypeScript functions from MeTTa, drop TypeScript objects straight into the atomspace as grounded atoms, and write rules with a typed eDSL. No FFI, same language end to end.
  - title: Optional host runtimes
    details: Opt into Python or Prolog only when you need them. Node adapters use pythonia and SWI-Prolog; browser adapters use Pyodide and SWI-WASM through the same host-import contract.
  - title: Async and concurrent
    details: Grounded operations can do I/O and the evaluator awaits them. Concurrency primitives (par, race, once, with-mutex) and transactions build on top.
  - title: Scales to millions of atoms
    details: Prolog-style clause indexing keys queries by functor and every ground argument, plus a flat interned KB with a worker-thread parallel matcher.
  - title: A typed eDSL
    details: Write MeTTa in idiomatic TypeScript with typed term builders and a tagged template. Optional helper subpaths build Python and Prolog interop calls without loading those runtimes.
---
