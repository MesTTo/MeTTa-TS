# MeTTa TS 1.0.8

A pure-TypeScript implementation of [MeTTa](https://metta-lang.dev) (Meta Type Talk), the OpenCog Hyperon language. It runs anywhere TypeScript runs: the browser, Node, Deno, Bun, and edge or serverless functions. No native addons, no WASM, no Rust.

## Tested on Linux

This release is tested on Linux (Node 20, the CI matrix): lint, format, typecheck, the full test suite, and the build all run there. Because the engine is pure TypeScript with no native addon and no WASM, it is meant to be cross-platform and should run unchanged on any JavaScript runtime. Other operating systems are not yet part of the tested matrix.

## What's new: a static analyzer and `metta-ts --check`

This release adds a static analyzer that catches mistakes before a program runs and reports them the way a modern compiler does: the exact source span underlined, an error code, a message, and a suggested fix. It ships in `@metta-ts/core` as a library and on the `metta-ts` CLI as `--check`.

The analyzer reads the interpreter's own signature table, so it flags exactly the calls the interpreter itself would reject. A builtin called with the wrong number of arguments is checked against the same `(-> ...)` declaration the evaluator uses at run time, not against a second copy of the arity rules that could drift from it:

```
error[arity-mismatch]: prog.metta:1:2
  |
1 | !(car-atom 1 2)
  |  ^^^^^^^^^^^^^^ car-atom expects 1 argument, got 2
```

An opt-in `--undefined-symbols` pass adds a "did you mean" on an unknown head, suggesting the closest defined name by edit distance. It is off by default because MeTTa's add-mode makes an unknown head legal: `(foo 1 2)` with no rule for `foo` is data added to the space, not a typo. With the flag on, `(fibonaci 10)` next to a defined `fibonacci` becomes a warning that carries the fix, never an error.

Precise spans come from a span-tracking parse that reuses the interpreter's own reader primitives, so the analyzer cannot disagree with the real parser about where a token starts or ends. `--json` emits the findings as a Language Server Protocol `Diagnostic[]`, each with a range, a severity, a code, and suggestions that carry an applicability tier, so an editor or a language server can consume them directly.

None of this changes the evaluator. The only edit to existing run-time code is a refactor of the parser that exports the primitives the span parser reuses, and it is guarded by the parser's own tests. So the 270-assertion Hyperon oracle and the corpus benchmark below are byte-identical to 1.0.7, and the analyzer adds no dependency.

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
