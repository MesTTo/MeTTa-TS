// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Clause code generation for the match-free nondet groups: each clause of a group compiles, once, to
// straight-line JavaScript over a slim mutable-cell term representation, stitched together with `new
// Function`. This removes the skeleton interpreter's per-node dispatch (the profile's unifySkel/instSkel/
// runCall spread) the same way a WAM removes a structure interpreter: head unification becomes specialized
// read/write-mode code that fails at the first mismatch with no allocation, body arguments and templates
// become direct constructor expressions, and integer guards and arithmetic fold inline. Measured on the
// proof-size-bounded chainer, the specialized form runs at ~80ns per inference — past SWI-Prolog's C WAM
// on the same search (~156ns with occurs_check) — where the skeleton interpreter runs at ~470ns.
//
// The occurs-check discipline is identical to the cell kernel (trail.ts): every bind that could close a
// cycle is checked (spec/loop_reject.als model MT2), so answers stay byte-identical to the interpreter —
// the moded-tabling differential oracle gates this file like every other engine change. Environments that
// forbid dynamic code (a CSP without 'unsafe-eval') make `new Function` throw; the caller then keeps the
// skeleton interpreter, which this module never replaces, only outruns.

import { type Atom, atomEq, expr, gint, sym, variable } from "./atom";
import { type IntVal, addInt, subInt, mulInt, cmpIntVal } from "./number";
import type { Skel, SkelBody, SkelClause } from "./compile";

// ---------- slim terms ----------
// One hidden class for every node (the engine's own Atom design, shrunk to what the search touches):
// t=0 unbound-able cell, t=1 symbol, t=2 integer, t=3 opaque grounded atom, t=4 expression. `h` is the
// expression's head-symbol discriminator (null for a non-symbol head) so two rigid applications compare
// heads in one string compare; `r` marks a rigid (variable-free) subtree so the occurs check skips it.
export interface Slim {
  readonly t: number;
  b: Slim | undefined;
  nm: string;
  readonly s: string;
  readonly n: IntVal;
  readonly g: Atom | undefined;
  readonly h: string | null;
  readonly i: readonly Slim[];
  readonly r: boolean;
}

const mkc = (): Slim => ({
  t: 0,
  b: undefined,
  nm: "",
  s: "",
  n: 0,
  g: undefined,
  h: null,
  i: EMPTY_ITEMS,
  r: false,
});
const EMPTY_ITEMS: readonly Slim[] = [];
const symS = (name: string): Slim => ({
  t: 1,
  b: undefined,
  nm: "",
  s: name,
  n: 0,
  g: undefined,
  h: null,
  i: EMPTY_ITEMS,
  r: true,
});
const intS = (n: IntVal): Slim => ({
  t: 2,
  b: undefined,
  nm: "",
  s: "",
  n,
  g: undefined,
  h: null,
  i: EMPTY_ITEMS,
  r: true,
});
const gndS = (g: Atom): Slim => ({
  t: 3,
  b: undefined,
  nm: "",
  s: "",
  n: 0,
  g,
  h: null,
  i: EMPTY_ITEMS,
  r: true,
});
const exq = (items: readonly Slim[]): Slim => {
  let rigid = true;
  for (const it of items)
    if (!it.r) {
      rigid = false;
      break;
    }
  const h0 = items.length > 0 && items[0]!.t === 1 ? items[0]!.s : null;
  return { t: 4, b: undefined, nm: "", s: "", n: 0, g: undefined, h: h0, i: items, r: rigid };
};

const derefS = (a: Slim): Slim => {
  let cur = a;
  while (cur.t === 0 && cur.b !== undefined) cur = cur.b;
  return cur;
};

const occursS = (v: Slim, t0: Slim): boolean => {
  const t = derefS(t0);
  if (t === v) return true;
  if (t.t !== 4 || t.r) return false;
  for (const it of t.i) if (occursS(v, it)) return true;
  return false;
};

/** Ints compare by value across the number/bigint split (canonical atoms keep equal values in one
 *  representation, so the `===` fast path almost always decides). */
const intEq = (a: IntVal, b: IntVal): boolean =>
  a === b || (typeof a !== typeof b && cmpIntVal(a, b) === 0);

