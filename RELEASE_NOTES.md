# MeTTa TS 1.0.7

A pure-TypeScript implementation of [MeTTa](https://metta-lang.dev) (Meta Type Talk), the OpenCog Hyperon language. It runs anywhere TypeScript runs: the browser, Node, Deno, Bun, and edge or serverless functions. No native addons, no WASM, no Rust.

## Tested on Linux

This release is tested on Linux (Node 20, the CI matrix): lint, format, typecheck, the full test suite, and the build all run there. Because the engine is pure TypeScript with no native addon and no WASM, it is meant to be cross-platform and should run unchanged on any JavaScript runtime. Other operating systems are not yet part of the tested matrix.

## What's new: the proof-size-bounded backward chainer, from losing to winning

Nil Geisweiller's [`bfc-xp`](https://github.com/ngeiswei/chaining) benchmark searches a Łukasiewicz propositional calculus for a proof of a target formula under a fixed size bound, backtracking through modus ponens and three axiom schemes. It is a real nondeterministic search, not a lookup, and it was the one place PeTTa still beat MeTTa TS. This release closes that gap by compiling the search itself, not just the terms it searches over.

A match-free nondeterministic group (no clause queries a space, only recursion, `if`-guards, and integer arithmetic) now compiles in two steps. First, every clause becomes a skeleton: a tree of constant subtrees, clause-variable slots, and structured nodes, computed once per group rather than copied per call. Second, the skeleton compiles to specialized JavaScript, one function per functor, generated once via `new Function` and shared by every run: head unification becomes read/write-mode code that fails at the first mismatch with no allocation, and body arguments and templates become direct constructor expressions with integer arithmetic unboxed. Underneath both steps, search variables are cell variables: a binding lives in a mutable slot on the variable itself, so dereferencing is pointer-chasing and undoing a failed branch is popping a trail array, no string-keyed map anywhere. Every bind carries an occurs check, so a would-be cyclic binding fails the search instead of looping, exactly the discipline `hasLoop` enforces on the interpreter's own immutable bindings and SWI-Prolog enforces under `occurs_check(true)`. A model in [`spec/loop_reject.als`](spec/loop_reject.als) proves the two mechanisms reject exactly the same binding sets, in every possible bind order. An environment that forbids dynamic code (a CSP without `unsafe-eval`) falls back to running the skeleton directly, still far faster than the plain interpreter; a group that does query a space (like `nilbc`, MeTTa TS's dependently-typed backward chainer) is unaffected and keeps running on the original interpreter-backed search.

The result, measured with `hyperfine` (mean ± σ, wall clock, engine startup included, each row from one `hyperfine` invocation so the two columns are directly comparable):

| benchmark                                           |           MeTTa TS |              PeTTa |
| --------------------------------------------------- | -----------------: | -----------------: |
| `jarr` (size 13)                                    |  124.8 ms ± 4.2 ms | 182.9 ms ± 10.6 ms |
| `pm2.27` (size 13)                                  |  121.6 ms ± 1.3 ms |  183.0 ms ± 8.3 ms |
| `imim1` (size 15)                                   |  152.2 ms ± 4.1 ms |  212.3 ms ± 3.9 ms |
| `jarr` (size 17), PeTTa with `occurs_check(true)`   | 455.5 ms ± 69.5 ms | 476.0 ms ± 11.8 ms |
| `loowoz` (size 19), PeTTa with `occurs_check(true)` |  2.092 s ± 0.063 s |  2.501 s ± 0.003 s |

The last two rows run PeTTa with `occurs_check(true)`, which its SWI-Prolog translation does not set (the flag defaults to off). At these two deeper searches that gap is not just a speed difference: PeTTa as shipped finds 94 answers for `jarr` at size 17 where only 91 exist, and 44 for `loowoz` at size 19 where only 3 exist, the surplus being cyclic-binding artifacts that `occurs_check` is exactly the guard against (the same requirement `bfc-xp`'s own SWI harness documents). Run correctly, PeTTa is a little slower here too. Every MeTTa TS answer above is checked byte-identical to the plain interpreter by a differential oracle that runs the search both ways (`packages/core/src/moded-tabling.test.ts`), and the compiled and interpreted engines' outputs are additionally diffed directly at sizes 17 and 19.

## Corpus benchmark

The existing PeTTa-corpus benchmark (107 shared programs, 97 both engines pass, median 2.01x, geomean 2.06x) is unaffected by this release: none of those programs exercise a match-free nondeterministic group, so they run the same code as before. See [`packages/node/bench/RESULTS-corpus.md`](packages/node/bench/RESULTS-corpus.md) for the full per-program table.

## Major performance gains (since 1.0.0)

The speed comes from general engine work:

- an O(1)-stack reduce-loop trampoline and worklist, so deep recursion does not grow the JS stack;
- deferred rule-RHS freshening with a head-shape candidate pre-filter;
- Prolog-style clause indexing by head functor and by every ground-leaf argument, so a keyed query over a 1,000,000-atom space resolves in about 0.2 to 1.4 ms;
- ground-atom type memoisation and an exact-match ground-fact index;
- automatic tabling of pure functions, including ones defined at runtime, and moded (variant) tabling for non-ground pure calls;
- a native-code compiler for the pure deterministic int/bool/tuple subset, with tail-recursion compiled to loops and higher-order specialisation;
- worker-thread parallelism: `(once (hyperpose ...))` races branches across CPU cores on Node, and a `SharedArrayBuffer` flat matcher scans large knowledge bases in parallel;
- the compiled clause-skeleton and JavaScript-codegen search described above, for match-free nondeterministic groups.

Every optimisation is verified byte-identical against the 270-assertion Hyperon oracle.

## What is in this release

- `@metta-ts/core` is the interpreter, parser, type system, pattern matching, and standard library, as a single ESM bundle. It passes all 270 assertions of Hyperon's oracle corpus (the full dependent-type tier, spaces and mutable state, nondeterminism, grounded operations, and documentation), cross-checked against [LeaTTa](https://github.com/MesTTo/LeaTTa), the machine-checked (Lean 4) MeTTa semantics pinned to the same commit.
- `@metta-ts/hyperon` is a TypeScript class API modeled on Python's `hyperon`, with a JavaScript interop layer (`js-atom`, `js-dot`, `js-list`, `js-dict`) that calls into the host runtime directly.
- `@metta-ts/edsl` is a typed eDSL with term builders, special-form combinators, and a tagged-template surface.
- `@metta-ts/node` has the `metta-ts` CLI, file `import!`, and the worker-thread parallel matcher.
- `@metta-ts/browser` is a browser entry with an in-memory virtual file system for `import!`.
- `@metta-ts/grapher` renders a MeTTa reduction as a node graph or a nested-block view, as static SVGs or an animated GIF, with a data-driven stylesheet for node size and colour.
- `@metta-ts/das-client` and `@metta-ts/das-gateway` are an optional client to SingularityNET's Distributed AtomSpace, run end to end against a live cluster, with atom handles matching the AtomDB byte for byte.

## Install

```bash
npm install @metta-ts/core        # the interpreter (works in any JS runtime)
npm install -g @metta-ts/node     # the metta-ts CLI
```

## Provenance

- Semantics: [hyperon-experimental](https://github.com/trueagi-io/hyperon-experimental), pinned to commit `3f76dc4`.
- Verified spec and differential oracle: [LeaTTa](https://github.com/MesTTo/LeaTTa) (Lean 4).
- Formal models: [Alloy](https://alloytools.org) specs in [`spec/`](spec/) for the matcher's deep loop rejection and the compiled search's occurs check.
- License: [MIT](LICENSE).
