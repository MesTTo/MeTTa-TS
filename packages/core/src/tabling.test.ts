// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import {
  buildEnv,
  initSt,
  mettaEval,
  registerAsyncGroundedOperation,
  registerGroundedOperation,
} from "./eval";
import { isModedTableSafeGroundedOp, isTableSafeGroundedOp, stdTable } from "./builtins";
import { parseAll } from "./parser";
import { standardTokenizer, preludeAtoms, runProgram } from "./runner";
import {
  analyzeCompilerCandidates,
  analyzeModedPurity,
  analyzePurity,
  analyzeTableWorth,
  keyWellFormed,
  MODED_IMPURE_OPS,
} from "./tabling";
import { expr, sym, gint, gfloat } from "./atom";
import { format } from "./parser";
import { TableSpace } from "./table-space";

const atoms = (src: string) =>
  parseAll(src, standardTokenizer())
    .filter((t) => !t.bang)
    .map((t) => t.atom);

describe("purity analysis", () => {
  it("a pure arithmetic recursion is pure; a state-using one is not", () => {
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...atoms(
          "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))\n" +
            "(= (bump) (change-state! &s 1))\n" +
            "(= (viafib $n) (+ 1 (fib $n)))",
        ),
      ],
      stdTable(),
    );
    const pure = analyzePurity(env);
    expect(pure.has("fib")).toBe(true);
    expect(pure.has("viafib")).toBe(true);
    expect(pure.has("bump")).toBe(false);
  });

  it("impurity propagates to callers", () => {
    const env = buildEnv(
      [...preludeAtoms(), ...atoms("(= (a) (b))\n(= (b) (add-atom &self x))")],
      stdTable(),
    );
    const pure = analyzePurity(env);
    expect(pure.has("a")).toBe(false);
    expect(pure.has("b")).toBe(false);
  });

  it("propagates impurity through a reducible bare symbol", () => {
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...atoms("(= unsafe-symbol-u6 (current-time))\n(= (through-symbol-u6) unsafe-symbol-u6)"),
      ],
      stdTable(),
    );

    const pure = analyzePurity(env);
    expect(pure.has("unsafe-symbol-u6")).toBe(false);
    expect(pure.has("through-symbol-u6")).toBe(false);
  });

  it("rejects a rule whose body applies an unknown variable head", () => {
    const env = buildEnv(
      [...preludeAtoms(), ...atoms("(= (invoke-u6 $function $value) ($function $value))")],
      stdTable(),
    );

    expect(analyzePurity(env).has("invoke-u6")).toBe(false);
    expect(analyzeCompilerCandidates(env).has("invoke-u6")).toBe(true);
  });

  it("treats custom sync and async grounded operations as impure by default", () => {
    const gt = stdTable();
    gt.set("host-tick", () => ({ tag: "ok", results: [gint(1)] }));
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...atoms("(= (through-sync) (host-tick))\n(= (through-async) (host-wait))"),
      ],
      gt,
    );
    env.agt.set("host-wait", async () => ({ tag: "ok", results: [gint(1)] }));

    const pure = analyzePurity(env);
    expect(pure.has("through-sync")).toBe(false);
    expect(pure.has("through-async")).toBe(false);
  });

  it("excludes effectful standard grounded operations transitively", () => {
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...atoms(
          "(= (clocked) (current-time))\n" +
            '(= (decoded) (json-decode "{\\"a\\": 1}"))\n' +
            "(= (freshened $x) (sealed () $x))",
        ),
      ],
      stdTable(),
    );

    const pure = analyzePurity(env);
    expect(pure.has("clocked")).toBe(false);
    expect(pure.has("decoded")).toBe(false);
    expect(pure.has("freshened")).toBe(false);
  });

  it("uses separate ground and alpha-invariant built-in safety metadata", () => {
    const table = stdTable();
    const alphaSensitive = [
      "atom_concat",
      "concat",
      "format-args",
      "json-encode",
      "msort",
      "repr",
      "sort",
      "sort-atom",
      "sort-strings",
    ];

    for (const name of alphaSensitive) {
      const fn = table.get(name)!;
      expect(isTableSafeGroundedOp(name, fn), name).toBe(true);
      expect(isModedTableSafeGroundedOp(name, fn), name).toBe(false);
    }
    for (const name of ["current-time", "json-decode", "sealed"]) {
      const fn = table.get(name)!;
      expect(isTableSafeGroundedOp(name, fn), name).toBe(false);
      expect(isModedTableSafeGroundedOp(name, fn), name).toBe(false);
    }

    const replacement = () => ({ tag: "ok" as const, results: [] });
    expect(isTableSafeGroundedOp("repr", replacement)).toBe(false);
    expect(isModedTableSafeGroundedOp("repr", replacement)).toBe(false);

    const env = buildEnv(
      [...preludeAtoms(), ...atoms("(= (rendered-u6 $value) (repr $value))")],
      table,
    );
    expect(analyzePurity(env, new Set(MODED_IMPURE_OPS)).has("rendered-u6")).toBe(true);
    expect(analyzeModedPurity(env).has("rendered-u6")).toBe(false);
  });

  it("invalidates cached analysis when a host operation is registered", () => {
    const env = buildEnv([...preludeAtoms()], stdTable());
    env.tableSpace = new TableSpace();
    env.tablingDirty = false;
    env.pureFunctors = new Set(["host-wait"]);
    env.compiled = new Map();
    env.compileDirty = false;
    const key = env.tableSpace.key("ground", expr([sym("cached")]), 0);
    env.tableSpace.rememberCompleted(key, 0, [gint(1)]);

    registerAsyncGroundedOperation(env, "host-wait", async () => ({
      tag: "ok",
      results: [gint(1)],
    }));

    expect(env.tablingDirty).toBe(true);
    expect(env.tableSpace.stats()).toEqual({ entries: 0, answers: 0, approxCells: 0 });
    expect(env.compiled).toBeUndefined();
    expect(env.compileDirty).toBeUndefined();
  });

  it("re-evaluates a ground call after its host operation is registered", () => {
    const env = buildEnv([...preludeAtoms()], stdTable());
    const call = expr([sym("late-host-op")]);
    const [before, state] = mettaEval(env, 10_000, initSt(), [], call);
    expect(before.map((pair) => format(pair[0]))).toEqual(["(late-host-op)"]);

    registerGroundedOperation(env, "late-host-op", () => ({ tag: "ok", results: [gint(7)] }));
    const [after] = mettaEval(env, 10_000, state, [], call);
    expect(after.map((pair) => format(pair[0]))).toEqual(["7"]);
  });

  it("table-worth analysis admits branching recursion and rejects linear recursion", () => {
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...atoms(
          "(= (fib $n) (if (< $n 2) $n (+ (fib (- $n 1)) (fib (- $n 2)))))\n" +
            "(= (fact $n $acc) (if (< $n 2) $acc (fact (- $n 1) (* $acc $n))))",
        ),
      ],
      stdTable(),
    );
    const pure = analyzePurity(env);
    const worth = analyzeTableWorth(env, pure);
    expect(worth.has("fib")).toBe(true);
    expect(worth.has("fact")).toBe(false);
  });

  it("structural table keys are stable and keyWellFormed rejects floats", () => {
    const tables = new TableSpace();
    const call = expr([sym("fib"), gint(30)]);
    expect(tables.key("ground", call, 0).tokens).toEqual(tables.key("ground", call, 0).tokens);
    expect(tables.key("ground", call, 0).tokens).not.toEqual(tables.key("ground", call, 1).tokens);
    expect(keyWellFormed(call)).toBe(true);
    expect(keyWellFormed(expr([sym("g"), gfloat(1.5)]))).toBe(false);
  });
});

