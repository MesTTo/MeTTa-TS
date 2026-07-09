# MeTTa-TS vs PeTTa — PeTTa example corpus

Wall-clock per example as a black-box subprocess (each engine's runtime startup included).
`speedup` = PeTTa / MeTTa-TS over examples both engines pass. `*` marks a non-pass run.

- examples: 105, both pass: 98, speedup median 1.82x, geomean 1.85x
- timeout 60s, runs 3 (min), MeTTa-TS --max-steps 100000000

| example | PeTTa (ms) | MeTTa-TS (ms) | speedup | result |
|---|--:|--:|--:|---|
| and_or | 177 | 90 | 1.96x | pass |
| atomops | 146 | 90 | 1.62x | pass |
| builin_types | 172 | 93 | 1.85x | pass |
| callquoteevalreduce2 | 159 | 92 | 1.74x | pass |
| case | 179 | 92 | 1.95x | pass |
| case2 | 170 | 89 | 1.91x | pass |
| caseempty | 167 | 91 | 1.82x | pass |
| chain | 170 | 94 | 1.80x | pass |
| collapse | 155 | 92 | 1.69x | pass |
| comments | 181 | 87 | 2.08x | pass |
| constanthead | 178 | 90 | 1.97x | pass |
| curry | 176 | 111 | 1.58x | pass |
| cut | 179 | 93 | 1.93x | pass |
| empty | 176 | 89 | 1.99x | pass |
| eval | 164 | 106 | 1.54x | pass |
| factorial | 160 | 91 | 1.76x | pass |
| fib | 454 | 88 | 5.14x | pass |
| fibadd | 451 | 100 | 4.53x | pass |
| fibsmart | 150 | 89 | 1.69x | pass |
| fibsmartimport | 178 | 98 | 1.82x | pass |
| foldall | 183 | 110 | 1.66x | pass |
| foldallmatch | 180 | 103 | 1.74x | pass |
| foldallspacecount | 179 | 102 | 1.76x | pass |
| forall | 177 | 124 | 1.43x | pass |
| functiontypes | 174 | 95 | 1.82x | pass |
| greedy_chess | 14934\* (timeout) | 2056\* (ran) | - | timeout/ran |
| he_assert | 184 | 96 | 1.91x | pass |
| he_atomspace | 148 | 92 | 1.61x | pass |
| he_equalreduct | 180 | 90 | 1.99x | pass |
| he_error | 146 | 90 | 1.63x | pass |
| he_evaluation | 177 | 101 | 1.74x | pass |
| he_math | 180 | 97 | 1.86x | pass |
| he_minimalmetta | 1825 | 1065 | 1.71x | pass |
| he_quoting | 182 | 94 | 1.94x | pass |
| he_types | 180 | 91 | 1.97x | pass |
| holfunctions | 174 | 107 | 1.62x | pass |
| hyperpose_primes | 1116 | 1062 | 1.05x | pass |
| identity | 172 | 89 | 1.92x | pass |
| if | 178 | 91 | 1.95x | pass |
| if2 | 176 | 90 | 1.95x | pass |
| if3 | 165 | 89 | 1.86x | pass |
| if4 | 178 | 92 | 1.94x | pass |
| ifcasenondet | 168 | 95 | 1.76x | pass |
| is_alpha_member_test | 177 | 104 | 1.70x | pass |
| iter | 183 | 102 | 1.80x | pass |
| lambda | 180 | 113 | 1.60x | pass |
| let_superpose_if_case | 149 | 99 | 1.51x | pass |
| letext | 179 | 92 | 1.96x | pass |
| letlet | 176 | 98 | 1.79x | pass |
| letstar | 153 | 94 | 1.62x | pass |
| listhead | 168 | 90 | 1.85x | pass |
| matchnested | 177 | 106 | 1.68x | pass |
| matchnested2 | 156 | 107 | 1.47x | pass |
| matchsingle | 177 | 91 | 1.95x | pass |
| matchtypes | 146 | 89 | 1.65x | pass |
| matespacefast | 4348 | 3043 | 1.43x | pass |
| math | 182 | 98 | 1.87x | pass |
| meta_types | 174 | 91 | 1.91x | pass |
| metta4_prog | 177 | 93 | 1.89x | pass |
| multicall | 179 | 93 | 1.93x | pass |
| multiset_operations | 182 | 90 | 2.01x | pass |
| mutex_and_transaction | 181 | 103 | 1.75x | pass |
| myinterpreter | 179 | 95 | 1.89x | pass |
| nars_direct | 159 | 96\* (fail) | - | pass/fail |
| nars_tuffy | 252 | 104\* (fail) | - | pass/fail |
| nilbc | 761 | 709 | 1.07x | pass |
| once | 175 | 93 | 1.88x | pass |
| parametric_types | 150 | 90 | 1.66x | pass |
| parse | 181 | 88 | 2.05x | pass |
| patrick_iterate_fib | 181 | 97 | 1.85x | pass |
| patrick_iterate_quad | 340 | 167 | 2.04x | pass |
| peano | 1588 | 306 | 5.19x | pass |
| peanofast | 516 | 114 | 4.52x | pass |
| permutations | 867 | 483 | 1.80x | pass |
| pln_direct | 200 | 99\* (fail) | - | pass/fail |
| pln_roman | 229 | 102\* (fail) | - | pass/fail |
| pln_tuffy | 191 | 108\* (fail) | - | pass/fail |
| plntest | 182 | 97 | 1.87x | pass |
| plntestdirect | 159 | 325\* (ran) | - | pass/ran |
| recursive_types | 153 | 91 | 1.67x | pass |
| recursive_types2 | 177 | 95 | 1.87x | pass |
| repr | 164 | 90 | 1.81x | pass |
| selfprog | 175 | 95 | 1.84x | pass |
| smartdispatch | 162 | 99 | 1.64x | pass |
| spacefunction | 171 | 93 | 1.85x | pass |
| spaces | 173 | 93 | 1.87x | pass |
| spaces2 | 179 | 95 | 1.89x | pass |
| spaces3 | 176 | 96 | 1.84x | pass |
| specializecyclic | 152 | 98 | 1.54x | pass |
| state | 184 | 94 | 1.96x | pass |
| streamops | 146 | 94 | 1.55x | pass |
| string | 174 | 88 | 1.96x | pass |
| supercollapse | 177 | 106 | 1.67x | pass |
| superpose_nested | 179 | 106 | 1.69x | pass |
| superpose_primes | 174 | 107 | 1.63x | pass |
| tabling_fib | 171 | 96 | 1.78x | pass |
| test_alpha_unique_atom | 182 | 110 | 1.65x | pass |
| test_string_comments | 171 | 99 | 1.73x | pass |
| tests | 163 | 111 | 1.47x | pass |
| tilepuzzle | 1602 | 426 | 3.76x | pass |
| translatorrule_fib | 178 | 96 | 1.85x | pass |
| twostage | 183 | 88 | 2.08x | pass |
| types | 161 | 103 | 1.56x | pass |
| types_dependent | 170 | 95 | 1.78x | pass |
| xor | 180 | 92 | 1.95x | pass |