/** `unifyCellOccurs` on slim terms: per-bind occurs check, pointer identity for variables, trail pushes
 *  for the caller's LIFO undo. */
function unifyS(trail: Slim[], l0: Slim, r0: Slim): boolean {
  const l = derefS(l0);
  const r = derefS(r0);
  if (l === r) return true;
  if (l.t === 0) {
    if (occursS(l, r)) return false;
    l.b = r;
    trail.push(l);
    return true;
  }
  if (r.t === 0) {
    if (occursS(r, l)) return false;
    r.b = l;
    trail.push(r);
    return true;
  }
  if (l.t !== r.t) return false;
  if (l.t === 1) return l.s === r.s;
  if (l.t === 2) return intEq(l.n, r.n);
  if (l.t === 3) return atomEq(l.g!, r.g!);
  if (l.i.length !== r.i.length) return false;
  if (l.h !== null && r.h !== null && l.h !== r.h) return false;
  for (let k = 0; k < l.i.length; k++) if (!unifyS(trail, l.i[k]!, r.i[k]!)) return false;
  return true;
}

/** Bind an (already dereferenced, unbound) cell with the occurs check — the emitted write-mode bind. */
function bindS(trail: Slim[], v: Slim, t: Slim): boolean {
  if (occursS(v, t)) return false;
  v.b = t;
  trail.push(v);
  return true;
}

/** Dereference to an integer value or bail (emitted guard/arithmetic operand extraction). */
function gci(bail: unknown, a: Slim): IntVal {
  const d = derefS(a);
  if (d.t !== 2) throw bail;
  return d.n;
}

// ---------- boundary conversion ----------

function slimOfAtom(a: Atom, cells: Map<string, Slim>): Slim {
  if (a.kind === "var") {
    let c = cells.get(a.name);
    if (c === undefined) {
      c = mkc();
      cells.set(a.name, c);
    }
    return c;
  }
  if (a.kind === "sym") return symS(a.name);
  if (a.kind === "gnd")
    return (a.value as { g: string }).g === "int" ? intS((a.value as { n: IntVal }).n) : gndS(a);
  return exq(a.items.map((x) => slimOfAtom(x, cells)));
}

/** Materialize a slim term back to an atom under the bindings (the entry's per-answer resolve). An
 *  unbound cell gets a lazy stable name, so it comes out as a plain variable atom. */
function atomOfSlim(s0: Slim, namer: { c: number }): Atom {
  const s = derefS(s0);
  if (s.t === 0) {
    if (s.nm === "") {
      s.nm = "_c#" + String(namer.c);
      namer.c += 1;
    }
    return variable(s.nm);
  }
  if (s.t === 1) return sym(s.s);
  if (s.t === 2) return gint(s.n);
  if (s.t === 3) return s.g!;
  return expr(s.i.map((x) => atomOfSlim(x, namer)));
}

// ---------- the emitter ----------

interface EmitCtx {
  /** Hoisted rigid slim constants, one per distinct ground skeleton atom. */
  readonly consts: Atom[];
  readonly constIdx: Map<Atom, number>;
  /** Fresh temp-variable counter for the clause being emitted. */
  tmp: number;
}

const constRef = (ctx: EmitCtx, a: Atom): string => {
  let i = ctx.constIdx.get(a);
  if (i === undefined) {
    i = ctx.consts.length;
    ctx.consts.push(a);
    ctx.constIdx.set(a, i);
  }
  return "K[" + String(i) + "]";
};

/** A slot site's expression: the first head-read occurrence aliases (assigned there once per dispatch);
 *  every other site creates the clause cell on first execution and dereferences after (body sites re-run
 *  once per earlier goal's answer, so the decision must be dynamic). */
const slotDyn = (i: number): string => `(v${i} === undefined ? (v${i} = mkc()) : deref(v${i}))`;

/** Emit the expression that BUILDS a skeleton (write mode / instantiation). `fold` folds arithmetic
 *  nodes to integers (body arguments, templates, guard operands — matching the interpreter's discipline);
 *  head and pattern subtrees build structurally. */
