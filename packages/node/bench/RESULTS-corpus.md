# MeTTa-TS vs PeTTa — PeTTa example corpus

Wall-clock per example as a black-box subprocess (each engine's runtime startup included).
`speedup` = PeTTa / MeTTa-TS over examples both engines pass. `*` marks a non-pass run.

- examples: 107, both pass: 82, speedup median 1.75x, geomean 1.79x
- timeout 60s, runs 3 (min), MeTTa-TS --max-steps 100000000

| example | PeTTa (ms) | MeTTa-TS (ms) | speedup | result |
|---|--:|--:|--:|---|
| and_or | 187 | 89 | 2.09x | pass |
| atomops | 157 | 94 | 1.66x | pass |
| builin_types | 185 | 98 | 1.89x | pass |
| callquoteevalreduce2 | 176 | 94 | 1.86x | pass |
| case | 179 | 92 | 1.94x | pass |
| case2 | 180 | 100 | 1.80x | pass |
| caseempty | 182 | 92 | 1.97x | pass |
| chain | 168 | 92 | 1.82x | pass |
| collapse | 182 | 98 | 1.85x | pass |
| comments | 183 | 105 | 1.74x | pass |
| constanthead | 153 | 97 | 1.58x | pass |
| curry | 164 | 115 | 1.44x | pass |
| cut | 173 | 95 | 1.81x | pass |
| empty | 162 | 92 | 1.75x | pass |
| eval | 177 | 111 | 1.59x | pass |
| factorial | 158 | 94 | 1.69x | pass |
| fib | 462 | 101 | 4.57x | pass |
| fibadd | 481 | 102 | 4.72x | pass |
| fibsmart | 161 | 93 | 1.72x | pass |
| fibsmartimport | 174 | 104 | 1.68x | pass |
| foldall | 179 | 138\* (fail) | - | pass/fail |
| foldallmatch | 184 | 111\* (fail) | - | pass/fail |
| foldallspacecount | 171 | 106\* (fail) | - | pass/fail |
| forall | 169 | 123\* (fail) | - | pass/fail |
| functiontypes | 180 | 101 | 1.78x | pass |
| greedy_chess | 16327\* (timeout) | 2431\* (ran) | - | timeout/ran |
| he_assert | 191 | 156 | 1.23x | pass |
| he_atomspace | 213 | 99 | 2.15x | pass |
| he_equalreduct | 183 | 100 | 1.83x | pass |
| he_error | 168 | 95 | 1.76x | pass |
| he_evaluation | 158 | 105 | 1.50x | pass |
| he_math | 182 | 106 | 1.72x | pass |
| he_minimalmetta | 1890 | 1344 | 1.41x | pass |
| he_quoting | 185 | 97 | 1.90x | pass |
| he_types | 157 | 103 | 1.53x | pass |
| holfunctions | 163 | 113 | 1.45x | pass |
| hyperpose_primes | 1152 | 1106\* (fail) | - | pass/fail |
| identity | 156 | 95 | 1.64x | pass |
| if | 169 | 96 | 1.75x | pass |
| if2 | 189 | 149 | 1.27x | pass |
| if3 | 165 | 93 | 1.78x | pass |
| if4 | 160 | 94 | 1.71x | pass |
| ifcasenondet | 174 | 101 | 1.73x | pass |
| is_alpha_member_test | 161 | 104 | 1.56x | pass |
| iter | 163 | 115 | 1.42x | pass |
| lambda | 189 | 138 | 1.36x | pass |
| let_superpose_if_case | 187 | 107 | 1.75x | pass |
| letext | 170 | 96 | 1.76x | pass |
| letlet | 176 | 91 | 1.93x | pass |
| letstar | 163 | 100 | 1.63x | pass |
| listhead | 150 | 91 | 1.66x | pass |
| matchnested | 178 | 106\* (fail) | - | pass/fail |
| matchnested2 | 170 | 104\* (fail) | - | pass/fail |
| matchsingle | 167 | 98 | 1.70x | pass |
| matchtypes | 161 | 99 | 1.62x | pass |
| matespace | 4132 | 60150\* (timeout) | - | pass/timeout |
| matespace2 | 5893 | 60179\* (timeout) | - | pass/timeout |
| matespacefast | 4861 | 2136 | 2.28x | pass |
| math | 181 | 102 | 1.77x | pass |
| meta_types | 178 | 90 | 1.98x | pass |
| metta4_prog | 159 | 93 | 1.71x | pass |
| multicall | 186 | 116 | 1.61x | pass |
| multiset_operations | 160 | 93 | 1.72x | pass |
| mutex_and_transaction | 159 | 109 | 1.47x | pass |
| myinterpreter | 165 | 103 | 1.61x | pass |
| nars_direct | 169 | 99\* (fail) | - | pass/fail |
| nars_tuffy | 248 | 60077\* (timeout) | - | pass/timeout |
| nilbc | 786 | 780 | 1.01x | pass |
| once | 179 | 103 | 1.74x | pass |
| parametric_types | 190 | 99 | 1.92x | pass |
| parse | 187 | 105\* (fail) | - | pass/fail |
| patrick_iterate_fib | 158 | 104 | 1.51x | pass |
| patrick_iterate_quad | 339 | 174 | 1.95x | pass |
| peano | 1651 | 290 | 5.70x | pass |
| peanofast | 540 | 106 | 5.11x | pass |
| permutations | 843 | 471 | 1.79x | pass |
| pln_direct | 198 | 93\* (fail) | - | pass/fail |
| pln_roman | 227 | 138\* (fail) | - | pass/fail |
| pln_tuffy | 203 | 60080\* (timeout) | - | pass/timeout |
| plntest | 190 | 104 | 1.83x | pass |
| plntestdirect | 156 | 327\* (ran) | - | pass/ran |
| recursive_types | 164 | 96 | 1.70x | pass |
| recursive_types2 | 155 | 102 | 1.51x | pass |
| repr | 204 | 97 | 2.11x | pass |
| selfprog | 153 | 148\* (fail) | - | pass/fail |
| smartdispatch | 175 | 112 | 1.57x | pass |
| spacefunction | 189 | 103 | 1.84x | pass |
| spaces | 186 | 102 | 1.83x | pass |
| spaces2 | 158 | 101\* (fail) | - | pass/fail |
| spaces3 | 177 | 101\* (fail) | - | pass/fail |
| specializecyclic | 184 | 99 | 1.86x | pass |
| state | 166 | 92 | 1.82x | pass |
| streamops | 185 | 93\* (fail) | - | pass/fail |
| string | 180 | 91 | 1.98x | pass |
| supercollapse | 162 | 111\* (fail) | - | pass/fail |
| superpose_nested | 178 | 101\* (fail) | - | pass/fail |
| superpose_primes | 219 | 148 | 1.47x | pass |
| tabling_fib | 165 | 90 | 1.83x | pass |
| test_alpha_unique_atom | 182 | 111 | 1.63x | pass |
| test_string_comments | 158 | 93 | 1.70x | pass |
| tests | 155 | 110\* (fail) | - | pass/fail |
| tilepuzzle | 1661 | 538\* (ran) | - | pass/ran |
| translatorrule_fib | 176 | 93 | 1.89x | pass |
| twostage | 157 | 95 | 1.66x | pass |
| types | 153 | 101 | 1.52x | pass |
| types_dependent | 181 | 92 | 1.96x | pass |
| xor | 161 | 92 | 1.75x | pass |
