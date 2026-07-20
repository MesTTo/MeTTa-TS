---
# SPDX-FileCopyrightText: 2026 MesTTo
# SPDX-License-Identifier: MIT
layout: home

hero:
  name: MeTTaScript
  text: A metagraph rewriting database in TypeScript
  tagline: Store facts in a space, query them by pattern, and compute with rewrite rules. A pure-TypeScript library for the browser, Node, Deno, Bun, and edge. No native addons, no MeTTa knowledge required.
  image:
    src: /search.gif
    alt: A generate-and-test search played as a graph, where candidate answers fan out, are tested, and prune to the results
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Use cases
      link: /guide/use-cases
    - theme: alt
      text: GitHub
      link: https://github.com/MesTTo/MeTTaScript

features:
  - title: Use it from TypeScript
    details: Store facts, query by pattern, and write rules with a typed eDSL, entirely in TypeScript. Query keys, arguments, and results cross the boundary as ordinary values. You never have to learn a new language.
  - title: A more powerful data model
    details: A metagraph, not a table. Atoms nest, so a fact can be about another fact, and rules and types live in the same space as the data. One pattern-matching mechanism both queries and computes.
  - title: Faster than DataScript
    details: On DataScript's own declarative workloads MeTTaScript wins every query at 120k records, up to 1349x, while building faster and holding less heap. See the use-cases page for the full comparison.
  - title: Runs anywhere
    details: One core ESM bundle, about 23 KB gzipped. No native addon, no required WASM, no Rust. Import it in a web page, a serverless handler, or an agent loop and go.
  - title: TypeScript-native interop
    details: Call your own TypeScript functions from inside rules, drop TypeScript objects straight into the space, and await real I/O. No FFI, same language end to end.
  - title: Immutable and concurrent
    details: Keep immutable snapshots you can branch and roll back. Grounded operations can do I/O, and concurrency primitives (par, race, once, with-mutex) and transactions build on top.
  - title: Part of the MeTTa ecosystem, if you want it
    details: MeTTaScript implements MeTTa, the language from OpenCog Hyperon, and is validated 270/270 against Hyperon's oracle and the Lean-verified LeaTTa semantics. Use it as a plain library and never think about any of that.
---
