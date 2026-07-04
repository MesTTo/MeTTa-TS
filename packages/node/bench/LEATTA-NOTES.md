<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# LeaTTa as a secondary oracle: usage, divergences, and the improvements list

LeaTTa (`/home/user/Dev/LeaTTa`, the user's own Lean 4 formalization of MeTTa, version 1.0.6) is a
total, machine-checked minimal-MeTTa semantics that passes Hyperon's own 270-assertion oracle. We use
its binary as a secondary differential oracle when settling a semantic question the 270-test Hyperon
oracle does not already pin down, for example whether `superpose` evaluates its tuple argument as a
cross-product.

Priority order stays: real Hyperon (`hyperon-experimental`) first, the written spec second, LeaTTa
third. LeaTTa is total and proved, but it models the *minimal* interpreter and is not a drop-in for the
full Hyperon runtime, so where it is silent or less complete than Hyperon we defer to Hyperon. This
file records what LeaTTa agrees with us on (which confirms a behaviour is Hyperon-faithful), where
LeaTTa itself diverges, and how its "Improvements over Hyperon" list maps onto MeTTa-TS.

## Running the binary

```
cd /home/user/Dev/LeaTTa
./.lake/build/bin/LeaTTa --min '!(collapse (range 1 5))'
```

Modes (from `Main.lean`): `--min '<src>'` runs minimal-MeTTa source, `--file` / `--min-file <path>`
runs a `.metta` file, `--oracle <path>` runs in oracle mode, `--mettail <path> --term <t> [--fuel n]`
reduces a MeTTaIL term. Two usage notes:

- `--min` only prints results for `!`-prefixed expressions. A bare `(+ 1 2)` is added to the space and
  produces no output; you need `!(+ 1 2)`. Forgetting the bang makes every probe look like it returns
  `[]`.
- There is no `--help`. An unknown flag falls through to the default case and is evaluated as
  minimal-MeTTa source, so `--help` parses as a program and prints `[]`.

## Output-format divergences (cosmetic, not semantic)

These show up as text differences in a naive diff but carry no semantic weight. Normalize them before
comparing.

- Results are wrapped in `[...]`; multiple nondeterministic results are comma-joined inside, e.g.
  `!(superpose (1 2 3))` prints `[1, 2, 3]`.
- A collapsed / tuple Expression is printed with a leading `,`: `!(collapse (match &self (foo $x) $x))`
  prints `[(, 1 2 3 1)]` where MeTTa-TS prints `[(1 2 3 1)]`. The `,` is LeaTTa's printer marking an
  Expression-as-data; the elements are identical.
- The empty tuple / unit prints as `(,)`.

## Semantic divergence: LeaTTa does not arity-check

LeaTTa checks argument *types* but not argument *count*. A typed function or grounded op applied to the
wrong number of arguments is left unreduced instead of erroring. MeTTa-TS matches Hyperon here (it
errors), so this is a place LeaTTa is the one that diverges.

| Input | LeaTTa | MeTTa-TS / Hyperon |
| --- | --- | --- |
| `(if True 1)` | `(if True 1)` (unreduced) | `(Error (if True 1) IncorrectNumberOfArguments)` |
| `(+ 1)` | `(+ 1)` (unreduced) | `(Error (+ 1) IncorrectNumberOfArguments)` |
| `(+ 1 2 3)` | `(+ 1 2 3)` (unreduced) | `(Error (+ 1 2 3) IncorrectNumberOfArguments)` |
| `(if 5 a b)` | `(Error (if 5 a b) (BadArgType 1 Bool Number))` | same |

Hyperon's `if` is typed `(-> Bool Atom Atom $t)` (`stdlib.metta:511`), so `(if True 1)` is a 2-of-3
arity error. The last row shows the contrast: a *type* mismatch on the right number of arguments is
caught by both (`BadArgType`), only the *count* mismatch is missed by LeaTTa.

## Agreements that confirm MeTTa-TS is Hyperon-faithful

Each of these was a question we settled by running LeaTTa; in every case LeaTTa produced the same
result as MeTTa-TS, confirming the behaviour is Hyperon-correct and not a MeTTa-TS bug.

- **`superpose` evaluates its tuple argument as a cross-product.** `!(collapse (superpose ((1 (superpose
  (a b))) (2 (superpose (c d))))))` gives `{a,b}x{c,d}` flattened, and `!(collapse (superpose (4
  (empty))))` is empty because `{4}x{}` is empty. This is why the corpus files `mettaset` and
  `metta4_streams` are excluded: they rely on PeTTa unioning the tuple elements instead, so PeTTa's
  `range` built from `(superpose ($K (range (+ $K 1) $N)))` streams `1..N` while Hyperon/LeaTTa/MeTTa-TS
  yield nothing once the `(empty)` base case empties the product. Same root as the `spaces2` note.
- **Argument type errors agree** (`BadArgType` on `(if 5 a b)`, `get-type` results, `(== 1 1.0)` = `False`).
- **Return-type-`Atom` inertness.** A function declared `(: f (-> Number Atom))` has its result left
  inert: `(f 1)` with `(= (f $x) (g $x))` stays `(g 1)`, it is not reduced to `(g 1)`'s value, whereas
  the same body under a `Number` return type evaluates through. This is LeaTTa improvement #1 (below),
  and MeTTa-TS already implements it.
- **First-argument indexing is sound, with no same-head undercounting** (LeaTTa improvement #9 / Hyperon
  open issues 1079, 1076). A space of `(foo 1) (foo 2) (foo 3) (foo 1)` queried by `(foo $x)` returns
  all four including the duplicate; exact ground duplicates are counted with correct multiplicity; and a
  ground query against a space that also holds a variable-headed atom correctly returns both matches
  (the index fast path is bypassed when any head-less atom is present). Covered by `index-match.test.ts`.

## The "Improvements over Hyperon" list, mapped to MeTTa-TS

LeaTTa's book appendix (`book/Docs/Appendices.lean`, section "Improvements over Hyperon") lists nine
points where Hyperon's `interpreter.rs` carries a self-described hack, a hotfix, or an open bug, and
LeaTTa replaces it with a declarative construct. Assessed against MeTTa-TS:

1. **`is_evaluated()` mutable bit (hack) -> static return-type gating.** Already satisfied: MeTTa-TS
   treats a function's result as inert iff its declared return type is `Atom` (verified above), with no
   mutable per-atom bit. Our `evaluatedAtoms` WeakSet is a separate ground-term memo for the Peano
   O(n^2) case, not the inertness rule.
2. **`is_variable_op` hotfix -> total variable-headed guard.** N/A as a defect: MeTTa-TS dispatches
   variable-headed expressions through the matcher directly.
3. **Tuple-vs-function dispatch decided twice (issues 235, 458) -> decided once from the signature.**
   MeTTa-TS decides from the operator's signature / argMask in one place.
4. **`Rc<RefCell>` shared mutability -> pure immutable stack.** N/A by construction: the TS core is
   already a pure persistent World with copy-on-write, so the borrow-panic class cannot occur.
5. **Global `make_unique` counter -> threaded gensym.** Implementation hygiene; MeTTa-TS freshens
   through the binding machinery, not a process-global.
6. **Unbounded interpreter loop -> fuel-bounded driver.** Already satisfied: `interpretLoopG` /
   `mettaEvalG` carry `fuel` and degrade to a `StackOverflow` atom.
7. **Fragile cross-call binding threading (issues 127, 715, 290, 530, 911) -> pure state transformer.**
   N/A as a defect: bindings are threaded as immutable values; `resolveAtomFix` does the transitive
   resolution.
8. **Stubbed alpha-equivalence -> real alpha-equivalence.** MeTTa-TS passes the alpha corpus
   (`is_alpha_member_test`, `test_alpha_unique_atom`); not a stub here.
9. **`Space::visit` undercounting same-head atoms (issues 1079, 1076, open) -> sound first-argument
   indexing.** Directly relevant to the index added for the Peano fix; verified sound above and in
   `index-match.test.ts`.

The points are either already true of MeTTa-TS (1, 6, 8, 9) or describe Hyperon-internal Rust hygiene
that a pure-functional TS core avoids by construction (2, 3, 4, 5, 7). None require a change.

## Note on `HYPERON_IMPROVEMENTS.md`

`MeTTaIL/HYPERON_IMPROVEMENTS.md` in the LeaTTa tree, despite the filename, is about the MeTTaIL Scala
tool (theory-presentation elaboration for Rholang: `updateDef`, `replaceCats`, `check_interpret`), not
the MeTTa evaluator. Its five findings are bugs in that tool's sort-renaming and static checks and do
not transfer to MeTTa-TS. The MeTTa-evaluator improvements are the nine in the book appendix above.