/** A ground integer skeleton's raw JS literal (`2`, or `2n` past the safe range), if it is one. */
function intLit(sk: Skel): string | undefined {
  if (sk.t !== 0 || sk.a.kind !== "gnd" || (sk.a.value as { g: string }).g !== "int")
    return undefined;
  const n = (sk.a.value as { n: IntVal }).n;
  return typeof n === "bigint" ? `${String(n)}n` : String(n);
}

function emitBuild(ctx: EmitCtx, sk: Skel, fold: boolean): string {
  if (sk.t === 0) return constRef(ctx, sk.a);
  if (sk.t === 1) return slotDyn(sk.i);
  if (fold && sk.arith !== undefined)
    // one integer box for the whole (possibly nested) arithmetic tree
    return `int(${emitIntOperand(ctx, sk)})`;
  const parts = sk.items.map((x) => emitBuild(ctx, x, fold));
  return `exq([${parts.join(", ")}])`;
}

/** Emit the guard/arithmetic operand as a raw IntVal expression (bails on a non-integer): nested
 *  arithmetic stays unboxed, a ground integer becomes a literal, everything else extracts through gci. */
function emitIntOperand(ctx: EmitCtx, sk: Skel): string {
  if (sk.t === 2 && sk.arith !== undefined) {
    const a = emitIntOperand(ctx, sk.items[1]!);
    const b = emitIntOperand(ctx, sk.items[2]!);
    const fn = sk.arith === "+" ? "addI" : sk.arith === "-" ? "subI" : "mulI";
    return `${fn}(${a}, ${b})`;
  }
  const lit = intLit(sk);
  if (lit !== undefined) return lit;
  return `gci(${emitBuild(ctx, sk, true)})`;
}

/** Emit the boolean condition that unifies a skeleton against the term expression `t` (head arguments
 *  and goal patterns). Read mode walks the term; a skeleton subtree materializes and binds only when the
 *  term side dereferences to a cell. `headRead` marks slots whose first occurrence may alias directly
 *  (head arguments run once per dispatch); inside a goal pattern the dynamic form is used throughout. */
function emitUnify(ctx: EmitCtx, sk: Skel, t: string, firstSites: Set<number> | null): string {
  if (sk.t === 1) {
    if (firstSites !== null && !firstSites.has(sk.i)) {
      firstSites.add(sk.i);
      // First head occurrence: alias the (dereferenced) term — no cell, no trail entry, cannot fail.
      return `((v${sk.i} = deref(${t})), true)`;
    }
    return `unify(trail, ${slotDyn(sk.i)}, ${t})`;
  }
  if (sk.t === 0) {
    // A constant symbol or integer compares inline (the overwhelmingly common rigid mismatch/match);
    // binding into a term cell reuses the hoisted constant. Other constants go through generic unify.
    if (sk.a.kind === "sym") {
      const x = `x${ctx.tmp}`;
      ctx.tmp += 1;
      return (
        `((${x} = deref(${t})), ` +
        `${x}.t === 1 ? ${x}.s === ${JSON.stringify(sk.a.name)} : ` +
        `(${x}.t === 0 && bindS(trail, ${x}, ${constRef(ctx, sk.a)})))`
      );
    }
    const lit = intLit(sk);
    if (lit !== undefined) {
      const x = `x${ctx.tmp}`;
      ctx.tmp += 1;
      return (
        `((${x} = deref(${t})), ` +
        `${x}.t === 2 ? (${x}.n === ${lit} || cmpI(${x}.n, ${lit}) === 0) : ` +
        `(${x}.t === 0 && bindS(trail, ${x}, ${constRef(ctx, sk.a)})))`
      );
    }
    return `unify(trail, ${constRef(ctx, sk.a)}, ${t})`;
  }
  // structured node: deref the term once into a temp, then read or write mode
  const x = `x${ctx.tmp}`;
  ctx.tmp += 1;
  const items = sk.items;
  const reads: string[] = [];
  for (let k = 0; k < items.length; k++)
    reads.push(emitUnify(ctx, items[k]!, `${x}.i[${k}]`, firstSites));
  // In write mode every slot below builds through the dynamic form, so pre-mark head-read slots as seen.
  const build = emitBuild(ctx, sk, false);
  return (
    `((${x} = deref(${t})), ` +
    `${x}.t === 0 ? bindS(trail, ${x}, ${build}) : ` +
    `(${x}.t === 4 && ${x}.i.length === ${items.length} && ${reads.join(" && ")}))`
  );
}

