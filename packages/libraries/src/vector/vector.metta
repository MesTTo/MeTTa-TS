
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
