
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
