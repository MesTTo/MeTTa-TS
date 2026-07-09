# MeTTa TS 1.1.3

MeTTa TS 1.1.3 improves nondeterministic evaluation and bounds every automatic
table allocation. The default evaluator is faster than PeTTa on the four
reported nondeterministic workloads while preserving Hyperon semantics. There
is no benchmark mode, PeTTa mode, curry mode, or manually selected fast path.

## Tested on Linux

This release is prepared on Linux with Node 22 and pnpm 11. The release gate
builds every package, typechecks the workspace, runs the full Vitest suite,
builds the GitHub Pages documentation, runs the Hyperon oracle, runs the scale
proof, and runs the benchmark suite before tagging.

The final suite passed 109 test files and 1,063 tests, with 38 optional live
integration tests skipped. The checked 270-assertion oracle passed all 23
corpus files.

The external Core/ST conformance result is unchanged from the untouched 1.1.2
baseline: 431 passed, 77 failed, 60 manifest expected failures, and 0 skipped.
The remaining failures are existing parser, directive, kernel, typing, and
stdlib contract differences. This release does not claim full specification
conformance.

## Nondeterministic execution

The new checked benchmark keeps four query shapes reported by Patrick Hammer
as ordinary `.metta` files. Five-run subprocess medians include startup:

| Program                          |     PeTTa |  MeTTa TS | Speedup |
| -------------------------------- | --------: | --------: | ------: |
| filtered `matespacefast` matches | 5738.1 ms | 3344.2 ms |   1.72x |
| 22^4 `superpose` cross product   |  388.7 ms |  148.5 ms |   2.62x |
| nondeterministic tabled `fib(7)` |  180.1 ms |   99.6 ms |   1.81x |
| duplicate-heavy `TupleConcat`    |  178.8 ms |  101.1 ms |   1.77x |

The harness validates 234,256 cross-product results, 196 distinct Fibonacci
answers, the exact `TupleConcat` sequence, and the embedded matespace
assertion. Run it with `pnpm bench:nondeterminism`.

A slot-based choice evaluator handles closed pure `let`, `let*`, `superpose`,
integer arithmetic, comparisons, `if`, and constructor tuples. Unsupported,
redefined, ill-typed, async, or executable-grounded forms stay on the normal
interpreter path. Result order and multiplicity are unchanged.

`unique-atom(collapse(call))` can evaluate a supported static pure integer
recurrence as a first-seen answer set. Closed pure choice products also retain
first-seen answers as they emit instead of materializing a duplicate bag first.
An ordinary `collapse(call)` still returns its exact ordered bag with duplicate
derivations. Ground answer deduplication uses structural hashes with equality
checks instead of a quadratic scan.

## Bounded automatic tabling

Automatic table admission remains conservative. The whole rule dependency
graph must be pure, the call key must be safe, and the recursive component must
branch back into itself at least twice. Linear recursion stays on the normal
compiled path.

The policy does not assume that every recursive program is safe to memoize and
does not let admitted tables grow until the process runs out of memory. It
combines the static overlap test with one global runtime budget. Exceeding the
active-state budget returns `TableResourceLimit`; it does not continue toward
an out-of-memory failure.

Completed and active tables now share these default ceilings:

- 50,000 entries
- 1,000,000 answers
- 1,000,000 retained atom cells
- 100,000 cells in one entry
- 250,000 interned leaves

Completed tables are removed in least-recently-used order. Active tables are
not evicted while their producer runs, so they return `TableResourceLimit` when
the shared budget cannot fit more state. The consumer-directed recurrence memo
uses the same entry, answer, cell, and per-entry limits. Interner generations
prevent stale tail-call keys from writing after a reset.

Direct active variant recursion still uses local-linear fixed-point completion.
Non-cyclic calls preserve exact ordered bags. The evaluator does not infer
Picat-style `min` or `max` answer subsumption.

## Matching and scale

Ground runtime facts now have a nested argument-functor index. A pattern such
as `(num (M $x))` selects the `M` bucket instead of scanning every `num` fact.
The matcher falls back to complete candidates when a non-ground fact could
unify.

A finite in-memory match whose result is discarded by a standard
`let ... (empty)` is removed before enumeration. The optimization declines for
custom grounded matchers, mutable state handles, changed standard forms, and
non-memory spaces.

The 30,000-fact scale gate also runs larger actual MeTTa workloads:

| Program                    |                  Checked result |     Time |
| -------------------------- | ------------------------------: | -------: |
| 24^4 pure choice product   |                 331,776 answers |  81.2 ms |
| duplicate tuple product    | 50 values from 500,000 branches |  30.8 ms |
| nondeterministic `fib(10)` |          2,817 distinct answers |  73.4 ms |
| nested runtime match       |                  30,000 answers | 647.3 ms |

## Correctness fixes

- `superpose` in the choice evaluator now strips a collapsed bag's leading
  comma marker. The recursive `supercollapse` corpus case remains empty as
  Hyperon requires.
- Choice planning now respects application type errors, expression-headed
  rewrite rules, and replaced sync or async grounded operations.
- Nested indexing no longer changes candidate enumeration when a pattern has
  no nested-head constraint.
- Active table entries and answers count against the same global resource
  budget as completed entries.
- The purity firewall now treats custom sync and async grounded operations as
  effectful unless they are the unchanged implementation of a known-pure
  built-in. File, catalog, random, time, output, fresh-identity, and host calls
  cannot enter automatic tables transitively.
- File handles can be closed immediately with `file-close!` and are also closed
  when their grounded atom is collected. Dictionary spaces and file records use
  weak-key storage instead of lifetime-unbounded global maps. Grounded behavior
  and non-default grounded types remain on the lossless atomspace path.
- Grounded-operation registration invalidates evaluated terms, table analyses,
  and compiled closures that may encode the previous dispatch behavior.
- DAS gateway binding responses must contain exactly one MeTTa atom per value.
  Malformed or multi-atom wire values now fail at the decode boundary.
- Git imports pass an end-of-options marker before the repository path.
- The unused `streamEmit`, `tableBackchain`, and `trieSpace` experimental
  options have been removed. They never selected an implementation.

## Install

```bash
npm install @metta-ts/core@1.1.3
npm install -g @metta-ts/node@1.1.3
```

Optional host packages use the same version:

```bash
npm install @metta-ts/py@1.1.3 pythonia
npm install @metta-ts/prolog@1.1.3
```

## Provenance

- Semantics: [hyperon-experimental](https://github.com/trueagi-io/hyperon-experimental).
- Verified differential semantics: [LeaTTa](https://github.com/MesTTo/LeaTTa).
- Host compatibility: PeTTa-compatible Python and Prolog bridge forms where
  they do not depend on PeTTa's evaluator.
- License: [MIT](LICENSE).
