# MeTTa-TS ⟷ PeTTa parity

Goal: pass and outrun PeTTa on the example corpus while staying byte-identical to LeaTTa
`MettaHyperonFull` for core semantics. Re-benchmark after each change. Hyperon conformance remains a
regression surface, not the authority when it disagrees with LeaTTa.

## Status (`corpus-bench --engine=both`)

107 examples (42 host-FFI / PeTTa-execution-model cases excluded as N/A in the last full run). MeTTa-TS
passed 96 shared files in that run and beat PeTTa on most shared passing files. Re-run before making any
fresh headline claim: the current unresolved split is PLN/NARS lib ports, selfprog, greedy_chess status, and
the `matespace` family. `matespace`/`matespace2` now have a faster collapse-count route on finite slices, but
the PeTTa constants are not established as Hyperon expected values for the current no-barrier files.

## Done

- Corpus `bench/corpus-mettats/`: the PeTTa examples adapted to LeaTTa conventions, attributed to PeTTa (MIT).
- Engine bugs fixed (genuine, not adaptations): `sealed`/`|->` body laziness; grounded-op type declarations;
  alpha-unique-atom; occurs check on rebind reconciliation (nilbc); `add-atom`/`remove-atom` store unreduced
  + `add-reducts` reduces; compile tuple-memo key; parser string round-trip; `if` return type `$t`.
- Perf (oracle byte-identical): O(1)-stack reduce trampoline; Set-based binding path; deferred rhs
  freshening + candidate pre-filter; `getTypes` memo; persistent ground-fact exact-match index (peano
  15.4s→3.7s); count-without-materialise + O(1) worklist (permutations un-timed-out); runtime-rule tabling
  (fibadd); tuple compilation + PeTTa-style higher-order specialiser + param-type inference
  (patrick_iterate_quad >90s→0.31s); scoped matcher (rename-at-bind); worker-thread race for
  `(once (hyperpose …))` (hyperpose_primes 15s timeout→1.4s).
- Perf, allocation-floor pass (oracle byte-identical): instantiate recomputes the `ground` flag so
  instantiated-to-ground terms hit the evaluated-mark cache; constructor/normal-form short-circuit (nilbc
  3.1s→2.2s, ~1.4x); live-variable caching across branch restriction (one-pass `chainLiveVars`,
  empty-`vars` short-circuits); direct hot-binding resolution via `lookupVal` in `restrictBnd`/`splitConjGoals`
  (permutations −3%); streamed `(case (match …) cases)` emit, folding match values through the case body
  without materialising the collapsed tuple (peano 3.5s→2.8s, ~1.25x; gated, `METTA_STREAM_CASE`). Validated
  by the 270 oracle, full suite, and a 600-case streaming-vs-materialising counter differential.
- Experimental compact atomspace (`experimental.flatAtomspace` / `--flat-atomspace`, OFF by default so the
  oracle path is untouched). `flat-atomspace.ts`: runtime `&self` additions stored as interned TermId/FactId
  in typed-array chunks with exact ground-membership counts, tombstoned removals, and rollback-safe roots,
  instead of JS `Atom` trees (~5 KB/atom). Crosses the matespace memory floor — K=4 no longer OOMs under the
  flag. Byte-identical to the materialising path (full suite 619, an on/off corpus differential, round-trip
  `format(decode(encode))`). See Remaining 2: matespace is then CPU-bound, not memory-bound.
- Named spaces indexed for O(1) ground membership (`World.spaces` holds the same `AtomLog` `&self` uses:
  O(1) append with structural sharing, a ground-membership index, the membership fast path padding the
  counter by the space size so the fresh-variable numbering is byte-identical to the scan). This turned the
  tilepuzzle BFS visited-set from O(n²) to O(n); with a `runFile` import fix (let a corpus file import its
  sibling `../lib`), tilepuzzle goes from a degenerate timeout to 1.03s, byte-identical (181441), beating
  PeTTa's 1564ms. Also a query-variable `compileSymbolic` path so `(move $state $_)` stays compiled. All
  byte-identical (270 oracle, full suite, compiled-vs-interpreter corpus differential, a query-var counter
  differential).
- No `curry` mode. PeTTa-style partial application is ordinary behavior where supported, not an
  import-controlled evaluator switch.
- Two review passes: dead code removed, inelegances fixed, jscpd clean.

## Remaining

1. **PLN / NARS lib ports.** lib_pln (pln_direct/roman/tuffy), lib_nars (nars_direct/tuffy), lib_roman
   (roman_test). The truth arithmetic ports cleanly, but the example files use PeTTa execution-model
   primitives (`cut`, `reduce`, `(cons , $args)`, `progn`), so a faithful pass needs the examples rewritten
   in Hyperon style, not just a lib port.
