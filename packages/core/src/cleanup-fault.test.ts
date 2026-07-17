// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  aggregateCleanupFailures,
  cleanupFailureLeaves,
  combineInitiatingAndCleanupFailure,
  selectWorkerQuiescenceFailure,
} from "./cleanup-fault";
import { WorkerQuiescenceError } from "./worker-protocol";

describe("cleanup fault aggregation", () => {
  it("preserves every ordinary cleanup failure in source order", () => {
    const first = new Error("first cleanup failed");
    const second = new Error("second cleanup failed");
    const failure = aggregateCleanupFailures([first, second], "cleanup failed");

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([first, second]);
  });

  it("does not reinterpret a user-thrown AggregateError as runtime cleanup structure", () => {
    const child = new Error("user aggregate child");
    const userFailure = new AggregateError([child], "user operation failed");

    expect(cleanupFailureLeaves(userFailure)).toEqual([userFailure]);
  });

  it("preserves an undefined rejection", () => {
    expect(aggregateCleanupFailures([undefined], "cleanup failed")).toBeUndefined();
  });

  it("promotes quiescence while retaining every sibling cleanup failure", () => {
    const ordinary = new Error("ordinary cleanup failed");
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const later = new Error("later cleanup failed");
    const failure = aggregateCleanupFailures(
      [ordinary, quiescence, later],
      "worker cleanup failed",
    );

    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    const retained = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(retained).toBeInstanceOf(AggregateError);
    expect((retained as AggregateError).errors).toEqual([ordinary, quiescence, later]);
  });

  it("retains an initiating failure under a quiescence cleanup fault", () => {
    const initiating = new Error("evaluation failed");
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const failure = combineInitiatingAndCleanupFailure(
      initiating,
      quiescence,
      "evaluation and cleanup failed",
    );

    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).cause).toBe(initiating);
    expect((failure as WorkerQuiescenceError).quiescenceFailure).toBe(quiescence);
  });

  it("keeps one identity when the operation and cleanup expose the same failure", () => {
    const quiescence = new WorkerQuiescenceError("worker may still be running");

    expect(
      combineInitiatingAndCleanupFailure(
        quiescence,
        quiescence,
        "evaluation and cleanup both failed",
      ),
    ).toBe(quiescence);
  });

  it("keeps initiating quiescence above an ordinary cleanup fault", () => {
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const cleanup = new Error("later cleanup failed");
    const failure = combineInitiatingAndCleanupFailure(
      quiescence,
      cleanup,
      "evaluation and cleanup failed",
    );

    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    const retained = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(retained).toBeInstanceOf(AggregateError);
    expect((retained as AggregateError).errors).toEqual([quiescence, cleanup]);
  });

  it("normalizes hostile structural quiescence faults without reading unsafe fields", () => {
    const structural = Object.defineProperties(
      { code: "WORKER_QUIESCENCE_UNKNOWN" },
      {
        message: {
          get: () => {
            throw new Error("hostile message getter");
          },
        },
        cause: {
          get: () => {
            throw new Error("hostile cause getter");
          },
        },
      },
    );
    const failure = aggregateCleanupFailures(
      [new Error("ordinary cleanup failed"), structural],
      "cleanup failed",
    );

    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).message).toBe(
      "worker quiescence could not be established",
    );
  });

  it("retains all joined quiescence faults under the initiating cancellation", () => {
    const cancellation = { code: "external-stop" };
    const first = new WorkerQuiescenceError("first worker may still be running");
    const second = new WorkerQuiescenceError("second worker may still be running");
    const failure = selectWorkerQuiescenceFailure([first, second], cancellation);

    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).cause).toBe(cancellation);
    const aggregated = (failure as WorkerQuiescenceError).quiescenceFailure;
    expect(aggregated).toBeInstanceOf(WorkerQuiescenceError);
    const retained = (aggregated as WorkerQuiescenceError).quiescenceFailure;
    expect(retained).toBeInstanceOf(AggregateError);
    expect((retained as AggregateError).errors).toEqual([first, second]);
  });

  it("retains one identity when the same quiescence fault crosses two join paths", () => {
    const cancellation = { code: "external-stop" };
    const quiescence = new WorkerQuiescenceError("worker may still be running");
    const failure = selectWorkerQuiescenceFailure([quiescence, quiescence], cancellation);

    expect(failure).toBeInstanceOf(WorkerQuiescenceError);
    expect((failure as WorkerQuiescenceError).cause).toBe(cancellation);
    expect((failure as WorkerQuiescenceError).quiescenceFailure).toBe(quiescence);
  });
});
