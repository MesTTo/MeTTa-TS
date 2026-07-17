// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect, afterEach } from "vitest";
import { runProgramAsync, runProgram, runProgramWithState } from "./runner";
import type { ParallelBranchHostResult } from "./runner";
import { format } from "./parser";
import { expr, gint, sym } from "./atom";
import { setOutputSink } from "./builtins";
import { type AsyncGroundFn } from "./eval";
import { WorkerProtocolError, WorkerQuiescenceError } from "./worker-protocol";

// async ops: `aw n` resolves to n after an n-ms delay (so timing is controllable).
const aw: AsyncGroundFn = async (args, context) => {
  const a = args[0]!;
  const n = a.kind === "gnd" && a.value.g === "int" ? Number(a.value.n) : 0;
  const signal = context?.signal;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(finish, n);
    function finish(): void {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(signal?.reason ?? new Error("grounded operation cancelled"));
    }
    signal?.addEventListener("abort", cancel, { once: true });
  });
  return { tag: "ok", results: [gint(n)] };
};
const ops = (): Map<string, AsyncGroundFn> => new Map([["aw", aw]]);
const last = async (src: string): Promise<string[]> => {
  const rs = await runProgramAsync(src, ops());
  return rs[rs.length - 1]!.results.map(format);
};

const workerFallbackProgram = `
  (= (two) 2)
  (= (four) 4)
  !(once (hyperpose ((two) (four))))
`;

function malformedWorkerResults(): ParallelBranchHostResult[] {
  const throwingGetter = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(throwingGetter, "results", {
    get(): never {
      throw new Error("host getter failed");
    },
  });
  Object.defineProperty(throwingGetter, "counterDelta", { value: 0 });
  return [
    undefined,
    7,
    {},
    { counterDelta: 0 },
    { results: [1], counterDelta: 0 },
    { results: ["("], counterDelta: 0 },
    { results: [""], counterDelta: 0 },
    { results: [";comment"], counterDelta: 0 },
    { results: ["A B"], counterDelta: 0 },
    { results: ["!(two)"], counterDelta: 0 },
    { results: ["$x"], counterDelta: 0 },
    throwingGetter,
  ] as unknown as ParallelBranchHostResult[];
}

let restore: ((l: string) => void) | undefined;
afterEach(() => {
  if (restore) setOutputSink(restore);
  restore = undefined;
});

