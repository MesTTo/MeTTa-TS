// SPDX-FileCopyrightText: 2026 Nil Geisweiller — chaining (https://github.com/trueagi-io/chaining)
// SPDX-FileCopyrightText: 2026 MesTTo — MeTTaScript adaptation
//
// SPDX-License-Identifier: GPL-3.0-only

// The proof-size-bounded backward chainer from Nil Geisweiller's bfc-xp.metta (obc/obc-gtz plus the three
// Łukasiewicz propositional axioms and modus ponens), a rule-based (not space-based), Number-size-bounded
// search. Shared by the loop-rejection and moded-tabling tests. A call `(obc s (: $x $a))` searches for a
// proof `$x` of theorem `$a` with size exactly `s`; `obc-gtz` handles the size > 0 case. The `mp` rule joins
// two obc subgoals on the shared antecedent `$a`, the recursion whose repeated cyclic unifications motivated
// deep loop rejection and whose repeated non-ground subgoals motivate moded tabling.
export const OBC = `
(= (obc-gtz $s (: ax₁ (→ $𝜑 (→ $𝜓 $𝜑)))) (MkSized 1 (: ax₁ (→ $𝜑 (→ $𝜓 $𝜑)))))
(= (obc-gtz $s (: ax₂ (→ (→ $𝜑 (→ $𝜓 $𝜒)) (→ (→ $𝜑 $𝜓) (→ $𝜑 $𝜒))))) (MkSized 1 (: ax₂ (→ (→ $𝜑 (→ $𝜓 $𝜒)) (→ (→ $𝜑 $𝜓) (→ $𝜑 $𝜒))))))
(= (obc-gtz $s (: ax₃ (→ (→ (¬ $𝜑) (¬ $𝜓)) (→ $𝜓 $𝜑)))) (MkSized 1 (: ax₃ (→ (→ (¬ $𝜑) (¬ $𝜓)) (→ $𝜓 $𝜑)))))
(= (obc-gtz $s (: (mp $f $x) $b)) (if (< 2 $s) (let* (((MkSized $fs (: $f (→ $a $b))) (obc (- $s 2) (: $f (→ $a $b)))) ((MkSized $xs (: $x $a)) (obc (- (- $s 1) $fs) (: $x $a)))) (MkSized (+ (+ $fs $xs) 1) (: (mp $f $x) $b))) (empty)))
(= (obc $s (: $x $a)) (if (< 0 $s) (obc-gtz $s (: $x $a)) (empty)))`;
