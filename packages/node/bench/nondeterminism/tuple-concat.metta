; SPDX-FileCopyrightText: 2026 MesTTo
;
; SPDX-License-Identifier: MIT

(= (TupleConcat $Ev1 $Ev2)
   (unique-atom (collapse (superpose ((superpose $Ev1) (superpose $Ev2))))))

(= (range $K $N)
   (if (< $K $N)
       (TupleConcat ($K) (range (+ $K 1) $N))
       ()))

!(TupleConcat
  (1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20
   1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20
   1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20
   1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20)
  (1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20
   1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20
   1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20))