describe("tabling end to end", () => {
  it("does not replay producer allocation history for ground table hits", () => {
    const fib = "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))";
    const env = buildEnv([...preludeAtoms(), ...atoms(fib)], stdTable());
    env.tableSpace = new TableSpace();
    env.pureFunctors = analyzePurity(env);
    env.tableWorth = analyzeTableWorth(env, env.pureFunctors);
    env.modedPureFunctors = analyzeModedPurity(env);
    env.modedTableWorth = analyzeTableWorth(env, env.modedPureFunctors);
    env.tablingDirty = false;
    const call = atoms("(fib 8)")[0]!;

    const [coldResults, coldState] = mettaEval(env, 100_000, initSt(), [], call);
    const [warmResults, warmState] = mettaEval(env, 100_000, coldState, [], call);

    expect(warmResults.map((pair) => format(pair[0]))).toEqual(
      coldResults.map((pair) => format(pair[0])),
    );
    expect(coldState.counter).toBeGreaterThan(0);
    expect(warmState.counter).toBe(coldState.counter);
  });

  it("does not replay producer allocation history for irreducible ground memo hits", () => {
    const env = buildEnv([...preludeAtoms(), ...atoms("(= (maybe A) yes)")], stdTable());
    const call = atoms("(maybe B)")[0]!;

    const [coldResults, coldState] = mettaEval(env, 10_000, initSt(), [], call);
    const [warmResults, warmState] = mettaEval(env, 10_000, coldState, [], call);

    expect(coldResults.map((pair) => format(pair[0]))).toEqual(["(maybe B)"]);
    expect(warmResults.map((pair) => format(pair[0]))).toEqual(["(maybe B)"]);
    expect(coldState.counter).toBeGreaterThan(0);
    expect(warmState.counter).toBe(coldState.counter);
  });

  it("tabled fib agrees with untabled (fib 20) and computes fib(30) fast", () => {
    const fib = "(= (fib $n) (unify $n 0 0 (unify $n 1 1 (+ (fib (- $n 1)) (fib (- $n 2))))))";
    const small = `${fib}\n!(fib 20)`;
    const untabled = runProgram(small, 100_000, new Map(), { tabling: false });
    const tabled = runProgram(small, 100_000, new Map(), { tabling: true });
    expect(tabled.map((r) => r.results.map(format))).toEqual(
      untabled.map((r) => r.results.map(format)),
    );
    // fib(30) is infeasible untabled (~35s); tabled it is instant and exact.
    const big = runProgram(`${fib}\n!(fib 30)`, 100_000, new Map(), { tabling: true });
    expect(big[0]!.results.map(format)).toEqual(["832040"]);
  });

  it("tabling preserves multiplicity of a pure function over many calls", () => {
    const src = "(= (tri $n) (if (< $n 1) 0 (+ $n (tri (- $n 1)))))\n!(+ (tri 5) (tri 5))";
    const tabled = runProgram(src, 100_000, new Map(), { tabling: true });
    expect(tabled[0]!.results.map(format)).toEqual(["30"]);
  });

  it("linear recursion is not tabled automatically but still evaluates correctly", () => {
    const src = "(= (fact $n $acc) (if (< $n 2) $acc (fact (- $n 1) (* $acc $n))))\n!(fact 8 1)";
    const tabled = runProgram(src, 100_000, new Map(), { tabling: true });
    const untabled = runProgram(src, 100_000, new Map(), { tabling: false });
    expect(tabled[0]!.results.map(format)).toEqual(untabled[0]!.results.map(format));
    expect(tabled[0]!.results.map(format)).toEqual(["40320"]);
  });
});

