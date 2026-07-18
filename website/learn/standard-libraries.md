<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Standard libraries

MeTTa TS ships a set of ready-made libraries you can pull into a program. They are ports of the libraries from [PeTTa](https://github.com/patham9/PeTTa), the SWI-Prolog implementation of MeTTa, re-expressed to run on this Hyperon-faithful engine: the algorithms are the same, but the code uses this engine's own primitives rather than PeTTa's Prolog-specific ones.

## Importing a library

Each library is a named module. You bring one into your program's space with `import!`:

```metta
!(import! &self vector)
```

That makes the library's functions, their type signatures, and their documentation available in `&self`. Nothing is imported until you ask for it, so a plain program pays no cost for libraries it does not use. Once imported, you call the functions like any other:

```metta
!(import! &self vector)
!(dot (1.0 2.0 3.0) (4.0 5.0 6.0))   ; 32.0
!(norm (3.0 4.0))                    ; 5.0
```

The rest of this page walks through each library. Every example is run on the engine and shows its real output.

## vector

Dense numeric vectors, written as ordinary expression lists, with dot product, Euclidean norm, and cosine similarity.

```metta
!(import! &self vector)
!(dot (1.0 2.0 3.0) (4.0 5.0 6.0))   ; 32.0
!(norm (3.0 4.0))                    ; 5.0
!(cosine (1.0 0.0) (0.0 1.0))        ; 0.0, the vectors are orthogonal
```

`random-normal-vector` builds a random unit vector of a given dimension: `!(random-normal-vector 3)` returns three numbers scaled to length one.

## combinatorics

Combinatorial generators. `range` yields each integer in a half-open interval as a separate nondeterministic result, so you usually `collapse` it to gather them:

```metta
!(import! &self combinatorics)
!(collapse (range 0 4))          ; (, 0 1 2 3)
!(chooseKl (a b c) 2)            ; ((a b) (a c) (b c)): every 2-subset
!(takeK 2 (a b c d))             ; (a b): the first two elements
```

`choose2` gives every unordered pair, `chooseK` yields the k-subsets one at a time (the nondeterministic twin of `chooseKl`), and `takeK` truncates a list.

## roman

A Haskell-style functional prelude (named after its author, Roman Treutlein, not the numerals): higher-order maps and folds, set operations, function composition, and list-end accessors. The set operations take a predicate; the `=` variants match by unification, the `==` variants by strict equality, and the `=a` variants by alpha-equality.

```metta
!(import! &self roman)
(= (double $x) (* $x 2))
!(map-flat double (1 2 3))       ; (2 4 6)
!(fold-flat + 0 (1 2 3))         ; 6
!(/==\ (1 2 3) (2 3 4))          ; (2 3): intersection by ==
!(\== (1 2 3) (2 3 4))           ; (1): difference by ==
!(mylast (a b c))                ; c
```

## patrick

Patrick Hammer's `compose`: apply a list of single-argument functions right to left over an argument tuple.

```metta
!(import! &self patrick)
(= (inc $x) (+ $x 1))
(= (double $x) (* $x 2))
!(compose (double inc) (5))      ; 12: double(inc(5))
!(compose (inc double) (5))      ; 11: inc(double(5))
```

## datastructures

An amortized-O(1) functional queue and a fast unique-insert set. A queue keeps two stacks and a count. `enqueue` adds to the back; `dequeue` returns the front element paired with the rest of the queue, and yields nothing when the queue is empty:

```metta
!(import! &self datastructures)
!(dequeue (enqueue c (enqueue b (enqueue a (empty-queue)))))
; (Pair a (queue () (b c) 2)): a came in first, so it comes out first
```

`add-unique-or-fail` adds an atom to a space only when an equal one is not already there, which makes a space behave like a set.

## spaces

Utilities over atomspaces. `migrateAtoms` moves every atom matching a pattern from one space to another; `remove-all-atoms` empties a space.

```metta
!(import! &self spaces)
!(add-atom &warehouse (box 1))
!(add-atom &warehouse (box 2))
!(migrateAtoms &warehouse &shipped (box $n))
!(collapse (match &shipped $x $x))   ; (, (box 1) (box 2)): both boxes moved
```

## nars

A compact NARS (Non-Axiomatic Reasoning System) forward-chaining reasoner: the NAL truth-value functions, the NAL-1 to NAL-5 inference rules, and a priority-queue derivation engine. A truth value is `(stv <frequency> <confidence>)`, and a belief is a `Sentence` carrying a truth value and an evidence trail.

The truth functions combine two truth values the way NAL prescribes:

```metta
!(import! &self nars)
!(Truth_Deduction (stv 0.8 0.9) (stv 0.7 0.6))   ; (stv 0.5599999999999999 0.3024)
!(Truth_Expectation (stv 0.8 0.9))               ; 0.77
```

`NARS.Query` runs bounded forward chaining over a knowledge base and returns the highest-confidence answer for a term, together with the evidence that produced it:

```metta
!(import! &self nars)
(= (kb)
   ((Sentence ((--> Tweety robin) (stv 1.0 0.9)) (1))
    (Sentence ((--> robin bird)   (stv 1.0 0.9)) (2))
    (Sentence ((--> bird animal)  (stv 1.0 0.9)) (3))))
!(NARS.Query (kb) (--> Tweety animal) 10 10 100)
; ((stv 1.0 0.7290000000000001) (1 2 3)): chained across all three beliefs
```

Those are the same numbers PeTTa's own NARS produces for the same inputs.

## pln

A port of PeTTa's PLN (Probabilistic Logic Networks) reasoner: the truth-value functions, the PLN
inference rules over typed links (`Inheritance`, `Implication`, `Similarity`, `Equivalence`, `Evaluation`,
`Member`), and a priority-queue forward-derivation engine. As in `nars`, a truth value is
`(stv <strength> <confidence>)` and a belief is a `Sentence` carrying a truth value and an evidence trail.

The truth functions combine truth values the way PLN prescribes. `Truth_Revision` merges two independent
bodies of evidence for the same statement into a more confident one, and `Truth_Negation` flips a
statement's strength:

```metta
!(import! &self pln)
!(Truth_Revision (stv 0.5 0.9) (stv 0.5 0.9))   ; (stv 0.5 0.9473684210526316)
!(Truth_Negation (stv 0.8 0.9))                 ; (stv 0.19999999999999996 0.9)
```

`PLN.Query` runs bounded forward chaining over a knowledge base and returns the highest-confidence answer
for a term together with the evidence that produced it. The syllogistic rules ask for node truth values
through `STV`, so define those facts with the knowledge base. When a term is reachable by more than one
path, PLN revises those paths into a single, higher-confidence conclusion:

```metta
!(import! &self pln)
(= (STV A) (stv 0.5 0.9))
(= (STV B) (stv 0.25 0.9))
(= (STV C) (stv 0.25 0.9))
(= (STV D) (stv 0.5 0.9))
(= (kb)
   ((Sentence ((Inheritance A B) (stv 0.25 0.9)) (1))
    (Sentence ((Inheritance A C) (stv 0.25 0.9)) (2))
    (Sentence ((Inheritance B D) (stv 0.5 0.9)) (3))
    (Sentence ((Inheritance C D) (stv 0.5 0.9)) (4))))
!(PLN.Query (kb) (Inheritance A D) 10 10 100)
; ((stv 0.5 0.9473684210526316) (1 2 3 4)): both A->B->D and A->C->D, revised into one answer
```

Those are the same numbers PeTTa's own PLN produces for the same inputs.

## What is not here, and why

A few of PeTTa's libraries are deliberately left out. `he` (Hyperon-experimental compatibility shims) and `builtin_types` (operator type declarations) duplicate things this engine already provides natively, so importing them would only clash. The `import`, `zar`, and `tabling` libraries are Prolog-interop layers, `mm2` targets the MORK backend, and `llm` calls out to a language-model API. Those are host-integration boundaries, and this engine reaches the same capabilities through [`@metta-ts/prolog`](/typescript/prolog-interop), its own automatic tabling, and [`@metta-ts/py`](/typescript/python-interop) rather than a MeTTa port.
