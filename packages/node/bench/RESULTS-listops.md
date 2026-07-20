# MeTTaScript vs PeTTa — list-operation scaling

Wall-clock for `size-atom`, `map-atom`, `filter-atom`, `foldl-atom` over a literal list of N integers, as a black-box
subprocess (each engine's startup included). `r` = t(N)/t(previous N); with a 10x size step, ~10 is
linear and ~100 is quadratic. `speedup` = PeTTa / MeTTaScript.

- sizes 1000, 10000, 100000, runs 5 (min), timeout 120s

| op          |      N | MeTTaScript (ms) |   r | PeTTa (ms) |   r | speedup |
| ----------- | -----: | ---------------: | --: | ---------: | --: | ------: |
| size-atom   |   1000 |              192 |   - |        226 |   - |   1.18x |
| size-atom   |  10000 |              104 | 0.5 |        208 | 0.9 |   1.99x |
| size-atom   | 100000 |              170 | 1.6 |        887 | 4.3 |   5.23x |
| map-atom    |   1000 |              126 |   - |        169 |   - |   1.34x |
| map-atom    |  10000 |              148 | 1.2 |        222 | 1.3 |   1.50x |
| map-atom    | 100000 |              348 | 2.4 |        999 | 4.5 |   2.87x |
| filter-atom |   1000 |              108 |   - |        164 |   - |   1.51x |
| filter-atom |  10000 |              143 | 1.3 |        227 | 1.4 |   1.59x |
| filter-atom | 100000 |              360 | 2.5 |        966 | 4.3 |   2.68x |
| foldl-atom  |   1000 |              106 |   - |        161 |   - |   1.51x |
| foldl-atom  |  10000 |              163 | 1.5 |        235 | 1.5 |   1.44x |
| foldl-atom  | 100000 |              346 | 2.1 |        999 | 4.3 |   2.89x |

`*` marks a non-pass run (timeout/error/failed assertion).
