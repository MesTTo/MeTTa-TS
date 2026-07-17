// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  checkedWorkerPositiveInteger,
  checkedWorkerResultBytes,
  checkedWorkerSharedBufferLayout,
  checkedWorkerTimeout,
  contextualizeWorkerQuiescenceError,
  DEFAULT_WORKER_RESULT_BYTES,
  decodeWorkerBranchPayload,
  encodeWorkerBranchPayload,
  isWorkerQuiescenceError,
  MAX_WORKER_RESULT_BYTES,
  MAX_WORKER_SHARED_BYTES,
  MAX_WORKER_TIMEOUT_MS,
  WorkerQuiescenceError,
} from "./worker-protocol";

describe("worker branch protocol", () => {
  it("round-trips generated Unicode results and counters", () => {
    fc.assert(
      fc.property(
        fc.array(fc.fullUnicodeString(), { maxLength: 20 }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (results, counterDelta) => {
          const encoded = encodeWorkerBranchPayload({ results, counterDelta });
          expect(decodeWorkerBranchPayload(encoded)).toEqual({ results, counterDelta });
        },
      ),
      { numRuns: 250 },
    );
  });

  it("round-trips exact UTF-8 edge cases", () => {
    const results = ["café", "😀", '"quoted"', "back\\slash", "line\nbreak", "é", "\u0000"];
    const encoded = encodeWorkerBranchPayload({ results, counterDelta: 17 });

    expect(decodeWorkerBranchPayload(encoded)).toEqual({ results, counterDelta: 17 });
    expect(encoded.byteLength).toBeGreaterThan(JSON.stringify([1, results, 17]).length);
  });

  it.each([
    new Uint8Array(),
    new TextEncoder().encode("not-json"),
    new TextEncoder().encode("[2,[],0]"),
    new TextEncoder().encode('[1,["ok"],-1]'),
    new Uint8Array([0xff]),
  ])("rejects malformed payloads", (bytes) => {
    expect(decodeWorkerBranchPayload(bytes)).toBeUndefined();
  });

  it("brands unknown worker quiescence across package boundaries", () => {
    expect(isWorkerQuiescenceError(new WorkerQuiescenceError("worker did not stop"))).toBe(true);
    expect(isWorkerQuiescenceError({ code: "WORKER_QUIESCENCE_UNKNOWN" })).toBe(true);
    expect(isWorkerQuiescenceError(new Error("ordinary worker failure"))).toBe(false);
  });

  it("validates positive worker bounds and the platform timer ceiling", () => {
    expect(checkedWorkerPositiveInteger(undefined, 7, "maxWorkers")).toBe(7);
    expect(checkedWorkerPositiveInteger(3, 7, "maxWorkers")).toBe(3);
    expect(() => checkedWorkerPositiveInteger(0, 7, "maxWorkers")).toThrow(RangeError);
    expect(checkedWorkerTimeout(MAX_WORKER_TIMEOUT_MS)).toBe(MAX_WORKER_TIMEOUT_MS);
    expect(() => checkedWorkerTimeout(MAX_WORKER_TIMEOUT_MS + 1)).toThrow(RangeError);
    expect(checkedWorkerResultBytes(MAX_WORKER_RESULT_BYTES)).toBe(MAX_WORKER_RESULT_BYTES);
    expect(() => checkedWorkerResultBytes(MAX_WORKER_RESULT_BYTES + 1)).toThrow(RangeError);
  });

  it("computes aligned shared-buffer regions without unsafe arithmetic", () => {
    expect(checkedWorkerSharedBufferLayout(3, 5)).toEqual({
      regionBytes: 16,
      totalBytes: 48,
    });
    expect(() => checkedWorkerSharedBufferLayout(1, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => checkedWorkerSharedBufferLayout(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });

  it("admits exact aggregate result-buffer boundaries before allocation", () => {
    expect(checkedWorkerSharedBufferLayout(16, DEFAULT_WORKER_RESULT_BYTES)).toEqual({
      regionBytes: 65_544,
      totalBytes: 1_048_704,
    });
    expect(checkedWorkerSharedBufferLayout(16, 67_108_856)).toEqual({
      regionBytes: 67_108_864,
      totalBytes: MAX_WORKER_SHARED_BYTES,
    });
    expect(() => checkedWorkerSharedBufferLayout(16, 67_108_857)).toThrow(RangeError);
    expect(checkedWorkerSharedBufferLayout(1, MAX_WORKER_RESULT_BYTES)).toEqual({
      regionBytes: MAX_WORKER_SHARED_BYTES,
      totalBytes: MAX_WORKER_SHARED_BYTES,
    });
    expect(() => checkedWorkerSharedBufferLayout(2, MAX_WORKER_RESULT_BYTES)).toThrow(RangeError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 2_147_483_648, Number.MAX_SAFE_INTEGER])(
    "rejects an unsafe worker timeout %s",
    (timeout) => {
      expect(() => checkedWorkerTimeout(timeout)).toThrow(RangeError);
    },
  );

  it("retains the initiating failure when worker shutdown loses quiescence", () => {
    const termination = new Error("termination failed");
    const cancellation = new Error("cancel evaluation");
    const original = new WorkerQuiescenceError("worker may still be live", { cause: termination });
    const contextual = contextualizeWorkerQuiescenceError(original, cancellation);

    expect(contextual.cause).toBe(cancellation);
    expect(contextual.quiescenceFailure).toBe(original);
    expect((contextual.quiescenceFailure as Error).cause).toBe(termination);
  });
});