const CMP_JS: Record<string, string> = {
  "<": "< 0",
  "<=": "<= 0",
  ">": "> 0",
  ">=": ">= 0",
  "==": "=== 0",
};

function emitBody(ctx: EmitCtx, fnIdOf: Map<string, number>, b: SkelBody, kExpr: string): string {
  if (b.tag === "if") {
    const cmp = CMP_JS[b.op];
    if (cmp === undefined) return "throw BAIL;";
    const x = emitIntOperand(ctx, b.x);
    const y = emitIntOperand(ctx, b.y);
    const then = emitBody(ctx, fnIdOf, b.then, kExpr);
    const els = emitBody(ctx, fnIdOf, b.els, kExpr);
    return `if (cmpI(${x}, ${y}) ${cmp}) {\n${then}\n} else {\n${els}\n}`;
  }
  // seq: goals chain into nested callbacks, ending at the tail
  let inner: string;
  if (b.tail.tag === "empty") inner = "";
  else if (b.tail.tag === "tpl") inner = `${kExpr}(${emitBuild(ctx, b.tail.tpl, true)});`;
  else {
    const args = b.tail.args.map((a) => emitBuild(ctx, a, true)).join(", ");
    inner = `f${fnIdOf.get(b.tail.fn)!}(${args}${args.length > 0 ? ", " : ""}${kExpr});`;
  }
  for (let gi = b.goals.length - 1; gi >= 0; gi--) {
    const g = b.goals[gi]!;
    const args = g.args.map((a) => emitBuild(ctx, a, true)).join(", ");
    const r = `r${gi}`;
    const m = `mg${gi}`;
    const pat = emitUnify(ctx, g.pat, r, null);
    inner =
      `f${fnIdOf.get(g.fn)!}(${args}${args.length > 0 ? ", " : ""}(${r}) => {\n` +
      `const ${m} = trail.length;\n` +
      `if (${pat}) {\n${inner}\n}\n` +
      `while (trail.length > ${m}) trail.pop().b = undefined;\n` +
      `});`;
  }
  return inner;
}

/** Emit one functor's dispatch function: the clauses in order, each with the per-attempt counter
 *  advance, head unification, body, and LIFO undo — the exact skeleton-run discipline, specialized. */
