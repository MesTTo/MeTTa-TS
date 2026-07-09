; SPDX-FileCopyrightText: 2025 Patrick Hammer — PeTTa (https://github.com/trueagi-io/PeTTa)
; SPDX-FileCopyrightText: 2026 MesTTo — MeTTa-TS adaptation
;
; SPDX-License-Identifier: MIT
;
; Adapted from PeTTa examples/parse.metta for MeTTa-TS (Hyperon) conventions.

!(test (parse "A") A)
!(test (parse "(R A B)") (R A B))
!(test (parse "(R A (S B C))") (R A (S B C)))
; `parse` returns the parsed atom as data. `noeval` keeps a callable expression from reducing while the
; test compares the parsed value.
!(test (parse "(* 2 21)") (noeval (* 2 21)))
!(test (parse "\"42\"") "42")
