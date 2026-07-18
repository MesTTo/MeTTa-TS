// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Ports of PeTTa's standard libraries (the `lib/lib_*.metta` set in the PeTTa MeTTa implementation),
// re-expressed for this Hyperon-faithful engine. PeTTa targets SWI-Prolog and leans on a few dialect
// features this engine does not share, so the ports resolve those discrepancies rather than copy them:
//
//   - PeTTa's `(cons head tail)` cons-cells become Hyperon expression lists `(a b c)`, taken apart with
//     `decons-atom` and built with `cons-atom` (this engine evaluates a `cons` head, so the cell idiom
//     does not survive a copy).
//   - `foldl`/`foldr` become the Hyperon `foldl-atom` fold.
//   - Prolog-only and MORK-FFI pieces (`consult`, `import_prolog_function`, `add-translator-rule!`,
//     `&mork`) are dropped; this engine reaches those capabilities through `@metta-ts/prolog`, the
//     `import!` module system, and native spaces instead.
//
// Each library is an opt-in module imported with `(import! &self <name>)`, exactly like the built-in
// extension modules in `extensions.ts`. They live outside the vendored, spec-conformant prelude so the
// Hyperon oracle keeps running against a pristine baseline.

/** The `vector` library: dense numeric vectors as expression lists, with dot product, norm, and cosine
 *  similarity. Ported from PeTTa `lib/lib_vector.metta`; the `(cons a as)` recursion is re-expressed with
 *  `decons-atom`/`cons-atom` over expression lists. */
export const VECTOR_MODULE_SRC = `
  (: dot (-> Expression Expression Number))
  (: norm (-> Expression Number))
  (: cosine (-> Expression Expression Number))
  (: cosine-of-normalized (-> Expression Expression Number))
  (: random-normal-vector (-> Number Expression))

  (@doc dot
    (@desc "Dot product of two equal-length numeric vectors written as expression lists")
    (@params ((@param "First vector") (@param "Second vector")))
    (@return "Sum of the elementwise products"))
  (= (dot $u $v)
     (if (== $u ())
         0.0
         (let* ((($a $as) (decons-atom $u)) (($b $bs) (decons-atom $v)))
              (+ (* $a $b) (dot $as $bs)))))

  (@doc norm
    (@desc "Euclidean norm (length) of a numeric vector")
    (@params ((@param "Vector")))
    (@return "Square root of the vector dotted with itself"))
  (= (norm $v) (sqrt-math (dot $v $v)))

  (@doc cosine-of-normalized
    (@desc "Cosine similarity when both vectors are already unit length, which is just their dot product")
    (@params ((@param "First unit vector") (@param "Second unit vector")))
    (@return "Dot product of the two vectors"))
  (= (cosine-of-normalized $a $b) (dot $a $b))

  (@doc cosine
    (@desc "Cosine similarity of two numeric vectors, their dot product over the product of their norms")
    (@params ((@param "First vector") (@param "Second vector")))
    (@return "Dot product divided by the product of the norms"))
  (= (cosine $a $b)
     (/ (dot $a $b) (* (norm $a) (norm $b))))

  (@doc random-normal-vector
    (@desc "A random N-dimensional unit vector: N samples in [0, 1) scaled to length one")
    (@params ((@param "Dimension N")))
    (@return "A normalized vector of length N"))
  (= (random-normal-vector $n) (random-normal-vector-acc $n ()))
  ; cons-atom is a data constructor and does not evaluate its head, so force each random draw with
  ; a let before consing; otherwise the unevaluated (random-float ...) is re-rolled by norm and map.
  (= (random-normal-vector-acc $n $acc)
     (if (> $n 0)
         (let $r (random-float 0.0 1.0)
              (random-normal-vector-acc (- $n 1) (cons-atom $r $acc)))
         (let $len (norm $acc) (map-atom $acc $x (/ $x $len)))))
`;

/** The `roman` library: Roman Treutlein's Haskell-style functional prelude — map/fold over expression
 *  lists, predicate set operations, function composition, and list-end accessors. Ported from PeTTa
 *  `lib/lib_roman.metta`. Cons-cells become expression lists; because this engine takes `car-atom`/
 *  `cdr-atom`/`decons-atom`/`cons-atom` arguments unreduced, computed heads and recursive calls are
 *  `let`-forced before consing. `=` as a set-membership predicate means "unifies", so the `=` variants
 *  use `unify`; the `=a` variants use `=alpha`. Return types use a type variable, since an `Atom` return
 *  suppresses reduction of the body here. */
export const ROMAN_MODULE_SRC = `
  ; ---------- Tracing ----------
  (: traceid (-> $t $t))
  (@doc traceid
    (@desc "Print an atom to the trace log and return it unchanged, for inspecting a value mid-evaluation")
    (@params ((@param "The atom to trace and return")))
    (@return "The same atom"))
  (= (traceid $x) (trace! $x $x))

  (: tracem (-> Atom $t $t))
  (@doc tracem
    (@desc "Print a labelled atom (the message paired with the value) to the trace log and return the value unchanged")
    (@params ((@param "A label printed alongside the value") (@param "The value to trace and return")))
    (@return "The value, unchanged"))
  (= (tracem $msg $x) (trace! ($msg $x) $x))

  ; ---------- Higher-order functions over expression lists ----------
  (: map-flat (-> Atom Expression Expression))
  (@doc map-flat
    (@desc "Apply a unary function to each element of a flat expression list, returning the list of results")
    (@params ((@param "A unary function f, applied as (f element)") (@param "An expression list")))
    (@return "The list of (f element) values, in order"))
  (= (map-flat $f $l)
     (if (== $l ())
         ()
         (let* ((($x $xs) (decons-atom $l))
                ($h ($f $x))
                ($t (map-flat $f $xs)))
           (cons-atom $h $t))))

  (: map-nested (-> Atom Expression Expression))
  (@doc map-nested
    (@desc "Apply a unary function to each leaf of a nested expression list, recursing into sub-expressions and keeping the shape")
    (@params ((@param "A unary function f, applied as (f leaf)") (@param "A possibly nested expression list")))
    (@return "The list with f applied at every leaf and the nesting preserved"))
  (= (map-nested $f $l)
     (if (== $l ())
         ()
         (let* ((($x $xs) (decons-atom $l)))
           (if (is-expr $x)
               (let* (($h (map-nested $f $x)) ($t (map-nested $f $xs))) (cons-atom $h $t))
               (let* (($h ($f $x)) ($t (map-nested $f $xs))) (cons-atom $h $t))))))

  (: fold-flat (-> Atom $a Expression $a))
  (@doc fold-flat
    (@desc "Left fold over a flat expression list, combining the accumulator with each element left to right as (f acc element)")
    (@params ((@param "A binary function f, applied as (f acc element)") (@param "The initial accumulator") (@param "An expression list")))
    (@return "The final accumulator"))
  (= (fold-flat $f $init $l)
     (if (== $l ())
         $init
         (let* ((($x $xs) (decons-atom $l)))
           (fold-flat $f ($f $init $x) $xs))))

  (: foldr-flat (-> Atom $a Expression $a))
  (@doc foldr-flat
    (@desc "Right fold over a flat expression list, combining each element with the folded tail as (f element acc)")
    (@params ((@param "A binary function f, applied as (f element acc)") (@param "The initial accumulator") (@param "An expression list")))
    (@return "The folded result"))
  (= (foldr-flat $f $init $l)
     (if (== $l ())
         $init
         (let* ((($x $xs) (decons-atom $l)))
           ($f $x (foldr-flat $f $init $xs)))))

  (: fold-nested (-> Atom $a Expression $a))
  (@doc fold-nested
    (@desc "Left fold over a nested expression list, folding recursively through each sub-expression before continuing")
    (@params ((@param "A binary function f, applied as (f acc leaf)") (@param "The initial accumulator") (@param "A possibly nested expression list")))
    (@return "The final accumulator after folding every leaf"))
  (= (fold-nested $f $init $l)
     (if (== $l ())
         $init
         (let* ((($x $xs) (decons-atom $l)))
           (if (is-expr $x)
               (fold-nested $f (fold-nested $f $init $x) $xs)
               (fold-nested $f ($f $init $x) $xs)))))

  ; ---------- Set operations on expression lists ----------
  ; A predicate is any two-argument function returning a Bool. The = variants match by unification, the
  ; == variants by strict equality, and the =a variants by alpha-equality.

  ; True when $a matches some element of $bs under the two-argument predicate $pred.
  (= (roman-elem? $pred $a $bs)
     (if (== $bs ())
         False
         (let* ((($b $rest) (decons-atom $bs)))
           (if ($pred $a $b) True (roman-elem? $pred $a $rest)))))

  ; The = predicate, re-expressed for a Hyperon engine: two atoms are related when they unify.
  (= (roman-unify? $a $b) (unify $a $b True False))

  (: /?\\ (-> Atom Expression Expression Expression))
  (@doc /?\\
    (@desc "Intersection of two expression lists under a predicate: the elements of the first list that match some element of the second")
    (@params ((@param "A two-argument boolean predicate") (@param "The first expression list") (@param "The second expression list")))
    (@return "The elements of the first list that match under the predicate, in their original order"))
  (= (/?\\ $pred $l $bs)
     (if (== $l ())
         ()
         (let* ((($a $as) (decons-atom $l)))
           (if (roman-elem? $pred $a $bs)
               (let $rest (/?\\ $pred $as $bs) (cons-atom $a $rest))
               (/?\\ $pred $as $bs)))))

  (: /=\\ (-> Expression Expression Expression))
  (@doc /=\\
    (@desc "Intersection by unification")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list that unify with some element of the second"))
  (= (/=\\ $a $b) (/?\\ roman-unify? $a $b))

  (: /==\\ (-> Expression Expression Expression))
  (@doc /==\\
    (@desc "Intersection by strict equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list equal to some element of the second"))
  (= (/==\\ $a $b) (/?\\ == $a $b))

  (: /=a\\ (-> Expression Expression Expression))
  (@doc /=a\\
    (@desc "Intersection by alpha-equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list alpha-equal to some element of the second"))
  (= (/=a\\ $a $b) (/?\\ =alpha $a $b))

  (: \\? (-> Atom Expression Expression Expression))
  (@doc \\?
    (@desc "Subtraction of two expression lists under a predicate: the elements of the first list that match no element of the second")
    (@params ((@param "A two-argument boolean predicate") (@param "The first expression list") (@param "The second expression list")))
    (@return "The elements of the first list with no match in the second, in their original order"))
  (= (\\? $pred $l $bs)
     (if (== $l ())
         ()
         (let* ((($a $as) (decons-atom $l)))
           (if (roman-elem? $pred $a $bs)
               (\\? $pred $as $bs)
               (let $rest (\\? $pred $as $bs) (cons-atom $a $rest))))))

  (: \\= (-> Expression Expression Expression))
  (@doc \\=
    (@desc "Subtraction by unification")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list that unify with no element of the second"))
  (= (\\= $a $b) (\\? roman-unify? $a $b))

  (: \\== (-> Expression Expression Expression))
  (@doc \\==
    (@desc "Subtraction by strict equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list equal to no element of the second"))
  (= (\\== $a $b) (\\? == $a $b))

  (: \\=a (-> Expression Expression Expression))
  (@doc \\=a
    (@desc "Subtraction by alpha-equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list alpha-equal to no element of the second"))
  (= (\\=a $a $b) (\\? =alpha $a $b))

  (: \\?/ (-> Atom Expression Expression Expression))
  (@doc \\?/
    (@desc "Union of two expression lists under a predicate: the second list, prefixed by the elements of the first that it does not already contain")
    (@params ((@param "A two-argument boolean predicate") (@param "The first expression list") (@param "The second expression list")))
    (@return "The unmatched elements of the first list followed by the whole second list"))
  (= (\\?/ $pred $l $bs)
     (if (== $l ())
         $bs
         (let* ((($a $as) (decons-atom $l)))
           (if (roman-elem? $pred $a $bs)
               (\\?/ $pred $as $bs)
               (let $rest (\\?/ $pred $as $bs) (cons-atom $a $rest))))))

  (: \\=/ (-> Expression Expression Expression))
  (@doc \\=/
    (@desc "Union by unification")
    (@params ((@param "First list") (@param "Second list")))
    (@return "The second list prefixed by the elements of the first that unify with none of it"))
  (= (\\=/ $a $b) (\\?/ roman-unify? $a $b))

  (: \\==/ (-> Expression Expression Expression))
  (@doc \\==/
    (@desc "Union by strict equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "The second list prefixed by the elements of the first equal to none of it"))
  (= (\\==/ $a $b) (\\?/ == $a $b))

  (: \\=a/ (-> Expression Expression Expression))
  (@doc \\=a/
    (@desc "Union by alpha-equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "The second list prefixed by the elements of the first alpha-equal to none of it"))
  (= (\\=a/ $a $b) (\\?/ =alpha $a $b))

  ; ---------- Function composition ----------
  (: . (-> Atom Atom Atom $t))
  (@doc .
    (@desc "Compose two unary functions and apply them to an argument, computing (f1 (f2 arg))")
    (@params ((@param "The outer function f1") (@param "The inner function f2") (@param "The argument")))
    (@return "(f1 (f2 arg))"))
  (= (. $f1 $f2 $arg) ($f1 ($f2 $arg)))

  (: .. (-> Atom Atom Atom $t))
  (@doc ..
    (@desc "Compose two unary functions and apply them to an argument, computing (f1 (f2 arg)) (an alias of .)")
    (@params ((@param "The outer function f1") (@param "The inner function f2") (@param "The argument")))
    (@return "(f1 (f2 arg))"))
  (= (.. $f1 $f2 $arg) ($f1 ($f2 $arg)))

  (: .: (-> Atom Atom Atom Atom $t))
  (@doc .:
    (@desc "Compose a unary function with a binary function, computing (f1 (f2 arg1 arg2))")
    (@params ((@param "The outer unary function f1") (@param "The inner binary function f2") (@param "First argument") (@param "Second argument")))
    (@return "(f1 (f2 arg1 arg2))"))
  (= (.: $f1 $f2 $arg1 $arg2) ($f1 ($f2 $arg1 $arg2)))

  (: &&& (-> Atom Atom Atom Expression))
  (@doc &&&
    (@desc "Fan out one argument through two functions, pairing their results as ((f1 arg) (f2 arg))")
    (@params ((@param "First function f1") (@param "Second function f2") (@param "The shared argument")))
    (@return "The two-element list ((f1 arg) (f2 arg))"))
  (= (&&& $f1 $f2 $arg) (($f1 $arg) ($f2 $arg)))

  (: &^& (-> Atom Atom Atom $t))
  (@doc &^&
    (@desc "Fan out one argument through two functions and return both results non-deterministically")
    (@params ((@param "First function f1") (@param "Second function f2") (@param "The shared argument")))
    (@return "(f1 arg), then (f2 arg), as separate results"))
  (= (&^& $f1 $f2 $arg) (superpose (($f1 $arg) ($f2 $arg))))

  ; ---------- Reverse function matching ----------
  (: @ (-> Atom Atom $t))
  (@doc @
    (@desc "Match a pattern against a value and return the pattern with its variables bound, running the usual match in reverse")
    (@params ((@param "A pattern atom") (@param "A value to match the pattern against")))
    (@return "The pattern instantiated by matching it against the value"))
  (= (@ $a $b) (let $a $b $a))

  ; ---------- List ends ----------
  (: head (-> Expression $t))
  (@doc head
    (@desc "The first element of an expression list")
    (@params ((@param "A non-empty expression list")))
    (@return "The first element"))
  (= (head $l) (car-atom $l))

  (: tail (-> Expression Expression))
  (@doc tail
    (@desc "Every element of an expression list except the first")
    (@params ((@param "A non-empty expression list")))
    (@return "The list without its first element"))
  (= (tail $l) (cdr-atom $l))

  (: mylast (-> Expression $t))
  (@doc mylast
    (@desc "The last element of an expression list, found as the first element of its reverse")
    (@params ((@param "A non-empty expression list")))
    (@return "The last element"))
  (= (mylast $l) (let $r (reverse $l) (car-atom $r)))

  (: init (-> Expression Expression))
  (@doc init
    (@desc "Every element of an expression list except the last, found by reversing, dropping the head, and reversing back")
    (@params ((@param "A non-empty expression list")))
    (@return "The list without its last element"))
  (= (init $l) (let* (($r (reverse $l)) ($c (cdr-atom $r))) (reverse $c)))

  (: rcons (-> Expression Atom Expression))
  (@doc rcons
    (@desc "Append a single element to the end of an expression list")
    (@params ((@param "An expression list") (@param "The element to append")))
    (@return "The list with the element added at the end"))
  (= (rcons $xs $x) (union-atom $xs ($x)))

  ; ---------- Pair accessors ----------
  (: fst (-> Expression $t))
  (@doc fst
    (@desc "The first component of a two-element expression")
    (@params ((@param "A two-element expression (a b)")))
    (@return "The first component a"))
  (= (fst ($a $b)) $a)

  (: snd (-> Expression $t))
  (@doc snd
    (@desc "The second component of a two-element expression")
    (@params ((@param "A two-element expression (a b)")))
    (@return "The second component b"))
  (= (snd ($a $b)) $b)
`;

