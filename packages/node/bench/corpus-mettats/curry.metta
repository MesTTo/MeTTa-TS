; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/curry.metta.
;
; Partial application is normal evaluator behavior, so this file does not import
; a special module.

(= (f $a $b) (+ $a $b))

(= (g $a $b $c) (+ $c (+ $a $b)))

!(test (repr (f 1)) "(partial f (1))")
!(test ((f 1) 2) 3)
!(test (repr (g 1 2)) "(partial g (1 2))")

(= (h $A $B)
   (append ($A) $B))

!(test ((h 42) (1 2 3)) (42 1 2 3))
!(test (repr (h 42)) "(partial h (42))")
; PeTTa's 2-argument map-atom applies a function to each element; that conflicts with Hyperon's
; 3-argument map-atom, so @metta-ts uses maplist (the PeTTa-compat mapper) with the curried `(+ 1)`.
!(test (maplist (+ 1) (1 2 3)) (2 3 4))
