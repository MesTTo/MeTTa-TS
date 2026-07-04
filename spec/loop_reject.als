// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Model MT1 — deep variable-loop rejection in the matcher (verifies packages/core/src/bindings.ts hasLoop).
//
// A direct match binds a variable with no occurs check (LeaTTa Core/Matching `matchAtomsWith`; the occurs
// check lives only in reconcile), so a binding set can carry a cyclic binding `$x <- (.. $x ..)`. Such a
// set has no finite instantiation and is filtered at the match boundary by `hasLoop` — the same place
// Hyperon's `match_atoms` drops `!binding.has_loops()` and CeTTa's `bindings_atom_has_loop` rejects. metta-ts
// had a SHALLOW `hasLoop` (only the one-hop self relation `$x <- $x`); this model shows why that is unsound
// and why the check must be deep and run at the bind/match boundary rather than only on reconcile. It is the
// root cause of the stack overflow on Nil Geisweiller's bfc-xp obc proof search.
//
// Run (write Alloy's output somewhere outside the repo):  cd /tmp && java -jar ~/.local/share/alloy/alloy.jar exec /path/to/spec/loop_reject.als
// UNSAT = the assertion holds in scope; SAT (for a check) = a counterexample; SAT (for a run) = a witness.
//
// Abstraction: cycle detection depends only on variable reachability, not on term structure, so a binding
// set is modeled by its directed graph `refersTo`: x -> y iff variable y occurs in x's bound value.
module loop_reject

// util/ordering (used by model MT2 below) supplies a total order over Var atoms, read as a bind order.
open util/ordering[Var] as ord

sig Var { refersTo: set Var }

// A loop: some variable reachable from itself in the binding graph (Hyperon binding_has_loops is a DFS over
// this graph; an on-path revisit is the back-edge).
pred deepLoop { some x: Var | x in x.^refersTo }

// metta-ts's former shallow hasLoop: only a direct one-hop self reference.
pred shallowLoop { some x: Var | x in x.refersTo }

// (1) NECESSITY. The shallow check misses indirect cycles: a 2-cycle x->y->x is a deepLoop but not a
//     shallowLoop. Expect a SAT counterexample — deepening hasLoop is required, not cosmetic.
assert ShallowCatchesAll { deepLoop => shallowLoop }
check ShallowCatchesAll for 6

// A variable "resolves" — its instantiation terminates at ground/unbound leaves — iff it can reach no
// variable that lies on a cycle.
fun cyclic: set Var { { c: Var | c in c.^refersTo } }
pred resolves[x: Var] { no (x.*refersTo & cyclic) }

// (2) SOUNDNESS. Deep loop-freedom is EXACTLY the guarantee that every variable resolves to a finite normal
//     form, so rejecting loopy binding sets (deep hasLoop) is precisely the guard that makes the resolver
//     terminate. Expect UNSAT (the assertion holds in scope).
assert DeepLoopFreeIffAllResolve { (not deepLoop) iff (all x: Var | resolves[x]) }
check DeepLoopFreeIffAllResolve for 8

// (3) LOCATION. A cycle can be built where every variable is bound at most once (a simple directed cycle:
//     refersTo functional). Such a cycle is formed entirely by FIRST binds, so an occurs check that fires
//     only on reconcile — re-binding an already-bound variable (LeaTTa addVarBinding / metta-ts reconcile) —
//     never sees it. Expect a SAT witness: the check must run at the match boundary, not only on reconcile.
//     This is the exact shape of the `$x <- (f $y), $y <- (g $x)` binding that overflowed the obc search.
pred firstBindOnlyCycle { deepLoop and (all x: Var | lone x.refersTo) }
run firstBindOnlyCycle for 6

// Model MT2 — the trail's per-bind occurs check (unifyCellOccurs / occursCell, packages/core/src/trail.ts)
// accepts EXACTLY the binding sets hasLoop accepts (the acyclic ones). Routing the backward chainer through
// the trail therefore stays byte-identical to the immutable match-then-hasLoop path on the loop question:
// hasLoop scans the finished set once (bindings.ts), the trail instead rejects, at each bind, a bind that
// would close a cycle. This model proves they agree in every bind order — the reason an after-the-fact scan
// and a per-bind check cannot disagree.
//
// Unification binds each variable at most once (it binds only an unbound variable), so a run is a bind ORDER
// over the variables; util/ordering supplies one. When x is bound to a value whose variables are x.refersTo,
// occursCell dereferences that value through the binds made so far, so the check fires iff x is reachable
// from x.refersTo using only edges whose source was bound BEFORE x.

// The edges already in place when x is bound: those whose source precedes x in the bind order.
fun priorEdges[x: Var]: Var -> Var { ord/prevs[x] <: refersTo }
// occursCell(x, value): x occurs in the dereferenced value, i.e. x is reachable from its own referents
// through binds made before x. Binding x would then close a cycle, so the check rejects the bind.
pred occursFires[x: Var] { x in x.refersTo.*(priorEdges[x]) }

// EQUIVALENCE. Expect UNSAT (holds in scope): some bind's occurs check fires IFF the finished binding graph
// has a deep loop. So the trail rejects exactly the sets hasLoop rejects, independent of the bind order. Any
// disagreement is a minimal cycle (a self-loop or a 2-cycle plus its closing bind), so scope 6 is decisive;
// the total order this adds over Var makes larger scopes much slower to solve without exercising a new shape.
assert OccursCheckEqualsHasLoop { (some x: Var | occursFires[x]) iff deepLoop }
check OccursCheckEqualsHasLoop for 6