/** The `combinatorics` library: combinatorial generators — an integer range, unordered pairs, all
 *  k-subsets, and take-k. Ported from PeTTa `lib/lib_combinatorics.metta`. PeTTa's self-recursive
 *  `range` (a `superpose` over `($k (range …))`) collapses to empty here because the engine evaluates
 *  the nested call inside the tuple and the terminal `(empty)` annihilates it; it is rebuilt as a
 *  deterministic `range-list` that `superpose` then spreads. `cut` is replaced by explicit `if`
 *  dispatch, the `(|-> …)` lambda + function-form `map-atom` by the template form, and every recursive
 *  list builder `let`-forces its recursive call before `cons-atom`. */
export const COMBINATORICS_MODULE_SRC = `
  (: range (-> Number Number Number))
  (: choose2 (-> Expression Expression))
  (: choose2l (-> Expression Expression))
  (: chooseKl (-> Expression Number Expression))
  (: chooseK (-> Expression Number Expression))
  (: takeK (-> Number Expression Expression))

  (@doc range
    (@desc "Each integer from K up to but not including N, delivered as separate nondeterministic results")
    (@params ((@param "Start value K, included") (@param "End value N, excluded")))
    (@return "One result per integer in the half-open range from K to N"))
  (= (range $K $N) (let $lst (range-list $K $N) (superpose $lst)))
  (= (range-list $K $N)
     (if (< $K $N)
         (let $rest (range-list (+ $K 1) $N) (cons-atom $K $rest))
         ()))

  (@doc choose2
    (@desc "Each unordered pair of distinct positions in a list, so (a b) appears but (b a) does not")
    (@params ((@param "List to draw the pair from")))
    (@return "One (first second) pair per combination, nondeterministically"))
  (= (choose2 $L)
     (let $j (range 0 (length $L))
          (let $i (range 0 $j)
               ((index-atom $L $i) (index-atom $L $j)))))

  (@doc choose2l
    (@desc "Every unordered pair of distinct list elements, gathered into one tuple")
    (@params ((@param "List to draw pairs from")))
    (@return "A tuple holding all the pairs"))
  (= (choose2l $L) (collapse (choose2 $L)))

  (@doc chooseKl
    (@desc "All the ways to pick exactly K elements from a list, unordered, as a list of those combinations")
    (@params ((@param "List to choose from") (@param "Number of elements K to pick")))
    (@return "A list whose elements are the K-element combinations"))
  (= (chooseKl $L $k)
     (if (== $k 0)
         (())
         (if (== $L ())
             ()
             (let* ((($h $t) (decons-atom $L)))
                  (let $sub (chooseKl $t (- $k 1))
                       (append (map-atom $sub $c (cons-atom $h $c))
                               (chooseKl $t $k)))))))

  (@doc chooseK
    (@desc "Pick exactly K elements from a list, unordered, one combination per nondeterministic result")
    (@params ((@param "List to choose from") (@param "Number of elements K to pick")))
    (@return "One K-element combination per result"))
  (= (chooseK $L $k) (let $options (chooseKl $L $k) (superpose $options)))

  (@doc takeK
    (@desc "The first K elements of a list, or the whole list when it has fewer than K")
    (@params ((@param "Count K of leading elements to keep") (@param "List to take from")))
    (@return "A list of at most the first K elements"))
  (= (takeK $k $L)
     (if (== $L ())
         ()
         (if (> $k 0)
             (let* ((($head $tail) (decons-atom $L)))
                  (let $rest (takeK (- $k 1) $tail) (cons-atom $head $rest)))
             ())))
`;

/** The `patrick` library: Patrick Hammer's combinators. Ported from PeTTa `lib/lib_patrick.metta`.
 *  Only `compose` is carried here: `iterate` is already native in this engine's PeTTa-compat stdlib (a
 *  module clause would double-fire it), `@` is provided by the `roman` prelude, and `for` is dropped
 *  because it needs PeTTa's `add-translator-rule!` macro (inline `(let $v (superpose $coll) $body)`
 *  instead). `compose`'s return type is `%Undefined%` so the composed result reduces (an `Atom` return
 *  would leave it unevaluated) while the function list and argument tuple stay unevaluated. */
export const PATRICK_MODULE_SRC = `
  (: compose (-> Expression Atom %Undefined%))

  (@doc compose
    (@desc "Compose a list of single-argument functions, applied right to left, over an argument tuple")
    (@params ((@param "List of function symbols, innermost last") (@param "Argument tuple passed to the innermost function")))
    (@return "The result of the composed application"))
  (= (compose $fs $args)
     (let* ((($f $rest) (decons-atom $fs)))
       (if (== $rest ())
           (if (== (length $args) 1)
               (let ($arg) $args ($f $arg))
               (let $func (cons-atom $f $args) (reduce $func)))
           ($f (compose $rest $args)))))
`;

/** The `datastructures` library: an amortized-O(1) functional queue and a fast unique-insert set. Ported
 *  from PeTTa `lib/lib_datastructures.metta`. A queue is `(queue <in> <out> <n>)`, two expression-list
 *  stacks and a count. `dequeue` returns `(Pair front rest)` and yields nothing on an empty queue (a
 *  normal-evaluation rule cannot bind a caller's output variable the way PeTTa's relational `(dequeue $E
 *  $q)` does through a cons-in-head pattern). `add-unique-or-fail` keys on `repr`, and this engine's
 *  empty-collapse sentinel is `(,)`. Match-pattern and stored-element positions are typed `Atom` so they
 *  are not evaluated before use. */