2. **Perf outliers and PeTTa execution-model cases.** The last confirmed crossings were permutations via
   the conjunctive worst-case-optimal collapse-count;
   nilbc via the compiled nondeterministic let*-chain search (0.40s vs 0.71s, alpha-equivalent
   fresh naming); peano via the compiled add-atom saturation loop, the add-if-absent idiom as one
   exact-membership probe and the single-branch case-over-match as a snapshot-and-thread loop
   (0.22s vs 1.69s, byte-identical). **tilepuzzle now PASSES and beats PeTTa**: 1.03s vs
   1564ms, byte-identical (181441). Its BFS visited-set is a NAMED space, and named spaces were stored as an
   unindexed `Atom[]` (O(n) copy-on-write per `add-atom`, O(n) linear scan per `match`) while `&self` had an
   append-only log + ground index, so the search was O(n²). Storing each named space as the same `AtomLog`
   `&self` uses (O(1) append, ground-membership index) makes it O(n); the membership fast path pads the
   counter by the space size so the fresh-variable numbering is byte-identical to the scan. (A second fix:
   `runFile` was rejecting tilepuzzle's `../lib` import, so it had been running degenerate.) The
   `matespace` family is a separate two-floor case:
   - **Memory floor (done, experimental).** The default path stores each runtime atom as a JS expr tree
     (~5 KB/atom), so matespace's millions-of-states BFS V8-OOMs at the K=4 slice. `experimental.flatAtomspace`
     crosses this — under the flag K=4 no longer OOMs (RSS bounded), byte-identical. Promoting it to default
     is future work (it must subsume named spaces, custom grounded matchers, and every observable boundary
     byte-identically first; today it is opt-in).
   - **CPU floor and semantic split.** matespace uses `&self` (already indexed), so it is not the
     named-space bug. The current no-barrier MeTTa-TS slices grow as `matespace K0=2, K1=4, K2=30, K3=690`
     and `matespace2 K0=1, K1=4, K2=39, K3=42588`; both K4 probes timed out under a 30s cap, and
     `expandK 4` alone times out. `case (once (match ...))` now compiles, so `mate` compiles in
     `matespace`/`matespace2` and `rewriteK` compiles in `matespace2`; the real CLI slice improved
     `matespace2 K3` to about 0.90s. The discard route preserves tuple `Empty` pruning and now declines
     multi-branch dead compiled calls, because multiplying one final tail count by a multi-branch
     side-effecting build is unsound. PeTTa's `1063919`/`1297533` constants are not Hyperon-oracle values for
     these adapted files; returning them would be a semantic bug. The full non-cheating fix is either a
     Hyperon-native benchmark shape or a semi-naive/frontier aggregate evaluator proven against the ordinary
     interpreter.
3. **selfprog.** Two parts. (a) remove-atom of a static top-level rule: `eraseSpace` erases only the runtime
   `selfExtra` log, not `env.ruleIndex`, so the rule still reduces. Fix is a copy-on-write `removedStatic`
   tombstone on the World (stays branch-local like `selfExtra`), filtered in `candidates()`/`selfAtoms`
   behind an empty-set fast path, with compiled/tabling caches invalidated for a tombstoned head. (b) strict
   `repr`: a PeTTa primitive that evaluates its argument; @metta-ts types it lazy (`Atom`) for the curry
   repr-of-partial tests.

## Excluded (N/A): PeTTa execution model, not LeaTTa

- Host FFI: python, torch, prolog, git, llm, repl.
- Prolog execution model: cons-list matching `(cons $h $t)`, reverse/inverted function matching,
  head-eval-then-apply, `=`-as-unification, `call`/`eval`/`reduce` full-eval, unify-as-space-query.
- 2-arg `if` (ifsimple, booleansolver); PeTTa higher-order library and specializer shapes outside the
  supported partial-application surface (library, holbenchmark, specializefunctiontypes); relational logic
  (logicprog, scale).
- superpose-as-union (mettaset, metta4_streams, casenew): LeaTTa cross-products the tuple, so an `(empty)`
  element empties the whole superpose.
- overloaded-function dispatch (types_nondet): `(Error (f T1in) (BadArgType 1 Type2 Type1))` byte-identical
  to the LeaTTa binary; PeTTa's answer is PeTTa-only.

## Corpus adaptation conventions

- `assertEqual`/`assert*` return `()` on pass (PeTTa returns True). `assertEqualToResult`'s second argument
  is the expected result set as an unevaluated comma tuple; collapse of one result `r` is `(, r)`.
- Bool literals `True`/`False`; collapse is a comma tuple; floats render full IEEE.
- Math returns Float: pow/sqrt/log/min-atom/max-atom, and trunc/ceil/floor/round on float input.
- `==` is `(-> $t $t Bool)`; Hyperon has no `!=`.
- Keep MeTTa-TS LeaTTa-correct; never bend the engine to a PeTTa-ism.
