# MeTTa-TS vs PeTTa — PeTTa example corpus

Wall-clock per example as a black-box subprocess (each engine's runtime startup included).
`speedup` = PeTTa / MeTTa-TS over examples both engines pass. `*` marks a non-pass run.

- examples: 107, both pass: 97, speedup median 2.02x, geomean 1.97x
- timeout 12s, runs 3 (min), MeTTa-TS --max-steps 100000000

**`matespace` / `matespace2` are PeTTa-specific, not a MeTTa-TS performance gap.** Their expected counts
(1063919, 1297533) come only from PeTTa's compilation to Prolog: native backtracking over a
globally-persistent atomspace with duplicate adds pruned by failure, which is not minimal-MeTTa semantics.
Run through `hyperon-experimental` itself, `(collapse (mate-space-demo K))` is empty, and LeaTTa agrees;
PeTTa, real Hyperon, and MeTTa-TS each compute a different result for the same program. No Hyperon-faithful
engine reproduces PeTTa's number, so these two are excluded from the speedup stats. The faithful rewrite of
the same workload, `matespacefast`, MeTTa-TS runs about 2x faster than PeTTa, byte-identical.

| example                |        PeTTa (ms) |     MeTTa-TS (ms) | speedup | result       |
| ---------------------- | ----------------: | ----------------: | ------: | ------------ |
| and_or                 |               147 |               117 |   1.26x | pass         |
| atomops                |               163 |               125 |   1.30x | pass         |
| builin_types           |               167 |                84 |   1.99x | pass         |
| callquoteevalreduce2   |               175 |                81 |   2.15x | pass         |
| case                   |               161 |                80 |   2.02x | pass         |
| case2                  |               173 |                81 |   2.14x | pass         |
| caseempty              |               174 |                81 |   2.14x | pass         |
| chain                  |               175 |                85 |   2.05x | pass         |
| collapse               |               175 |                86 |   2.05x | pass         |
| comments               |               178 |                82 |   2.17x | pass         |
| constanthead           |               169 |                81 |   2.08x | pass         |
| curry                  |               177 |                97 |   1.83x | pass         |
| cut                    |               178 |                82 |   2.17x | pass         |
| empty                  |               178 |                80 |   2.24x | pass         |
| eval                   |               151 |                91 |   1.65x | pass         |
| factorial              |               178 |                81 |   2.20x | pass         |
| fib                    |               461 |                79 |   5.87x | pass         |
| fibadd                 |               450 |                86 |   5.23x | pass         |
| fibsmart               |               168 |                82 |   2.06x | pass         |
| fibsmartimport         |               149 |                88 |   1.69x | pass         |
| foldall                |               158 |               108 |   1.46x | pass         |
| foldallmatch           |               171 |                88 |   1.95x | pass         |
| foldallspacecount      |               179 |                86 |   2.08x | pass         |
| forall                 |               178 |               104 |   1.70x | pass         |
| functiontypes          |               178 |                85 |   2.10x | pass         |
| greedy_chess           | 12097\* (timeout) |      1640\* (ran) |       - | timeout/ran  |
| he_assert              |               152 |                84 |   1.80x | pass         |
| he_atomspace           |               175 |                82 |   2.13x | pass         |
| he_equalreduct         |               177 |                82 |   2.18x | pass         |
| he_error               |               178 |                81 |   2.21x | pass         |
| he_evaluation          |               170 |                88 |   1.92x | pass         |
| he_math                |               181 |                88 |   2.05x | pass         |
| he_minimalmetta        |              1851 |               508 |   3.65x | pass         |
| he_quoting             |               172 |                82 |   2.09x | pass         |
| he_types               |               180 |                85 |   2.11x | pass         |
| holfunctions           |               152 |                94 |   1.62x | pass         |
| hyperpose_primes       |              1144 |              1064 |   1.08x | pass         |
| identity               |               155 |                83 |   1.86x | pass         |
| if                     |               184 |                85 |   2.17x | pass         |
| if2                    |               182 |                87 |   2.09x | pass         |
| if3                    |               171 |                86 |   1.98x | pass         |
| if4                    |               181 |                88 |   2.07x | pass         |
| ifcasenondet           |               171 |                91 |   1.88x | pass         |
| is_alpha_member_test   |               176 |                91 |   1.93x | pass         |
| iter                   |               170 |                95 |   1.79x | pass         |
| lambda                 |               151 |                97 |   1.55x | pass         |
| let_superpose_if_case  |               166 |                92 |   1.80x | pass         |
| letext                 |               169 |                91 |   1.85x | pass         |
| letlet                 |               182 |                95 |   1.91x | pass         |
| letstar                |               148 |                85 |   1.73x | pass         |
| listhead               |               174 |                85 |   2.05x | pass         |
| matchnested            |               163 |                89 |   1.83x | pass         |
| matchnested2           |               178 |                90 |   1.97x | pass         |
| matchsingle            |               173 |                84 |   2.06x | pass         |
| matchtypes             |               182 |                83 |   2.18x | pass         |
| matespace              |              3977 | 12045\* (timeout) |       - | pass/timeout |
| matespace2             |              5594 | 12054\* (timeout) |       - | pass/timeout |
| matespacefast          |              4269 |              2159 |   1.98x | pass         |
| math                   |               175 |                93 |   1.88x | pass         |
| meta_types             |               181 |                83 |   2.18x | pass         |
| metta4_prog            |               180 |                84 |   2.14x | pass         |
| multicall              |               177 |                84 |   2.12x | pass         |
| multiset_operations    |               181 |                86 |   2.11x | pass         |
| mutex_and_transaction  |               160 |                95 |   1.69x | pass         |
| myinterpreter          |               180 |                89 |   2.02x | pass         |
| nars_direct            |               197 |       85\* (fail) |       - | pass/fail    |
| nars_tuffy             |               264 |      275\* (fail) |       - | pass/fail    |
| nilbc                  |               780 |              2173 |   0.36x | pass         |
| once                   |               156 |                89 |   1.75x | pass         |
| parametric_types       |               181 |                87 |   2.08x | pass         |
| parse                  |               153 |                87 |   1.75x | pass         |
| patrick_iterate_fib    |               155 |                85 |   1.82x | pass         |
| patrick_iterate_quad   |               339 |               157 |   2.16x | pass         |
| peano                  |              1521 |              2697 |   0.56x | pass         |
| peanofast              |               571 |                97 |   5.88x | pass         |
| permutations           |               853 |               450 |   1.90x | pass         |
| pln_direct             |               195 |       86\* (fail) |       - | pass/fail    |
| pln_roman              |               232 |      132\* (fail) |       - | pass/fail    |
| pln_tuffy              |               200 |      312\* (fail) |       - | pass/fail    |
| plntest                |               181 |                93 |   1.94x | pass         |
| plntestdirect          |               182 |       304\* (ran) |       - | pass/ran     |
| recursive_types        |               169 |                86 |   1.97x | pass         |
| recursive_types2       |               169 |                86 |   1.96x | pass         |
| repr                   |               168 |                82 |   2.04x | pass         |
| selfprog               |               180 |       83\* (fail) |       - | pass/fail    |
| smartdispatch          |               184 |                88 |   2.09x | pass         |
| spacefunction          |               178 |                85 |   2.09x | pass         |
| spaces                 |               177 |                95 |   1.87x | pass         |
| spaces2                |               183 |                90 |   2.02x | pass         |
| spaces3                |               167 |                91 |   1.82x | pass         |
| specializecyclic       |               171 |                89 |   1.93x | pass         |
| state                  |               176 |                83 |   2.11x | pass         |
| streamops              |               181 |                89 |   2.03x | pass         |
| string                 |               180 |                83 |   2.17x | pass         |
| supercollapse          |               185 |                91 |   2.03x | pass         |
| superpose_nested       |               178 |                89 |   2.00x | pass         |
| superpose_primes       |               187 |                91 |   2.04x | pass         |
| tabling_fib            |               181 |                86 |   2.10x | pass         |
| test_alpha_unique_atom |               171 |                94 |   1.81x | pass         |
| test_string_comments   |               181 |                87 |   2.08x | pass         |
| tests                  |               175 |                98 |   1.78x | pass         |
| tilepuzzle             |              1615 |               417 |   3.87x | pass         |
| translatorrule_fib     |               178 |                86 |   2.07x | pass         |
| twostage               |               146 |                83 |   1.76x | pass         |
| types                  |               179 |                90 |   1.99x | pass         |
| types_dependent        |               158 |                87 |   1.81x | pass         |
| xor                    |               165 |                84 |   1.97x | pass         |