export const DATASTRUCTURES_MODULE_SRC = `
  (: empty-queue (-> Expression))
  (: enqueue (-> Atom Expression Expression))
  (: dequeue (-> Expression Expression))
  (: add-unique-or-fail (-> Grounded Atom %Undefined%))

  (@doc empty-queue
    (@desc "The empty queue: two empty stacks and a zero count")
    (@params ())
    (@return "A queue (queue () () 0) holding no elements"))
  (= (empty-queue) (queue () () 0))

  (@doc enqueue
    (@desc "Add an element to the back of the queue in amortized O(1) by pushing it onto the in-stack")
    (@params ((@param "Element to add") (@param "Queue")))
    (@return "The queue with the element appended at the back"))
  (= (enqueue $e $q)
     (let (queue $in $out $n) $q
       (queue (cons-atom $e $in) $out (+ $n 1))))

  (@doc dequeue
    (@desc "Remove the front element and return it paired with the rest of the queue. When the out-stack is empty it first reverses the in-stack onto the out-stack, the amortized step. Yields nothing on an empty queue")
    (@params ((@param "Queue")))
    (@return "(Pair <front element> <rest of the queue>), or no result when the queue is empty"))
  (= (dequeue $q)
     (let (queue $in $out $n) $q
       (if (== $out ())
           (if (== $in ())
               (empty)
               (let* (($rev (reverse $in)) (($h $t) (decons-atom $rev)))
                 (Pair $h (queue () $t (- $n 1)))))
           (let* ((($h $t) (decons-atom $out)))
             (Pair $h (queue $in $t (- $n 1)))))))

  (@doc add-unique-or-fail
    (@desc "Intern (s <repr of the expression>) into the space only if no equal key is already present, otherwise yield nothing. A fast set insertion keyed on the atom's textual form")
    (@params ((@param "Space") (@param "Expression to intern as a key")))
    (@return "The add-atom result when newly inserted, or no result when the key already exists"))
  (= (add-unique-or-fail $space $expression)
     (let $st (s (repr $expression))
       (if (== (,) (collapse (once (match $space $st True))))
           (add-atom $space $st)
           (empty))))
`;

/** The `spaces` library: atomspace utilities. Ported from PeTTa `lib/lib_spaces.metta`, keeping the pure
 *  operations. `migrateAtoms` moves matching atoms from one space to another; PeTTa's original referenced
 *  the source space for both the add and the remove (a bug that never populated the target), so this adds
 *  to the target and removes from the source. PeTTa's `find`/`match-count` are already native here, and its
 *  `succeedsPredicate` runs a raw Prolog predicate (reachable through `@metta-ts/prolog` instead), so those
 *  are not re-shipped. The pattern parameter is typed `Atom` so it is matched, not evaluated. */
export const SPACES_MODULE_SRC = `
  (: migrateAtoms (-> Grounded Grounded Atom %Undefined%))
  (: remove-all-atoms (-> Grounded %Undefined%))

  (@doc migrateAtoms
    (@desc "Move every atom matching the pattern from one space to another: add each match to the target space, then remove it from the source space")
    (@params ((@param "Source space") (@param "Target space") (@param "Pattern to match and move")))
    (@return "The per-atom results of the move"))
  (= (migrateAtoms $FromSpace $ToSpace $Pattern)
     (match $FromSpace $Pattern
       (let $moved (add-atom $ToSpace $Pattern)
         (remove-atom $FromSpace $Pattern))))

  (@doc remove-all-atoms
    (@desc "Remove every atom from the space by matching each one and removing it")
    (@params ((@param "Space")))
    (@return "The collapsed results of removing each atom"))
  (= (remove-all-atoms $space)
     (collapse (match $space $x (remove-atom $space $x))))
`;

/** The `nars` library: a compact NARS (Non-Axiomatic Reasoning System) forward-chaining reasoner —
 *  NAL truth-value functions, NAL-1..5 inference rules, and a priority-queue derivation engine. Ported
 *  from PeTTa `lib/lib_nars.metta` and validated differentially against it: the truth formulas and the
 *  end-to-end `NARS.Query` derivations reproduce PeTTa's numbers exactly. `msort`/`list_to_set` become
 *  `sort`/`unique-atom`, and the derivation loop filters this engine's `Empty` collapse sentinel. PeTTa's
 *  source has no NAL-2 block, so none is invented, and `Truth_Union`/`Truth_DecomposeNNN` keep PeTTa's
 *  bare two-element results. */
