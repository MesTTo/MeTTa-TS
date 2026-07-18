; SPDX-FileCopyrightText: 2026 MesTTo
;
; SPDX-License-Identifier: MIT

!(collapse
  (let* (($T (1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22))
          ($X (superpose $T))
          ($Y (superpose $T))
          ($Z (superpose $T))
          ($W (superpose $T)))
    (+ $W (* (* $X $Y) $Z))))
