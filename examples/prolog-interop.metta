; SPDX-FileCopyrightText: 2026 MesTTo
; SPDX-License-Identifier: MIT

; Prolog interop from MeTTa source. Run it with the CLI:
;   metta-ts --prolog examples/prolog-interop.metta

; Assert two Prolog facts.
!(assertzPredicate (Predicate (hello world)))
!(assertzPredicate (Predicate (hello mars)))

; Query Prolog and let minimal MeTTa bind the answer back into this expression.
!(collapse (prolog-match (hello $what) $what))
!(let $temp (callPredicate (Predicate (hello $what))) (seen $temp $what))

; Import a Prolog predicate as a MeTTa function. The last Prolog argument is the function result.
!(import_prolog_function hello)
!(hello)

; SWI-Prolog built-ins work through the same path.
!(import_prolog_function succ)
!(succ 41)
!(collapse (prolog-match (between 1 4 $x) $x))