describe("par", () => {
  it("evaluates branches concurrently and unions their results", async () => {
    expect(await last("!(collapse (par (aw 3) (aw 4) (aw 2)))")).toEqual(["(, 3 4 2)"]);
  });

  it("runs concurrently (total time ~ slowest branch, not the sum)", async () => {
    const t = Date.now();
    await last("!(par (aw 40) (aw 40) (aw 40))");
    expect(Date.now() - t).toBeLessThan(100); // ~40ms concurrent, not ~120ms sequential
  });

  it("merges each branch's add-atom effects deterministically", async () => {
    expect(
      await last(`
        !(par (add-atom &self (k 1)) (add-atom &self (k 2)) (add-atom &self (k 3)))
        !(collapse (match &self (k $v) $v))
      `),
    ).toEqual(["(, 1 2 3)"]);
  });

  it("resumes reducible grounded results without replaying the host calls", async () => {
    let calls = 0;
    const produce: AsyncGroundFn = async () => {
      calls += 1;
      return { tag: "ok", results: [expr([sym("after-direct-par-u6")])] };
    };
    const results = await runProgramAsync(
      `
        (= (after-direct-par-u6) done)
        !(par (produce-direct-par-u6) (produce-direct-par-u6))
      `,
      new Map([["produce-direct-par-u6", produce]]),
    );

    expect(results[0]!.results.map(format)).toEqual(["done", "done"]);
    expect(calls).toBe(2);
  });

  it("resumes no-reduce branches without calling the grounded operation twice", async () => {
    let calls = 0;
    const defer: AsyncGroundFn = async () => {
      calls += 1;
      return { tag: "noReduce" };
    };
    const results = await runProgramAsync(
      `
        (= (defer-direct-par-u6) fallback)
        !(par (defer-direct-par-u6))
      `,
      new Map([["defer-direct-par-u6", defer]]),
    );

    expect(results[0]!.results.map(format)).toEqual(["fallback"]);
    expect(calls).toBe(1);
  });

  it("applies each settled grounded effect once before merging branch worlds", async () => {
    let calls = 0;
    const effect: AsyncGroundFn = async (args) => {
      calls += 1;
      return {
        tag: "ok",
        results: [expr([])],
        effects: [
          {
            kind: "addAtom",
            space: sym("&self"),
            atom: expr([sym("direct-par-effect-u6"), args[0]!]),
          },
        ],
      };
    };
    const results = await runProgramAsync(
      `
        !(par (effect-direct-par-u6 A) (effect-direct-par-u6 B))
        !(collapse (match &self (direct-par-effect-u6 $value) $value))
      `,
      new Map([["effect-direct-par-u6", effect]]),
    );

    expect(results.map((result) => result.results.map(format))).toEqual([
      ["()", "()"],
      ["(, A B)"],
    ]);
    expect(calls).toBe(2);
  });

  it("retains simultaneous direct grounded faults in source order", async () => {
    const first = new Error("first direct par fault");
    const second = new Error("second direct par fault");
    const failWith =
      (failure: Error): AsyncGroundFn =>
      async () => {
        throw failure;
      };

    const rejected = runProgramAsync(
      "!(par (first-direct-par-fault-u6) (second-direct-par-fault-u6))",
      new Map([
        ["first-direct-par-fault-u6", failWith(first)],
        ["second-direct-par-fault-u6", failWith(second)],
      ]),
    );

    let failure: unknown;
    try {
      await rejected;
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([first, second]);
    expect((failure as AggregateError).cause).toBe(first);
  });

  it("cancels and joins siblings before propagating a host fault", async () => {
    const failure = new Error("branch failed");
    let siblingClosed = false;
    const slow: AsyncGroundFn = async (_args, context) => {
      const signal = context?.signal;
      if (signal === undefined) throw new Error("missing par cancellation signal");
      await new Promise<void>((_resolve, reject) => {
        const close = (): void => {
          queueMicrotask(() => {
            siblingClosed = true;
            reject(signal.reason);
          });
        };
        signal.addEventListener("abort", close, { once: true });
      });
      return { tag: "ok", results: [sym("late")] };
    };
    const fail: AsyncGroundFn = async () => {
      throw failure;
    };

    await expect(
      runProgramAsync(
        "!(par (slow) (fail))",
        new Map<string, AsyncGroundFn>([
          ["slow", slow],
          ["fail", fail],
        ]),
      ),
    ).rejects.toBe(failure);
    expect(siblingClosed).toBe(true);
  });

  it("joins every branch before exposing an external runner cancellation", async () => {
    let entered = 0;
    let markEntered!: () => void;
    const allEntered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const cleaned = new Set<number>();
    const hold: AsyncGroundFn = async (args, context) => {
      const idAtom = args[0]!;
      const id = idAtom.kind === "gnd" && idAtom.value.g === "int" ? Number(idAtom.value.n) : -1;
      const signal = context?.signal;
      if (signal === undefined) throw new Error("missing par cancellation signal");
      entered += 1;
      if (entered === 2) markEntered();
      try {
        await new Promise<void>((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      } finally {
        await Promise.resolve();
        cleaned.add(id);
      }
      return { tag: "ok", results: [idAtom] };
    };
    const controller = new AbortController();
    const reason = new Error("cancel both par branches");
    const pending = runProgramAsync(
      "!(par (hold 1) (hold 2))",
      new Map([["hold", hold]]),
      undefined,
      new Map(),
      { signal: controller.signal },
    );

    await allEntered;
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect([...cleaned].sort()).toEqual([1, 2]);
  });
});

describe("race / once", () => {
  it("returns the first branch to produce a result", async () => {
    expect(await last("!(race (aw 40) (aw 3))")).toEqual(["3"]);
  });

  it("all-empty branches give an empty result", async () => {
    expect(await last("!(race (superpose ()) (superpose ()))")).toEqual([]);
  });

  it("cancels the losing branch (its effect does not land)", async () => {
    // the slow branch would add (k slow) but is aborted when the fast branch wins
    const out = await last(`
      !(race (let $x (aw 40) (add-atom &self (k slow))) (aw 2))
      !(collapse (match &self (k $v) $v))
    `);
    expect(out).toEqual(["(,)"]); // empty tuple: (k slow) was never added; the loser was cancelled before its add-atom
  });

  it("once cuts nondeterminism to the first result (and works synchronously)", async () => {
    expect(await last("!(once (superpose (1 2 3)))")).toEqual(["1"]);
    // sync runner: once with a pure argument needs no async
    expect(runProgram("!(once (superpose (7 8 9)))")[0]!.results.map(format)).toEqual(["7"]);
  });

  it("observes a Hyperpose answer before the same branch's long tail", () => {
    const results = runProgram(`
      (= (burn 0 $value) $value)
      (= (burn $n $value) (burn (- $n 1) $value))
      (= (branch-a) A0)
      (= (branch-a) (burn 20000 A1))
      (= (branch-b) (burn 2000 B))
      !(once (hyperpose ((branch-a) (branch-b))))
    `);
    expect(results[0]!.results.map(format)).toEqual(["A0"]);
  });

  it("gives a finite Hyperpose branch turns beside a divergent branch", () => {
    const results = runProgram(
      `
        (= (loop $x) (loop (S $x)))
        !(once (hyperpose ((loop Z) ready)))
      `,
      10000,
    );
    expect(results[0]!.results.map(format)).toEqual(["ready"]);
  });

  it("closes an ordinary nondeterministic tail before its later effect", () => {
    const results = runProgram(`
      (= (branch) first)
      (= (branch) (add-atom &self (late effect)))
      !(once (branch))
      !(collapse (match &self (late $value) $value))
    `);
    expect(results.map((result) => result.results.map(format))).toEqual([["first"], ["(,)"]]);
  });

  it("cuts a nondeterministic argument before its later effect", () => {
    const results = runProgram(`
      (= (strict-u6 $value) $value)
      (= (branch-u6) first)
      (= (branch-u6) (add-atom &self (late nested-effect)))
      !(once (strict-u6 (branch-u6)))
      !(collapse (match &self (late $value) $value))
    `);
    expect(results.map((result) => result.results.map(format))).toEqual([["first"], ["(,)"]]);
  });

  it("publishes a completed application before a divergent argument tail", () => {
    const results = runProgram(
      `
        (= (strict-u6 $value) $value)
        (= (nested-branch-u6) first)
        (= (nested-branch-u6) (nested-loop-u6 Z))
        (= (nested-loop-u6 $value) (nested-loop-u6 (S $value)))
        !(once (strict-u6 (nested-branch-u6)))
      `,
      10_000,
    );
    expect(results[0]!.results.map(format)).toEqual(["first"]);
  });

  it("joins a pruned Hyperpose argument before returning the completed application", async () => {
    let slowEntered = false;
    let slowCancelled = false;
    const nestedOps = new Map<string, AsyncGroundFn>([
      [
        "nested-fast-u6",
        async () => {
          await Promise.resolve();
          return { tag: "ok", results: [sym("A")] };
        },
      ],
      [
        "nested-slow-u6",
        async (_args, context) => {
          const signal = context?.signal;
          if (signal === undefined) throw new Error("missing nested Hyperpose signal");
          slowEntered = true;
          return await new Promise<never>((_resolve, reject) => {
            const cancel = (): void => {
              slowCancelled = true;
              reject(signal.reason);
            };
            if (signal.aborted) cancel();
            else signal.addEventListener("abort", cancel, { once: true });
          });
        },
      ],
    ]);

    const results = await runProgramAsync(
      `
        (= (strict-u6 $value) $value)
        !(once (strict-u6 (hyperpose ((nested-fast-u6) (nested-slow-u6)))))
      `,
      nestedOps,
    );

    expect(results[0]!.results.map(format)).toEqual(["A"]);
    expect(slowEntered).toBe(true);
    expect(slowCancelled).toBe(true);
  });

  it("publishes Hyperpose answers in async completion order with duplicates", async () => {
    expect(await last("!(collapse (hyperpose ((aw 20) (aw 1) (aw 1))))")).toEqual(["(, 1 1 20)"]);
  });

  it("preserves each Hyperpose branch answer without a cross-product", () => {
    const results = runProgram(`
      (= (left) A)
      (= (left) A)
      (= (right) B)
      (= (right) B)
      !(collapse (hyperpose ((left) (right))))
      !(collapse (superpose ((left) (right))))
    `);
    expect(results.map((result) => result.results.map(format))).toEqual([
      ["(, A B A B)"],
      ["(, A B A B A B A B)"],
    ]);
  });

  it("honors parEvalImpl in the async driver", async () => {
    const branchCalls: string[][] = [];
    const rs = await runProgramAsync(
      `
        (: two (-> Number))
        (= (two) 2)
        (: four (-> Number))
        (= (four) 4)
        !(once (hyperpose ((two) (four))))
      `,
      new Map(),
      undefined,
      new Map(),
      {
        tabling: true,
        parEvalImpl: (_rulesSrc, branchSrcs, firstOnly) => {
          branchCalls.push(branchSrcs);
          expect(firstOnly).toBe(true);
          return [
            { results: ["99"], counterDelta: 0 },
            { results: [], counterDelta: 0 },
          ];
        },
      },
    );
    expect(branchCalls).toEqual([["(two)", "(four)"]]);
    expect(rs[0]!.results.map(format)).toEqual(["99"]);
  });

  it("admits the transitive scalar prime graph to a first-answer worker", async () => {
    const branchCalls: string[][] = [];
    const rs = await runProgramAsync(
      `
        (= (find-divisor-u6 $n $d)
           (if (> (* $d $d) $n)
               $n
               (if (== 0 (% $n $d)) $d (find-divisor-u6 $n (+ $d 1)))))
        (= (prime-u6? $n) (== $n (find-divisor-u6 $n 2)))
        !(once (hyperpose ((prime-u6? 7) (prime-u6? 11))))
      `,
      new Map(),
      undefined,
      new Map(),
      {
        tabling: true,
        parEvalImpl: (_rulesSrc, branchSrcs, firstOnly) => {
          branchCalls.push(branchSrcs);
          expect(firstOnly).toBe(true);
          return [
            { results: ["True"], counterDelta: 0 },
            { results: [], counterDelta: 0 },
          ];
        },
      },
    );
    expect(branchCalls).toEqual([["(prime-u6? 7)", "(prime-u6? 11)"]]);
    expect(rs[0]!.results.map(format)).toEqual(["True"]);
  });

  it("preserves results and fresh counters when a warm table is replayed cold in a worker", () => {
    const source = `
      (= (fib-u6 $n)
         (if (< $n 2) $n (+ (fib-u6 (- $n 1)) (fib-u6 (- $n 2)))))
      !(fib-u6 8)
      !(once (hyperpose ((fib-u6 8) (fib-u6 9))))
      !(new-state after)
    `;
    let calls = 0;
    const workerEnabled = runProgram(source, 100_000, new Map(), {
      tabling: true,
      parEvalImpl: (rulesSrc, branchSrcs, _firstOnly, remainingFuel, initialCounter) => {
        calls += 1;
        const startCounter = initialCounter ?? 0;
        return branchSrcs.map((branchSrc) => {
          const execution = runProgramWithState(
            `${rulesSrc}\n!(once ${branchSrc})`,
            remainingFuel,
            new Map(),
            { tabling: true },
            startCounter,
          );
          return {
            results: execution.results.at(-1)?.results.map(format) ?? [],
            counterDelta: execution.state.counter - startCounter,
          };
        });
      },
    });
    const local = runProgram(source, 100_000, new Map(), { tabling: true });

    expect(calls).toBe(1);
    expect(workerEnabled.map((result) => result.results.map(format))).toEqual(
      local.map((result) => result.results.map(format)),
    );
  });

  it("sends each worker only rules visible before its current query", () => {
    const admittedPrograms: string[] = [];
    const rs = runProgram(
      `
        (= (before-u6) before)
        !(once (hyperpose ((before-u6))))
        (= (after-u6) after)
        !(once (hyperpose ((after-u6))))
      `,
      undefined,
      new Map(),
      {
        tabling: false,
        parEvalImpl: (rulesSrc, branchSrcs) => {
          admittedPrograms.push(rulesSrc);
          return branchSrcs.map((branch) => ({
            results: [branch === "(before-u6)" ? "before" : "after"],
            counterDelta: 0,
          }));
        },
      },
    );

    expect(rs.map((result) => result.results.map(format))).toEqual([["before"], ["after"]]);
    expect(admittedPrograms).toHaveLength(2);
    expect(admittedPrograms[0]).toContain("(= (before-u6) before)");
    expect(admittedPrograms[0]).not.toContain("after-u6");
    expect(admittedPrograms[1]).toContain("(= (after-u6) after)");
  });

  it.each([
    {
      setup: "(= (invoke-u6 $f $x) ($f $x))",
      branch: "(invoke-u6 new-state X)",
    },
    {
      setup: "(= (invoke-u6 $f $x) ($f $x)) (= (outer-u6 $f $x) (invoke-u6 $f $x))",
      branch: "(outer-u6 new-state X)",
    },
    {
      setup: "(= (id-u6 $x) $x)",
      branch: "(id-u6 (new-state X))",
    },
    {
      setup: "(= (run-code-u6 $source) (eval (parse $source)))",
      branch: '(run-code-u6 "(new-state X)")',
    },
  ])("rejects worker replay for transitive or dynamic state code", async ({ setup, branch }) => {
    let calls = 0;
    const rs = await runProgramAsync(
      `${setup}
       !(let $state (once (hyperpose (${branch} ready))) (get-state $state))`,
      new Map(),
      undefined,
      new Map(),
      {
        tabling: true,
        parEvalImpl: () => {
          calls += 1;
          return [
            { results: ["fake"], counterDelta: 0 },
            { results: [], counterDelta: 0 },
          ];
        },
      },
    );
    expect(calls).toBe(0);
    expect(rs[0]!.results.map(format)).toEqual(["X"]);
  });

  it.each([
    {
      name: "a higher-order output effect",
      setup: "(= (invoke-u6 $f $x) ($f $x))",
      branch: "(with-mutex output-u7 (invoke-u6 println! leaked))",
    },
    {
      name: "a bare symbol that reduces to an output effect",
      setup: "(= unsafe-symbol-u6 (with-mutex output-u7 (println! leaked)))",
      branch: "unsafe-symbol-u6",
    },
  ])("rejects worker replay for $name", async ({ setup, branch }) => {
    const lines: string[] = [];
    restore = setOutputSink((line) => lines.push(line));
    let calls = 0;
    const rs = await runProgramAsync(
      `${setup}
       !(once (hyperpose (${branch})))`,
      new Map(),
      undefined,
      new Map(),
      {
        parEvalImpl: () => {
          calls += 1;
          return [
            { results: ["fake"], counterDelta: 0 },
            { results: [], counterDelta: 0 },
          ];
        },
      },
    );

    expect(calls).toBe(0);
    expect(rs[0]!.results.map(format)).toEqual(["()"]);
    expect(lines).toEqual(["leaked"]);
  });

  it.each([
    { expression: "(atom_concat T rue)", expected: "True" },
    { expression: '(atom_concat "$" x)', expected: "$x" },
    { expression: '(atom_concat A " " B)', expected: "A B" },
  ])("falls back before a constructed symbol can change kind in transport", async (testCase) => {
    let calls = 0;
    const rs = await runProgramAsync(
      `
        (= (id-u6 $x) $x)
        !(let $x ${testCase.expression}
           (once (hyperpose ((id-u6 $x) (id-u6 fallback)))))
      `,
      new Map(),
      undefined,
      new Map(),
      {
        tabling: true,
        parEvalImpl: () => {
          calls += 1;
          return [
            { results: ["fake"], counterDelta: 0 },
            { results: [], counterDelta: 0 },
          ];
        },
      },
    );
    const result = rs[0]!.results[0];
    expect(calls).toBe(0);
    expect(result?.kind).toBe("sym");
    if (result?.kind === "sym") expect(result.name).toBe(testCase.expected);
  });

  it("replays malformed synchronous results only after a typed completion certificate", () => {
    for (const malformed of malformedWorkerResults()) {
      const rs = runProgram(workerFallbackProgram, undefined, new Map(), {
        parEvalImpl: () => ({
          status: "completed",
          branches: [malformed, { results: [], counterDelta: 0 }],
        }),
      });
      expect(rs[0]!.results.map(format)).toEqual(["2"]);
    }
  });

  it("rejects a legacy worker bag without counter state", async () => {
    let calls = 0;
    await expect(
      runProgramAsync(workerFallbackProgram, new Map(), undefined, new Map(), {
        parEvalAsyncImpl: async () => {
          calls += 1;
          return [["77"], []];
        },
      }),
    ).rejects.toBeInstanceOf(WorkerProtocolError);

    expect(calls).toBe(1);
  });

  it("falls back synchronously only when the host explicitly declines ownership", () => {
    const rs = runProgram(workerFallbackProgram, undefined, new Map(), {
      parEvalImpl: () => ({ status: "declined" }),
    });
    expect(rs[0]!.results.map(format)).toEqual(["2"]);
  });

  it("does not replay after an invalid or throwing synchronous host response", () => {
    const throwingBag = new Proxy([], {
      get(): never {
        throw new Error("host bag failed");
      },
    });
    const hosts = [
      () => undefined as never,
      () => 7 as never,
      () => throwingBag as never,
      () => {
        throw new Error("worker host failed");
      },
    ];
    for (const parEvalImpl of hosts) {
      expect(() =>
        runProgram(workerFallbackProgram, undefined, new Map(), { parEvalImpl }),
      ).toThrow();
    }
  });

  it("does not replay locally after a synchronous worker loses quiescence", () => {
    const error = new WorkerQuiescenceError("worker may still be running");
    expect(() =>
      runProgram(workerFallbackProgram, undefined, new Map(), {
        parEvalImpl: () => {
          throw error;
        },
      }),
    ).toThrow(error);
  });

  it("replays malformed asynchronous results only after a typed completion certificate", async () => {
    for (const malformed of malformedWorkerResults()) {
      const rs = await runProgramAsync(workerFallbackProgram, new Map(), undefined, new Map(), {
        parEvalAsyncImpl: async () => ({
          status: "completed",
          branches: [malformed, { results: [], counterDelta: 0 }],
        }),
      });
      expect(rs[0]!.results.map(format)).toEqual(["2"]);
    }
  });

  it("falls back asynchronously only when the host explicitly declines ownership", async () => {
    const rs = await runProgramAsync(workerFallbackProgram, new Map(), undefined, new Map(), {
      parEvalAsyncImpl: async () => ({ status: "declined" }),
    });
    expect(rs[0]!.results.map(format)).toEqual(["2"]);
  });

  it("does not replay after an invalid or rejected asynchronous host response", async () => {
    const hosts = [
      async () => undefined as never,
      async () => 7 as never,
      async (): Promise<never> => Promise.reject(new Error("worker host rejected")),
    ];
    for (const parEvalAsyncImpl of hosts) {
      await expect(
        runProgramAsync(workerFallbackProgram, new Map(), undefined, new Map(), {
          parEvalAsyncImpl,
        }),
      ).rejects.toBeDefined();
    }
  });

  it("surfaces a joined host failure without replaying its branches", async () => {
    const error = new Error("joined worker batch failed");
    await expect(
      runProgramAsync(workerFallbackProgram, new Map(), undefined, new Map(), {
        parEvalAsyncImpl: async () => ({ status: "failed", error }),
      }),
    ).rejects.toBe(error);
  });

  it("does not replay locally after an asynchronous worker loses quiescence", async () => {
    const error = new WorkerQuiescenceError("worker may still be running");
    await expect(
      runProgramAsync(workerFallbackProgram, new Map(), undefined, new Map(), {
        parEvalAsyncImpl: async () => Promise.reject(error),
      }),
    ).rejects.toBe(error);
  });

  it("does not mask worker quiescence failure with sibling cancellation", async () => {
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const error = new WorkerQuiescenceError("worker may still be running");
    const controller = new AbortController();
    const reason = new Error("external cancellation");
    const evaluation = runProgramAsync(workerFallbackProgram, new Map(), undefined, new Map(), {
      signal: controller.signal,
      parEvalAsyncImpl: async (_rules, _branches, _firstOnly, signal) => {
        markEntered();
        await new Promise<void>((_done, reject) => {
          if (signal?.aborted === true) {
            reject(error);
            return;
          }
          signal?.addEventListener("abort", () => reject(error), { once: true });
        });
        return [];
      },
    });

    await entered;
    controller.abort(reason);
    const failure = await evaluation.catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).cause).toBe(reason);
    expect((failure as WorkerQuiescenceError).quiescenceFailure).toBe(error);
  });

  it("treats an untyped host rejection during cancellation as unknown quiescence", async () => {
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const rejection = new Error("custom host stopped reporting");
    const controller = new AbortController();
    const reason = new Error("cancel custom host");
    const evaluation = runProgramAsync(workerFallbackProgram, new Map(), undefined, new Map(), {
      signal: controller.signal,
      parEvalAsyncImpl: async (_rules, _branches, _firstOnly, signal) => {
        markEntered();
        await new Promise<void>((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(rejection), { once: true }),
        );
        return { status: "declined" };
      },
    });

    await entered;
    controller.abort(reason);
    const failure = await evaluation.catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).cause).toBe(reason);
    const unknown = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(unknown).toBeInstanceOf(WorkerQuiescenceError);
    expect((unknown as WorkerQuiescenceError).cause).toBe(rejection);
  });

  it("keeps full Hyperpose on the fair event scheduler", () => {
    const source = `
      (= (full-u6 A) A1)
      (= (full-u6 A) A2)
      (= (full-u6 B) B1)
      (= (full-u6 B) B2)
      !(collapse (hyperpose ((full-u6 A) (full-u6 B))))
    `;
    const local = runProgram(source, 1_000_000);
    const workerConfigured = runProgram(source, 1_000_000, new Map(), {
      parEvalImpl: () => {
        throw new Error("full Hyperpose must not enter the first-answer worker path");
      },
    });

    expect(workerConfigured[0]!.results.map(format)).toEqual(local[0]!.results.map(format));
    expect(local[0]!.results.map(format)).toEqual(["(, A1 B1 A2 B2)"]);
  });
});

