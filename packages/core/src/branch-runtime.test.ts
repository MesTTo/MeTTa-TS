// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { expr, gnd, sym, type Atom } from "./atom";
import { setOutputSink } from "./builtins";
import { format, parseAll } from "./parser";
import { preludeAtoms, runProgramAsync, standardTokenizer } from "./runner";
import { stdlibAtoms } from "./stdlib";
import { stdTable } from "./builtins";
import {
  branchRuntimeSnapshot,
  buildEnv,
  createMettaSearchCursor,
  initSt,
  mettaEval,
  mettaEvalAsync,
  registerAsyncGroundedOperation,
  registerGroundedOperation,
  WorldConflictError,
} from "./eval";
import { ResourceLimitError } from "./resources";
import { drainSyncCursor } from "./search-cursor";

const atom = (source: string) => parseAll(`!${source}`, standardTokenizer())[0]!.atom;
const env = () => buildEnv([...preludeAtoms(), ...stdlibAtoms()], stdTable());

describe("branch worlds and effect journals", () => {
  it("rolls a transaction back by retaining the parent journal prefix", () => {
    const runtime = env();
    const start = initSt();
    const [, terminal] = mettaEval(
      runtime,
      100_000,
      start,
      [],
      atom("(transaction (let $_ (add-atom &self (discarded)) (superpose ())))"),
    );

    expect(branchRuntimeSnapshot(terminal).effects).toEqual([]);
    expect(terminal.world).toBe(start.world);
  });

  it("commits one shared transaction prefix once", () => {
    const runtime = env();
    const [, terminal] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(transaction (let $_ (add-atom &self (kept)) (superpose (A B))))"),
    );

    expect(branchRuntimeSnapshot(terminal).effects.map((effect) => effect.operation)).toEqual([
      "add-atom",
    ]);
  });

  it("threads effectful Hyperpose branches in source order", () => {
    const definitions = parseAll(
      `
        (= (increment-u7)
           (match &temp (counter-u7 $value)
             ((remove-atom &temp (counter-u7 $value))
              (let $next (+ $value 1)
                (add-atom &temp (counter-u7 $next))))))
        (= (serialized-increment-u7)
           (with_mutex counter-lock-u7 (increment-u7)))
        (= (effect-cycle-a-u7 $depth)
           (if (== $depth 0)
             (serialized-increment-u7)
             (effect-cycle-b-u7 (- $depth 1))))
        (= (effect-cycle-b-u7 $depth) (effect-cycle-a-u7 $depth))
      `,
      standardTokenizer(),
    );
    const runtime = buildEnv(
      [...preludeAtoms(), ...stdlibAtoms(), ...definitions.map((top) => top.atom)],
      stdTable(),
    );
    const [, seeded] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(add-atom &temp (counter-u7 0))"),
    );
    const [increments, terminal] = mettaEval(
      runtime,
      100_000,
      seeded,
      [],
      atom("(hyperpose ((effect-cycle-b-u7 0) (effect-cycle-b-u7 0) (effect-cycle-b-u7 0)))"),
    );
    const [values] = mettaEval(
      runtime,
      100_000,
      terminal,
      [],
      atom("(match &temp (counter-u7 $value) $value)"),
    );

    expect(increments.map(([answer]) => format(answer))).toEqual(["(() ())", "(() ())", "(() ())"]);
    expect(values.map(([answer]) => format(answer))).toEqual(["3"]);
  });

  it("rolls back nondeterministic answer paths with different world deltas", () => {
    const definitions = parseAll(
      `
        (= (transaction-branch-u7 A) (let $_ (add-atom &self (left-u7)) A))
        (= (transaction-branch-u7 B) (let $_ (add-atom &self (right-u7)) B))
      `,
      standardTokenizer(),
    );
    const runtime = buildEnv(
      [...preludeAtoms(), ...stdlibAtoms(), ...definitions.map((top) => top.atom)],
      stdTable(),
    );
    const [answers, terminal] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(transaction (transaction-branch-u7 $value))"),
    );

    expect(answers.map(([answer]) => format(answer))).toEqual([
      '(Error (transaction (transaction-branch-u7 $value)) "transaction: answer effects conflict")',
    ]);
    expect(branchRuntimeSnapshot(terminal).effects).toEqual([]);
  });

  it("commits identical effects from isolated rule alternatives once", () => {
    const definitions = parseAll(
      `
        (= (same-effect-u7 A) (let $_ (add-atom &self (shared-u7)) A))
        (= (same-effect-u7 B) (let $_ (add-atom &self (shared-u7)) B))
      `,
      standardTokenizer(),
    );
    const runtime = buildEnv(
      [...preludeAtoms(), ...stdlibAtoms(), ...definitions.map((top) => top.atom)],
      stdTable(),
    );
    const [answers, terminal] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(transaction (same-effect-u7 $value))"),
    );

    expect(answers.map(([answer]) => format(answer))).toEqual(["A", "B"]);
    expect(branchRuntimeSnapshot(terminal).effects.map((effect) => effect.operation)).toEqual([
      "add-atom",
    ]);
    const [matches] = mettaEval(
      runtime,
      100_000,
      terminal,
      [],
      atom("(match &self (shared-u7) found)"),
    );
    expect(matches.map(([answer]) => format(answer))).toEqual(["found"]);
  });

  it("rolls back distinct effects produced by nested alternatives", () => {
    const definitions = parseAll(
      `
        (= (nested-effects-u7)
           (let $choice (superpose (A B))
             (let $_ (add-atom &self (nested-u7 $choice)) $choice)))
      `,
      standardTokenizer(),
    );
    const runtime = buildEnv(
      [...preludeAtoms(), ...stdlibAtoms(), ...definitions.map((top) => top.atom)],
      stdTable(),
    );
    const [answers, terminal] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(transaction (nested-effects-u7))"),
    );

    expect(answers.map(([answer]) => format(answer))).toEqual([
      '(Error (transaction (nested-effects-u7)) "transaction: answer effects conflict")',
    ]);
    expect(branchRuntimeSnapshot(terminal).effects).toEqual([]);
    const [matches] = mettaEval(
      runtime,
      100_000,
      terminal,
      [],
      atom("(match &self (nested-u7 $value) $value)"),
    );
    expect(matches).toEqual([]);
  });

  it("attaches sequential answer effects to their exact state boundaries", () => {
    // Definitions stay static. Each answer performs its own branch-local write.
    const definitions = parseAll(
      `
        (= (effect-answer-u7 A) (let $_ (add-atom &self (seen-u7 A)) A))
        (= (effect-answer-u7 B) (let $_ (add-atom &self (seen-u7 B)) B))
      `,
      standardTokenizer(),
    );
    const defined = buildEnv(
      [...preludeAtoms(), ...stdlibAtoms(), ...definitions.map((top) => top.atom)],
      stdTable(),
    );
    const result = drainSyncCursor(
      createMettaSearchCursor(defined, atom("(effect-answer-u7 $value)")),
      { maxSteps: 1 },
    );

    expect(result.kind).toBe("exhausted");
    if (result.kind !== "exhausted") return;
    expect(result.values.map((answer) => format(answer.atom))).toEqual(["A", "B"]);
    expect(
      result.values.map((answer) => branchRuntimeSnapshot(answer.state).effects.length),
    ).toEqual([1, 2]);
  });

  it("rejects conflicting isolated state writes before committing either branch", async () => {
    const runtime = env();
    const [, withState] = mettaEval(runtime, 100_000, initSt(), [], atom("(new-state initial)"));

    await expect(
      mettaEvalAsync(
        runtime,
        100_000,
        withState,
        [],
        atom("(par (change-state! (State 0) left) (change-state! (State 0) right))"),
      ),
    ).rejects.toBeInstanceOf(WorldConflictError);

    expect(format(withState.world.store.get(0)!)).toBe("initial");
  });

  it("debits one aggregate branch ledger before a fanout starts", async () => {
    const runtime = env();
    const start = initSt({ resources: { limits: { branches: 2 } } });

    await expect(
      mettaEvalAsync(runtime, 100_000, start, [], atom("(par A B C)")),
    ).rejects.toMatchObject({
      kind: "resource-limit",
      fault: { resource: "branches", limit: 2, consumed: 0, requested: 3 },
    });
    expect(branchRuntimeSnapshot(start).resources.used.branches).toBe(0);
  });

  it("shares branch consumption and keeps resource exhaustion outside the answer bag", async () => {
    const runtime = env();
    const start = initSt({ resources: { limits: { branches: 3 }, track: true } });
    const [, terminal] = await mettaEvalAsync(runtime, 100_000, start, [], atom("(par A B C)"));

    expect(branchRuntimeSnapshot(terminal).resources.used.branches).toBe(3);
    expect(() =>
      mettaEval(runtime, 100_000, initSt({ resources: { limits: { steps: 0 } } }), [], atom("A")),
    ).toThrow(ResourceLimitError);
  });

  it("rejects undeclared host I/O before invoking it in a transaction", () => {
    const runtime = env();
    let calls = 0;
    registerGroundedOperation(runtime, "host-effect-u7", () => {
      calls += 1;
      return { tag: "ok", results: [sym("leaked")] };
    });

    const [answers, terminal] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(transaction (host-effect-u7))"),
    );

    expect(calls).toBe(0);
    expect(answers.map(([answer]) => format(answer))).toEqual([
      '(Error (host-effect-u7) "host-effect-u7: irreversible effect is not allowed in an isolated branch")',
    ]);
    expect(branchRuntimeSnapshot(terminal).effects).toEqual([]);
  });

  it("keeps grounded effect declarations local to their environment", () => {
    const speculative = env();
    const rejecting = env();
    let calls = 0;
    const sharedOperation = () => {
      calls += 1;
      return { tag: "ok" as const, results: [sym("accepted")] };
    };
    registerGroundedOperation(speculative, "shared-effect-u7", sharedOperation, {
      classes: ["pure"],
      speculative: true,
    });
    registerGroundedOperation(rejecting, "shared-effect-u7", sharedOperation, {
      classes: ["host-io"],
      speculative: false,
    });

    const [accepted] = mettaEval(
      speculative,
      100_000,
      initSt(),
      [],
      atom("(transaction (shared-effect-u7))"),
    );
    const [rejected] = mettaEval(
      rejecting,
      100_000,
      initSt(),
      [],
      atom("(transaction (shared-effect-u7))"),
    );

    expect(accepted.map(([answer]) => format(answer))).toEqual(["accepted"]);
    expect(format(rejected[0]![0])).toContain("irreversible effect");
    expect(calls).toBe(1);
  });

  it("invalidates transitive Hyperpose effect analysis when a policy changes", async () => {
    const definitions = parseAll(
      `
        (= (policy-wrapper-u7 $delay)
           (with_mutex policy-lock-u7 (policy-operation-u7 $delay)))
      `,
      standardTokenizer(),
    );
    const runtime = buildEnv(
      [...preludeAtoms(), ...stdlibAtoms(), ...definitions.map((top) => top.atom)],
      stdTable(),
    );
    const operation = async (args: readonly Atom[]) => {
      const value = args[0]!;
      const delay = value.kind === "gnd" && value.value.g === "int" ? Number(value.value.n) : 0;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      return { tag: "ok" as const, results: [value] };
    };
    registerAsyncGroundedOperation(runtime, "policy-operation-u7", operation, {
      classes: ["suspension"],
      speculative: true,
    });

    const [completionOrdered] = await mettaEvalAsync(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(hyperpose ((policy-wrapper-u7 20) (policy-wrapper-u7 1)))"),
    );
    expect(completionOrdered.map(([answer]) => format(answer))).toEqual(["1", "20"]);

    registerAsyncGroundedOperation(runtime, "policy-operation-u7", operation, {
      classes: ["atomspace-read", "suspension"],
      speculative: true,
    });
    const [sourceOrdered] = await mettaEvalAsync(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(hyperpose ((policy-wrapper-u7 20) (policy-wrapper-u7 1)))"),
    );

    expect(sourceOrdered.map(([answer]) => format(answer))).toEqual(["20", "1"]);
  });

  it("rejects contradictory or empty grounded effect declarations", () => {
    const runtime = env();
    const operation = () => ({ tag: "ok" as const, results: [sym("value")] });

    expect(() =>
      registerGroundedOperation(runtime, "empty-policy-u7", operation, {
        classes: [],
        speculative: true,
      }),
    ).toThrow("at least one effect class");
    expect(() =>
      registerGroundedOperation(runtime, "mixed-pure-u7", operation, {
        classes: ["pure", "host-io"],
        speculative: false,
      }),
    ).toThrow("pure grounded operation");
    expect(runtime.gt.has("empty-policy-u7")).toBe(false);
    expect(runtime.gt.has("mixed-pure-u7")).toBe(false);
  });

  it("records a zero-answer pre-effect sequentially and rolls it back transactionally", () => {
    const runtime = env();
    registerGroundedOperation(runtime, "zero-read-u7", () => ({ tag: "ok", results: [] }), {
      classes: ["atomspace-read"],
      speculative: true,
    });

    const [sequentialAnswers, sequential] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(zero-read-u7)"),
    );
    const [transactionAnswers, transaction] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(transaction (zero-read-u7))"),
    );

    expect(sequentialAnswers).toEqual([]);
    expect(branchRuntimeSnapshot(sequential).effects).toMatchObject([
      { class: "atomspace-read", operation: "zero-read-u7", phase: "pre" },
    ]);
    expect(transactionAnswers).toEqual([]);
    expect(branchRuntimeSnapshot(transaction).effects).toEqual([]);
  });

  it("classifies standard time and randomness before observation", () => {
    const runtime = env();
    const [time] = mettaEval(runtime, 100_000, initSt(), [], atom("(transaction (current-time))"));
    const [random] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(transaction (random-int 0 1))"),
    );

    expect(format(time[0]![0])).toContain("current-time: irreversible effect");
    expect(format(random[0]![0])).toContain("random-int: irreversible effect");
  });

  it("propagates parent cancellation into evaluator transitions", () => {
    const controller = new AbortController();
    const start = initSt({ signal: controller.signal });
    controller.abort(new Error("parent stopped"));

    expect(() => mettaEval(env(), 100_000, start, [], atom("A"))).toThrow("parent stopped");
    expect(branchRuntimeSnapshot(start).cancellation).toMatchObject({
      cancellation: { reason: { code: "Error", message: "parent stopped" } },
    });
  });

  it("rejects direct async host effects in par before either call starts", async () => {
    const runtime = env();
    let calls = 0;
    registerAsyncGroundedOperation(
      runtime,
      "async-host-effect-u7",
      async () => {
        calls += 1;
        return { tag: "ok", results: [sym("leaked")] };
      },
      { classes: ["suspension", "host-io"], speculative: false },
    );

    const [answers] = await mettaEvalAsync(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(par (async-host-effect-u7) (async-host-effect-u7))"),
    );

    expect(calls).toBe(0);
    expect(answers).toHaveLength(2);
    expect(answers.every(([answer]) => format(answer).includes("irreversible effect"))).toBe(true);
  });

  it("rejects executable grounded heads before crossing an isolated boundary", () => {
    const runtime = env();
    let calls = 0;
    const head = gnd(
      { g: "ext", kind: "branch-runtime-test", id: "exec-u7" },
      sym("Grounded"),
      () => {
        calls += 1;
        return [sym("leaked")];
      },
    );
    const [answers] = mettaEval(
      runtime,
      100_000,
      initSt(),
      [],
      expr([sym("transaction"), expr([head])]),
    );

    expect(calls).toBe(0);
    expect(format(answers[0]![0])).toContain("<grounded-exec>: irreversible effect");
  });

  it("rejects host imports before an isolated par branch invokes the resolver", async () => {
    let calls = 0;
    const results = await runProgramAsync(
      '!(par (import! &self "native-u7") ready)',
      new Map(),
      100_000,
      new Map(),
      {
        hostImport: async () => {
          calls += 1;
          return { tag: "ok", results: [sym("leaked")] };
        },
      },
    );

    expect(calls).toBe(0);
    expect(results[0]!.results.map(format)).toEqual([
      '(Error (import! &self "native-u7") import!: host imports are not allowed in an isolated branch)',
      "ready",
    ]);
  });

  it("does not let speculative output reach the host sink", () => {
    const runtime = env();
    const lines: string[] = [];
    const restore = setOutputSink((line) => lines.push(line));
    try {
      const [answers] = mettaEval(
        runtime,
        100_000,
        initSt(),
        [],
        atom("(once (hyperpose ((println! leaked))))"),
      );
      expect(format(answers[0]![0])).toContain("irreversible effect");
      expect(lines).toEqual([]);
    } finally {
      setOutputSink(restore);
    }
  });

  it("keeps a host effect isolated when the same Hyperpose branch also writes state", () => {
    const runtime = env();
    const lines: string[] = [];
    const restore = setOutputSink((line) => lines.push(line));
    try {
      const [answers] = mettaEval(
        runtime,
        100_000,
        initSt(),
        [],
        atom("(once (hyperpose ((let $_ (add-atom &self (before-output-u7)) (println! leaked)))))"),
      );
      expect(format(answers[0]![0])).toContain("irreversible effect");
      expect(lines).toEqual([]);
    } finally {
      setOutputSink(restore);
    }
  });

  it("restores the parent policy after selecting a race winner", async () => {
    const runtime = env();
    registerAsyncGroundedOperation(runtime, "fast-u7", async () => ({
      tag: "ok",
      results: [sym("winner")],
    }));
    registerAsyncGroundedOperation(runtime, "slow-u7", async (_args, context) => {
      const signal = context?.signal;
      if (signal === undefined) throw new Error("missing cancellation signal");
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      signal.throwIfAborted();
      return { tag: "ok", results: [sym("loser")] };
    });

    const [answers, terminal] = await mettaEvalAsync(
      runtime,
      100_000,
      initSt(),
      [],
      atom("(race (fast-u7) (slow-u7))"),
    );

    expect(answers.map(([answer]) => format(answer))).toEqual(["winner"]);
    expect(branchRuntimeSnapshot(terminal)).toMatchObject({
      policy: "sequential-commit",
      irreversibleEffects: "allow",
      cancellation: { closed: false },
      effects: [{ class: "suspension", operation: "fast-u7", phase: "pre" }],
    });
  });
});