describe("tabling invalidation", () => {
  it("does not cache an effect reached through a runtime bare-symbol rule", () => {
    let clockCalls = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => 1000 + clockCalls++);
    try {
      const src = `
        !(add-atom &self (= unsafe-symbol-u6 (current-time)))
        !(add-atom &self (= (f-u6 Z) unsafe-symbol-u6))
        !(add-atom &self (= (f-u6 (S $n)) ((f-u6 $n) (f-u6 $n))))
        !(add-atom &self (= (h-u6) (f-u6 Z)))
        !(add-atom &self (= (h-u6) (f-u6 Z)))
        !(h-u6)
      `;
      const result = runProgram(src, 100_000, new Map(), { tabling: true }).at(-1)!;

      expect(result.results.map(format)).toEqual(["1.0", "1.001"]);
      expect(clockCalls).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    {
      name: "a locally bound callable variable",
      base: "(let $function (choose-u6) ($function))",
    },
    {
      name: "a reducible expression head",
      base: "((choose-u6))",
    },
  ])("does not cache an effect reached through $name", ({ base }) => {
    let clockCalls = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => 1000 + clockCalls++);
    try {
      const src = `
        !(add-atom &self (= (choose-u6) current-time))
        !(add-atom &self (= (dynamic-u6 Z) ${base}))
        !(add-atom &self (= (dynamic-u6 (S $n)) ((dynamic-u6 $n) (dynamic-u6 $n))))
        !(add-atom &self (= (dynamic-root-u6) (dynamic-u6 Z)))
        !(add-atom &self (= (dynamic-root-u6) (dynamic-u6 Z)))
        !(dynamic-root-u6)
      `;
      const result = runProgram(src, 100_000, new Map(), { tabling: true }).at(-1)!;

      expect(result.results.map(format)).toEqual(["1.0", "1.001"]);
      expect(clockCalls).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it("runtime helper rule changes invalidate cached callers through the world rule version", () => {
    const src =
      "(= (fib $n) (if (< $n 2) (base) (+ (fib (- $n 1)) (fib (- $n 2)))))\n" +
      "!(add-atom &self (= (base) 1))\n" +
      "!(fib 3)\n" +
      "!(remove-atom &self (= (base) 1))\n" +
      "!(add-atom &self (= (base) 2))\n" +
      "!(fib 3)";
    const tabled = runProgram(src, 100_000, new Map(), { tabling: true });
    const untabled = runProgram(src, 100_000, new Map(), { tabling: false });
    const lastT = tabled[tabled.length - 1]!.results.map(format);
    const lastU = untabled[untabled.length - 1]!.results.map(format);
    expect(lastT).toEqual(lastU);
    expect(lastT).toEqual(["6"]);
  });

  it("static rule removals do not reuse cached answers from the full static graph", () => {
    const src =
      "(= (base) 1)\n" +
      "(= (fib $n) (if (< $n 2) (base) (+ (fib (- $n 1)) (fib (- $n 2)))))\n" +
      "!(fib 3)\n" +
      "!(remove-atom &self (= (base) 1))\n" +
      "!(fib 3)";
    const tabled = runProgram(src, 100_000, new Map(), { tabling: true });
    const untabled = runProgram(src, 100_000, new Map(), { tabling: false });
    expect(tabled.map((r) => r.results.map(format))).toEqual(
      untabled.map((r) => r.results.map(format)),
    );
  });
});

// A function defined at RUNTIME via add-atom (PeTTa's fibadd) lands in the per-world selfRules, not the
// static rule index, so it bypassed analyzePurity and ran un-memoised (exponential). It is now tabled with
// a rule-set-versioned key, which stays byte-identical to no-tabling even when the space mutates or the
// function is redefined.
describe("runtime-rule tabling (fibadd)", () => {
  const bothMatch = (src: string) => {
    const off = runProgram(src, 200_000_000, new Map(), { tabling: false });
    const on = runProgram(src, 200_000_000, new Map(), { tabling: true });
    expect(on.map((r) => r.results.map(format))).toEqual(off.map((r) => r.results.map(format)));
    return on;
  };

  it("a runtime-defined fib is memoised and correct", () => {
    const on = bothMatch(
      "!(add-atom &self (= (fib $N) (if (< $N 2) $N (+ (fib (- $N 1)) (fib (- $N 2))))))\n!(fib 22)",
    );
    expect(on[on.length - 1]!.results.map(format)).toEqual(["17711"]);
  });

  it("an IMPURE runtime function (match over the space) is NOT tabled, so state changes show", () => {
    // (cnt) reads the space, so tabling it would serve a stale count after a new (foo ...) is added.
    bothMatch(
      "!(add-atom &self (= (cnt) (foldall + (match &self (foo $x) 1) 0)))\n" +
        "!(add-atom &self (foo a))\n!(cnt)\n!(add-atom &self (foo b))\n!(cnt)",
    );
  });

  it("redefining a runtime function does not serve a stale memo (version bumps)", () => {
    bothMatch(
      "!(add-atom &self (= (k $n) (* $n 10)))\n!(k 5)\n" +
        "!(add-atom &self (= (k $n) (* $n 100)))\n!(collapse (k 5))",
    );
  });
});