function emitFn(
  ctx: EmitCtx,
  fnIdOf: Map<string, number>,
  fnId: number,
  arity: number,
  clauses: readonly SkelClause[],
): string {
  const params: string[] = [];
  for (let i = 0; i < arity; i++) params.push(`a${i}`);
  const lines: string[] = [];
  lines.push(`function f${fnId}(${params.join(", ")}${arity > 0 ? ", " : ""}k) {`);
  lines.push(`if (++ST.d > ST.cap) throw BAIL;`);
  for (const clause of clauses) {
    lines.push(`ST.c += 1;`);
    if (clause.lhsArgs.length !== arity) continue; // arity mismatch: attempt counted, never matches
    const slots: string[] = [];
    for (let i = 0; i < clause.n; i++) slots.push(`v${i}`);
    // temps are per-clause; reset the counter and declare after emission
    ctx.tmp = 0;
    const firstSites = new Set<number>();
    const headConds: string[] = [];
    for (let i = 0; i < arity; i++)
      headConds.push(emitUnify(ctx, clause.lhsArgs[i]!, `a${i}`, firstSites));
    const body = emitBody(ctx, fnIdOf, clause.body, "k");
    const temps: string[] = [];
    for (let i = 0; i < ctx.tmp; i++) temps.push(`x${i}`);
    lines.push(`{`);
    if (slots.length > 0) lines.push(`let ${slots.join(", ")};`);
    if (temps.length > 0) lines.push(`let ${temps.join(", ")};`);
    lines.push(`const m = trail.length;`);
    lines.push(`if (${headConds.length > 0 ? headConds.join(" && ") : "true"}) {`);
    lines.push(body);
    lines.push(`}`);
    lines.push(`while (trail.length > m) trail.pop().b = undefined;`);
    lines.push(`}`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

// ---------- group compilation and the per-run wrapper ----------

export interface JitGroup {
  /** Call a compiled functor: entry arguments as slim terms, `k` fired per answer (lazy slim term). */
  readonly call: (
    fn: string,
    args: readonly Slim[],
    k: (r: Slim) => void,
    st: { c: number; d: number; cap: number },
  ) => void;
}

export interface JitRuntime {
  readonly mkc: () => Slim;
  readonly slimOfAtom: typeof slimOfAtom;
  readonly atomOfSlim: typeof atomOfSlim;
  readonly derefS: typeof derefS;
}

export const jitRuntime: JitRuntime = { mkc, slimOfAtom, atomOfSlim, derefS };

/** Compile a match-free group's skeleton clauses to specialized JavaScript. Returns `undefined` when
 *  dynamic code generation is unavailable (CSP) or any shape falls outside the emitter; the caller then
 *  keeps the skeleton interpreter. The generated module is created once per group and shared by runs —
 *  per-run state (trail marks live inside the run's own trail array, the counter/cap box) is threaded in. */
export function compileJitGroup(
  skelsByFn: ReadonlyMap<string, readonly SkelClause[]>,
  arityByFn: ReadonlyMap<string, number>,
  bail: unknown,
): JitGroup | undefined {
  const fnIdOf = new Map<string, number>();
  for (const fn of skelsByFn.keys()) fnIdOf.set(fn, fnIdOf.size);
  const ctx: EmitCtx = { consts: [], constIdx: new Map(), tmp: 0 };
  const fnSrcs: string[] = [];
  try {
    for (const [fn, clauses] of skelsByFn) {
      const arity = arityByFn.get(fn);
      if (arity === undefined) return undefined;
      fnSrcs.push(emitFn(ctx, fnIdOf, fnIdOf.get(fn)!, arity, clauses));
    }
  } catch {
    return undefined;
  }
  const dispatch: string[] = [];
  for (const [fn, id] of fnIdOf) dispatch.push(`${JSON.stringify(fn)}: f${id}`);
  // Per-run state (the trail and the counter/cap box) lives in module-level slots set by `$run`, so the
  // module — and every closure V8 has profiled and optimized in it — is instantiated ONCE per group and
  // shared by all runs. Runs never interleave (the generated code calls only within its own group and a
  // bail unwinds the whole run), so the slots cannot be observed stale.
  const src =
    `"use strict";\n` +
    `const { K, BAIL, mkc, deref, unify, bindS, occursS, exq, int, gci, addI, subI, mulI, cmpI } = R;\n` +
    `let trail = null, ST = null;\n` +
    fnSrcs.join("\n") +
    `\nreturn { $run(t, s) { trail = t; ST = s; }, ${dispatch.join(", ")} };`;
  // Hoisted constants convert once (they are ground, so the cell map is never consulted).
  const noCells = new Map<string, Slim>();
  const K = ctx.consts.map((a) => slimOfAtom(a, noCells));
  const R = {
    K,
    BAIL: bail,
    mkc,
    deref: derefS,
    unify: unifyS,
    bindS,
    occursS,
    exq,
    int: intS,
    gci: (a: Slim) => gci(bail, a),
    addI: addInt,
    subI: subInt,
    mulI: mulInt,
    cmpI: cmpIntVal,
  };
  let mod: Record<string, (...xs: unknown[]) => void>;
  try {
    const factory = new Function("R", src) as (
      r: object,
    ) => Record<string, (...xs: unknown[]) => void>;
    mod = factory(R);
  } catch {
    return undefined; // CSP without 'unsafe-eval', or an emitter bug caught by the syntax check
  }
  return {
    call: (fn, args, k, st) => {
      const f = mod[fn];
      if (f === undefined) throw bail;
      mod["$run"]!([], st);
      f(...args, k);
    },
  };
}
