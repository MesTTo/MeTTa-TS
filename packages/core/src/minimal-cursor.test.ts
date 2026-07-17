// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileEnv } from "./compile";
import { analyzePurity } from "./tabling";
import {
  AsyncInSyncError,
  addAtomToEnv,
  atomEq,
  buildEnv,
  createMinimalAsyncSearchCursor,
  createMinimalSearchCursor,
  createMettaAsyncSearchCursor,
  createMettaSearchCursor,
  drainAsyncCursor,
  drainSyncCursor,
  expr,
  format,
  gnd,
  interpretMinimal,
  interpretMinimalAsync,
  initSt,
  mettaEval,
  mettaEvalAsync,
  parseAll,
  preludeAtoms,
  registerAsyncGroundedOperation,
  standardTokenizer,
  stdTable,
  sym,
  type AsyncSearchCursor,
  type Atom,
  type BindingRel,
  type MinimalSearchAnswer,
  type ReduceResult,
  type St,
  type SyncSearchCursor,
  WorkerQuiescenceError,
} from "./index";

function parseAtom(source: string): Atom {
  return parseAll(source, standardTokenizer())[0]!.atom;
}

function makeEnv(rules = "") {
  return buildEnv(
    rules === "" ? [] : parseAll(rules, standardTokenizer()).map((item) => item.atom),
    stdTable(),
  );
}

