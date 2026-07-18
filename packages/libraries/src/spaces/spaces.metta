
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
