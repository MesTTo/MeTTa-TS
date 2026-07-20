# MeTTa-TS vs PeTTa — PeTTa example corpus

Wall-clock per example as a black-box subprocess (each engine's runtime startup included).
`speedup` = PeTTa / MeTTa-TS over examples both engines pass. `*` marks a non-pass run.

- examples: 105, both pass: 98, speedup median 1.55x, geomean 1.61x
- timeout 60s, runs 3 (min), MeTTa-TS --max-steps 100000000

| example | PeTTa (ms) | MeTTa-TS (ms) | speedup | result |
|---|--:|--:|--:|---|
| and_or | 154 | 100 | 1.54x | pass |
| atomops | 153 | 99 | 1.54x | pass |
| builin_types | 163 | 98 | 1.67x | pass |
| callquoteevalreduce2 | 145 | 101 | 1.44x | pass |
| case | 159 | 102 | 1.56x | pass |
| case2 | 141 | 106 | 1.33x | pass |
| caseempty | 169 | 109 | 1.55x | pass |
| chain | 156 | 113 | 1.39x | pass |
| collapse | 184 | 101 | 1.82x | pass |
| comments | 163 | 103 | 1.58x | pass |
| constanthead | 171 | 104 | 1.64x | pass |
| curry | 147 | 114 | 1.29x | pass |
| cut | 166 | 109 | 1.52x | pass |
| empty | 175 | 108 | 1.61x | pass |
| eval | 171 | 118 | 1.45x | pass |
| factorial | 161 | 103 | 1.56x | pass |
| fib | 452 | 105 | 4.29x | pass |
| fibadd | 471 | 111 | 4.25x | pass |
| fibsmart | 151 | 105 | 1.44x | pass |
| fibsmartimport | 176 | 108 | 1.63x | pass |
| foldall | 150 | 130 | 1.16x | pass |
| foldallmatch | 165 | 120 | 1.37x | pass |
| foldallspacecount | 172 | 112 | 1.53x | pass |
| forall | 165 | 129 | 1.28x | pass |
| functiontypes | 167 | 106 | 1.57x | pass |
| greedy_chess | 15795\* (timeout) | 1448\* (ran) | - | timeout/ran |
| he_assert | 171 | 110 | 1.56x | pass |
| he_atomspace | 173 | 102 | 1.69x | pass |
| he_equalreduct | 172 | 104 | 1.65x | pass |
| he_error | 169 | 103 | 1.64x | pass |
| he_evaluation | 171 | 112 | 1.53x | pass |
| he_math | 162 | 112 | 1.44x | pass |
| he_minimalmetta | 1851 | 1218 | 1.52x | pass |
| he_quoting | 178 | 109 | 1.64x | pass |
| he_types | 156 | 114 | 1.36x | pass |
| holfunctions | 155 | 115 | 1.35x | pass |
| hyperpose_primes | 1125 | 1065 | 1.06x | pass |
| identity | 200 | 109 | 1.84x | pass |
| if | 148 | 104 | 1.42x | pass |
| if2 | 178 | 111 | 1.60x | pass |
| if3 | 169 | 105 | 1.60x | pass |
| if4 | 172 | 104 | 1.65x | pass |
| ifcasenondet | 164 | 110 | 1.49x | pass |
| is_alpha_member_test | 181 | 117 | 1.55x | pass |
| iter | 181 | 114 | 1.59x | pass |
| lambda | 150 | 129 | 1.16x | pass |
| let_superpose_if_case | 178 | 112 | 1.60x | pass |
| letext | 145 | 111 | 1.30x | pass |
| letlet | 175 | 116 | 1.50x | pass |
| letstar | 178 | 111 | 1.61x | pass |
| listhead | 180 | 111 | 1.62x | pass |
| matchnested | 182 | 116 | 1.58x | pass |
| matchnested2 | 181 | 117 | 1.55x | pass |
| matchsingle | 179 | 109 | 1.65x | pass |
| matchtypes | 158 | 113 | 1.40x | pass |
| matespacefast | 4292 | 3337 | 1.29x | pass |
| math | 153 | 99 | 1.54x | pass |
| meta_types | 178 | 98 | 1.81x | pass |
| metta4_prog | 168 | 103 | 1.64x | pass |
| multicall | 167 | 104 | 1.61x | pass |
| multiset_operations | 172 | 101 | 1.70x | pass |
| mutex_and_transaction | 161 | 113 | 1.43x | pass |
| myinterpreter | 162 | 111 | 1.46x | pass |
| nars_direct | 164 | 103\* (fail) | - | pass/fail |
| nars_tuffy | 230 | 108\* (fail) | - | pass/fail |
| nilbc | 737 | 478 | 1.54x | pass |
| once | 155 | 103 | 1.50x | pass |
| parametric_types | 169 | 103 | 1.64x | pass |
| parse | 165 | 101 | 1.64x | pass |
| patrick_iterate_fib | 167 | 111 | 1.51x | pass |
| patrick_iterate_quad | 318 | 178 | 1.79x | pass |
| peano | 1543 | 297 | 5.19x | pass |
| peanofast | 496 | 118 | 4.20x | pass |
| permutations | 823 | 541 | 1.52x | pass |
| pln_direct | 179 | 112\* (fail) | - | pass/fail |
| pln_roman | 236 | 143\* (fail) | - | pass/fail |
| pln_tuffy | 190 | 110\* (fail) | - | pass/fail |
| plntest | 158 | 108 | 1.46x | pass |
| plntestdirect | 170 | 354\* (ran) | - | pass/ran |
| recursive_types | 165 | 102 | 1.62x | pass |
| recursive_types2 | 170 | 101 | 1.69x | pass |
| repr | 167 | 94 | 1.78x | pass |
| selfprog | 167 | 102 | 1.64x | pass |
| smartdispatch | 167 | 111 | 1.50x | pass |
| spacefunction | 161 | 99 | 1.63x | pass |
| spaces | 168 | 104 | 1.62x | pass |
| spaces2 | 146 | 110 | 1.33x | pass |
| spaces3 | 143 | 104 | 1.38x | pass |
| specializecyclic | 147 | 104 | 1.41x | pass |
| state | 149 | 98 | 1.52x | pass |
| streamops | 169 | 104 | 1.62x | pass |
| string | 163 | 97 | 1.67x | pass |
| supercollapse | 164 | 109 | 1.50x | pass |
| superpose_nested | 162 | 106 | 1.52x | pass |
| superpose_primes | 177 | 109 | 1.62x | pass |
| tabling_fib | 168 | 103 | 1.62x | pass |
| test_alpha_unique_atom | 157 | 110 | 1.42x | pass |
| test_string_comments | 159 | 103 | 1.54x | pass |
| tests | 170 | 106 | 1.60x | pass |
| tilepuzzle | 1663 | 424 | 3.92x | pass |
| translatorrule_fib | 145 | 104 | 1.39x | pass |
| twostage | 148 | 104 | 1.43x | pass |
| types | 161 | 112 | 1.43x | pass |
| types_dependent | 147 | 106 | 1.38x | pass |
| xor | 179 | 104 | 1.72x | pass |
