
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