function makeCompiledPreludeEnv(rules: string) {
  const env = buildEnv(
    [...preludeAtoms(), ...parseAll(rules, standardTokenizer()).map((item) => item.atom)],
    stdTable(),
  );
  env.pureFunctors = analyzePurity(env);
  const compiled = compileEnv(env);
  env.compiled = compiled;
  return { env, compiled };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function countRetainedFailure(root: unknown, target: unknown, seen = new Set<unknown>()): number {
  if (seen.has(root)) return 0;
  seen.add(root);
  let count = Object.is(root, target) ? 1 : 0;
  if (root instanceof AggregateError)
    for (const error of root.errors) count += countRetainedFailure(error, target, seen);
  if (root instanceof WorkerQuiescenceError) {
    count += countRetainedFailure(root.cause, target, seen);
    count += countRetainedFailure(root.quiescenceFailure, target, seen);
  }
  return count;
}

function registerCancellationCleanup(
  env: ReturnType<typeof makeEnv>,
  name: string,
  entered: ReturnType<typeof deferred>,
  cleanup: (signal: AbortSignal) => Promise<ReduceResult>,
): void {
  registerAsyncGroundedOperation(env, name, async (_args, context) => {
    const signal = context?.signal;
    if (signal === undefined) throw new Error("missing cleanup cancellation signal");
    entered.resolve();
    await waitForAbort(signal);
    return cleanup(signal);
  });
}

interface CursorQuotaObservation {
  readonly answers: readonly {
    readonly atom: string;
    readonly bindings: readonly BindingRel[];
    readonly cumulativeSteps: number;
    readonly counter: number;
    readonly generation: number;
  }[];
  readonly terminalSteps: number;
  readonly terminalCounter: number;
  readonly terminalGeneration: number;
}

function observeSyncQuota(
  cursor: SyncSearchCursor<MinimalSearchAnswer, St>,
  maxSteps: number,
): CursorQuotaObservation {
  const answers: CursorQuotaObservation["answers"][number][] = [];
  let cumulativeSteps = 0;
  for (let reads = 0; reads < 100_000; reads++) {
    const event = cursor.next({ maxSteps });
    expect(event.steps).toBeLessThanOrEqual(maxSteps);
    cumulativeSteps += event.steps;
    switch (event.kind) {
      case "answer":
        answers.push({
          atom: format(event.value.atom),
          bindings: event.value.bindings,
          cumulativeSteps,
          counter: event.value.state.counter,
          generation: event.value.state.world.generation,
        });
        break;
      case "pending":
        break;
      case "exhausted":
        return {
          answers,
          terminalSteps: cumulativeSteps,
          terminalCounter: event.terminal.counter,
          terminalGeneration: event.terminal.world.generation,
        };
      case "cancelled":
        throw new Error(`quota observation was cancelled: ${event.reason.code}`);
      case "fault":
        throw event.error;
    }
  }
  throw new Error("quota observation did not terminate");
}

function drainSyncAtUnitQuota(cursor: SyncSearchCursor<MinimalSearchAnswer, St>): {
  readonly answers: readonly string[];
  readonly terminal: St;
} {
  const answers: string[] = [];
  for (let eventIndex = 0; eventIndex < 1_000; eventIndex++) {
    const event = cursor.next({ maxSteps: 1 });
    switch (event.kind) {
      case "answer":
        answers.push(format(event.value.atom));
        break;
      case "pending":
        break;
      case "exhausted":
        return { answers, terminal: event.terminal };
      case "cancelled":
        throw new Error(`unit-quota cursor was cancelled: ${event.reason.code}`);
      case "fault":
        throw event.error;
    }
  }
  throw new Error("unit-quota cursor did not terminate");
}

describe("Minimal MeTTa search cursor", () => {
  it("pauses at quotas and resumes the exact ordered answer stream", () => {
    const rules = `
      (= color red)
      (= color green)
      (= red warm)
      (= green cool)
    `;
    const env = makeEnv(rules);
    const atom = parseAtom("(chain (eval color) $x (eval $x))");
    const cursor = createMinimalSearchCursor(env, atom);
    const events = [];
    for (;;) {
      const event = cursor.next({ maxSteps: 1 });
      events.push(event);
      if (event.kind === "exhausted") break;
      expect(event.kind === "fault" || event.kind === "cancelled").toBe(false);
    }
    expect(events.some((event) => event.kind === "pending")).toBe(true);
    expect(
      events.flatMap((event) => (event.kind === "answer" ? [format(event.value.atom)] : [])),
    ).toEqual(["warm", "cool"]);

    const [eager, eagerState] = interpretMinimal(env, atom);
    const terminal = events[events.length - 1]!;
    expect(eager.map(([answer]) => format(answer))).toEqual(["warm", "cool"]);
    expect(terminal.kind).toBe("exhausted");
    if (terminal.kind === "exhausted") expect(terminal.terminal).toEqual(eagerState);
  });

  it("keeps answer boundaries and exact transition totals independent of cursor quota", () => {
    const rules = `
      (= color red)
      (= color green)
      (= red warm)
      (= green cool)
    `;
    const atom = parseAtom("(chain (eval color) $x (eval $x))");
    const observations = [1, 2, 7, 256].map((maxSteps) =>
      observeSyncQuota(createMinimalSearchCursor(makeEnv(rules), atom), maxSteps),
    );

    for (const observation of observations.slice(1)) expect(observation).toEqual(observations[0]);
  });

  it("delivers one answer and retains the unvisited tail until close", () => {
    const cursor = createMinimalSearchCursor(
      makeEnv("(= color red) (= color green)"),
      parseAtom("(eval color)"),
    );
    let first;
    do first = cursor.next({ maxSteps: 1 });
    while (first.kind === "pending");
    expect(first.kind).toBe("answer");
    if (first.kind === "answer") expect(format(first.value.atom)).toBe("red");

    cursor.close({ code: "test-prune" });
    cursor.close();
    expect(cursor.next()).toEqual({
      kind: "cancelled",
      reason: { code: "test-prune" },
      steps: 0,
    });
  });

  it("preempts a nested metta reduction instead of draining it eagerly", () => {
    const env = makeEnv(`
      (= (walk Z) done)
      (= (walk (S $n)) (walk $n))
    `);
    const input = `(metta (walk ${"(S ".repeat(32)}Z${")".repeat(32)}) %Undefined% &self)`;
    const cursor = createMinimalSearchCursor(env, parseAtom(input));

    const first = cursor.next({ maxSteps: 1 });
    expect(first).toEqual({ kind: "pending", steps: 1 });

    const drained = drainSyncCursor(cursor, { maxSteps: 1 });
    expect(drained.kind).toBe("exhausted");
    if (drained.kind === "exhausted") {
      expect(drained.values.map((answer) => format(answer.atom))).toEqual(["done"]);
    }
  });

  it("reports an async boundary as a typed cursor fault in the sync API", () => {
    const env = makeEnv();
    registerAsyncGroundedOperation(env, "later", async () => ({
      tag: "ok",
      results: [sym("done")],
    }));
    const cursor = createMinimalSearchCursor(env, parseAtom("(eval (later))"));
    const drained = drainSyncCursor(cursor);
    expect(drained.kind).toBe("fault");
    if (drained.kind === "fault") expect(drained.error).toBeInstanceOf(AsyncInSyncError);
    expect(cursor.closed).toBe(true);
    const repeated = cursor.next();
    expect(repeated.kind).toBe("fault");
    if (repeated.kind === "fault") {
      expect(repeated.error).toBeInstanceOf(AsyncInSyncError);
      expect(repeated.steps).toBe(0);
    }
  });

  it("joins an active asynchronous grounding before close resolves", async () => {
    const env = makeEnv();
    const entered = deferred();
    const gate = deferred();
    registerAsyncGroundedOperation(env, "wait", async () => {
      entered.resolve();
      await gate.promise;
      return { tag: "ok", results: [sym("late")] };
    });
    const cursor = createMinimalAsyncSearchCursor(env, parseAtom("(eval (wait))"));
    const pending = cursor.next({ maxSteps: 8 });
    await entered.promise;

    const closing = cursor.close({ code: "test-close" });
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    gate.resolve();
    await closing;
    expect(await pending).toEqual({
      kind: "cancelled",
      reason: { code: "test-close" },
      steps: 0,
    });
    expect(cursor.closed).toBe(true);
  });

  it.each(["next", "drain"] as const)(
    "joins a pre-aborted active %s before public close resolves",
    async (method) => {
      const cursor = createMettaAsyncSearchCursor(makeEnv(), parseAtom("ready"));
      const controller = new AbortController();
      const reason = { code: `pre-aborted-${method}` };
      controller.abort(reason);
      let readSettled = false;
      const reading = (
        method === "next"
          ? cursor.next({ signal: controller.signal })
          : cursor.drain!({ signal: controller.signal })
      ).finally(() => {
        readSettled = true;
      });

      await cursor.close({ code: "public-close" });
      expect(readSettled).toBe(true);
      await expect(reading).resolves.toMatchObject({ kind: "cancelled", reason });
    },
  );

  it("keeps sync and async exhaustion sticky after a later abort", async () => {
    const env = makeEnv();
    const atom = parseAtom("done");
    const sync = createMinimalSearchCursor(env, atom);
    const asyncCursor = createMinimalAsyncSearchCursor(env, atom);
    expect(drainSyncCursor(sync).kind).toBe("exhausted");
    expect((await drainAsyncCursor(asyncCursor)).kind).toBe("exhausted");

    const controller = new AbortController();
    controller.abort(new Error("too late"));
    expect(sync.next({ signal: controller.signal })).toMatchObject({
      kind: "exhausted",
      steps: 0,
    });
    await expect(asyncCursor.next({ signal: controller.signal })).resolves.toMatchObject({
      kind: "exhausted",
      steps: 0,
    });
  });

  it("copies and freezes direct close reasons", async () => {
    const env = makeEnv();
    const atom = parseAtom("answer");
    const syncReason = { code: "sync-close", message: "before" };
    const asyncReason = { code: "async-close", message: "before" };
    const sync = createMinimalSearchCursor(env, atom);
    const asyncCursor = createMinimalAsyncSearchCursor(env, atom);

    sync.close(syncReason);
    await asyncCursor.close(asyncReason);
    syncReason.code = "mutated";
    syncReason.message = "after";
    asyncReason.code = "mutated";
    asyncReason.message = "after";

    const syncEvent = sync.next();
    const asyncEvent = await asyncCursor.next();
    expect(syncEvent).toMatchObject({
      kind: "cancelled",
      reason: { code: "sync-close", message: "before" },
    });
    expect(asyncEvent).toMatchObject({
      kind: "cancelled",
      reason: { code: "async-close", message: "before" },
    });
    if (syncEvent.kind === "cancelled") expect(Object.isFrozen(syncEvent.reason)).toBe(true);
    if (asyncEvent.kind === "cancelled") expect(Object.isFrozen(asyncEvent.reason)).toBe(true);
  });

  it("propagates cancellation to host imports", async () => {
    const env = makeEnv();
    const entered = deferred();
    let seenSignal: AbortSignal | undefined;
    env.hostImport = async (_space, _file, context) => {
      seenSignal = context?.signal;
      entered.resolve();
      if (seenSignal === undefined) throw new Error("missing import cancellation signal");
      if (!seenSignal.aborted)
        await new Promise<void>((resolve) =>
          seenSignal!.addEventListener("abort", () => resolve(), { once: true }),
        );
      seenSignal.throwIfAborted();
      return { tag: "ok", results: [sym("unreachable")] };
    };
    const cursor = createMettaAsyncSearchCursor(env, parseAtom('(import! &self "module")'));
    const reading = cursor.next({ maxSteps: 8 });
    await entered.promise;

    await cursor.close({ code: "cancel-import" });
    expect(seenSignal?.aborted).toBe(true);
    await expect(reading).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "cancel-import" },
    });
  });

  it("propagates cancellation to executable grounded heads", async () => {
    const env = makeEnv();
    const entered = deferred();
    let seenSignal: AbortSignal | undefined;
    const head = gnd(
      { g: "ext", kind: "minimal-cursor-test", id: "cancel-exec" },
      sym("Grounded"),
      async (_args, context) => {
        seenSignal = context?.signal;
        entered.resolve();
        if (seenSignal === undefined) throw new Error("missing executable cancellation signal");
        if (!seenSignal.aborted)
          await new Promise<void>((resolve) =>
            seenSignal!.addEventListener("abort", () => resolve(), { once: true }),
          );
        seenSignal.throwIfAborted();
        return [sym("unreachable")];
      },
    );
    const cursor = createMettaAsyncSearchCursor(env, expr([head]));
    const reading = cursor.next({ maxSteps: 8 });
    await entered.promise;

    await cursor.close({ code: "cancel-exec" });
    expect(seenSignal?.aborted).toBe(true);
    await expect(reading).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "cancel-exec" },
    });
  });

  it("preserves worker quiescence when executable rejection races cancellation", async () => {
    const env = makeEnv();
    const entered = deferred();
    const quiescence = new WorkerQuiescenceError("executable worker may still be running");
    const head = gnd(
      { g: "ext", kind: "minimal-cursor-test", id: "cancel-exec-quiescence" },
      sym("Grounded"),
      async (_args, context) => {
        const signal = context?.signal;
        if (signal === undefined) throw new Error("missing executable cancellation signal");
        entered.resolve();
        await waitForAbort(signal);
        throw quiescence;
      },
    );
    const cursor = createMettaAsyncSearchCursor(env, expr([head]));
    const reading = cursor.next({ maxSteps: 8 });
    await entered.promise;

    const closing = cursor.close({ code: "cancel-exec-quiescence" });
    const event = await reading;

    expect(event.kind).toBe("fault");
    if (event.kind !== "fault") throw new Error("expected worker-quiescence fault");
    expect(event.error).toBeInstanceOf(WorkerQuiescenceError);
    expect((event.error as WorkerQuiescenceError).cause).toEqual({
      code: "cancel-exec-quiescence",
    });
    await expect(closing).rejects.toBeInstanceOf(WorkerQuiescenceError);
  });

  it("preserves sync executable quiescence through cursor and eager adapters", () => {
    const env = makeEnv();
    const quiescence = new WorkerQuiescenceError("executable worker may still be running");
    const head = gnd(
      { g: "ext", kind: "minimal-cursor-test", id: "sync-exec-quiescence" },
      sym("Grounded"),
      () => {
        throw quiescence;
      },
    );
    const call = expr([head]);

    const mettaCursorResult = drainSyncCursor(createMettaSearchCursor(env, call));
    expect(mettaCursorResult.kind).toBe("fault");
    if (mettaCursorResult.kind === "fault") expect(mettaCursorResult.error).toBe(quiescence);
    expect(() => mettaEval(env, 1_000, initSt(), [], call)).toThrow(quiescence);

    const minimalCall = expr([sym("eval"), call]);
    const minimalCursorResult = drainSyncCursor(createMinimalSearchCursor(env, minimalCall));
    expect(minimalCursorResult.kind).toBe("fault");
    if (minimalCursorResult.kind === "fault") expect(minimalCursorResult.error).toBe(quiescence);
    expect(() => interpretMinimal(env, minimalCall)).toThrow(quiescence);
  });

  it("keeps one executable quiescence fault under eager Minimal cancellation", async () => {
    const env = makeEnv();
    const entered = deferred();
    const quiescence = new WorkerQuiescenceError("executable worker may still be running");
    const head = gnd(
      { g: "ext", kind: "minimal-cursor-test", id: "eager-cancel-exec-quiescence" },
      sym("Grounded"),
      async (_args, context) => {
        const signal = context?.signal;
        if (signal === undefined) throw new Error("missing executable cancellation signal");
        entered.resolve();
        await waitForAbort(signal);
        throw quiescence;
      },
    );
    const controller = new AbortController();
    const reason = Object.freeze({ code: "eager-exec-stop" });
    const outcome = interpretMinimalAsync(env, expr([sym("eval"), expr([head])]), {
      signal: controller.signal,
    }).catch((error: unknown) => error);
    await entered.promise;

    controller.abort(reason);
    const failure = await outcome;
    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).cause).toEqual(reason);
    expect(countRetainedFailure(failure, quiescence)).toBe(1);
  });

  it("removes a cancelled mutex waiter without entering its body", async () => {
    const env = makeEnv();
    const holderEntered = deferred();
    const releaseHolder = deferred();
    let waiterBodyCalled = false;
    registerAsyncGroundedOperation(env, "hold-lock", async () => {
      holderEntered.resolve();
      await releaseHolder.promise;
      return { tag: "ok", results: [sym("holder-done")] };
    });
    registerAsyncGroundedOperation(env, "waiter-body", async () => {
      waiterBodyCalled = true;
      return { tag: "ok", results: [sym("waiter-ran")] };
    });
    const holder = createMettaAsyncSearchCursor(env, parseAtom("(with-mutex lock (hold-lock))"));
    const waiter = createMettaAsyncSearchCursor(env, parseAtom("(with-mutex lock (waiter-body))"));
    const holderRead = holder.next({ maxSteps: 8 });
    await holderEntered.promise;
    const waiterRead = waiter.next({ maxSteps: 8 });
    await Promise.resolve();

    await waiter.close({ code: "cancel-waiter" });
    expect(waiterBodyCalled).toBe(false);
    await expect(waiterRead).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "cancel-waiter" },
    });

    releaseHolder.resolve();
    await holderRead;
    await holder.close({ code: "test-finished" });
  });

  it("joins yielded branch cleanup before active close resolves", async () => {
    const env = makeEnv();
    const entered = deferred();
    const cleanupStarted = deferred();
    const cleanupGate = deferred();
    registerCancellationCleanup(env, "cleanup-wait", entered, async (signal) => {
      cleanupStarted.resolve();
      await cleanupGate.promise;
      signal.throwIfAborted();
      return { tag: "ok", results: [sym("unreachable")] };
    });
    const cursor = createMettaAsyncSearchCursor(env, parseAtom("(par (cleanup-wait))"));
    const reading = cursor.next({ maxSteps: 8 });
    await entered.promise;

    let closeSettled = false;
    let closeError: unknown;
    const closing = cursor.close({ code: "cancel-cleanup" }).then(
      () => {
        closeSettled = true;
      },
      (error: unknown) => {
        closeSettled = true;
        closeError = error;
      },
    );
    await cleanupStarted.promise;
    await Promise.resolve();
    expect(closeSettled).toBe(false);

    cleanupGate.resolve();
    await closing;
    expect(closeSettled).toBe(true);
    expect(closeError).toBeUndefined();
    await expect(reading).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "cancel-cleanup" },
    });
  });

  it("keeps cancellation visible while close exposes yielded cleanup failure", async () => {
    const env = makeEnv();
    const entered = deferred();
    const cleanupError = new Error("yielded cleanup failed");
    registerCancellationCleanup(env, "cleanup-fails", entered, async () => {
      throw cleanupError;
    });
    const cursor = createMettaAsyncSearchCursor(env, parseAtom("(par (cleanup-fails))"));
    const reading = cursor.next({ maxSteps: 8 });
    await entered.promise;

    const closing = cursor.close({ code: "cancel-before-cleanup-fault" });
    await expect(reading).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "cancel-before-cleanup-fault" },
    });
    await expect(closing).rejects.toBe(cleanupError);
    await expect(cursor.next()).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "cancel-before-cleanup-fault" },
    });
  });

  it("surfaces unknown quiescence instead of an external par cancellation", async () => {
    const env = makeEnv();
    const entered = deferred();
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    registerCancellationCleanup(env, "quiescence-fails", entered, async () => {
      throw quiescence;
    });
    const cursor = createMettaAsyncSearchCursor(env, parseAtom("(par (quiescence-fails))"));
    const controller = new AbortController();
    const reading = cursor.next({ maxSteps: 8, signal: controller.signal });
    await entered.promise;

    controller.abort(new Error("external cancellation"));
    const event = await reading;
    expect(event).toMatchObject({ kind: "fault" });
    if (event.kind !== "fault") throw new Error("expected a quiescence fault");
    expect(event.error).toBeInstanceOf(WorkerQuiescenceError);
    expect(event.error).not.toBe(quiescence);
    expect((event.error as WorkerQuiescenceError).cause).toEqual({
      code: "Error",
      message: "external cancellation",
    });
    const retained = new Set<unknown>();
    const visit = (error: unknown): void => {
      if (retained.has(error)) return;
      retained.add(error);
      if (error instanceof AggregateError) for (const child of error.errors) visit(child);
      if (error instanceof WorkerQuiescenceError) visit(error.quiescenceFailure);
    };
    visit(event.error);
    expect(retained.has(quiescence)).toBe(true);
    const closeFailure = await cursor.close().catch((error: unknown) => error);
    expect(closeFailure).toBeInstanceOf(WorkerQuiescenceError);
    expect((closeFailure as WorkerQuiescenceError).cause).toEqual({
      code: "Error",
      message: "external cancellation",
    });
    const closeRetained = new Set<unknown>();
    const visitClose = (error: unknown): void => {
      if (closeRetained.has(error)) return;
      closeRetained.add(error);
      if (error instanceof AggregateError) for (const child of error.errors) visitClose(child);
      if (error instanceof WorkerQuiescenceError) visitClose(error.quiescenceFailure);
    };
    visitClose(closeFailure);
    expect(closeRetained.has(quiescence)).toBe(true);
    await expect(cursor.next()).resolves.toMatchObject({
      kind: "fault",
      error: event.error,
      steps: 0,
    });
  });

  it("retains every sibling quiescence failure after external cancellation", async () => {
    const env = makeEnv();
    const firstEntered = deferred();
    const secondEntered = deferred();
    const first = new WorkerQuiescenceError("first worker may still be running");
    const second = new WorkerQuiescenceError("second worker may still be running");
    registerCancellationCleanup(env, "first-quiescence", firstEntered, async () => {
      throw first;
    });
    registerCancellationCleanup(env, "second-quiescence", secondEntered, async () => {
      throw second;
    });
    const cursor = createMettaAsyncSearchCursor(
      env,
      parseAtom("(par (first-quiescence) (second-quiescence))"),
    );
    const controller = new AbortController();
    const reading = cursor.next({ maxSteps: 16, signal: controller.signal });
    await Promise.all([firstEntered.promise, secondEntered.promise]);

    controller.abort({ code: "external-stop" });
    const event = await reading;
    expect(event.kind).toBe("fault");
    if (event.kind !== "fault") throw new Error("expected a quiescence fault");
    expect(event.error).toBeInstanceOf(WorkerQuiescenceError);
    expect((event.error as WorkerQuiescenceError).cause).toEqual({ code: "external-stop" });
    const seen = new Set<unknown>();
    const visit = (error: unknown): void => {
      if (seen.has(error)) return;
      seen.add(error);
      if (error instanceof AggregateError) for (const child of error.errors) visit(child);
      if (error instanceof WorkerQuiescenceError) visit(error.quiescenceFailure);
    };
    visit(event.error);
    expect(seen.has(first)).toBe(true);
    expect(seen.has(second)).toBe(true);
    await expect(cursor.close()).rejects.toBe(event.error);
  });

  it("retains an ordinary branch failure before a sibling quiescence failure", async () => {
    const env = makeEnv();
    const ordinaryEntered = deferred();
    const quiescenceEntered = deferred();
    const ordinaryFailed = deferred();
    const ordinary = new Error("ordinary branch cleanup failed");
    const quiescence = new WorkerQuiescenceError("sibling worker may still be running");
    registerCancellationCleanup(env, "ordinary-cleanup-failure", ordinaryEntered, async () => {
      ordinaryFailed.resolve();
      throw ordinary;
    });
    registerCancellationCleanup(env, "later-quiescence", quiescenceEntered, async () => {
      await ordinaryFailed.promise;
      throw quiescence;
    });
    const cursor = createMettaAsyncSearchCursor(
      env,
      parseAtom("(par (ordinary-cleanup-failure) (later-quiescence))"),
    );
    const reading = cursor.next({ maxSteps: 16 });
    await Promise.all([ordinaryEntered.promise, quiescenceEntered.promise]);

    const closing = cursor.close({ code: "ordinary-then-quiescence" });
    const event = await reading;
    expect(event.kind).toBe("fault");
    if (event.kind !== "fault") throw new Error("expected worker-quiescence fault");
    expect(event.error).toBeInstanceOf(WorkerQuiescenceError);
    expect((event.error as WorkerQuiescenceError).cause).toEqual({
      code: "ordinary-then-quiescence",
    });
    expect(countRetainedFailure(event.error, ordinary)).toBe(1);
    expect(countRetainedFailure(event.error, quiescence)).toBe(1);
    const closeFailure = await closing.catch((error: unknown) => error);
    expect(countRetainedFailure(closeFailure, ordinary)).toBe(1);
    expect(countRetainedFailure(closeFailure, quiescence)).toBe(1);
  });

  it("keeps the initiating branch fault when scheduler unwinding loses quiescence", async () => {
    const env = makeEnv();
    const failingEntered = deferred();
    const cleanupEntered = deferred();
    const releaseFailure = deferred();
    const initiating = new Error("branch operation failed");
    const quiescence = new WorkerQuiescenceError("cancelled sibling may still be running");
    registerAsyncGroundedOperation(env, "operation-failure", async () => {
      failingEntered.resolve();
      await releaseFailure.promise;
      throw initiating;
    });
    registerCancellationCleanup(env, "quiescence-on-unwind", cleanupEntered, async () => {
      throw quiescence;
    });
    const cursor = createMettaAsyncSearchCursor(
      env,
      parseAtom("(par (operation-failure) (quiescence-on-unwind))"),
    );
    const reading = cursor.next({ maxSteps: 16 });
    await Promise.all([failingEntered.promise, cleanupEntered.promise]);

    releaseFailure.resolve();
    const event = await reading;
    expect(event.kind).toBe("fault");
    if (event.kind !== "fault") throw new Error("expected worker-quiescence fault");
    expect(event.error).toBeInstanceOf(WorkerQuiescenceError);
    expect(countRetainedFailure(event.error, initiating)).toBe(1);
    expect(countRetainedFailure(event.error, quiescence)).toBe(1);
    await expect(cursor.close()).resolves.toBeUndefined();
  });

  it("keeps operation and quiescence faults through the eager expression adapter", async () => {
    const env = makeEnv();
    const failingEntered = deferred();
    const cleanupEntered = deferred();
    const releaseFailure = deferred();
    const initiating = new Error("eager branch operation failed");
    const quiescence = new WorkerQuiescenceError("eager sibling may still be running");
    registerAsyncGroundedOperation(env, "eager-operation-failure", async () => {
      failingEntered.resolve();
      await releaseFailure.promise;
      throw initiating;
    });
    registerCancellationCleanup(env, "eager-quiescence-on-unwind", cleanupEntered, async () => {
      throw quiescence;
    });
    const evaluation = mettaEvalAsync(
      env,
      1_000,
      initSt(),
      [],
      parseAtom("(par (eager-operation-failure) (eager-quiescence-on-unwind))"),
    ).catch((error: unknown) => error);
    await Promise.all([failingEntered.promise, cleanupEntered.promise]);

    releaseFailure.resolve();
    const failure = await evaluation;
    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect(countRetainedFailure(failure, initiating)).toBe(1);
    expect(countRetainedFailure(failure, quiescence)).toBe(1);
  });

  it("does not confuse a same-text cleanup fault with cancellation", async () => {
    const env = makeEnv();
    const entered = deferred();
    const cleanupError = new Error("same text");
    registerCancellationCleanup(env, "same-text-cleanup-fails", entered, async () => {
      throw cleanupError;
    });
    const cursor = createMettaAsyncSearchCursor(env, parseAtom("(par (same-text-cleanup-fails))"));
    const reading = cursor.next({ maxSteps: 8 });
    await entered.promise;

    const closing = cursor.close({ code: "Error", message: "same text" });
    await expect(reading).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "Error", message: "same text" },
    });
    await expect(closing).rejects.toBe(cleanupError);
  });

  it("joins Superpose adapter cleanup and keeps cancellation sticky", async () => {
    const env = makeEnv();
    const entered = deferred();
    const cleanupError = new Error("superpose cleanup failed");
    registerCancellationCleanup(env, "superpose-cleanup-fails", entered, async () => {
      throw cleanupError;
    });
    const cursor = createMettaAsyncSearchCursor(
      env,
      parseAtom("(superpose (superpose-cleanup-fails))"),
    );
    const reading = cursor.next({ maxSteps: 8 });
    await entered.promise;

    const closing = cursor.close({ code: "cancel-superpose" });
    await expect(reading).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "cancel-superpose" },
    });
    await expect(closing).rejects.toBe(cleanupError);
    await expect(cursor.next()).resolves.toMatchObject({
      kind: "cancelled",
      reason: { code: "cancel-superpose" },
    });
  });

  it("joins signal-driven direct drain cleanup before exposing cancellation", async () => {
    const env = makeEnv();
    const entered = deferred();
    const cleanupStarted = deferred();
    const cleanupGate = deferred();
    registerCancellationCleanup(env, "direct-cleanup-wait", entered, async (signal) => {
      cleanupStarted.resolve();
      await cleanupGate.promise;
      signal.throwIfAborted();
      return { tag: "ok", results: [sym("unreachable")] };
    });
    const controller = new AbortController();
    const reason = Object.freeze({ code: "direct-drain-cancel" });
    let settled = false;
    const outcome = interpretMinimalAsync(env, parseAtom("(eval (direct-cleanup-wait))"), {
      signal: controller.signal,
    })
      .then(
        () => ({ kind: "resolved" as const, error: undefined }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      )
      .finally(() => {
        settled = true;
      });
    await entered.promise;

    controller.abort(reason);
    await cleanupStarted.promise;
    await Promise.resolve();
    expect(settled).toBe(false);

    cleanupGate.resolve();
    await expect(outcome).resolves.toEqual({ kind: "rejected", error: reason });
    expect(settled).toBe(true);
  });
});

