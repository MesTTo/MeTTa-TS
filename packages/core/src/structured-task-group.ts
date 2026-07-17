// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { normalizeCancellationReason, type CancellationReason } from "./resources";
import { aggregateOperationFailures } from "./cleanup-fault";

const TASK_FAULT = Symbol("structured-task-fault");
const CLOSED_REASON: CancellationReason = Object.freeze({ code: "closed" });

interface TaskFault {
  readonly tag: typeof TASK_FAULT;
  readonly error: unknown;
}

export interface StructuredTaskGroupOptions<T> {
  readonly signal?: AbortSignal;
  readonly validate?: (result: unknown, index: number) => T;
  readonly selectCriticalFault?: (
    faults: readonly unknown[],
    cancellation: CancellationReason | undefined,
  ) => unknown | undefined;
}

export type StructuredTaskGroupResult<T> =
  | { readonly kind: "exhausted"; readonly results: readonly T[] }
  | { readonly kind: "cancelled"; readonly reason: CancellationReason }
  | { readonly kind: "fault"; readonly error: unknown };

function cancellationReason(signal: AbortSignal | undefined): CancellationReason | undefined {
  return signal?.aborted === true
    ? Object.freeze(normalizeCancellationReason(signal.reason))
    : undefined;
}

function isOwnedCancellation(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  if (Object.is(error, signal.reason)) return true;
  if (typeof error !== "object" || error === null) return false;
  try {
    const candidate = error as { readonly name?: unknown; readonly cause?: unknown };
    return candidate.name === "AbortError" && Object.is(candidate.cause, signal.reason);
  } catch {
    return false;
  }
}

/** Start indexed child work, cancel siblings on a fault, and join every started child before return. */
export async function runStructuredTaskGroup<I, T>(
  inputs: readonly I[],
  start: (input: I, index: number, signal: AbortSignal) => T | Promise<T>,
  options: StructuredTaskGroupOptions<T> = {},
): Promise<StructuredTaskGroupResult<T>> {
  const controller = new AbortController();
  let externalCancellation = cancellationReason(options.signal);
  const faults: unknown[] = [];
  const recordFault = (error: unknown): void => {
    if (isOwnedCancellation(error, controller.signal)) return;
    faults.push(error);
    if (!controller.signal.aborted) controller.abort({ code: "fault" });
  };
  const onAbort = (): void => {
    externalCancellation = cancellationReason(options.signal) ?? CLOSED_REASON;
    if (!controller.signal.aborted) controller.abort(externalCancellation);
  };
  if (externalCancellation !== undefined) controller.abort(externalCancellation);
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const tasks: Promise<T | TaskFault>[] = [];
    for (let index = 0; index < inputs.length; index++) {
      if (controller.signal.aborted) break;
      try {
        tasks.push(
          Promise.resolve(start(inputs[index]!, index, controller.signal)).then(
            (result) => {
              try {
                return options.validate === undefined ? result : options.validate(result, index);
              } catch (error) {
                recordFault(error);
                return { tag: TASK_FAULT, error };
              }
            },
            (error: unknown) => {
              recordFault(error);
              return { tag: TASK_FAULT, error };
            },
          ),
        );
      } catch (error) {
        recordFault(error);
        break;
      }
    }

    const settled = await Promise.all(tasks);
    if (faults.length > 0 && options.selectCriticalFault !== undefined) {
      let criticalFault: unknown;
      try {
        criticalFault = options.selectCriticalFault(faults, externalCancellation);
      } catch (error) {
        return { kind: "fault", error };
      }
      if (criticalFault !== undefined) return { kind: "fault", error: criticalFault };
    }
    if (externalCancellation !== undefined)
      return { kind: "cancelled", reason: externalCancellation };
    if (faults.length > 0)
      return {
        kind: "fault",
        error: aggregateOperationFailures(faults, "multiple structured tasks failed"),
      };
    return { kind: "exhausted", results: settled as readonly T[] };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}
