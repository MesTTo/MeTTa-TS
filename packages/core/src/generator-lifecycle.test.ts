// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  closeGeneratorAsync,
  closeGeneratorSync,
  ExclusiveAsyncScope,
  finishGeneratorAsync,
} from "./generator-lifecycle";
import { combineInitiatingAndCleanupFailure } from "./cleanup-fault";
import { WorkerQuiescenceError } from "./worker-protocol";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("generator cleanup lifecycle", () => {
  it("reserves active work before a re-entrant close and joins it", async () => {
    const scope = new ExclusiveAsyncScope();
    const gate = deferred();
    let closing!: Promise<void>;
    let activeSettled = false;
    const active = scope
      .run(async () => {
        closing = scope.close(() => Promise.resolve());
        await gate.promise;
      })
      .finally(() => {
        activeSettled = true;
      });
    let closeSettled = false;
    void closing.then(() => {
      closeSettled = true;
    });

    await Promise.resolve();
    expect(activeSettled).toBe(false);
    expect(closeSettled).toBe(false);
    gate.resolve();
    await active;
    await closing;
    expect(closeSettled).toBe(true);
  });

  it("reserves the close promise before invoking re-entrant cleanup", async () => {
    const scope = new ExclusiveAsyncScope();
    let nested!: Promise<void>;
    const closing = scope.close(() => {
      nested = scope.close(() => Promise.reject(new Error("must not run")));
      return Promise.resolve();
    });

    expect(nested).toBe(closing);
    await expect(closing).resolves.toBeUndefined();
  });

  it("joins cleanup when active start re-enters close and then throws", async () => {
    const scope = new ExclusiveAsyncScope();
    const failure = new Error("active start failed after close");
    let cleanupCalls = 0;
    let closing!: Promise<void>;
    const active = scope.run(() => {
      closing = scope.close(() => {
        cleanupCalls += 1;
        return Promise.resolve();
      });
      throw failure;
    });
    const closeOutcome = closing.catch((error: unknown) => error);

    await expect(active).rejects.toBe(failure);
    await expect(closeOutcome).resolves.toBe(failure);
    expect(cleanupCalls).toBe(1);
  });

  it("keeps one close promise when re-entrant cleanup throws synchronously", async () => {
    const scope = new ExclusiveAsyncScope();
    const failure = new Error("close callback failed");
    let nested!: Promise<void>;
    const closing = scope.close(() => {
      nested = scope.close(() => Promise.reject(new Error("must not run")));
      throw failure;
    });

    expect(nested).toBe(closing);
    await expect(closing).rejects.toBe(failure);
    await expect(nested).rejects.toBe(failure);
  });

  it("passes the active aborted signal to a yielded finalizer", async () => {
    function* task(): Generator<"work" | "cleanup", string, unknown> {
      try {
        yield "work";
      } finally {
        yield "cleanup";
      }
      return "done";
    }
    const generator = task();
    expect(generator.next()).toEqual({ done: false, value: "work" });
    const controller = new AbortController();
    const reason = Object.freeze({ code: "test-abort" });
    controller.abort(reason);
    const seenSignals: AbortSignal[] = [];

    await finishGeneratorAsync(
      generator,
      generator.return("done"),
      controller.signal,
      (_value, signal) => {
        seenSignals.push(signal);
      },
    );

    expect(seenSignals).toEqual([controller.signal]);
    expect(seenSignals[0]?.aborted).toBe(true);
    expect(seenSignals[0]?.reason).toBe(reason);
  });

  it("awaits a yielded finalizer before surfacing its rejection", async () => {
    function* task(): Generator<"work" | "cleanup", string, unknown> {
      try {
        yield "work";
      } finally {
        yield "cleanup";
      }
      return "done";
    }
    const generator = task();
    generator.next();
    const gate = deferred();
    const cleanupError = new Error("async cleanup failed");
    let settled = false;
    const closing = closeGeneratorAsync(
      generator,
      "done",
      new AbortController().signal,
      async () => {
        await gate.promise;
        throw cleanupError;
      },
    ).finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    await expect(closing).rejects.toBe(cleanupError);
    expect(settled).toBe(true);
  });

  it("runs a throwing synchronous finalizer exactly once", () => {
    const cleanupError = new Error("sync cleanup failed");
    let cleanupRuns = 0;
    function* task(): Generator<"work", string, unknown> {
      try {
        yield "work";
      } finally {
        cleanupRuns += 1;
        throw cleanupError;
      }
    }
    const generator = task();
    generator.next();

    expect(() => closeGeneratorSync(generator, "done", () => undefined)).toThrow(cleanupError);
    expect(() => closeGeneratorSync(generator, "done", () => undefined)).not.toThrow();
    expect(cleanupRuns).toBe(1);
  });

  it("preserves an undefined asynchronous cleanup rejection", async () => {
    function* task(): Generator<"work" | "cleanup", string, unknown> {
      try {
        yield "work";
      } finally {
        yield "cleanup";
      }
      return "done";
    }
    const generator = task();
    generator.next();
    const outcome = closeGeneratorAsync(generator, "done", new AbortController().signal, () =>
      Promise.reject(undefined),
    ).then(
      () => ({ rejected: false as const, reason: undefined }),
      (reason: unknown) => ({ rejected: true as const, reason }),
    );

    await expect(outcome).resolves.toEqual({ rejected: true, reason: undefined });
  });

  it("retains every synchronous yielded-finalizer failure", () => {
    function* task(): Generator<"work" | "first" | "second", string, unknown> {
      try {
        yield "work";
      } finally {
        try {
          yield "first";
        } catch {}
        try {
          yield "second";
        } catch {}
      }
      return "done";
    }
    const generator = task();
    generator.next();
    const first = new Error("first finalizer failed");
    const second = new Error("second finalizer failed");

    let failure: unknown;
    try {
      closeGeneratorSync(generator, "done", (value) => {
        throw value === "first" ? first : second;
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([first, second]);
  });

  it("promotes later async quiescence without losing earlier finalizer failure", async () => {
    function* task(): Generator<"work" | "first" | "second", string, unknown> {
      try {
        yield "work";
      } finally {
        try {
          yield "first";
        } catch {}
        try {
          yield "second";
        } catch {}
      }
      return "done";
    }
    const generator = task();
    generator.next();
    const first = new Error("first finalizer failed");
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const failure = await closeGeneratorAsync(
      generator,
      "done",
      new AbortController().signal,
      (value) => Promise.reject(value === "first" ? first : quiescence),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    const retained = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(retained).toBeInstanceOf(AggregateError);
    expect((retained as AggregateError).errors).toEqual([first, quiescence]);
  });

  it("keeps a pending generator fault ahead of the yielded-finalizer failure", async () => {
    const initiating = new Error("operation failed before cleanup");
    const cleanup = new Error("yielded cleanup failed");
    function* task(): Generator<"work" | "cleanup", string, unknown> {
      let operationFailure: unknown;
      try {
        yield "work";
      } catch (error) {
        operationFailure = error;
        throw error;
      } finally {
        try {
          yield "cleanup";
        } catch (error) {
          throw combineInitiatingAndCleanupFailure(
            operationFailure,
            error,
            "operation and cleanup failed",
          );
        }
      }
      return "done";
    }
    const generator = task();
    generator.next();
    const cleanupStart = generator.throw(initiating);
    const failure = await finishGeneratorAsync(
      generator,
      cleanupStart,
      new AbortController().signal,
      () => Promise.reject(cleanup),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([initiating, cleanup]);
  });

  it("retains active-work and close failures together", async () => {
    const scope = new ExclusiveAsyncScope();
    const activeFailure = new Error("active work failed");
    const cleanupFailure = new Error("cleanup failed");
    const active = scope.run(() => Promise.reject(activeFailure));
    const closing = scope.close(() => Promise.reject(cleanupFailure));

    await expect(active).rejects.toBe(activeFailure);
    const failure = await closing.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([activeFailure, cleanupFailure]);
  });
});