describe("full MeTTa search cursor", () => {
  it("pins the synchronous program image at cursor construction", () => {
    const env = makeEnv("(= (value) old)");
    const cursor = createMettaSearchCursor(env, parseAtom("(value)"));
    addAtomToEnv(env, parseAtom("(= (value) new)"));

    const result = drainSyncCursor(cursor);
    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted")
      expect(result.values.map((answer) => format(answer.atom))).toEqual(["old"]);
  });

  it("pins sync and async input bindings at cursor construction", async () => {
    const original: BindingRel = { tag: "val", x: "x", a: sym("old"), y: undefined };
    const bindings: BindingRel[] = [original];
    const env = makeEnv();
    const atom = parseAtom("$x");
    const sync = createMettaSearchCursor(env, atom, { bindings });
    const asyncCursor = createMettaAsyncSearchCursor(env, atom, { bindings });

    bindings[0] = { tag: "val", x: "x", a: sym("new"), y: undefined };
    (original as { a: Atom }).a = sym("also-new");

    const syncResult = drainSyncCursor(sync);
    const asyncResult = await drainAsyncCursor(asyncCursor);
    expect(syncResult.kind).toBe("exhausted");
    expect(asyncResult.kind).toBe("exhausted");
    if (syncResult.kind === "exhausted") {
      expect(syncResult.values.map((answer) => format(answer.atom))).toEqual(["old"]);
      expect(syncResult.values[0]!.bindings).not.toBe(bindings);
    }
    if (asyncResult.kind === "exhausted") {
      expect(asyncResult.values.map((answer) => format(answer.atom))).toEqual(["old"]);
      expect(asyncResult.values[0]!.bindings).not.toBe(bindings);
    }
  });

  it("isolates answer states and bindings from later alternatives", () => {
    const env = makeEnv(`
      (= (allocate) (new-state A))
      (= (allocate) (new-state B))
    `);
    const bindings: BindingRel[] = [{ tag: "val", x: "seed", a: sym("stable"), y: undefined }];
    const cursor = createMettaSearchCursor(env, parseAtom("(allocate)"), { bindings });
    let first = cursor.next({ maxSteps: 1 });
    while (first.kind === "pending") first = cursor.next({ maxSteps: 1 });
    expect(first.kind).toBe("answer");
    if (first.kind !== "answer") return;

    const before = first.value.state.world.allocation.ids.clone().next("state");
    first.value.state.world.tokens.set("answer-only", sym("leak"));
    expect(() =>
      (first.value.bindings as BindingRel[]).push({
        tag: "val",
        x: "answer-only",
        a: sym("leak"),
        y: undefined,
      }),
    ).toThrow(TypeError);

    let second = cursor.next({ maxSteps: 1 });
    while (second.kind === "pending") second = cursor.next({ maxSteps: 1 });
    expect(second.kind).toBe("answer");
    if (second.kind !== "answer") return;

    expect(second.value.state.world.tokens.has("answer-only")).toBe(false);
    expect(second.value.bindings.some((binding) => binding.x === "answer-only")).toBe(false);
    expect(first.value.state.world.allocation.ids.clone().next("state")).toBe(before);
  });

  it("publishes the first rule answer before evaluating a long tail", () => {
    const env = makeEnv(`
      (= (burn 0 $value) $value)
      (= (burn $n $value) (burn (- $n 1) $value))
      (= (branch) first)
      (= (branch) (burn 200000 late))
    `);
    const cursor = createMettaSearchCursor(env, parseAtom("(branch)"));

    let event = cursor.next({ maxSteps: 8 });
    while (event.kind === "pending") event = cursor.next({ maxSteps: 8 });
    expect(event.kind).toBe("answer");
    if (event.kind === "answer") expect(format(event.value.atom)).toBe("first");

    cursor.close({ code: "cut-after-first" });
    expect(cursor.closed).toBe(true);
  });

  it("streams nested argument products in left-major order", () => {
    const env = makeEnv(`
      (= left-u6 L1)
      (= left-u6 L2)
      (= right-u6 R1)
      (= right-u6 R2)
      (= (pair-u6 $left $right) ($left $right))
    `);
    const result = drainSyncCursor(
      createMettaSearchCursor(env, parseAtom("(pair-u6 left-u6 right-u6)")),
      { maxSteps: 1 },
    );

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted")
      expect(result.values.map((answer) => format(answer.atom))).toEqual([
        "(L1 R1)",
        "(L1 R2)",
        "(L2 R1)",
        "(L2 R2)",
      ]);
  });

  it("threads bindings from an earlier argument into later arguments", () => {
    const env = makeEnv(`
      (= (choose-u6 A) A)
      (= (choose-u6 B) B)
      (= (echo-u6 A) seen-A)
      (= (echo-u6 B) seen-B)
      (= (pair-u6 $left $right) ($left $right))
    `);
    const result = drainSyncCursor(
      createMettaSearchCursor(env, parseAtom("(pair-u6 (choose-u6 $shared) (echo-u6 $shared))")),
      { maxSteps: 1 },
    );

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted")
      expect(result.values.map((answer) => format(answer.atom))).toEqual([
        "(A seen-A)",
        "(B seen-B)",
      ]);
  });

  it("matches eager argument products for generated finite bags", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 4 }),
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 4 }),
        (left, right) => {
          const rules = [
            ...left.map((value) => `(= left-u6 L${value})`),
            ...right.map((value) => `(= right-u6 R${value})`),
            "(= (pair-u6 $left $right) ($left $right))",
          ].join("\n");
          const atom = parseAtom("(pair-u6 left-u6 right-u6)");
          const [eager] = mettaEval(makeEnv(rules), 10_000, initSt(), [], atom);
          const streamed = drainSyncCursor(createMettaSearchCursor(makeEnv(rules), atom), {
            maxSteps: 1,
          });

          expect(streamed.kind).toBe("exhausted");
          if (streamed.kind === "exhausted")
            expect(streamed.values.map((answer) => format(answer.atom))).toEqual(
              eager.map(([answer]) => format(answer)),
            );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("threads sequential effects through each completed argument product", () => {
    const rules = `
      (= (left-u6 A) (let $_ (add-atom &self (seen L-A)) A))
      (= (left-u6 B) (let $_ (add-atom &self (seen L-B)) B))
      (= (right-u6 A R1) (let $_ (add-atom &self (seen R-A1)) R1))
      (= (right-u6 A R2) (let $_ (add-atom &self (seen R-A2)) R2))
      (= (right-u6 B R1) (let $_ (add-atom &self (seen R-B1)) R1))
      (= (right-u6 B R2) (let $_ (add-atom &self (seen R-B2)) R2))
      (= (pair-u6 $left $right) ($left $right))
    `;
    const env = buildEnv(
      [...preludeAtoms(), ...parseAll(rules, standardTokenizer()).map((item) => item.atom)],
      stdTable(),
    );
    const result = drainSyncCursor(
      createMettaSearchCursor(
        env,
        parseAtom("(pair-u6 (left-u6 $shared) (right-u6 $shared $right))"),
      ),
      { maxSteps: 1 },
    );

    const eagerEnv = buildEnv(
      [...preludeAtoms(), ...parseAll(rules, standardTokenizer()).map((item) => item.atom)],
      stdTable(),
    );
    const [eagerAnswers, eagerState] = mettaEval(
      eagerEnv,
      10_000,
      initSt(),
      [],
      parseAtom("(pair-u6 (left-u6 $shared) (right-u6 $shared $right))"),
    );

    expect(result.kind).toBe("exhausted");
    if (result.kind !== "exhausted") return;
    expect(result.values.map((answer) => format(answer.atom))).toEqual(
      eagerAnswers.map(([answer]) => format(answer)),
    );
    const [seen] = mettaEval(
      env,
      10_000,
      result.terminal,
      [],
      parseAtom("(collapse (match &self (seen $value) $value))"),
    );
    const [eagerSeen] = mettaEval(
      eagerEnv,
      10_000,
      eagerState,
      [],
      parseAtom("(collapse (match &self (seen $value) $value))"),
    );
    expect(seen.map(([answer]) => format(answer))).toEqual(
      eagerSeen.map(([answer]) => format(answer)),
    );
  });

  it("threads the continuation counter through streamed Superpose argument answers", () => {
    const rules = "(= (fresh-wrap-u6 $value) ($value $fresh))";
    const atom = parseAtom("(fresh-wrap-u6 (superpose (A B)))");
    const eagerEnv = makeEnv(rules);
    const [eagerAnswers, eagerState] = mettaEval(eagerEnv, 10_000, initSt(), [], atom);
    const { answers: streamedAnswers, terminal } = drainSyncAtUnitQuota(
      createMettaSearchCursor(makeEnv(rules), atom),
    );

    expect(streamedAnswers).toEqual(eagerAnswers.map(([answer]) => format(answer)));
    expect(terminal.counter).toBe(eagerState.counter);
  });

  it("commits every streamed Hyperpose continuation effect at exhaustion", () => {
    const rules = `
      (= (record-u6 $value) (let $_ (add-atom &self (seen-u6 $value)) $value))
    `;
    const atom = parseAtom("(record-u6 (hyperpose (A B)))");
    const eagerEnv = buildEnv(
      [...preludeAtoms(), ...parseAll(rules, standardTokenizer()).map((item) => item.atom)],
      stdTable(),
    );
    const [eagerAnswers, eagerState] = mettaEval(eagerEnv, 10_000, initSt(), [], atom);
    const streamedEnv = buildEnv(
      [...preludeAtoms(), ...parseAll(rules, standardTokenizer()).map((item) => item.atom)],
      stdTable(),
    );
    const { answers: streamedAnswers, terminal } = drainSyncAtUnitQuota(
      createMettaSearchCursor(streamedEnv, atom),
    );

    expect(streamedAnswers).toEqual(eagerAnswers.map(([answer]) => format(answer)));
    const query = parseAtom("(collapse (match &self (seen-u6 $value) $value))");
    const [eagerSeen] = mettaEval(eagerEnv, 10_000, eagerState, [], query);
    const [streamedSeen] = mettaEval(streamedEnv, 10_000, terminal, [], query);
    expect(streamedSeen.map(([answer]) => format(answer))).toEqual(
      eagerSeen.map(([answer]) => format(answer)),
    );
    expect(terminal.world.generation).toBe(eagerState.world.generation);
  });

  it("preserves net-zero continuation writes in the world generation", () => {
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...parseAll(
          `
            (= (noop-write-u6 $value)
               (let $_ (change-state! (State 0) A) $value))
          `,
          standardTokenizer(),
        ).map((item) => item.atom),
      ],
      stdTable(),
    );
    const [, initial] = mettaEval(env, 10_000, initSt(), [], parseAtom("(new-state A)"));
    const atom = parseAtom("(noop-write-u6 (hyperpose (X)))");
    const [, eagerState] = mettaEval(env, 10_000, initial, [], atom);
    const { terminal } = drainSyncAtUnitQuota(
      createMettaSearchCursor(env, atom, { state: initial }),
    );

    expect(terminal.world.generation).toBe(eagerState.world.generation);
    expect(terminal.world.generation).toBe(initial.world.generation + 1);
  });

  it("commits each continuation delta once for a multi-answer Hyperpose branch", () => {
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...parseAll(
          `
            (= (branch-u6) A)
            (= (branch-u6) B)
            (= (record-u6 $value)
               (let $_ (add-atom &self (seen-u6 $value)) $value))
          `,
          standardTokenizer(),
        ).map((item) => item.atom),
      ],
      stdTable(),
    );
    const { answers, terminal } = drainSyncAtUnitQuota(
      createMettaSearchCursor(env, parseAtom("(record-u6 (hyperpose ((branch-u6))))")),
    );

    expect(answers).toEqual(["A", "B"]);
    const [seen] = mettaEval(
      env,
      10_000,
      terminal,
      [],
      parseAtom("(collapse (match &self (seen-u6 $value) $value))"),
    );
    expect(seen.map(([atom]) => format(atom))).toEqual(["(, A B)"]);
  });

  it("standardizes Hyperpose branch-local variables apart before collapse", () => {
    const rules = `
      (= (fresh-u6 $tag) (fresh-value-u6 $tag $fresh))
      (= (probe-u6 (, (fresh-value-u6 A $x) (fresh-value-u6 B $y)) $x $y) ok)
    `;
    const { env, compiled } = makeCompiledPreludeEnv(rules);
    expect(compiled.get("fresh-u6")?.kind).toBe("symbolic");
    const collapsed = drainSyncCursor(
      createMettaSearchCursor(env, parseAtom("(collapse (hyperpose ((fresh-u6 A) (fresh-u6 B))))")),
      { maxSteps: 1 },
    );

    expect(collapsed.kind).toBe("exhausted");
    if (collapsed.kind !== "exhausted") return;
    const tuple = collapsed.values[0]!.atom;
    expect(tuple.kind).toBe("expr");
    if (tuple.kind !== "expr") return;
    const left = tuple.items[1];
    const right = tuple.items[2];
    expect(left?.kind).toBe("expr");
    expect(right?.kind).toBe("expr");
    if (left?.kind !== "expr" || right?.kind !== "expr") return;
    expect(atomEq(left.items[2]!, right.items[2]!)).toBe(false);
    expect(atomEq(parseAtom(format(tuple)), tuple)).toBe(true);

    const [probed] = mettaEval(
      env,
      10_000,
      initSt(),
      [],
      parseAtom("(probe-u6 (collapse (hyperpose ((fresh-u6 A) (fresh-u6 B)))) 1 2)"),
    );
    expect(probed.map(([atom]) => format(atom))).toEqual(["ok"]);
  });

  it("standardizes asynchronous par branch-local variables apart before collapse", async () => {
    const rules = `
      (= (fresh-u6 $tag) (fresh-value-u6 $tag $fresh))
      (= (probe-u6 (, (fresh-value-u6 A $x) (fresh-value-u6 B $y)) $x $y) ok)
    `;
    const { env, compiled } = makeCompiledPreludeEnv(rules);
    expect(compiled.get("fresh-u6")?.kind).toBe("symbolic");
    const result = await drainAsyncCursor(
      createMettaAsyncSearchCursor(
        env,
        parseAtom("(probe-u6 (collapse (par (fresh-u6 A) (fresh-u6 B))) 1 2)"),
      ),
      { maxSteps: 1 },
    );

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted")
      expect(result.values.map((answer) => format(answer.atom))).toEqual(["ok"]);

    const [eager] = await mettaEvalAsync(
      env,
      10_000,
      initSt(),
      [],
      parseAtom("(probe-u6 (collapse (par (fresh-u6 A) (fresh-u6 B))) 1 2)"),
    );
    expect(eager.map(([atom]) => format(atom))).toEqual(["ok"]);
  });

  it("keeps a branch-local variable identical in its answer and world state", async () => {
    const rules = `
      (= (make-u6 $tag)
         (let $state (new-state $fresh) ($tag $state $fresh)))
      (= (check-u6 ($tag $state $value))
         (let $stored (get-state $state)
           (let $stored-name (repr $stored)
             (let $value-name (repr $value)
               (if (== $stored-name $value-name) ok bad)))))
    `;
    const env = buildEnv(
      [...preludeAtoms(), ...parseAll(rules, standardTokenizer()).map((item) => item.atom)],
      stdTable(),
    );

    const [hyperpose] = mettaEval(
      env,
      10_000,
      initSt(),
      [],
      parseAtom("(check-u6 (hyperpose ((make-u6 A) (make-u6 B))))"),
    );
    const [parallel] = await mettaEvalAsync(
      env,
      10_000,
      initSt(),
      [],
      parseAtom("(check-u6 (par (make-u6 A) (make-u6 B)))"),
    );

    expect(hyperpose.map(([atom]) => format(atom))).toEqual(["ok", "ok"]);
    expect(parallel.map(([atom]) => format(atom))).toEqual(["ok", "ok"]);
  });

  it("keeps each bulk-drained answer at its real state boundary", () => {
    const env = buildEnv(
      [
        ...preludeAtoms(),
        ...parseAll(
          `
            (= (effect-answer-u6 A) (let $_ (add-atom &self (seen-u6 A)) A))
            (= (effect-answer-u6 B) (let $_ (add-atom &self (seen-u6 B)) B))
          `,
          standardTokenizer(),
        ).map((item) => item.atom),
      ],
      stdTable(),
    );
    const result = drainSyncCursor(
      createMettaSearchCursor(env, parseAtom("(effect-answer-u6 $value)")),
      { maxSteps: 1 },
    );

    expect(result.kind).toBe("exhausted");
    if (result.kind !== "exhausted") return;
    expect(result.values.map((answer) => format(answer.atom))).toEqual(["A", "B"]);
    const query = parseAtom("(collapse (match &self (seen-u6 $value) $value))");
    const snapshots = result.values.map((answer) =>
      mettaEval(env, 10_000, answer.state, [], query)[0].map(([atom]) => format(atom)),
    );
    expect(snapshots).toEqual([["(, A)"], ["(, A B)"]]);
  });

  it("drains the same ordered bag and multiplicity as eager evaluation", () => {
    const env = makeEnv(`
      (= color red)
      (= color red)
      (= color blue)
    `);
    const atom = parseAtom("color");
    const streamed = drainSyncCursor(createMettaSearchCursor(env, atom));
    const [eager] = interpretMinimal(env, parseAtom("(metta color %Undefined% &self)"));

    expect(streamed.kind).toBe("exhausted");
    if (streamed.kind === "exhausted") {
      expect(streamed.values.map((answer) => format(answer.atom))).toEqual(["red", "red", "blue"]);
    }
    expect(eager.map(([answer]) => format(answer))).toEqual(["red", "red", "blue"]);
  });

  it("bulk-drains only the tail after an answer was already observed", async () => {
    const env = makeEnv(`
      (= color red)
      (= color green)
      (= color blue)
    `);
    const cursor = createMettaAsyncSearchCursor(env, parseAtom("color"));
    let first = await cursor.next({ maxSteps: 1 });
    while (first.kind === "pending") first = await cursor.next({ maxSteps: 1 });
    expect(first.kind).toBe("answer");
    if (first.kind === "answer") expect(format(first.value.atom)).toBe("red");

    const tail = await drainAsyncCursor(cursor, { maxSteps: 1 });
    expect(tail.kind).toBe("exhausted");
    if (tail.kind === "exhausted")
      expect(tail.values.map((answer) => format(answer.atom))).toEqual(["green", "blue"]);
  });

  it("uses the incremental source-ordered scheduler for par", async () => {
    const cursor = createMettaAsyncSearchCursor(makeEnv(), parseAtom("(par red green blue)"));
    const result = await drainAsyncCursor(cursor, { maxSteps: 1 });

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted")
      expect(result.values.map((answer) => format(answer.atom))).toEqual(["red", "green", "blue"]);
  });

  it("validates sync and async quotas before serving queued Superpose answers", async () => {
    const env = makeEnv();
    const atom = parseAtom("(superpose (A B))");
    const sync = createMettaSearchCursor(env, atom);
    const asyncCursor = createMettaAsyncSearchCursor(env, atom);

    let syncFirst = sync.next({ maxSteps: 1 });
    while (syncFirst.kind === "pending") syncFirst = sync.next({ maxSteps: 1 });
    let asyncFirst = await asyncCursor.next({ maxSteps: 1 });
    while (asyncFirst.kind === "pending") asyncFirst = await asyncCursor.next({ maxSteps: 1 });
    expect(syncFirst.kind === "answer" ? format(syncFirst.value.atom) : syncFirst.kind).toBe("A");
    expect(asyncFirst.kind === "answer" ? format(asyncFirst.value.atom) : asyncFirst.kind).toBe(
      "A",
    );

    expect(() => sync.next({ maxSteps: 0 })).toThrow("maxSteps must be a positive safe integer");
    await expect(asyncCursor.next({ maxSteps: 0 })).rejects.toThrow(
      "maxSteps must be a positive safe integer",
    );
    expect(sync.next({ maxSteps: 1 })).toMatchObject({ kind: "answer", steps: 0 });
    await expect(asyncCursor.next({ maxSteps: 1 })).resolves.toMatchObject({
      kind: "answer",
      steps: 0,
    });
  });

  it("preempts an unbounded full reduction at the exact requested quota", () => {
    const env = makeEnv("(= (loop $x) (loop (S $x)))");
    const cursor = createMettaSearchCursor(env, parseAtom("(loop Z)"), { fuel: 10000 });
    expect(cursor.next({ maxSteps: 7 })).toEqual({ kind: "pending", steps: 7 });
    cursor.close({ code: "quota-test-finished" });
  });

  it("preserves interpreter errors when a cooperative compiled run bails", () => {
    const rules = `
      (= (divide-down $n)
         (if (== $n 0) (/ 1 0) (divide-down (- $n 1))))
    `;
    const env = buildEnv(
      [...preludeAtoms(), ...parseAll(rules, standardTokenizer()).map((item) => item.atom)],
      stdTable(),
    );
    env.pureFunctors = analyzePurity(env);
    env.compiled = compileEnv(env);
    const cursor = createMettaSearchCursor(env, parseAtom("(divide-down 20)"));

    const events = [];
    for (;;) {
      const event = cursor.next({ maxSteps: 3 });
      events.push(event);
      expect(event.steps).toBeLessThanOrEqual(3);
      if (event.kind === "fault") throw event.error;
      expect(event.kind).not.toBe("cancelled");
      if (event.kind === "exhausted") break;
    }

    expect(events.some((event) => event.kind === "pending")).toBe(true);
    // The compiled loop consumes 21 steps. Deoptimization resumes at `(divide-down 0)`, whose
    // interpreted error path consumes 10 more. Restarting from `(divide-down 20)` costs 441 steps.
    expect(events.reduce((steps, event) => steps + event.steps, 0)).toBe(31);
    expect(
      events.flatMap((event) => (event.kind === "answer" ? [format(event.value.atom)] : [])),
    ).toEqual(["(Error (/ 1 0) DivisionByZero)"]);
  });

  it("keeps sync and async cursor quotas across a nested Hyperpose scheduler", async () => {
    const env = makeEnv(`
      (= (walk Z $value) $value)
      (= (walk (S $n) $value) (walk $n $value))
    `);
    const atom = parseAtom(
      "(hyperpose ((walk (S (S (S (S Z)))) left) (walk (S (S (S (S Z)))) right)))",
    );
    type Cursor =
      | Pick<SyncSearchCursor<MinimalSearchAnswer, St>, "next">
      | Pick<AsyncSearchCursor<MinimalSearchAnswer, St>, "next">;
    const collect = async (cursor: Cursor): Promise<string[]> => {
      const answers: string[] = [];
      const eventKinds: string[] = [];
      let exhausted = false;
      for (let eventIndex = 0; eventIndex < 1_000; eventIndex++) {
        const event = await cursor.next({ maxSteps: 1 });
        eventKinds.push(event.kind);
        expect(event.steps).toBeLessThanOrEqual(1);
        if (event.kind === "answer") answers.push(format(event.value.atom));
        if (event.kind === "exhausted") {
          exhausted = true;
          break;
        }
        expect(event.kind === "fault" || event.kind === "cancelled").toBe(false);
      }
      expect(exhausted, JSON.stringify({ answers, eventKinds: eventKinds.slice(-20) })).toBe(true);
      return answers;
    };

    expect(await collect(createMettaSearchCursor(env, atom))).toEqual(["left", "right"]);
    expect(await collect(createMettaAsyncSearchCursor(env, atom))).toEqual(["left", "right"]);
  });

  it("exhausts a deterministic full cursor after its answer", () => {
    const env = makeEnv(`
      (= (walk Z $value) $value)
      (= (walk (S $n) $value) (walk $n $value))
    `);
    const cursor = createMettaSearchCursor(env, parseAtom("(walk (S (S (S (S Z)))) done)"));
    const kinds: string[] = [];
    for (let eventIndex = 0; eventIndex < 100; eventIndex++) {
      const event = cursor.next({ maxSteps: 1 });
      kinds.push(event.kind);
      if (event.kind === "exhausted") break;
    }
    expect(kinds.includes("answer")).toBe(true);
    expect(kinds.at(-1)).toBe("exhausted");
  });
});
