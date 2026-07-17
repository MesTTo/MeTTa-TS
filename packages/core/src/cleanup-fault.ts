// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  contextualizeWorkerQuiescenceError,
  isWorkerQuiescenceError,
  WorkerQuiescenceError,
} from "./worker-protocol";

const cleanupAggregates = new WeakSet<AggregateError>();

function cleanupAggregate(errors: readonly unknown[], message: string): AggregateError {
  const aggregate = new AggregateError(errors, message);
  cleanupAggregates.add(aggregate);
  return aggregate;
}

/** Expand only aggregates created by this cleanup combiner. A user-thrown AggregateError remains one
 *  failure, so its identity and error payload are not reinterpreted. */
export function cleanupFailureLeaves(error: unknown): unknown[] {
  if (!(error instanceof AggregateError) || !cleanupAggregates.has(error)) return [error];
  return error.errors.flatMap(cleanupFailureLeaves);
}

function quiescenceMessage(failure: WorkerQuiescenceError): string {
  try {
    return typeof failure.message === "string" && failure.message.length > 0
      ? failure.message
      : "worker quiescence could not be established";
  } catch {
    return "worker quiescence could not be established";
  }
}

function quiescenceCause(failure: WorkerQuiescenceError): unknown {
  try {
    return failure.cause;
  } catch {
    return undefined;
  }
}

/** Combine cleanup failures without discarding later failures. Unknown worker quiescence is promoted
 *  because no caller may continue while owned worker work could still be running. */
export function aggregateCleanupFailures(failures: readonly unknown[], message: string): unknown {
  if (failures.length === 0)
    throw new RangeError("aggregateCleanupFailures requires at least one failure");
  const quiescence = failures.find(isWorkerQuiescenceError);
  if (quiescence === undefined)
    return failures.length === 1 ? failures[0] : cleanupAggregate(failures, message);
  if (failures.length === 1) return quiescence;
  return new WorkerQuiescenceError(quiescenceMessage(quiescence), {
    cause: quiescenceCause(quiescence),
    quiescenceFailure: cleanupAggregate(failures, message),
  });
}

/** Retain every operation failure in observation order and identify the first as the cause. */
export function aggregateOperationFailures(failures: readonly unknown[], message: string): unknown {
  if (failures.length === 0)
    throw new RangeError("aggregateOperationFailures requires at least one failure");
  if (failures.length === 1) return failures[0];
  return new AggregateError(failures, message, { cause: failures[0] });
}

/** Retain the operation or cancellation that initiated cleanup together with cleanup failure. */
export function combineInitiatingAndCleanupFailure(
  initiatingFailure: unknown,
  cleanupFailure: unknown,
  message: string,
): unknown {
  if (Object.is(initiatingFailure, cleanupFailure)) return initiatingFailure;
  if (isWorkerQuiescenceError(cleanupFailure))
    return contextualizeWorkerQuiescenceError(cleanupFailure, initiatingFailure);
  if (isWorkerQuiescenceError(initiatingFailure))
    return new WorkerQuiescenceError(quiescenceMessage(initiatingFailure), {
      cause: quiescenceCause(initiatingFailure),
      quiescenceFailure: cleanupAggregate([initiatingFailure, cleanupFailure], message),
    });
  return cleanupAggregate([initiatingFailure, cleanupFailure], message);
}

/** Select and aggregate every quiescence failure from joined work. An ordinary sibling fault or external
 *  cancellation remains attached as the event that initiated cleanup. */
export function selectWorkerQuiescenceFailure(
  failures: readonly unknown[],
  initiatingFailure?: unknown,
): unknown | undefined {
  const distinctFailures: unknown[] = [];
  for (const failure of failures)
    if (!distinctFailures.some((candidate) => Object.is(candidate, failure)))
      distinctFailures.push(failure);
  const quiescenceFailures = distinctFailures.filter(isWorkerQuiescenceError);
  if (quiescenceFailures.length === 0) return undefined;
  const initiating =
    initiatingFailure ?? distinctFailures.find((failure) => !isWorkerQuiescenceError(failure));
  let removedInitiating = false;
  const retained = distinctFailures.filter((failure) => {
    if (initiating !== undefined && !removedInitiating && Object.is(failure, initiating)) {
      removedInitiating = true;
      return false;
    }
    return true;
  });
  if (initiating !== undefined && retained.length === 0) return initiating;
  const cleanupFailure = aggregateCleanupFailures(
    initiating === undefined ? distinctFailures : retained,
    "multiple worker cleanups lost quiescence",
  );
  return initiating === undefined
    ? cleanupFailure
    : combineInitiatingAndCleanupFailure(
        initiating,
        cleanupFailure,
        "operation and worker cleanup both failed",
      );
}
