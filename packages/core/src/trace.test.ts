// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  NO_TRACE_SINK,
  RuntimeIdAllocator,
  TraceRecorder,
  childTraceContext,
  isRuntimeId,
  makeRuntimeId,
  nextStateTraceContext,
  parseRuntimeId,
  rootTraceContext,
} from "./trace";

describe("evaluation trace identity", () => {
  it("round-trips serializable branded IDs", () => {
    const id = makeRuntimeId("branch", "run.worker-2", 42);
    expect(parseRuntimeId(id)).toEqual({ kind: "branch", namespace: "run.worker-2", sequence: 42 });
    expect(isRuntimeId(id, "branch")).toBe(true);
    expect(isRuntimeId(id, "state")).toBe(false);
    expect(parseRuntimeId("branch:bad:01")).toBeUndefined();
  });

  it("allocates disjoint kinds and child lanes", () => {
    const allocator = new RuntimeIdAllocator("session");
    expect(allocator.next("branch")).toBe("branch:session:0");
    expect(allocator.next("state")).toBe("state:session:0");
    expect(allocator.next("branch")).toBe("branch:session:1");
    const worker = allocator.fork("worker-1");
    expect(worker.next("branch")).toBe("branch:session.worker-1:0");
    expect(() => allocator.fork("worker-1")).toThrow("already been allocated");
  });

  it("retains trace ancestry while allocating branch and state identities", () => {
    const allocator = new RuntimeIdAllocator("run");
    const root = rootTraceContext(allocator);
    const child = childTraceContext(allocator, root);
    const next = nextStateTraceContext(allocator, child);
    expect(child.traceId).toBe(root.traceId);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.branchId).not.toBe(root.branchId);
    expect(next.branchId).toBe(child.branchId);
    expect(next.stateId).not.toBe(child.stateId);
  });

  it("records monotonic bounded events without a clock by default", () => {
    const allocator = new RuntimeIdAllocator("run");
    const context = rootTraceContext(allocator);
    const recorder = new TraceRecorder(allocator, { maxEvents: 2 });
    const first = recorder.record({ kind: "step-started", context, opcode: "eval" });
    const second = recorder.record({ kind: "answer", context, attributes: { count: 1 } });
    const dropped = recorder.record({ kind: "branch-closed", context });
    expect(first).toMatchObject({ kind: "recorded", event: { sequence: 0 } });
    expect(second).toMatchObject({ kind: "recorded", event: { sequence: 1 } });
    expect(dropped).toEqual({ kind: "dropped", reason: "event-limit" });
    expect(recorder.snapshot()).toHaveLength(2);
    expect(recorder.snapshot()[0]).not.toHaveProperty("timestampMs");
  });

  it("distinguishes disabled tracing from a full trace buffer", () => {
    const allocator = new RuntimeIdAllocator("disabled");
    expect(NO_TRACE_SINK.record({ kind: "answer", context: rootTraceContext(allocator) })).toEqual({
      kind: "ignored",
    });
  });

  it("enforces a byte bound before allocating the event", () => {
    const allocator = new RuntimeIdAllocator("run");
    const context = rootTraceContext(allocator);
    const recorder = new TraceRecorder(allocator, { maxBytes: 1 });
    expect(recorder.record({ kind: "answer", context })).toEqual({
      kind: "dropped",
      reason: "byte-limit",
    });
    expect(recorder.snapshot()).toEqual([]);
    expect(allocator.next("event")).toBe("event:run:0");
  });

  it("never repeats a generated identifier", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (count) => {
        const allocator = new RuntimeIdAllocator("property");
        const ids = Array.from({ length: count }, () => allocator.next("state"));
        return new Set(ids).size === ids.length;
      }),
      { numRuns: 100 },
    );
  });
});
