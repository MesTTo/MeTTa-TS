(= (rewriteK $t $n)
   (if (== $n 0)
       done
       (let* (($_1 (add-atom &self (num (M $t))))
              ($_2 (add-atom &self (num (W $t))))
              ($_3 (add-atom &self (num (C $t)))))
         ((rewriteK (M $t) (- $n 1))
          (rewriteK (W $t) (- $n 1))))))

(= (mate-space-demo $K)
   (let* (($s (add-atom &self (num Z)))
          ($g (rewriteK Z $K)))
     (match &self (num $1) (num $1))))

!(test (length (collapse (mate-space-demo 19))) 1572862)
!(let $u (match &self (num (M $x)) $x) (empty))
!(let $u (match &self (num (W $x)) $x) (empty))
!(let $u (match &self (num (C $x)) $x) (empty))
