; SPDX-FileCopyrightText: 2026 MesTTo
;
; SPDX-License-Identifier: MIT

!(import! &self (library lib_tabling))

!(tabled (fib $N))

(= (fib $N)
   (if (< $N 2)
       $N
       (+ (fib (- $N 1))
          (fib (- $N 2)))))

(= (fib $N) 42)

!(unique-atom (collapse (fib 7)))
