; SPDX-FileCopyrightText: 2026 MesTTo
; SPDX-License-Identifier: MIT

; The 1.2.0 importable libraries are opt-in. Each import adds its functions to &self.
; Run it after building packages:
;   pnpm --filter @metta-ts/examples standard-libraries

!(import! &self vector)
!(dot (1.0 2.0 3.0) (4.0 5.0 6.0))          ; [32.0]

!(import! &self combinatorics)
!(collapse (range 1 4))                     ; [(, 1 2 3)]

!(import! &self roman)
(= (double $x) (* $x 2))
!(map-flat double (1 2 3))                  ; [(2 4 6)]

!(import! &self patrick)
(= (inc $x) (+ $x 1))
!(compose (double inc) (5))                 ; [12]

!(import! &self datastructures)
!(dequeue (enqueue b (enqueue a (empty-queue)))) ; [(Pair a (queue () (b) 1))]

!(import! &self spaces)
!(add-atom &warehouse (box 1))
!(migrateAtoms &warehouse &shipped (box $n))
!(collapse (match &shipped $x $x))          ; [(, (box 1))]

!(import! &self nars)
!(Truth_Expectation (stv 0.8 0.9))          ; [0.77]

!(import! &self pln)
!(Truth_ModusPonens (stv 0.8 0.9) (stv 0.7 0.6)) ; [(stv 0.564 0.54)]