export const NARS_MODULE_SRC = `
  ; ---------- Truth values ----------
  (: Truth_c2w (-> Number Number))
  (@doc Truth_c2w
    (@desc "Convert NARS confidence to evidence weight")
    (@params ((@param "Confidence c")))
    (@return "Evidence weight c / (1 - c)"))
  (= (Truth_c2w $c)
     (/ $c (- 1 $c)))

  (: Truth_w2c (-> Number Number))
  (@doc Truth_w2c
    (@desc "Convert evidence weight to NARS confidence")
    (@params ((@param "Evidence weight w")))
    (@return "Confidence w / (w + 1)"))
  (= (Truth_w2c $w)
     (/ $w (+ $w 1)))

  (: Truth_Deduction (-> Expression Expression Expression))
  (@doc Truth_Deduction
    (@desc "NAL deduction truth function over two simple truth values")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "(stv (* f1 f2) (* f1 f2 c1 c2))"))
  (= (Truth_Deduction (stv $f1 $c1)
                      (stv $f2 $c2))
     (stv (* $f1 $f2) (* (* $f1 $f2) (* $c1 $c2))))

  (: Truth_Abduction (-> Expression Expression Expression))
  (@doc Truth_Abduction
    (@desc "NAL abduction truth function")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Abductive simple truth value"))
  (= (Truth_Abduction (stv $f1 $c1)
                      (stv $f2 $c2))
     (stv $f2 (Truth_w2c (* (* $f1 $c1) $c2))))

  (: Truth_Induction (-> Expression Expression Expression))
  (@doc Truth_Induction
    (@desc "NAL induction, defined as reversed abduction")
    (@params ((@param "First truth value") (@param "Second truth value")))
    (@return "Inductive simple truth value"))
  (= (Truth_Induction $T1 $T2)
     (Truth_Abduction $T2 $T1))

  (: Truth_Exemplification (-> Expression Expression Expression))
  (@doc Truth_Exemplification
    (@desc "NAL exemplification truth function")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Exemplification simple truth value"))
  (= (Truth_Exemplification (stv $f1 $c1)
                            (stv $f2 $c2))
     (stv 1.0 (Truth_w2c (* (* $f1 $f2) (* $c1 $c2)))))

  (: Truth_StructuralDeduction (-> Expression Expression))
  (@doc Truth_StructuralDeduction
    (@desc "Structural deduction against the fixed NARS truth value (stv 1.0 0.9)")
    (@params ((@param "Input truth value")))
    (@return "Structurally deduced truth value"))
  (= (Truth_StructuralDeduction $T)
     (Truth_Deduction $T (stv 1.0 0.9)))

  (: Truth_Negation (-> Expression Expression))
  (@doc Truth_Negation
    (@desc "Negate the frequency of a simple truth value while preserving confidence")
    (@params ((@param "Truth value (stv f c)")))
    (@return "(stv (1 - f) c)"))
  (= (Truth_Negation (stv $f $c))
     (stv (- 1 $f) $c))

  (: Truth_StructuralDeductionNegated (-> Expression Expression))
  (@doc Truth_StructuralDeductionNegated
    (@desc "Structural deduction followed by truth negation")
    (@params ((@param "Input truth value")))
    (@return "Negated structural deduction truth value"))
  (= (Truth_StructuralDeductionNegated $T)
     (Truth_Negation (Truth_StructuralDeduction $T)))

  (: Truth_Intersection (-> Expression Expression Expression))
  (@doc Truth_Intersection
    (@desc "Truth function for intersection")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "(stv (* f1 f2) (* c1 c2))"))
  (= (Truth_Intersection (stv $f1 $c1)
                         (stv $f2 $c2))
     (stv (* $f1 $f2) (* $c1 $c2)))

  (: Truth_StructuralIntersection (-> Expression Expression))
  (@doc Truth_StructuralIntersection
    (@desc "Structural intersection against the fixed NARS truth value (stv 1.0 0.9)")
    (@params ((@param "Input truth value")))
    (@return "Structurally intersected truth value"))
  (= (Truth_StructuralIntersection $T)
     (Truth_Intersection $T (stv 1.0 0.9)))

  (: Truth_or (-> Number Number Number))
  (@doc Truth_or
    (@desc "Probabilistic OR over two frequencies")
    (@params ((@param "First frequency") (@param "Second frequency")))
    (@return "1 - (1 - a) * (1 - b)"))
  (= (Truth_or $a $b)
     (- 1 (* (- 1 $a) (- 1 $b))))

  (: Truth_Comparison (-> Expression Expression Expression))
  (@doc Truth_Comparison
    (@desc "NAL comparison truth function")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Comparison simple truth value"))
  (= (Truth_Comparison (stv $f1 $c1)
                       (stv $f2 $c2))
     (let $f0 (Truth_or $f1 $f2)
          (stv (if (== $f0 0.0)
                   0.0
                   (/ (* $f1 $f2) $f0))
               (Truth_w2c (* $f0 (* $c1 $c2))))))

  (: Truth_Analogy (-> Expression Expression Expression))
  (@doc Truth_Analogy
    (@desc "NAL analogy truth function")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Analogy simple truth value"))
  (= (Truth_Analogy (stv $f1 $c1)
                    (stv $f2 $c2))
     (stv (* $f1 $f2) (* (* $c1 $c2) $f2)))

  (: Truth_Resemblance (-> Expression Expression Expression))
  (@doc Truth_Resemblance
    (@desc "NAL resemblance truth function")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Resemblance simple truth value"))
  (= (Truth_Resemblance (stv $f1 $c1)
                        (stv $f2 $c2))
     (stv (* $f1 $f2) (* (* $c1 $c2) (Truth_or $f1 $f2))))

  (: Truth_Union (-> Expression Expression Expression))
  (@doc Truth_Union
    (@desc "PeTTa lib_nars union truth function; the upstream body returns a two-element expression, not an stv-headed value")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "A two-element expression matching PeTTa's source"))
  (= (Truth_Union (stv $f1 $c1)
                  (stv $f2 $c2))
     ((Truth_or $f1 $f2) (* $c1 $c2)))

  (: Truth_Difference (-> Expression Expression Expression))
  (@doc Truth_Difference
    (@desc "NAL difference truth function")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Difference simple truth value"))
  (= (Truth_Difference (stv $f1 $c1)
                       (stv $f2 $c2))
     (stv (* $f1 (- 1 $f2)) (* $c1 $c2)))

  (: Truth_DecomposePNN (-> Expression Expression Expression))
  (@doc Truth_DecomposePNN
    (@desc "NAL decomposition truth function for positive-negative-negative decomposition")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Decomposition simple truth value"))
  (= (Truth_DecomposePNN (stv $f1 $c1)
                         (stv $f2 $c2))
     (let $fn (* $f1 (- 1 $f2))
          (stv (- 1 $fn) (* $fn (* $c1 $c2)))))

  (: Truth_DecomposeNPP (-> Expression Expression Expression))
  (@doc Truth_DecomposeNPP
    (@desc "NAL decomposition truth function for negative-positive-positive decomposition")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Decomposition simple truth value"))
  (= (Truth_DecomposeNPP (stv $f1 $c1)
                         (stv $f2 $c2))
     (let $f (* (- 1 $f1) $f2)
          (stv $f (* $f (* $c1 $c2)))))

  (: Truth_DecomposePNP (-> Expression Expression Expression))
  (@doc Truth_DecomposePNP
    (@desc "NAL decomposition truth function for positive-negative-positive decomposition")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Decomposition simple truth value"))
  (= (Truth_DecomposePNP (stv $f1 $c1)
                         (stv $f2 $c2))
     (let $f (* $f1 (- 1 $f2))
          (stv $f (* $f (* $c1 $c2)))))

  (: Truth_DecomposePPP (-> Expression Expression Expression))
  (@doc Truth_DecomposePPP
    (@desc "NAL decomposition truth function for positive-positive-positive decomposition")
    (@params ((@param "First truth value") (@param "Second truth value")))
    (@return "Decomposition simple truth value"))
  (= (Truth_DecomposePPP $v1 $v2)
     (Truth_DecomposeNPP (Truth_Negation $v1) $v2))

  (: Truth_DecomposeNNN (-> Expression Expression Expression))
  (@doc Truth_DecomposeNNN
    (@desc "PeTTa lib_nars decomposition for negative-negative-negative; the upstream body returns a two-element expression, not an stv-headed value")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "A two-element expression matching PeTTa's source"))
  (= (Truth_DecomposeNNN (stv $f1 $c1)
                         (stv $f2 $c2))
     (let $fn (* (- 1 $f1) (- 1 $f2))
          ((- 1 $fn) (* $fn (* $c1 $c2)))))

  (: Truth_Eternalize (-> Expression Expression))
  (@doc Truth_Eternalize
    (@desc "Eternalize a simple truth value by converting its confidence as a weight")
    (@params ((@param "Truth value (stv f c)")))
    (@return "Eternalized simple truth value"))
  (= (Truth_Eternalize (stv $f $c))
     (stv $f (Truth_w2c $c)))

  (: Truth_Revision (-> Expression Expression Expression))
  (@doc Truth_Revision
    (@desc "Revise two independent simple truth values by combining their evidence weights")
    (@params ((@param "First truth value (stv f c)") (@param "Second truth value (stv f c)")))
    (@return "Revised simple truth value"))
  (= (Truth_Revision (stv $f1 $c1)
                     (stv $f2 $c2))
     (let* (($w1 (Truth_c2w $c1))
            ($w2 (Truth_c2w $c2))
            ($w (+ $w1 $w2))
            ($f (/ (+ (* $w1 $f1) (* $w2 $f2)) $w))
            ($c (Truth_w2c $w)))
       (stv (min 1.00 $f) (min 0.99 (max (max $c $c1) $c2)))))

  (: Truth_Expectation (-> Expression Number))
  (@doc Truth_Expectation
    (@desc "Expectation of a simple truth value")
    (@params ((@param "Truth value (stv f c)")))
    (@return "c * (f - 0.5) + 0.5"))
  (= (Truth_Expectation (stv $f $c))
     (+ (* $c (- $f 0.5)) 0.5))

  ; ---------- Inference rules ----------
  (@doc |-
    (@desc "PeTTa lib_nars NAL inference rules. Binary forms combine two judgements; unary forms decompose one judgement")
    (@params ((@param "One or two NARS judgements, each written as (<term> <truth>)")))
    (@return "A derived judgement (<term> <truth>)"))

  ; NAL-1: revision and inheritance syllogisms.
  (= (|- ($T $T1) ($T $T2)) ($T (Truth_Revision $T1 $T2)))
  (= (|- ((--> $a $b) $T1) ((--> $b $c) $T2)) ((--> $a $c) (Truth_Deduction $T1 $T2)))
  (= (|- ((--> $a $b) $T1) ((--> $a $c) $T2)) ((--> $c $b) (Truth_Induction $T1 $T2)))
  (= (|- ((--> $a $c) $T1) ((--> $b $c) $T2)) ((--> $b $a) (Truth_Abduction $T1 $T2)))
  (= (|- ((--> $a $b) $T1) ((--> $b $c) $T2)) ((--> $c $a) (Truth_Exemplification $T1 $T2)))

  ; PeTTa's lib_nars source has no NAL-2 block.

  ; NAL-3: sets and extensional/intensional decomposition.
  (= (|- ((--> ({} $A $B) $M) $T)) ((--> ({} $A) $M) (Truth_StructuralDeduction $T)))
  (= (|- ((--> ({} $A $B) $M) $T)) ((--> ({} $B) $M) (Truth_StructuralDeduction $T)))
  (= (|- ((--> $M ([] $A $B)) $T)) ((--> $M ([] $A)) (Truth_StructuralDeduction $T)))
  (= (|- ((--> $M ([] $A $B)) $T)) ((--> $M ([] $B)) (Truth_StructuralDeduction $T)))
  (= (|- ((--> (∪ $S $P) $M) $T)) ((--> $S $M) (Truth_StructuralDeduction $T)))
  (= (|- ((--> $M (∩ $S $P)) $T)) ((--> $M $S) (Truth_StructuralDeduction $T)))
  (= (|- ((--> (∪ $S $P) $M) $T)) ((--> $P $M) (Truth_StructuralDeduction $T)))
  (= (|- ((--> $M (∩ $S $P)) $T)) ((--> $M $P) (Truth_StructuralDeduction $T)))
  (= (|- ((--> (~ $A $S) $M) $T)) ((--> $A $M) (Truth_StructuralDeduction $T)))
  (= (|- ((--> $M (− $B $S)) $T)) ((--> $M $B) (Truth_StructuralDeduction $T)))
  (= (|- ((--> (~ $A $S) $M) $T)) ((--> $S $M) (Truth_StructuralDeductionNegated $T)))
  (= (|- ((--> $M (− $B $S)) $T)) ((--> $M $S) (Truth_StructuralDeductionNegated $T)))
  (= (|- ((--> $S $M) $T1) ((--> (∪ $S $P) $M) $T2)) ((--> $P $M) (Truth_DecomposePNN $T1 $T2)))
  (= (|- ((--> $P $M) $T1) ((--> (∪ $S $P) $M) $T2)) ((--> $S $M) (Truth_DecomposePNN $T1 $T2)))
  (= (|- ((--> $S $M) $T1) ((--> (∩ $S $P) $M) $T2)) ((--> $P $M) (Truth_DecomposeNPP $T1 $T2)))
  (= (|- ((--> $P $M) $T1) ((--> (∩ $S $P) $M) $T2)) ((--> $S $M) (Truth_DecomposeNPP $T1 $T2)))
  (= (|- ((--> $S $M) $T1) ((--> (~ $S $P) $M) $T2)) ((--> $P $M) (Truth_DecomposePNP $T1 $T2)))
  (= (|- ((--> $S $M) $T1) ((--> (~ $P $S) $M) $T2)) ((--> $P $M) (Truth_DecomposeNNN $T1 $T2)))
  (= (|- ((--> $M $S) $T1) ((--> $M (∩ $S $P)) $T2)) ((--> $M $P) (Truth_DecomposePNN $T1 $T2)))
  (= (|- ((--> $M $P) $T1) ((--> $M (∩ $S $P)) $T2)) ((--> $M $S) (Truth_DecomposePNN $T1 $T2)))
  (= (|- ((--> $M $S) $T1) ((--> $M (∪ $S $P)) $T2)) ((--> $M $P) (Truth_DecomposeNPP $T1 $T2)))
  (= (|- ((--> $M $P) $T1) ((--> $M (∪ $S $P)) $T2)) ((--> $M $S) (Truth_DecomposeNPP $T1 $T2)))
  (= (|- ((--> $M $S) $T1) ((--> $M (− $S $P)) $T2)) ((--> $M $P) (Truth_DecomposePNP $T1 $T2)))
  (= (|- ((--> $M $S) $T1) ((--> $M (− $P $S)) $T2)) ((--> $M $P) (Truth_DecomposeNNN $T1 $T2)))

  ; NAL-4: relation component rules.
  (= (|- ((--> (× $A $B) $R) $T1) ((--> (× $C $B) $R) $T2)) ((--> $C $A) (Truth_Abduction $T1 $T2)))
  (= (|- ((--> (× $A $B) $R) $T1) ((--> (× $A $C) $R) $T2)) ((--> $C $B) (Truth_Abduction $T1 $T2)))
  (= (|- ((--> $R (× $A $B)) $T1) ((--> $R (× $C $B)) $T2)) ((--> $C $A) (Truth_Induction $T1 $T2)))
  (= (|- ((--> $R (× $A $B)) $T1) ((--> $R (× $A $C)) $T2)) ((--> $C $B) (Truth_Induction $T1 $T2)))
  (= (|- ((--> (× $A $B) $R) $T1) ((--> $C $A) $T2)) ((--> (× $C $B) $R) (Truth_Deduction $T1 $T2)))
  (= (|- ((--> (× $A $B) $R) $T1) ((--> $A $C) $T2)) ((--> (× $C $B) $R) (Truth_Induction $T1 $T2)))
  (= (|- ((--> (× $A $B) $R) $T1) ((--> $C $B) $T2)) ((--> (× $A $C) $R) (Truth_Deduction $T1 $T2)))
  (= (|- ((--> (× $A $B) $R) $T1) ((--> $B $C) $T2)) ((--> (× $A $C) $R) (Truth_Induction $T1 $T2)))
  (= (|- ((--> $R (× $A $B)) $T1) ((--> $A $C) $T2)) ((--> $R (× $C $B)) (Truth_Deduction $T1 $T2)))
  (= (|- ((--> $R (× $A $B)) $T1) ((--> $C $A) $T2)) ((--> $R (× $C $B)) (Truth_Abduction $T1 $T2)))
  (= (|- ((--> $R (× $A $B)) $T1) ((--> $B $C) $T2)) ((--> $R (× $A $C)) (Truth_Deduction $T1 $T2)))
  (= (|- ((--> $R (× $A $B)) $T1) ((--> $C $B) $T2)) ((--> $R (× $A $C)) (Truth_Abduction $T1 $T2)))

  ; NAL-5: negation, conjunction, disjunction, and higher-order decomposition.
  (= (|- ((¬ $A) $T)) ($A (Truth_Negation $T)))
  (= (|- ((∧ $A $B) $T)) ($A (Truth_StructuralDeduction $T)))
  (= (|- ((∧ $A $B) $T)) ($B (Truth_StructuralDeduction $T)))
  (= (|- ($S $T1) ((∧ $S $A) $T2)) ($A (Truth_DecomposePNN $T1 $T2)))
  (= (|- ($S $T1) ((∨ $S $A) $T2)) ($A (Truth_DecomposeNPP $T1 $T2)))
  (= (|- ($S $T1) ((∧ (¬ $S) $A) $T2)) ($A (Truth_DecomposeNNN $T1 $T2)))
  (= (|- ($S $T1) ((∨ (¬ $S) $A) $T2)) ($A (Truth_DecomposePPP $T1 $T2)))
  (= (|- ($A $T1) ((==> $A $B) $T2)) ($B (Truth_Deduction $T1 $T2)))
  (= (|- ($A $T1) ((==> (∧ $A $B) $C) $T2)) ((==> $B $C) (Truth_Deduction $T1 $T2)))
  (= (|- ($B $T1) ((==> $A $B) $T2)) ($A (Truth_Abduction $T1 $T2)))

  ; ---------- Derivation and query engine ----------
  (: NARS.Config.MaxSteps (-> Number))
  (@doc NARS.Config.MaxSteps
    (@desc "Default maximum number of derivation task selections")
    (@params ())
    (@return "100"))
  (= (NARS.Config.MaxSteps) 100)

  (: NARS.Config.TaskQueueSize (-> Number))
  (@doc NARS.Config.TaskQueueSize
    (@desc "Default active task queue bound")
    (@params ())
    (@return "10"))
  (= (NARS.Config.TaskQueueSize) 10)

  (: NARS.Config.BeliefQueueSize (-> Number))
  (@doc NARS.Config.BeliefQueueSize
    (@desc "Default belief buffer bound")
    (@params ())
    (@return "100"))
  (= (NARS.Config.BeliefQueueSize) 100)

  (: NARS.CollapseToList (-> Atom Expression))
  (@doc NARS.CollapseToList
    (@desc "Collect nondeterministic results and convert this engine's comma-headed collapse tuple into a plain expression list")
    (@params ((@param "Nondeterministic query to collapse")))
    (@return "A plain expression list of the collapsed results"))
  (= (NARS.CollapseToList $query)
     (let* (($collapsed (collapse $query))
            ($plain (cdr-atom $collapsed)))
       (exclude-item Empty $plain)))

  (: StampDisjoint (-> Expression Expression Bool))
  (@doc StampDisjoint
    (@desc "True when two evidence stamps share no evidence item")
    (@params ((@param "First evidence stamp list") (@param "Second evidence stamp list")))
    (@return "Bool indicating whether the stamps are disjoint"))
  (= (StampDisjoint $Ev1 $Ev2)
     (== () (intersection-atom $Ev1 $Ev2)))

  (: StampConcat (-> Expression Expression Expression))
  (@doc StampConcat
    (@desc "Concatenate a stamp with new evidence and sort it, preserving PeTTa lib_nars' stamp-combination shape")
    (@params ((@param "Base evidence stamp") (@param "Evidence stamp to add")))
    (@return "Sorted combined evidence stamp"))
  (= (StampConcat $stamp $addition)
     (if (== $addition ())
         $stamp
         (sort (append $stamp $addition))))

  (: BestCandidate (-> Atom %Undefined% Expression %Undefined%))
  (@doc BestCandidate
    (@desc "Return the item in a candidate list with the highest score under an evaluator function")
    (@params ((@param "Unary evaluator function") (@param "Current best candidate") (@param "Candidate list")))
    (@return "The best candidate, or the initial best candidate when the list is empty"))
  (= (BestCandidate $evaluateCandidateFunction $bestCandidate $tuple)
     (max-by-atom $evaluateCandidateFunction $bestCandidate $tuple))

  (: PriorityRank (-> Expression Number))
  (@doc PriorityRank
    (@desc "Task priority score: the confidence of a sentence, with a low sentinel for the empty candidate")
    (@params ((@param "A Sentence candidate or ()")))
    (@return "Priority score"))
  (= (PriorityRank (Sentence ($x (stv $f $c)) $Ev1)) $c)
  (= (PriorityRank ()) -99999.0)

  (: PriorityRankNeg (-> Expression Number))
  (@doc PriorityRankNeg
    (@desc "Negated task priority score, used to find the lowest-priority queue item")
    (@params ((@param "A Sentence candidate or ()")))
    (@return "Negated priority score"))
  (= (PriorityRankNeg (Sentence ($x (stv $f $c)) $Ev1)) (- 0.0 $c))
  (= (PriorityRankNeg ()) -99999.0)

  (: LimitSize (-> Expression Number Expression))
  (@doc LimitSize
    (@desc "Bound a priority queue to fewer than the size limit by dropping the lowest-priority items")
    (@params ((@param "Candidate list") (@param "Size bound")))
    (@return "Bounded candidate list"))
  (= (LimitSize $L $size)
     (top-k-by-atom PriorityRank $size $L))

  (: NARS.PairInference (-> Expression Expression Expression))
  (@doc NARS.PairInference
    (@desc "Apply the binary inference rules in both premise orders")
    (@params ((@param "First judgement") (@param "Second judgement")))
    (@return "A derived judgement"))
  (= (NARS.PairInference $x $y) (|- $x $y))
  (= (NARS.PairInference $x $y) (|- $y $x))

  (: NARS.BinaryDerivation (-> Expression Expression Expression Expression))
  (@doc NARS.BinaryDerivation
    (@desc "Derive sentences from one selected task and one belief when their stamps are disjoint")
    (@params ((@param "Selected task judgement") (@param "Selected task evidence stamp") (@param "Belief sentence")))
    (@return "A derived Sentence, or no result when stamps overlap or no rule applies"))
  (= (NARS.BinaryDerivation $x $Ev1 (Sentence $y $Ev2))
     (if (StampDisjoint $Ev1 $Ev2)
         (let $stamp (StampConcat $Ev1 $Ev2)
              (case (NARS.PairInference $x $y)
                    ((($T $TV) (Sentence ($T $TV) $stamp)))))
         (empty)))

  (: NARS.UnaryDerivation (-> Expression Expression Expression))
  (@doc NARS.UnaryDerivation
    (@desc "Derive sentences from one selected task using unary inference rules")
    (@params ((@param "Selected task judgement") (@param "Selected task evidence stamp")))
    (@return "A derived Sentence, or no result when no unary rule applies"))
  (= (NARS.UnaryDerivation $x $Ev1)
     (case (|- $x)
           ((($T (stv $f $c)) (Sentence ($T (stv $f $c)) $Ev1)))))

  (@doc NARS.Derive
    (@desc "Priority-queue forward derivation over tasks and beliefs")
    (@params ((@param "Task list") (@param "Belief list") (@param "Optional step and queue bounds")))
    (@return "A pair (tasks beliefs) after bounded derivation"))
  (= (NARS.Derive $Tasks $Beliefs $steps $maxsteps $taskqueuesize $beliefqueuesize)
     (if (or (> $steps $maxsteps) (== $Tasks ()))
         ($Tasks $Beliefs)
         (let $selected (BestCandidate PriorityRank () $Tasks)
           (let (Sentence $x $Ev1) $selected
             (let $fromBeliefs (NARS.CollapseToList
                                 (let $belief (superpose $Beliefs)
                                   (NARS.BinaryDerivation $x $Ev1 $belief)))
               (let $fromTask (NARS.CollapseToList
                               (NARS.UnaryDerivation $x $Ev1))
                 (let $derivations (append $fromBeliefs $fromTask)
                   (let $_ (trace! (SELECTED $steps (Sentence $x $Ev1)) 42)
                     (let $taskCandidates (unique-atom (append $Tasks $derivations))
                       (let $withoutSelected (exclude-item $selected $taskCandidates)
                         (let $newTasks (LimitSize $withoutSelected $taskqueuesize)
                           (let $beliefCandidates (unique-atom (append $Beliefs $derivations))
                             (let $newBeliefs (LimitSize $beliefCandidates $beliefqueuesize)
                               (NARS.Derive $newTasks
                                            $newBeliefs
                                            (+ $steps 1)
                                            $maxsteps
                                            $taskqueuesize
                                            $beliefqueuesize))))))))))))))

  (= (NARS.Derive $Tasks $Beliefs $maxsteps $taskqueuesize $beliefqueuesize)
     (NARS.Derive $Tasks $Beliefs 1 $maxsteps $taskqueuesize $beliefqueuesize))

  (= (NARS.Derive $Tasks $Beliefs $maxsteps)
     (NARS.Derive $Tasks $Beliefs $maxsteps (NARS.Config.TaskQueueSize) (NARS.Config.BeliefQueueSize)))

  (= (NARS.Derive $Tasks $Beliefs)
     (NARS.Derive $Tasks $Beliefs (NARS.Config.MaxSteps)))

  (: ConfidenceRank (-> Expression Number))
  (@doc ConfidenceRank
    (@desc "Query-answer score: the confidence of a (truth evidence) pair, with zero for the empty candidate")
    (@params ((@param "A query answer ((stv f c) evidence) or ()")))
    (@return "Confidence score"))
  (= (ConfidenceRank ((stv $f $c) $Ev)) $c)
  (= (ConfidenceRank ()) 0)

  (@doc NARS.Query
    (@desc "Query a term against a NARS knowledge base after bounded forward derivation")
    (@params ((@param "Task list or knowledge base") (@param "Belief list or term") (@param "Term and optional bounds")))
    (@return "The highest-confidence answer as ((stv f c) evidence), or () when no belief matches"))
  ; let-force the candidate list: imported into &self, BestCandidate's Expression-typed argument is not
  ; re-evaluated if it already looks like an Expression, so evaluate NARS.CollapseToList explicitly first.
  (= (NARS.Query $Tasks $Beliefs $term $maxsteps $taskqueuesize $beliefqueuesize)
     (let $candidates
          (NARS.CollapseToList
            (let ($TasksRet $BeliefsRet) (NARS.Derive $Tasks $Beliefs $maxsteps $taskqueuesize $beliefqueuesize)
              (case (superpose $BeliefsRet)
                    (((Sentence ($Term $TV) $Ev)
                      (case (== $Term $term)
                            ((True ($TV $Ev)))))))))
          (BestCandidate ConfidenceRank () $candidates)))

  (= (NARS.Query $kb $term $maxsteps $taskqueuesize $beliefqueuesize)
     (NARS.Query $kb $kb $term $maxsteps $taskqueuesize $beliefqueuesize))

  (= (NARS.Query $kb $term $maxsteps)
     (NARS.Query $kb $term $maxsteps (NARS.Config.TaskQueueSize) (NARS.Config.BeliefQueueSize)))

  (= (NARS.Query $kb $term)
     (NARS.Query $kb $term (NARS.Config.MaxSteps)))
`;