describe("with-mutex", () => {
  it("serializes external effects across concurrent branches", async () => {
    const lines: string[] = [];
    restore = setOutputSink((l) => lines.push(l));
    await last(
      "!(par" +
        " (with-mutex L (let $x (aw 20) (let $y (println! A1) (println! A2))))" +
        " (with-mutex L (let $x (aw 2) (let $y (println! B1) (println! B2)))))",
    );
    // A's whole section completes before B's, despite B's shorter await (not interleaved).
    expect(lines).toEqual(["A1", "A2", "B1", "B2"]);
  });

  it("accepts PeTTa's with_mutex spelling as a single-threaded wrapper", async () => {
    expect(await last("!(with_mutex L (aw 1))")).toEqual(["1"]);
    expect(runProgram("!(with_mutex L (+ 1 1))")[0]!.results.map(format)).toEqual(["2"]);
  });
});

describe("sync driver rejects concurrency primitives", () => {
  it("par/race/with-mutex throw AsyncInSyncError under runProgram", () => {
    expect(() => runProgram("!(par (+ 1 1) (+ 2 2))")).toThrow(/async|sync/i);
    expect(() => runProgram("!(race (+ 1 1))")).toThrow(/async|sync/i);
    expect(() => runProgram("!(with-mutex L (+ 1 1))")).toThrow(/async|sync/i);
  });
});
