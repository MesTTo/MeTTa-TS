// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Differential testing: run a program two ways and assert the printed result lists agree per query.
// Used to gate optimisations (e.g. tabling) byte-identical against the reference engine, on a fixed
// adversarial corpus plus generated programs.
import { type QueryResult } from "./runner";
import { format } from "./parser";

export type RunFn = (src: string) => QueryResult[] | Promise<QueryResult[]>;

export interface Divergence {
  readonly program: string;
  readonly a: string;
  readonly b: string;
}

function renderResults(rs: QueryResult[]): string {
  return rs.map((r) => format(r.query) + " => " + r.results.map(format).join(" ")).join("\n");
}

function recursiveSpaceReader(space: string): string {
  return `
    (= (space-read $n $x)
       (unify $n 0
         (match ${space} (fact $x) hit)
         (join (space-read (- $n 1) $x) (space-read (- $n 1) $x))))
    (= (join hit hit) hit)
  `;
}

/** Run every program through both functions; return one Divergence per program whose printed
 *  results differ (order and multiplicity included, because `format`-joining preserves both). */
export async function differential(
  programs: string[],
  runA: RunFn,
  runB: RunFn,
): Promise<Divergence[]> {
  const out: Divergence[] = [];
  for (const program of programs) {
    const a = renderResults(await runA(program));
    const b = renderResults(await runB(program));
    if (a !== b) out.push({ program, a, b });
  }
  return out;
}