export const PLN_MODULE_SRC = `
  ; ---------- Tuple helpers ----------
  (@doc PLN.Force
    (@desc "Evaluate a raw expression call while preserving already-data expression lists")
    (@params ((@param "Atom to force")))
    (@return "The evaluated atom, or the original atom when eval leaves it unreduced"))
  (= (PLN.Force $atom)
     (let $forced (eval $atom)
       (case $forced
             (((eval $raw) $atom)
              ($_ $forced)))))

  (: clamp (-> Number Number Number Number))
  (@doc clamp
    (@desc "Clamp a number to the inclusive range [min, max]")
    (@params ((@param "Value") (@param "Minimum") (@param "Maximum")))
    (@return "The value bounded by the range"))
  (= (clamp $v $min $max)
     (min $max (max $v $min)))

  (: TupleConcat (-> Expression Expression Expression))
  (@doc TupleConcat
    (@desc "Concatenate two tuple lists represented as Hyperon expression lists")
    (@params ((@param "First tuple list") (@param "Second tuple list")))
    (@return "The concatenated tuple list"))
  (= (TupleConcat $Ev1 $Ev2)
     (append $Ev1 $Ev2))

  (: TupleCount (-> Expression Number))
  (@doc TupleCount
    (@desc "Count items in a tuple list")
    (@params ((@param "Tuple list")))
    (@return "The item count"))
  (= (TupleCount $tuple)
     (size-atom $tuple))

  (: and5 (-> Bool Bool Bool Bool Bool Bool))
  (@doc and5
    (@desc "Five-argument boolean conjunction")
    (@params ((@param "First boolean") (@param "Second boolean") (@param "Third boolean") (@param "Fourth boolean") (@param "Fifth boolean")))
    (@return "True when all five inputs are true"))
  (= (and5 $0 $1 $2 $3 $4)
     (and $0 (and $1 (and $2 (and $3 $4)))))

  (: min5 (-> Number Number Number Number Number Number))
  (@doc min5
    (@desc "Minimum of five numbers")
    (@params ((@param "First number") (@param "Second number") (@param "Third number") (@param "Fourth number") (@param "Fifth number")))
    (@return "The smallest input"))
  (= (min5 $0 $1 $2 $3 $4)
     (min $0 (min $1 (min $2 (min $3 $4)))))

  (: /safe (-> Number Number Number))
  (@doc /safe
    (@desc "Division guarded like PeTTa lib_pln: divide only when the denominator is positive")
    (@params ((@param "Numerator") (@param "Denominator")))
    (@return "The quotient, or no result when the denominator is not positive"))
  (= (/safe $A $B)
     (if (> $B 0.0)
         (/ $A $B)
         (empty)))

  (: negate (-> Number Number))
  (@doc negate
    (@desc "Return 1 minus the argument")
    (@params ((@param "Number")))
    (@return "1 - x"))
  (= (negate $arg)
     (- 1.0 $arg))

  (: invert (-> Number Number))
  (@doc invert
    (@desc "Return the reciprocal through /safe")
    (@params ((@param "Number")))
    (@return "1 / x, or no result when x is not positive"))
  (= (invert $arg)
     (/safe 1.0 $arg))

  (: InsertSorted (-> Number Expression Expression))
  (@doc InsertSorted
    (@desc "Insert a numeric item into a sorted tuple list")
    (@params ((@param "Item") (@param "Sorted tuple list")))
    (@return "The sorted tuple list with the item inserted"))
  (= (InsertSorted $x $L)
     (if (== $L ())
         ($x)
         (let* ((($head $tail) (decons-atom $L)))
           (if (< $x $head)
               (TupleConcat ($x $head) $tail)
               (let $inserted (InsertSorted $x $tail)
                    (TupleConcat ($head) $inserted))))))

  (: InsertionSort (-> Expression Expression Expression))
  (@doc InsertionSort
    (@desc "Sort a tuple list. The second argument is preserved for PeTTa lib_pln call compatibility and is ignored by the upstream implementation")
    (@params ((@param "Tuple list") (@param "Ignored accumulator")))
    (@return "Sorted tuple list"))
  (= (InsertionSort $L $Ret)
     (let $items (PLN.Force $L)
       (if (== $items ())
           $Ret
           (let* ((($x $rest) (decons-atom $items))
                  ($newRet (InsertSorted $x $Ret)))
             (InsertionSort $rest $newRet)))))

  (: Without (-> Expression %Undefined% Expression))
  (@doc Without
    (@desc "Remove an item from a tuple list")
    (@params ((@param "Tuple list") (@param "Item to remove")))
    (@return "Tuple list without the item"))
  (= (Without $Tuple $a)
     (exclude-item $a $Tuple))

  (: ElementOf (-> %Undefined% Expression Bool))
  (@doc ElementOf
    (@desc "Check whether an item is a member of a tuple list")
    (@params ((@param "Item") (@param "Tuple list")))
    (@return "Bool membership result"))
  (= (ElementOf $a $Tuple)
     (is-member $a $Tuple))

  (: Unique (-> Expression Expression Expression))
  (@doc Unique
    (@desc "Deduplicate a tuple list. The second argument is preserved for PeTTa lib_pln call compatibility and is ignored by the upstream implementation")
    (@params ((@param "Tuple list") (@param "Ignored accumulator")))
    (@return "Deduplicated tuple list"))
  (= (Unique $L $Ret)
     (unique-atom $L))

  ; ---------- Consistency helpers ----------
  (: smallest-intersection-probability (-> Number Number Number))
  (@doc smallest-intersection-probability
    (@desc "Lower bound for a conditional intersection probability")
    (@params ((@param "Strength of A") (@param "Strength of B")))
    (@return "Clamped lower probability bound"))
  (= (smallest-intersection-probability $As $Bs)
     (clamp (/ (- (+ $As $Bs) 1) $As) 0 1))

  (: largest-intersection-probability (-> Number Number Number))
  (@doc largest-intersection-probability
    (@desc "Upper bound for a conditional intersection probability")
    (@params ((@param "Strength of A") (@param "Strength of B")))
    (@return "Clamped upper probability bound"))
  (= (largest-intersection-probability $As $Bs)
     (clamp (/ $Bs $As) 0 1))

  (: conditional-probability-consistency (-> Number Number Number Bool))
  (@doc conditional-probability-consistency
    (@desc "Check PeTTa lib_pln conditional probability bounds")
    (@params ((@param "Strength of A") (@param "Strength of B") (@param "Strength of A implies B")))
    (@return "True when the conditional probability is inside the PLN bounds"))
  (= (conditional-probability-consistency $As $Bs $ABs)
     (and (< 0 $As)
          (and (<= (smallest-intersection-probability $As $Bs) $ABs)
               (<= $ABs (largest-intersection-probability $As $Bs)))))

  (: Consistency_ImplicationImplicantConjunction (-> Number Number Number Number Number Bool))
  (@doc Consistency_ImplicationImplicantConjunction
    (@desc "Check PeTTa lib_pln implication and implicant conjunction consistency")
    (@params ((@param "Strength of A") (@param "Strength of B") (@param "Strength of C") (@param "Strength of A implies C") (@param "Strength of B implies C")))
    (@return "Bool consistency result"))
  (= (Consistency_ImplicationImplicantConjunction $As $Bs $Cs $ACs $BCs)
     (and5 (> $As 0) (> $Bs 0) (> $Cs 0)
           (<= $ACs (/ $Cs $As))
           (<= $BCs (/ $Cs $Bs))))

  ; ---------- Truth functions ----------
  ; PeTTa lib_pln leaves STV as a stub so callers can define node truth values.
  (= (STV $stv) (empty))

  (: Truth_c2w (-> Number Number))
  (@doc Truth_c2w
    (@desc "Convert PLN confidence to evidence weight")
    (@params ((@param "Confidence c")))
    (@return "Evidence weight c / (1 - c), or no result when c is 1"))
  (= (Truth_c2w $c)
     (/safe $c (- 1 $c)))

  (: Truth_w2c (-> Number Number))
  (@doc Truth_w2c
    (@desc "Convert evidence weight to PLN confidence")
    (@params ((@param "Evidence weight w")))
    (@return "Confidence w / (w + 1)"))
  (= (Truth_w2c $w)
     (/safe $w (+ $w 1)))

  (: Truth_Deduction (-> Expression Expression Expression Expression Expression Expression))
  (@doc Truth_Deduction
    (@desc "PeTTa lib_pln five-argument PLN deduction truth function")
    (@params ((@param "Truth of P") (@param "Truth of Q") (@param "Truth of R") (@param "Truth of P implies Q") (@param "Truth of Q implies R")))
    (@return "Deductive simple truth value"))
  (= (Truth_Deduction (stv $Ps $Pc)
                      (stv $Qs $Qc)
                      (stv $Rs $Rc)
                      (stv $PQs $PQc)
                      (stv $QRs $QRc))
     (if (and (conditional-probability-consistency $Ps $Qs $PQs)
              (conditional-probability-consistency $Qs $Rs $QRs))
         (stv (if (< 0.9999 $Qs)
                  $Rs
                  (+ (* $PQs $QRs)
                     (/safe (* (- 1 $PQs) (- $Rs (* $Qs $QRs))) (- 1 $Qs))))
              (min $Pc (min $Qc (min $Rc (min $PQc $QRc)))))
         (stv 1 0)))

  (: Truth_Induction (-> Expression Expression Expression Expression Expression Expression))
  (@doc Truth_Induction
    (@desc "PeTTa lib_pln five-argument PLN induction truth function")
    (@params ((@param "Truth of A") (@param "Truth of B") (@param "Truth of C") (@param "Truth of B implies A") (@param "Truth of B implies C")))
    (@return "Inductive simple truth value"))
  (= (Truth_Induction (stv $sA $cA)
                      (stv $sB $cB)
                      (stv $sC $cC)
                      (stv $sBA $cBA)
                      (stv $sBC $cBC))
     (stv (+ (/safe (* (* $sBA $sBC) $sB) $sA)
             (* (- 1 (/safe (* $sBA $sB) $sA))
                (/safe (- $sC (* $sB $sBC)) (- 1 $sB))))
          (Truth_w2c (min $cBA $cBC))))

  (: Truth_Abduction (-> Expression Expression Expression Expression Expression Expression))
  (@doc Truth_Abduction
    (@desc "PeTTa lib_pln five-argument PLN abduction truth function")
    (@params ((@param "Truth of A") (@param "Truth of B") (@param "Truth of C") (@param "Truth of A implies B") (@param "Truth of C implies B")))
    (@return "Abductive simple truth value"))
  (= (Truth_Abduction (stv $sA $cA)
                      (stv $sB $cB)
                      (stv $sC $cC)
                      (stv $sAB $cAB)
                      (stv $sCB $cCB))
     (stv (+ (/safe (* (* $sAB $sCB) $sC)
                    $sB)
             (/safe (* $sC (* (- 1 $sAB) (- 1 $sCB)))
                    (- 1 $sB)))
          (Truth_w2c (min $cAB $cCB))))

  (: Truth_ModusPonens (-> Expression Expression Expression))
  (@doc Truth_ModusPonens
    (@desc "PeTTa lib_pln modus ponens truth function")
    (@params ((@param "Antecedent truth value") (@param "Implication truth value")))
    (@return "Conclusion truth value"))
  (= (Truth_ModusPonens (stv $f1 $c1) (stv $f2 $c2))
     (stv (+ (* $f1 $f2) (* 0.02 (- 1 $f1)))
          (* $c1 $c2)))

  (: Truth_SymmetricModusPonens (-> Expression Expression Expression))
  (@doc Truth_SymmetricModusPonens
    (@desc "PeTTa lib_pln symmetric modus ponens truth function")
    (@params ((@param "Source truth value") (@param "Similarity truth value")))
    (@return "Conclusion truth value"))
  (= (Truth_SymmetricModusPonens (stv $sA $cA) (stv $sAB $cAB))
     (let* (($snotAB 0.2)
            ($cnotAB 1.0))
       (stv (+ (* $sA $sAB) (* (* $snotAB (negate $sA)) (+ 1.0 $sAB)))
            (min (min $cAB $cnotAB) $cA))))

  (: Truth_Revision (-> Expression Expression Expression))
  (@doc Truth_Revision
    (@desc "PeTTa lib_pln heuristic revision of two simple truth values")
    (@params ((@param "First truth value") (@param "Second truth value")))
    (@return "Revised truth value"))
  (= (Truth_Revision (stv $f1 $c1) (stv $f2 $c2))
     (let* (($w1 (Truth_c2w $c1))
            ($w2 (Truth_c2w $c2))
            ($w (+ $w1 $w2))
            ($f (/safe (+ (* $w1 $f1) (* $w2 $f2)) $w))
            ($c (Truth_w2c $w)))
       (stv (min 1.0 $f)
            (min 1.0 (max (max $c $c1) $c2)))))

  (: Truth_Negation (-> Expression Expression))
  (@doc Truth_Negation
    (@desc "Negate the strength of a simple truth value while preserving confidence")
    (@params ((@param "Truth value")))
    (@return "Negated truth value"))
  (= (Truth_Negation (stv $s $c))
     (stv (- 1.0 $s) $c))

  (: Truth_inversion (-> Expression Expression Expression))
  (@doc Truth_inversion
    (@desc "PeTTa lib_pln inversion truth function")
    (@params ((@param "Target node truth value") (@param "Link truth value")))
    (@return "Inverted truth value"))
  (= (Truth_inversion (stv $Bs $Bc) (stv $ABs $ABc))
     (stv $ABs (* $Bc (* $ABc 0.6))))

  (: Truth_equivalenceToImplication (-> Expression Expression Expression Expression))
  (@doc Truth_equivalenceToImplication
    (@desc "Convert an equivalence truth value into an implication truth value")
    (@params ((@param "Truth of A") (@param "Truth of B") (@param "Truth of equivalence A B")))
    (@return "Implication truth value"))
  (= (Truth_equivalenceToImplication (stv $As $Ac) (stv $Bs $Bc) (stv $ABs $ABc))
     (let* (($ConclS (if (< 0.99 (* $ABs $ABc))
                         $ABs
                         (/safe (* (+ 1.0 (/safe $Bs $As)) $ABs) (+ 1.0 $ABs)))))
       (stv $ConclS $ABc)))

  (: TransitiveSimilarityStrength (-> Number Number Number Number Number Number))
  (@doc TransitiveSimilarityStrength
    (@desc "PeTTa lib_pln transitive similarity strength helper")
    (@params ((@param "Strength of A") (@param "Strength of B") (@param "Strength of C") (@param "Strength of A similar B") (@param "Strength of B similar C")))
    (@return "Transitive similarity strength"))
  (= (TransitiveSimilarityStrength $sA $sB $sC $sAB $sBC)
     (let* (($T1 (/ (* (+ 1.0 (/ $sB $sA)) $sAB) (+ 1.0 $sAB)))
            ($T2 (/ (* (+ 1.0 (/ $sC $sB)) $sBC) (+ 1.0 $sBC)))
            ($T3 (/ (* (+ 1.0 (/ $sB $sC)) $sBC) (+ 1.0 $sBC)))
            ($T4 (/ (* (+ 1.0 (/ $sA $sB)) $sAB) (+ 1.0 $sAB))))
       (invert (- (+ (invert (+ (* $T1 $T2)
                                (* (negate $T1)
                                   (/safe (- $sC (* $sB $T2)) (negate $sB)))))
                     (invert (+ (* $T3 $T4)
                                (* (negate $T3)
                                   (/safe (- $sC (* $sB $T4)) (negate $sB))))))
                  1.0))))

  (: Truth_transitiveSimilarity (-> Expression Expression Expression Expression Expression Expression))
  (@doc Truth_transitiveSimilarity
    (@desc "PeTTa lib_pln transitive similarity truth function")
    (@params ((@param "Truth of A") (@param "Truth of B") (@param "Truth of C") (@param "Truth of A similar B") (@param "Truth of B similar C")))
    (@return "Transitive similarity truth value"))
  (= (Truth_transitiveSimilarity (stv $As $Ac)
                                 (stv $Bs $Bc)
                                 (stv $Cs $Cc)
                                 (stv $ABs $ABc)
                                 (stv $BCs $BCc))
     (let* (($ConclS (TransitiveSimilarityStrength $As $Bs $Cs $ABs $BCs))
            ($ConclC (min $ABc $BCc)))
       (stv $ConclS $ConclC)))

  (: simpleDeductionStrength (-> Number Number Number Number Number Number))
  (@doc simpleDeductionStrength
    (@desc "PeTTa lib_pln simple deduction strength helper")
    (@params ((@param "Strength of A") (@param "Strength of B") (@param "Strength of C") (@param "Strength of A implies B") (@param "Strength of B implies C")))
    (@return "Deduction strength, or no result when consistency checks fail"))
  (= (simpleDeductionStrength $sA $sB $sC $sAB $sBC)
     (if (and (conditional-probability-consistency $sA $sB $sAB)
              (conditional-probability-consistency $sB $sC $sBC))
         (if (< 0.99 $sB)
             $sC
             (+ (* $sAB $sBC)
                (/safe (* (- 1.0 $sAB) (- $sC (* $sB $sBC))) (- 1.0 $sB))))
         (empty)))

  (: Truth_evaluationImplication (-> Expression Expression Expression Expression Expression Expression))
  (@doc Truth_evaluationImplication
    (@desc "PeTTa lib_pln evaluation implication truth function")
    (@params ((@param "Truth of A") (@param "Truth of B") (@param "Truth of C") (@param "Truth of A implies B") (@param "Truth of A implies C")))
    (@return "Evaluation implication truth value"))
  (= (Truth_evaluationImplication (stv $As $Ac)
                                  (stv $Bs $Bc)
                                  (stv $Cs $Cc)
                                  (stv $ABs $ABc)
                                  (stv $ACs $ACc))
     (let* (($ConclS (simpleDeductionStrength $Bs $As $Cs $ABs $ACs))
            ($ConclC (* (* 0.9 0.9)
                        (min5 $Bc $Ac $Cc $ACc (* 0.9 $ABc)))))
       (stv $ConclS $ConclC)))

  ; ---------- Inference rules ----------
  (@doc |-
    (@desc "PeTTa lib_pln PLN inference rules")
    (@params ((@param "One or two PLN sentences written as (<term> <truth>)")))
    (@return "A derived sentence written as (<term> <truth>)"))

  ; Revision.
  (= (|- ($T $T1)
         ($T $T2))
     (let $TV (Truth_Revision $T1 $T2)
       ($T $TV)))

  ; Modus ponens.
  (= (|- ($A $T1)
         ((Implication $A $B) $T2))
     (let $TV (Truth_ModusPonens $T1 $T2)
       ($B $TV)))

  ; Guards for link-specific rules. Missing guard facts intentionally leave the rule unreduced.
  (= (SymmetricModusPonensRuleGuard Similarity) True)
  (= (SymmetricModusPonensRuleGuard IntentionalSimilarity) True)
  (= (SymmetricModusPonensRuleGuard ExtensionalSimilarity) True)

  (= (|- ($A $TruthA)
         (($LinkType $A $B) $TruthAB))
     (if (SymmetricModusPonensRuleGuard $LinkType)
         (let $TV (Truth_SymmetricModusPonens $TruthA $TruthAB)
           ($B $TV))
         (empty)))

  (= (SyllogisticRuleGuard Inheritance) True)
  (= (SyllogisticRuleGuard Implication) True)

  (= (|- (($LinkType $A $B) $T1)
         (($LinkType $B $C) $T2))
     (if (SyllogisticRuleGuard $LinkType)
         (let* (($TruthA (STV $A))
                ($TruthB (STV $B))
                ($TruthC (STV $C))
                ($TV (Truth_Deduction $TruthA $TruthB $TruthC $T1 $T2)))
           (($LinkType $A $C) $TV))
         (empty)))

  (= (|- (($LinkType $C $A) $T1)
         (($LinkType $C $B) $T2))
     (if (SyllogisticRuleGuard $LinkType)
         (let* (($TruthA (STV $A))
                ($TruthB (STV $B))
                ($TruthC (STV $C))
                ($TV (Truth_Induction $TruthA $TruthB $TruthC $T1 $T2)))
           (($LinkType $A $B) $TV))
         (empty)))

  (= (|- (($LinkType $A $C) $T1)
         (($LinkType $B $C) $T2))
     (if (SyllogisticRuleGuard $LinkType)
         (let* (($TruthA (STV $A))
                ($TruthB (STV $B))
                ($TruthC (STV $C))
                ($TV (Truth_Abduction $TruthA $TruthB $TruthC $T1 $T2)))
           (($LinkType $A $B) $TV))
         (empty)))

  ; Usage of inheritance for predicates.
  (= (|- ((Evaluation (Predicate $x)
                      (List (Concept $C))) $T1)
         ((Inheritance (Concept $S) (Concept $C)) $T2))
     (let $TV (Truth_ModusPonens $T1 $T2)
       ((Evaluation (Predicate $x)
                    (List (Concept $S)))
        $TV)))

  (= (|- ((Evaluation (Predicate $x)
                      (List (Concept $C1) (Concept $C2))) $T1)
         ((Inheritance (Concept $S) (Concept $C1)) $T2))
     (let $TV (Truth_ModusPonens $T1 $T2)
       ((Evaluation (Predicate $x)
                    (List (Concept $S) (Concept $C2)))
        $TV)))

  (= (|- ((Evaluation (Predicate $x)
                      (List (Concept $C1) (Concept $C2))) $T1)
         ((Inheritance (Concept $S) (Concept $C2)) $T2))
     (let $TV (Truth_ModusPonens $T1 $T2)
       ((Evaluation (Predicate $x)
                    (List (Concept $C1) (Concept $S)))
        $TV)))

  (= (|- ((Not $A) $T))
     (let $TV (Truth_Negation $T)
       ($A $TV)))

  (= (|- ((Inheritance $A $B) $Truth))
     (let* (($TruthB (STV $B))
            ($TV (Truth_inversion $TruthB $Truth)))
       ((Inheritance $B $A) $TV)))

  (= (|- ((Implication $A $B) $Truth))
     (let* (($TruthB (STV $B))
            ($TV (Truth_inversion $TruthB $Truth)))
       ((Implication $B $A) $TV)))

  (= (|- ((Equivalence $A $B) $Truth))
     (let* (($TruthA (STV $A))
            ($TruthB (STV $B))
            ($TV (Truth_equivalenceToImplication $TruthA $TruthB $Truth)))
       ((Implication $A $B) $TV)))

  (= (|- ((Equivalence $A $B) $Truth))
     (let* (($TruthA (STV $A))
            ($TruthB (STV $B))
            ($TV (Truth_equivalenceToImplication $TruthA $TruthB $Truth)))
       ((Implication $B $A) $TV)))

  (= (|- ((Similarity $A $B) $T1)
         ((Similarity $B $C) $T2))
     (let* (($TruthA (STV $A))
            ($TruthB (STV $B))
            ($TruthC (STV $C))
            ($TV (Truth_transitiveSimilarity $TruthA $TruthB $TruthC $T1 $T2)))
       ((Similarity $A $C) $TV)))

  (= (|- ((Evaluation $A $B) $TruthAB)
         ((Implication $A $C) $TruthAC))
     (let* (($TruthA (STV $A))
            ($TruthB (STV $B))
            ($TruthC (STV $C))
            ($TV (Truth_evaluationImplication $TruthA $TruthB $TruthC $TruthAB $TruthAC)))
       ((Evaluation $C $B) $TV)))

  (= (|- ((Member $A $B) $T1)
         ((Inheritance $B $C) $T2))
     (let* (($TruthA (STV $A))
            ($TruthB (STV $B))
            ($TruthC (STV $C))
            ($TV (Truth_Deduction $TruthA $TruthB $TruthC $T1 $T2)))
       ((Member $A $C) $TV)))

  ; ---------- Derivation and query engine ----------
  (: PLN.Config.MaxSteps (-> Number))
  (@doc PLN.Config.MaxSteps
    (@desc "Default maximum number of derivation task selections")
    (@params ())
    (@return "100"))
  (= (PLN.Config.MaxSteps) 100)

  (: PLN.Config.TaskQueueSize (-> Number))
  (@doc PLN.Config.TaskQueueSize
    (@desc "Default active task queue bound")
    (@params ())
    (@return "10"))
  (= (PLN.Config.TaskQueueSize) 10)

  (: PLN.Config.BeliefQueueSize (-> Number))
  (@doc PLN.Config.BeliefQueueSize
    (@desc "Default belief buffer bound")
    (@params ())
    (@return "100"))
  (= (PLN.Config.BeliefQueueSize) 100)

  (: PLN.CollapseToList (-> Atom Expression))
  (@doc PLN.CollapseToList
    (@desc "Collect nondeterministic results and convert this engine's comma-headed collapse tuple into a plain expression list")
    (@params ((@param "Nondeterministic query to collapse")))
    (@return "A plain expression list of collapsed results"))
  (= (PLN.CollapseToList $query)
     (let* (($collapsed (collapse $query))
            ($plain (cdr-atom $collapsed)))
       (exclude-item Empty $plain)))

  (: StampDisjoint (-> Expression Expression Bool))
  (@doc StampDisjoint
    (@desc "True when two evidence stamps share no evidence item")
    (@params ((@param "First evidence stamp") (@param "Second evidence stamp")))
    (@return "Bool indicating whether the stamps are disjoint"))
  (= (StampDisjoint $Ev1 $Ev2)
     (== () (intersection-atom $Ev1 $Ev2)))

  (: StampConcat (-> Expression Expression Expression))
  (@doc StampConcat
    (@desc "Concatenate a stamp with new evidence and sort it")
    (@params ((@param "Base evidence stamp") (@param "Evidence stamp to add")))
    (@return "Sorted combined evidence stamp"))
  (= (StampConcat $stamp $addition)
     (if (== $addition ())
         $stamp
         (let $combined (TupleConcat $stamp $addition)
              (InsertionSort $combined ()))))

  (: BestCandidate (-> Atom %Undefined% Expression %Undefined%))
  (@doc BestCandidate
    (@desc "Return the candidate with the highest score under an evaluator function")
    (@params ((@param "Unary evaluator function") (@param "Current best candidate") (@param "Candidate list")))
    (@return "The best candidate, or the initial best candidate when the list is empty"))
  (= (BestCandidate $evaluateCandidateFunction $bestCandidate $tuple)
     (max-by-atom $evaluateCandidateFunction $bestCandidate $tuple))

  (: PriorityRank (-> Expression Number))
  (@doc PriorityRank
    (@desc "Task priority score: the confidence of a Sentence candidate")
    (@params ((@param "Sentence candidate or empty sentinel")))
    (@return "Priority score"))
  (= (PriorityRank (Sentence ($x (stv $f $c)) $Ev1)) $c)
  (= (PriorityRank ()) -99999.0)

  (: PriorityRankNeg (-> Expression Number))
  (@doc PriorityRankNeg
    (@desc "Negated task priority score, used to find the lowest-priority queue item")
    (@params ((@param "Sentence candidate or empty sentinel")))
    (@return "Negated priority score"))
  (= (PriorityRankNeg (Sentence ($x (stv $f $c)) $Ev1)) (- 0.0 $c))
  (= (PriorityRankNeg ()) -99999.0)

  (: LimitSize (-> Expression Number Expression))
  (@doc LimitSize
    (@desc "Limit a priority queue by removing the lowest-priority item when the accumulator reaches the size bound")
    (@params ((@param "Candidate list") (@param "Size bound")))
    (@return "Bounded candidate list"))
  (= (LimitSize $L $size)
     (top-k-by-atom PriorityRank $size $L))

  (: PLN.PairInference (-> Expression Expression Expression))
  (@doc PLN.PairInference
    (@desc "Apply binary inference rules in both premise orders")
    (@params ((@param "First judgement") (@param "Second judgement")))
    (@return "A derived judgement"))
  (= (PLN.PairInference $x $y) (|- $x $y))
  (= (PLN.PairInference $x $y) (|- $y $x))

  (: PLN.BinaryDerivation (-> Expression Expression Expression Expression))
  (@doc PLN.BinaryDerivation
    (@desc "Derive sentences from one selected task and one belief when their stamps are disjoint")
    (@params ((@param "Selected task judgement") (@param "Selected task evidence stamp") (@param "Belief sentence")))
    (@return "A derived Sentence, or no result"))
  (= (PLN.BinaryDerivation $x $Ev1 (Sentence $y $Ev2))
     (if (StampDisjoint $Ev1 $Ev2)
         (let $stamp (StampConcat $Ev1 $Ev2)
              (case (PLN.PairInference $x $y)
                    ((($T $TV) (let $forcedTV $TV
                                  (Sentence ($T $forcedTV) $stamp))))))
         (empty)))

  (: PLN.UnaryDerivation (-> Expression Expression Expression))
  (@doc PLN.UnaryDerivation
    (@desc "Derive sentences from one selected task using unary inference rules")
    (@params ((@param "Selected task judgement") (@param "Selected task evidence stamp")))
    (@return "A derived Sentence, or no result"))
  (= (PLN.UnaryDerivation $x $Ev1)
     (case (|- $x)
           ((($T $TV) (let $forcedTV $TV
                        (Sentence ($T $forcedTV) $Ev1))))))

  (@doc PLN.Derive
    (@desc "Priority-queue forward derivation over tasks and beliefs")
    (@params ((@param "Task list") (@param "Belief list") (@param "Optional step and queue bounds")))
    (@return "A pair (tasks beliefs) after bounded derivation"))
  (= (PLN.Derive $Tasks $Beliefs $steps $maxsteps $taskqueuesize $beliefqueuesize)
     (if (or (> $steps $maxsteps) (== $Tasks ()))
         ($Tasks $Beliefs)
         (let $selected (BestCandidate PriorityRank () $Tasks)
           (let (Sentence $x $Ev1) $selected
             (let $fromBeliefs (PLN.CollapseToList
                                 (let $belief (superpose $Beliefs)
                                   (PLN.BinaryDerivation $x $Ev1 $belief)))
               (let $fromTask (PLN.CollapseToList
                               (PLN.UnaryDerivation $x $Ev1))
                 (let $derivations (TupleConcat $fromBeliefs $fromTask)
                   (let $_ (trace! (SELECTED $steps (Sentence $x $Ev1)) 42)
                     (let $taskCandidates (TupleConcat $Tasks $derivations)
                       (let $uniqueTasks (Unique $taskCandidates ())
                         (let $withoutSelected (Without $uniqueTasks $selected)
                           (let $newTasks (LimitSize $withoutSelected $taskqueuesize)
                             (let $beliefCandidates (TupleConcat $Beliefs $derivations)
                               (let $uniqueBeliefs (Unique $beliefCandidates ())
                                 (let $newBeliefs (LimitSize $uniqueBeliefs $beliefqueuesize)
                                   (PLN.Derive $newTasks
                                               $newBeliefs
                                               (+ $steps 1)
                                               $maxsteps
                                               $taskqueuesize
                                               $beliefqueuesize))))))))))))))))

  (= (PLN.Derive $Tasks $Beliefs $maxsteps $taskqueuesize $beliefqueuesize)
     (PLN.Derive $Tasks $Beliefs 1 $maxsteps $taskqueuesize $beliefqueuesize))

  (= (PLN.Derive $Tasks $Beliefs $maxsteps)
     (PLN.Derive $Tasks
                 $Beliefs
                 $maxsteps
                 (PLN.Config.TaskQueueSize)
                 (PLN.Config.BeliefQueueSize)))

  (= (PLN.Derive $Tasks $Beliefs)
     (PLN.Derive $Tasks $Beliefs (PLN.Config.MaxSteps)))

  (: ConfidenceRank (-> Expression Number))
  (@doc ConfidenceRank
    (@desc "Query-answer score: the confidence of a (truth evidence) pair")
    (@params ((@param "Query answer or empty sentinel")))
    (@return "Confidence score"))
  (= (ConfidenceRank ((stv $f $c) $Ev)) $c)
  (= (ConfidenceRank ()) 0)

  (: PLN.QueryCandidate (-> %Undefined% Expression Expression))
  (@doc PLN.QueryCandidate
    (@desc "Return a query answer when a belief Sentence has the requested term")
    (@params ((@param "Requested term") (@param "Belief sentence")))
    (@return "A (truth evidence) pair, or no result when the term differs"))
  (= (PLN.QueryCandidate $term (Sentence ($term $TV) $Ev))
     ($TV $Ev))
  (= (PLN.QueryCandidate $term $sentence)
     (empty))

  (@doc PLN.QueryCandidates
    (@desc "Collect all belief truth/evidence pairs whose term matches a query after bounded derivation")
    (@params ((@param "Task list") (@param "Belief list") (@param "Term") (@param "Step and queue bounds")))
    (@return "A plain expression list of query candidates"))
  (= (PLN.QueryCandidates $qcTasks $qcBeliefs $qcTerm $qcMaxSteps $qcTaskQueueSize $qcBeliefQueueSize)
     (let $TasksEval (PLN.Force $qcTasks)
       (let $BeliefsEval (PLN.Force $qcBeliefs)
         (let* (($maxstepsEval (+ 0 $qcMaxSteps))
                ($taskqueuesizeEval (+ 0 $qcTaskQueueSize))
                ($beliefqueuesizeEval (+ 0 $qcBeliefQueueSize)))
           (let ($TasksRet $BeliefsRet)
                (PLN.Derive $TasksEval $BeliefsEval 1 $maxstepsEval $taskqueuesizeEval $beliefqueuesizeEval)
             (PLN.CollapseToList
               (let $belief (superpose $BeliefsRet)
                 (PLN.QueryCandidate $qcTerm $belief))))))))

  (@doc PLN.Query
    (@desc "Query a term against a PLN knowledge base after bounded forward derivation")
    (@params ((@param "Task list or knowledge base") (@param "Belief list or term") (@param "Term and optional bounds")))
    (@return "The highest-confidence answer as ((stv f c) evidence), or () when no belief matches"))
  (= (PLN.Query $ts $bs $term $m $t $b)
     (let* (($TasksClone (filter-atom $ts $taskItem True))
            ($BeliefsClone (filter-atom $bs $beliefItem True)))
       (BestCandidate ConfidenceRank ()
                      (PLN.QueryCandidates $TasksClone
                                           $BeliefsClone
                                           $term
                                           $m
                                           $t
                                           $b))))

  (= (PLN.Query $k $term $m $t $b)
     (let $kbClone (filter-atom $k $kbItem True)
       (BestCandidate ConfidenceRank ()
                      (PLN.QueryCandidates $kbClone
                                           $kbClone
                                           $term
                                           $m
                                           $t
                                           $b))))

  (= (PLN.Query $k $term $m)
     (PLN.Query $k $term $m (PLN.Config.TaskQueueSize) (PLN.Config.BeliefQueueSize)))

  (= (PLN.Query $k $term)
     (PLN.Query $k $term (PLN.Config.MaxSteps)))
`;

/** Library module sources, keyed by the name used in `(import! &self <name>)`. Registered by
 *  `builtinModules()` in `extensions.ts`. */
export const LIBRARY_MODULE_SRCS: Readonly<Record<string, string>> = {
  vector: VECTOR_MODULE_SRC,
  roman: ROMAN_MODULE_SRC,
  combinatorics: COMBINATORICS_MODULE_SRC,
  patrick: PATRICK_MODULE_SRC,
  datastructures: DATASTRUCTURES_MODULE_SRC,
  spaces: SPACES_MODULE_SRC,
  nars: NARS_MODULE_SRC,
  pln: PLN_MODULE_SRC,
};
