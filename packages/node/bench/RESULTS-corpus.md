# MeTTa-TS vs PeTTa — PeTTa example corpus

Wall-clock per example as a black-box subprocess (each engine's runtime startup included).
`speedup` = PeTTa / MeTTa-TS over examples both engines pass. `*` marks a non-pass run.

- examples: 105, both pass: 98, speedup median 1.49x, geomean 1.55x
- timeout 60s, runs 5 (min), MeTTa-TS --max-steps 100000000

| example | PeTTa (ms) | MeTTa-TS (ms) | speedup | result |
|---|--:|--:|--:|---|
| and_or | 147 | 105 | 1.40x | pass |
| atomops | 149 | 109 | 1.36x | pass |
| builin_types | 171 | 99 | 1.74x | pass |
| callquoteevalreduce2 | 144 | 108 | 1.33x | pass |
| case | 155 | 100 | 1.55x | pass |
| case2 | 154 | 96 | 1.61x | pass |
| caseempty | 144 | 104 | 1.39x | pass |
| chain | 144 | 95 | 1.52x | pass |
| collapse | 146 | 93 | 1.56x | pass |
| comments | 151 | 96 | 1.57x | pass |
| constanthead | 152 | 104 | 1.46x | pass |
| curry | 149 | 118 | 1.26x | pass |
| cut | 153 | 106 | 1.44x | pass |
| empty | 146 | 104 | 1.41x | pass |
| eval | 180 | 117 | 1.54x | pass |
| factorial | 149 | 103 | 1.45x | pass |
| fib | 425 | 103 | 4.10x | pass |
| fibadd | 435 | 149 | 2.92x | pass |
| fibsmart | 145 | 101 | 1.43x | pass |
| fibsmartimport | 166 | 112 | 1.48x | pass |
| foldall | 149 | 128 | 1.16x | pass |
| foldallmatch | 170 | 114 | 1.49x | pass |
| foldallspacecount | 148 | 108 | 1.38x | pass |
| forall | 147 | 131 | 1.11x | pass |
| functiontypes | 150 | 106 | 1.42x | pass |
| greedy_chess | 16000\* (timeout) | 1422\* (ran) | - | timeout/ran |
| he_assert | 151 | 102 | 1.48x | pass |
| he_atomspace | 137 | 92 | 1.48x | pass |
| he_equalreduct | 139 | 96 | 1.45x | pass |
| he_error | 140 | 93 | 1.50x | pass |
| he_evaluation | 141 | 98 | 1.43x | pass |
| he_math | 142 | 94 | 1.51x | pass |
| he_minimalmetta | 1742 | 1130 | 1.54x | pass |
| he_quoting | 149 | 127 | 1.17x | pass |
| he_types | 180 | 103 | 1.75x | pass |
| holfunctions | 154 | 117 | 1.32x | pass |
| hyperpose_primes | 1094 | 1071 | 1.02x | pass |
| identity | 149 | 96 | 1.56x | pass |
| if | 152 | 98 | 1.55x | pass |
| if2 | 175 | 107 | 1.64x | pass |
| if3 | 147 | 99 | 1.49x | pass |
| if4 | 165 | 101 | 1.63x | pass |
| ifcasenondet | 170 | 103 | 1.65x | pass |
| is_alpha_member_test | 158 | 117 | 1.35x | pass |
| iter | 152 | 105 | 1.45x | pass |
| lambda | 157 | 123 | 1.28x | pass |
| let_superpose_if_case | 151 | 106 | 1.43x | pass |
| letext | 145 | 104 | 1.39x | pass |
| letlet | 140 | 103 | 1.35x | pass |
| letstar | 149 | 103 | 1.46x | pass |
| listhead | 174 | 102 | 1.71x | pass |
| matchnested | 162 | 103 | 1.57x | pass |
| matchnested2 | 143 | 104 | 1.38x | pass |
| matchsingle | 161 | 100 | 1.62x | pass |
| matchtypes | 142 | 98 | 1.45x | pass |
| matespacefast | 4181 | 3307 | 1.26x | pass |
| math | 142 | 97 | 1.46x | pass |
| meta_types | 161 | 96 | 1.68x | pass |
| metta4_prog | 155 | 100 | 1.55x | pass |
| multicall | 150 | 105 | 1.43x | pass |
| multiset_operations | 161 | 94 | 1.71x | pass |
| mutex_and_transaction | 162 | 109 | 1.50x | pass |
| myinterpreter | 165 | 99 | 1.66x | pass |
| nars_direct | 163 | 100\* (fail) | - | pass/fail |
| nars_tuffy | 237 | 110\* (fail) | - | pass/fail |
| nilbc | 765 | 467 | 1.64x | pass |
| once | 158 | 103 | 1.53x | pass |
| parametric_types | 144 | 98 | 1.47x | pass |
| parse | 153 | 108 | 1.41x | pass |
| patrick_iterate_fib | 153 | 98 | 1.57x | pass |
| patrick_iterate_quad | 313 | 169 | 1.85x | pass |
| peano | 1583 | 310 | 5.11x | pass |
| peanofast | 510 | 120 | 4.24x | pass |
| permutations | 832 | 559 | 1.49x | pass |
| pln_direct | 164 | 108\* (fail) | - | pass/fail |
| pln_roman | 201 | 104\* (fail) | - | pass/fail |
| pln_tuffy | 158 | 107\* (fail) | - | pass/fail |
| plntest | 143 | 111 | 1.29x | pass |
| plntestdirect | 146 | 359\* (ran) | - | pass/ran |
| recursive_types | 148 | 103 | 1.43x | pass |
| recursive_types2 | 152 | 98 | 1.55x | pass |
| repr | 141 | 93 | 1.51x | pass |
| selfprog | 148 | 100 | 1.49x | pass |
| smartdispatch | 154 | 101 | 1.53x | pass |
| spacefunction | 145 | 98 | 1.48x | pass |
| spaces | 148 | 101 | 1.47x | pass |
| spaces2 | 149 | 104 | 1.43x | pass |
| spaces3 | 160 | 105 | 1.52x | pass |
| specializecyclic | 172 | 102 | 1.69x | pass |
| state | 166 | 96 | 1.72x | pass |
| streamops | 165 | 106 | 1.56x | pass |
| string | 172 | 95 | 1.81x | pass |
| supercollapse | 173 | 104 | 1.67x | pass |
| superpose_nested | 150 | 101 | 1.48x | pass |
| superpose_primes | 166 | 104 | 1.59x | pass |
| tabling_fib | 152 | 100 | 1.53x | pass |
| test_alpha_unique_atom | 152 | 105 | 1.44x | pass |
| test_string_comments | 146 | 127 | 1.15x | pass |
| tests | 155 | 106 | 1.46x | pass |
| tilepuzzle | 1543 | 401 | 3.85x | pass |
| translatorrule_fib | 146 | 99 | 1.47x | pass |
| twostage | 143 | 100 | 1.43x | pass |
| types | 159 | 106 | 1.49x | pass |
| types_dependent | 142 | 100 | 1.42x | pass |
| xor | 152 | 100 | 1.52x | pass |