/** A fixed corpus that exercises the semantics tabling must not disturb. */
export const ADVERSARIAL: string[] = [
  "!(+ 1 2)",
  "(= (f $x) (g $x))\n(= (g $x) (* $x 2))\n!(f 21)",
  "!(superpose (a b c))",
  "(= (col) (collapse (superpose (1 2 3))))\n!(col)",
  "!(+ 0.0 -0.0)",
  "!(== 1 1.0)",
  "(= (dup $x) (superpose ($x $x)))\n!(dup 7)",
  "!(if (> 3 2) yes no)",
  "(= (amb) (superpose (1 2)))\n!(let $x (amb) (let $y (amb) ($x $y)))",
  "!(new-state 5)",
  "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))\n!(fib 12)",
  "(= (qd $n) (/ 12 $n))\n!(qd 3)\n!(qd 0)",
  "(= (dbl $n) (+ $n $n))\n!(dbl 2.5)\n!(dbl 7)",
  "(= (ack $m $n) (if (== $m 0) (+ $n 1) (if (== $n 0) (ack (- $m 1) 1) (ack (- $m 1) (ack $m (- $n 1))))))\n!(ack 2 3)",
  "(= (g $n) (let $x (* $n 2) (let $y (+ $x 1) (* $x $y))))\n!(g 6)",
  // Superpose argument policy: an ill-typed-call tuple is data (operators enumerate), a well-typed
  // call still evaluates first, and a computed tuple splits its value.
  "!(superpose (+ - *))",
  "(= (t) (a b))\n!(superpose (t))",
  "!(superpose (cdr-atom (0 1 2 3)))",
  "(= (a b) c)\n!(superpose (a b))",
  // Number-family aliasing: `Int`-signed functions accept `Number` values on both engines' paths, in
  // the parameter direction and through a `Number`-parameter composition such as `+`.
  "(: f (-> Int Int))\n(= (f $x) (+ $x 1))\n!(f 5)",
  "(: f (-> Int Int))\n(= (f $x) (+ $x 1))\n!(f 3.5)",
  "(: ev (-> Atom Atom Int))\n(= (ev (Lit $n) $env) $n)\n(= (ev (Add $a $b) $env) (+ (ev $a $env) (ev $b $env)))\n!(ev (Add (Lit 2) (Add (Lit 3) (Lit 4))) empty)",
  // A constructor-bound application head dispatches grounded numeric operators natively. User-defined
  // and unresolved symbols take the per-clause interpreter fallback instead.
  "(= (var-ev (C $n)) $n)\n(= (var-ev (Bin $op $a $b)) ($op (var-ev $a) (var-ev $b)))\n!(var-ev (Bin + (C 2) (Bin * (C 3) (C 4))))",
  "(= (join $a $b) (Pair $a $b))\n(= (var-ev (C $n)) $n)\n(= (var-ev (Bin $op $a $b)) ($op (var-ev $a) (var-ev $b)))\n!(var-ev (Bin join (C 2) (C 3)))",
  "(= (var-ev (C $n)) $n)\n(= (var-ev (Bin $op $a $b)) ($op (var-ev $a) (var-ev $b)))\n!(var-ev (Bin unresolved-head (C 2) (C 3)))",
  // A whole-branch scalar self-call is depth-neutral, while the same call nested under `+` remains
  // depth-tracked and cuts at the default language bound.
  "(= (count $n) (if (== $n 0) done (count (- $n 1))))\n!(count 500)",
  "(= (sum $n) (if (== $n 0) 0 (+ 1 (sum (- $n 1)))))\n!(sum 500)",
  `
    (Evaluation (philosopher Plato))
    (Evaluation (likes-to-wrestle Plato))
    (Implication
      (And (Evaluation (philosopher $x)) (Evaluation (likes-to-wrestle $x)))
      (Evaluation (human $x)))
    (Implication (Evaluation (human $x)) (Evaluation (mortal $x)))
    (= (deduce (Evaluation ($p $x))) (match &self (Evaluation ($p $x)) T))
    (= (deduce (Evaluation ($p $x)))
       (match &self (Implication $premise (Evaluation ($p $x))) (deduce $premise)))
    (= (deduce (And $a $b)) (And (deduce $a) (deduce $b)))
    (= (And T T) T)
    !(deduce (Evaluation (mortal Plato)))
    !(deduce (Evaluation (mortal Plato)))
  `,
  `
    ${recursiveSpaceReader("&self")}
    !(space-read 2 added)
    !(add-atom &self (fact added))
    !(space-read 2 added)
  `,
  `
    ${recursiveSpaceReader("&self")}
    !(add-atom &self (fact removed))
    !(space-read 2 removed)
    !(remove-atom &self (fact removed))
    !(space-read 2 removed)
  `,
  `
    !(bind! &kb (new-space))
    ${recursiveSpaceReader("&kb")}
    !(space-read 2 named)
    !(add-atom &kb (fact named))
    !(space-read 2 named)
  `,
  `
    ${recursiveSpaceReader("&self")}
    (= (write-read $x)
       (let $unit (add-atom &self (fact $x))
         (space-read 2 $x)))
    !(space-read 2 written)
    !(write-read written)
  `,
];

// A tiny seeded PRNG so generated programs are deterministic across runs (no Math.random).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0x100000000);
}

/** Generate `n` small pure recursive arithmetic programs with random int arguments. These are the
 *  shape tabling targets (overlapping subproblems), so they exercise the memo path. */
export function genPrograms(n: number, seed = 1): string[] {
  const rnd = lcg(seed);
  const defs = [
    (a: number) =>
      `(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))\n!(fib ${a})`,
    (a: number) => `(= (fact $n) (if (< $n 1) 1 (* $n (fact (- $n 1)))))\n!(fact ${a})`,
    (a: number) => `(= (sumto $n) (if (< $n 1) 0 (+ $n (sumto (- $n 1)))))\n!(sumto ${a})`,
    (a: number) =>
      `(= (even $n) (if (== $n 0) True (odd (- $n 1))))\n(= (odd $n) (if (== $n 0) False (even (- $n 1))))\n!(even ${a})`,
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const def = defs[Math.floor(rnd() * defs.length)]!;
    const arg = 1 + Math.floor(rnd() * 12); // small, so untabled runs stay fast
    out.push(def(arg));
  }
  return out;
}
