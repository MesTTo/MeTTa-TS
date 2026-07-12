# MeTTa TS 1.1.4

MeTTa TS 1.1.4 adds selective nested-head indexing for immutable static facts.
Queries such as `(num (M $x))` can select the matching `M` bucket while the
normal unifier preserves MeTTa result order, multiplicity, and fallback
semantics.

## Static nested matching

Static `&self` facts now have a nested argument-functor candidate index. A
pattern such as `(num (M $x))` selects the `M` bucket instead of scanning every
static `num` fact. The path applies to one match pattern over an immutable
ground fact bucket. Static removals, state cells, runtime additions,
variable-headed facts, non-ground facts, and conjunctions disable the new
static nested path. Runtime additions retain their separate compact-store
index. Static candidate selection then follows the existing complete or
leaf-indexed paths. Existing leaf-key selection retains precedence. The full
unifier remains authoritative.

Indexed and custom-grounded residual candidates merge by source occurrence,
so the nested path retains insertion order and duplicate multiplicity. Skipped
ground candidate attempts are restored to the evaluator counter. Leaf index
keys now retain custom grounded matchers as residual candidates and use one
numeric key for integer and float values, matching ground equality.

The selective static nested scale case passed at the 30,000-fact default and
with `node packages/node/bench/scale-proof.mjs --size=100000`.
`pnpm bench:nested-index` validates complete ordered result sequences and
counters while measuring selective and dense cases up to 1,000,000 facts.
Detailed measurements are in
[`packages/node/bench/RESULTS.md`](packages/node/bench/RESULTS.md).

## Verification

The workspace build, typecheck, lint, formatting check, documentation build,
benchmark suite, and 270-assertion oracle pass. The full suite passes 109 test
files and 1,079 tests, with 38 optional live integration tests skipped.

The concurrency benchmark status now states both parts of its regression gate:
the median must exceed 1.5 times the baseline and add more than 1 millisecond.

## Repository links

Package metadata, documentation links, and the GitHub Pages base path now use
the canonical [`MesTTo/MeTTa-TS`](https://github.com/MesTTo/MeTTa-TS)
repository name.

`@metta-ts/grapher` now ships a package README. Its examples distinguish
starting a reduction trace from scheduling later trace steps, and its GIF
example contains a reducible expression.

## Install

```bash
npm install @metta-ts/core@1.1.4
npm install -g @metta-ts/node@1.1.4
```

Optional host packages use the same version:

```bash
npm install @metta-ts/py@1.1.4 pythonia
npm install @metta-ts/prolog@1.1.4
```

## Provenance

- Semantics: [hyperon-experimental](https://github.com/trueagi-io/hyperon-experimental).
- Verified differential semantics: [LeaTTa](https://github.com/MesTTo/LeaTTa).
- License: [MIT](LICENSE).
