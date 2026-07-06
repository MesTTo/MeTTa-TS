# MeTTa TS 1.0.9

A pure-TypeScript implementation of [MeTTa](https://metta-lang.dev) (Meta Type Talk), the OpenCog Hyperon language. It runs anywhere TypeScript runs: the browser, Node, Deno, Bun, and edge or serverless functions. No native addons, no WASM, no Rust.

## Tested on Linux

This release is tested on Linux (Node 20, the CI matrix): lint, format, typecheck, the full test suite, and the build all run there. Because the engine is pure TypeScript with no native addon and no WASM, it is meant to be cross-platform and should run unchanged on any JavaScript runtime. Other operating systems are not yet part of the tested matrix.

## What's new: a recovering CST for editors and language servers

1.0.8 added a span-tracking parse for the static analyzer. This release turns it into a concrete syntax tree an editor can build on. `parseCst` never throws, so a language server can keep offering features while a document is mid-edit: an unclosed `(` closes at end of input, an unexpected `)` and an unterminated string each become a diagnostic instead of an exception, and deep nesting is bounded without a recursive overflow. The tree also carries what an editor needs and the analyzer did not: the comments, a syntactic kind per node, the paren spans, and the span of a top-level `!` query.

Leaf atoms still come from the interpreter's own reader primitives, so on valid input the CST is byte-identical to `parseAll`. A 1000-run differential checks the atoms and bang flags against the plain reader, and a 2000-run fuzz checks that the parser never throws on arbitrary input. The diagnostics are shaped as Language Server Protocol `Diagnostic`s with a range, a severity, and a stable code, so an editor consumes them directly. The static analyzer and `metta-ts --check` from 1.0.8 are unchanged and still read the interpreter's own signature table:

```
error[arity-mismatch]: prog.metta:1:2
  |
1 | !(car-atom 1 2)
  |  ^^^^^^^^^^^^^^ car-atom expects 1 argument, got 2
```

None of this touches the evaluator. `parseCst` is off the `runFile` hot path; the only change to shared code is that `readStringAt` now reports whether a string was terminated instead of throwing, and the plain parser re-throws exactly as before. The 270-assertion Hyperon oracle and every byte-identical experimental suite still pass, and a parse/eval microbench is within noise of 1.0.8.

## Corpus benchmark

The engine is unchanged in this release, so the PeTTa-corpus benchmark (107 shared programs, 97 both engines pass, median 2.01x, geomean 2.06x) is identical to 1.0.7. See [`packages/node/bench/RESULTS-corpus.md`](packages/node/bench/RESULTS-corpus.md) for the full per-program table.

## Major performance gains (since 1.0.0)

The speed comes from general engine work:

- an O(1)-stack reduce-loop trampoline and worklist, so deep recursion does not grow the JS stack;
- deferred rule-RHS freshening with a head-shape candidate pre-filter;
- Prolog-style clause indexing by head functor and by every ground-leaf argument, so a keyed query over a 1,000,000-atom space resolves in about 0.2 to 1.4 ms;
- ground-atom type memoisation and an exact-match ground-fact index;
- automatic tabling of pure functions, including ones defined at runtime, and moded (variant) tabling for non-ground pure calls;
- a native-code compiler for the pure deterministic int/bool/tuple subset, with tail-recursion compiled to loops and higher-order specialisation;
- worker-thread parallelism: `(once (hyperpose ...))` races branches across CPU cores on Node, and a `SharedArrayBuffer` flat matcher scans large knowledge bases in parallel;
- the compiled clause-skeleton and JavaScript-codegen search for match-free nondeterministic groups, added in 1.0.7.

Every optimisation is verified byte-identical against the 270-assertion Hyperon oracle.

## What is in this release

- `@metta-ts/core` is the interpreter, parser, type system, pattern matching, and standard library, as a single ESM bundle. It now also carries the static analyzer and its diagnostic model, described above. It passes all 270 assertions of Hyperon's oracle corpus (the full dependent-type tier, spaces and mutable state, nondeterminism, grounded operations, and documentation), cross-checked against [LeaTTa](https://github.com/MesTTo/LeaTTa), the machine-checked (Lean 4) MeTTa semantics pinned to the same commit.
- `@metta-ts/hyperon` is a TypeScript class API modeled on Python's `hyperon`, with a JavaScript interop layer (`js-atom`, `js-dot`, `js-list`, `js-dict`) that calls into the host runtime directly.
- `@metta-ts/edsl` is a typed eDSL with term builders, special-form combinators, and a tagged-template surface.
- `@metta-ts/node` has the `metta-ts` CLI, now with `--check` for static analysis, plus file `import!` and the worker-thread parallel matcher.
- `@metta-ts/browser` is a browser entry with an in-memory virtual file system for `import!`.
- `@metta-ts/grapher` renders a MeTTa reduction as a node graph or a nested-block view, as static SVGs or an animated GIF, with a data-driven stylesheet for node size and colour.
- `@metta-ts/das-client` and `@metta-ts/das-gateway` are an optional client to SingularityNET's Distributed AtomSpace, run end to end against a live cluster, with atom handles matching the AtomDB byte for byte.

## Install

```bash
npm install @metta-ts/core        # the interpreter (works in any JS runtime)
npm install -g @metta-ts/node     # the metta-ts CLI
```

Check a file without running it:

```bash
metta-ts --check program.metta                       # arity errors, rustc-style
metta-ts --check --undefined-symbols program.metta   # also "did you mean" on unknown heads
metta-ts --check --json program.metta                # diagnostics as an LSP Diagnostic[]
```

## Provenance

- Semantics: [hyperon-experimental](https://github.com/trueagi-io/hyperon-experimental), pinned to commit `3f76dc4`.
- Verified spec and differential oracle: [LeaTTa](https://github.com/MesTTo/LeaTTa) (Lean 4).
- Formal models: [Alloy](https://alloytools.org) specs in [`spec/`](spec/) for the matcher's deep loop rejection and the compiled search's occurs check.
- License: [MIT](LICENSE).
