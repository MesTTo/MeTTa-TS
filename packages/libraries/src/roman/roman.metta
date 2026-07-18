
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

  (: /?\ (-> Atom Expression Expression Expression))
  (@doc /?\
    (@desc "Intersection of two expression lists under a predicate: the elements of the first list that match some element of the second")
    (@params ((@param "A two-argument boolean predicate") (@param "The first expression list") (@param "The second expression list")))
    (@return "The elements of the first list that match under the predicate, in their original order"))
  (= (/?\ $pred $l $bs)
     (if (== $l ())
         ()
         (let* ((($a $as) (decons-atom $l)))
           (if (roman-elem? $pred $a $bs)
               (let $rest (/?\ $pred $as $bs) (cons-atom $a $rest))
               (/?\ $pred $as $bs)))))

  (: /=\ (-> Expression Expression Expression))
  (@doc /=\
    (@desc "Intersection by unification")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list that unify with some element of the second"))
  (= (/=\ $a $b) (/?\ roman-unify? $a $b))

  (: /==\ (-> Expression Expression Expression))
  (@doc /==\
    (@desc "Intersection by strict equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list equal to some element of the second"))
  (= (/==\ $a $b) (/?\ == $a $b))

  (: /=a\ (-> Expression Expression Expression))
  (@doc /=a\
    (@desc "Intersection by alpha-equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list alpha-equal to some element of the second"))
  (= (/=a\ $a $b) (/?\ =alpha $a $b))

  (: \? (-> Atom Expression Expression Expression))
  (@doc \?
    (@desc "Subtraction of two expression lists under a predicate: the elements of the first list that match no element of the second")
    (@params ((@param "A two-argument boolean predicate") (@param "The first expression list") (@param "The second expression list")))
    (@return "The elements of the first list with no match in the second, in their original order"))
  (= (\? $pred $l $bs)
     (if (== $l ())
         ()
         (let* ((($a $as) (decons-atom $l)))
           (if (roman-elem? $pred $a $bs)
               (\? $pred $as $bs)
               (let $rest (\? $pred $as $bs) (cons-atom $a $rest))))))

  (: \= (-> Expression Expression Expression))
  (@doc \=
    (@desc "Subtraction by unification")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list that unify with no element of the second"))
  (= (\= $a $b) (\? roman-unify? $a $b))

  (: \== (-> Expression Expression Expression))
  (@doc \==
    (@desc "Subtraction by strict equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list equal to no element of the second"))
  (= (\== $a $b) (\? == $a $b))

  (: \=a (-> Expression Expression Expression))
  (@doc \=a
    (@desc "Subtraction by alpha-equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "Elements of the first list alpha-equal to no element of the second"))
  (= (\=a $a $b) (\? =alpha $a $b))

  (: \?/ (-> Atom Expression Expression Expression))
  (@doc \?/
    (@desc "Union of two expression lists under a predicate: the second list, prefixed by the elements of the first that it does not already contain")
    (@params ((@param "A two-argument boolean predicate") (@param "The first expression list") (@param "The second expression list")))
    (@return "The unmatched elements of the first list followed by the whole second list"))
  (= (\?/ $pred $l $bs)
     (if (== $l ())
         $bs
         (let* ((($a $as) (decons-atom $l)))
           (if (roman-elem? $pred $a $bs)
               (\?/ $pred $as $bs)
               (let $rest (\?/ $pred $as $bs) (cons-atom $a $rest))))))

  (: \=/ (-> Expression Expression Expression))
  (@doc \=/
    (@desc "Union by unification")
    (@params ((@param "First list") (@param "Second list")))
    (@return "The second list prefixed by the elements of the first that unify with none of it"))
  (= (\=/ $a $b) (\?/ roman-unify? $a $b))

  (: \==/ (-> Expression Expression Expression))
  (@doc \==/
    (@desc "Union by strict equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "The second list prefixed by the elements of the first equal to none of it"))
  (= (\==/ $a $b) (\?/ == $a $b))

  (: \=a/ (-> Expression Expression Expression))
  (@doc \=a/
    (@desc "Union by alpha-equality")
    (@params ((@param "First list") (@param "Second list")))
    (@return "The second list prefixed by the elements of the first alpha-equal to none of it"))
  (= (\=a/ $a $b) (\?/ =alpha $a $b))

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
