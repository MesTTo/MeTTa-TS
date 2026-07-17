// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

export const WORKER_PROTOCOL_VERSION = 1;
export const DEFAULT_WORKER_RESULT_BYTES = 64 * 1024;
export const DEFAULT_WORKER_TIMEOUT_MS = 60_000;
export const MAX_WORKER_TIMEOUT_MS = 0x7fff_ffff;
const WORKER_RESULT_HEADER_BYTES = 8;
const WORKER_RESULT_ALIGNMENT = 4;
/** Deterministic allocation ceiling for one worker result pool. MDN recommends at most 1 GiB for a
 *  SharedArrayBuffer to reduce process-level out-of-memory risk. */
export const MAX_WORKER_SHARED_BYTES = 1024 * 1024 * 1024;
export const MAX_WORKER_RESULT_BYTES = MAX_WORKER_SHARED_BYTES - WORKER_RESULT_HEADER_BYTES;

export function checkedWorkerPositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0)
    throw new RangeError(`${name} must be a positive safe integer`);
  return selected;
}

/** Validate a delay without allowing Node or browser timers to wrap to an immediate timeout. */
export function checkedWorkerTimeout(value: number | undefined): number {
  const selected = checkedWorkerPositiveInteger(value, DEFAULT_WORKER_TIMEOUT_MS, "timeoutMs");
  if (selected > MAX_WORKER_TIMEOUT_MS)
    throw new RangeError(`timeoutMs must be at most ${MAX_WORKER_TIMEOUT_MS}`);
  return selected;
}

/** Validate a result limit that remains exactly representable in the shared Int32 wire header. */
export function checkedWorkerResultBytes(value: number | undefined): number {
  const selected = checkedWorkerPositiveInteger(
    value,
    DEFAULT_WORKER_RESULT_BYTES,
    "maxResultBytes",
  );
  if (selected > MAX_WORKER_RESULT_BYTES)
    throw new RangeError(`maxResultBytes must be at most ${MAX_WORKER_RESULT_BYTES}`);
  return selected;
}

export interface WorkerSharedBufferLayout {
  readonly regionBytes: number;
  readonly totalBytes: number;
}

/** Compute aligned worker result regions without allowing integer rounding or multiplication overflow. */
export function checkedWorkerSharedBufferLayout(
  maxWorkers: number,
  maxResultBytes: number,
): WorkerSharedBufferLayout {
  const workers = checkedWorkerPositiveInteger(maxWorkers, 1, "maxWorkers");
  const resultBytes = checkedWorkerResultBytes(maxResultBytes);
  const alignedResultBytes =
    Math.ceil(resultBytes / WORKER_RESULT_ALIGNMENT) * WORKER_RESULT_ALIGNMENT;
  const regionBytes = alignedResultBytes + WORKER_RESULT_HEADER_BYTES;
  if (!Number.isSafeInteger(alignedResultBytes) || !Number.isSafeInteger(regionBytes))
    throw new RangeError("maxResultBytes is too large for a worker result region");
  if (workers > Math.floor(MAX_WORKER_SHARED_BYTES / regionBytes))
    throw new RangeError(`worker result buffer size must be at most ${MAX_WORKER_SHARED_BYTES}`);
  const totalBytes = workers * regionBytes;
  if (!Number.isSafeInteger(totalBytes))
    throw new RangeError("worker result buffer size exceeds the safe integer range");
  return { regionBytes, totalBytes };
}

export interface WorkerBranchPayload {
  readonly results: readonly string[];
  readonly counterDelta: number;
}

function validCounterDelta(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Encode one pure branch result as versioned UTF-8 JSON. */
export function encodeWorkerBranchPayload(payload: WorkerBranchPayload): Uint8Array {
  if (!Array.isArray(payload.results) || !payload.results.every((item) => typeof item === "string"))
    throw new TypeError("worker results must be an array of strings");
  if (!validCounterDelta(payload.counterDelta))
    throw new RangeError("worker counterDelta must be a non-negative safe integer");
  return new TextEncoder().encode(
    JSON.stringify([WORKER_PROTOCOL_VERSION, payload.results, payload.counterDelta]),
  );
}

/** Decode and validate one versioned UTF-8 branch result. */
export function decodeWorkerBranchPayload(bytes: Uint8Array): WorkerBranchPayload | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!Array.isArray(parsed) || parsed.length !== 3) return undefined;
    const [version, results, counterDelta] = parsed;
    if (
      version !== WORKER_PROTOCOL_VERSION ||
      !Array.isArray(results) ||
      !results.every((item) => typeof item === "string") ||
      typeof counterDelta !== "number" ||
      !validCounterDelta(counterDelta)
    )
      return undefined;
    return { results: results.slice(), counterDelta };
  } catch {
    return undefined;
  }
}

/** A worker host violated the ownership or result-shape contract. Local replay is unsafe. */
export class WorkerProtocolError extends Error {
  readonly code = "WORKER_PROTOCOL_INVALID";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkerProtocolError";
  }
}

/** A worker could not be proven stopped, so replaying its task locally would overlap execution. */
export class WorkerQuiescenceError extends Error {
  readonly code = "WORKER_QUIESCENCE_UNKNOWN";
  readonly quiescenceFailure: unknown;

  constructor(message: string, options?: ErrorOptions & { readonly quiescenceFailure?: unknown }) {
    super(message, options);
    this.name = "WorkerQuiescenceError";
    this.quiescenceFailure = options?.quiescenceFailure;
  }
}

/** Preserve the operation that initiated shutdown when shutdown itself cannot prove worker quiescence. */
export function contextualizeWorkerQuiescenceError(
  failure: WorkerQuiescenceError,
  initiatingCause: unknown,
): WorkerQuiescenceError {
  let message = "worker quiescence could not be established";
  try {
    if (typeof failure.message === "string" && failure.message.length > 0)
      message = failure.message;
  } catch {
    // Cross-realm protocol faults may expose hostile accessors. The stable error code carries the contract.
  }
  return new WorkerQuiescenceError(message, {
    cause: initiatingCause,
    quiescenceFailure: failure,
  });
}

export function isWorkerQuiescenceError(error: unknown): error is WorkerQuiescenceError {
  if (error instanceof WorkerQuiescenceError) return true;
  if (typeof error !== "object" || error === null) return false;
  try {
    return (error as { readonly code?: unknown }).code === "WORKER_QUIESCENCE_UNKNOWN";
  } catch {
    return false;
  }
}
