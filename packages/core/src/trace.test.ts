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
    expect(worker.namespace).not.toBe(allocator.namespace);
    expect(() => allocator.fork("worker-1")).toThrow("already been allocated");
  });

  it("preserves the enumerable own namespace property", () => {
    const allocator = new RuntimeIdAllocator("session");

    expect(Object.keys(allocator)).toEqual(["namespace"]);
    expect(Object.hasOwn(allocator, "namespace")).toBe(true);
    expect(allocator.namespace).toBe("session");
    expect(allocator.rootNamespace).toBe("session");
  });

  it("reserves an unformatted sequence from the same kind stream", () => {
    const allocator = new RuntimeIdAllocator("session");

    expect(allocator.reserveSequence("branch")).toBe(0);
    expect(allocator.next("branch")).toBe("branch:session:1");
    expect(allocator.next("state")).toBe("state:session:0");
  });

  it("distinguishes a dotted lane from two nested lanes", () => {
    const direct = new RuntimeIdAllocator("session").fork("a.b").next("state");
    const nested = new RuntimeIdAllocator("session").fork("a").fork("b").next("state");
    const escapedLiteral = new RuntimeIdAllocator("session").fork("_x_612e62").next("state");

    expect(direct).not.toBe(nested);
    expect(direct).toBe("state:session._x_612e62:0");
    expect(escapedLiteral).not.toBe(direct);
  });

  it("supports generated descendant namespaces beyond the public component bound", () => {
    let allocator = new RuntimeIdAllocator("deep");
    for (let depth = 0; depth < 256; depth++) allocator = allocator.fork(`lane-${depth}`);

    const id = allocator.next("state");
    const parsed = parseRuntimeId(id);
    expect(parsed).toMatchObject({ kind: "state", sequence: 0 });
    expect(parsed!.namespace.length).toBeGreaterThan(128);
    expect(() => makeRuntimeId("state", parsed!.namespace, 0)).toThrow(
      "runtime ID namespace must be at most 128 characters",
    );
  });

  it("preserves the public 128-character bound and the permissive parser", () => {
    const maximum = "n".repeat(128);
    const tooLong = "n".repeat(129);

    expect(makeRuntimeId("state", maximum, 0)).toBe(`state:${maximum}:0`);
    expect(new RuntimeIdAllocator(maximum).namespace).toBe(maximum);
    expect(new RuntimeIdAllocator("root").fork(maximum).namespace).toBe(`root.${maximum}`);
    expect(() => makeRuntimeId("state", tooLong, 0)).toThrow(
      "runtime ID namespace must be at most 128 characters",
    );
    expect(() => new RuntimeIdAllocator(tooLong)).toThrow(
      "runtime ID namespace must be at most 128 characters",
    );
    expect(() => new RuntimeIdAllocator("root").fork(tooLong)).toThrow(
      "runtime ID namespace must be at most 128 characters",
    );
    expect(parseRuntimeId(`state:${tooLong}:0`)).toEqual({
      kind: "state",
      namespace: tooLong,
      sequence: 0,
    });
    expect(parseRuntimeId("state:~aa:0")).toBeUndefined();
    expect(() => makeRuntimeId("state", "bad:namespace", 0)).toThrow(
      "runtime ID namespace must contain only letters, digits, dot, underscore, or hyphen",
    );
  });

  it("clones allocation state for replay without sharing later mutations", () => {
    const allocator = new RuntimeIdAllocator("replay");
    expect(allocator.next("state")).toBe("state:replay:0");
    allocator.fork("reserved");
    const replay = allocator.clone();

    expect(replay.next("state")).toBe("state:replay:1");
    expect(allocator.next("state")).toBe("state:replay:1");
    expect(() => replay.fork("reserved")).toThrow("already been allocated");
    expect(() => allocator.fork("reserved")).toThrow("already been allocated");

    const replayLane = replay.fork("later").next("state");
    const sourceLane = allocator.fork("later").next("state");
    expect(replayLane).toBe(sourceLane);
  });

  it("restores the complete parent authority through nested replay snapshots", () => {
    const root = new RuntimeIdAllocator("authority");
    expect(root.reserveSequence("branch")).toBe(0);
    const first = root.fork("first");
    const nested = first.fork("nested");
    root.fork("second");

    const restored = first.parentAuthority()!;
    expect(restored.namespace).toBe("authority");
    expect(restored.next("branch")).toBe("branch:authority:1");
    expect(root.next("branch")).toBe("branch:authority:1");
    expect(() => restored.fork("first")).toThrow("already been allocated");
    expect(() => restored.fork("second")).toThrow("already been allocated");

    const nestedReplay = nested.clone();
    const nestedParent = nestedReplay.parentAuthority()!;
    expect(nestedParent.namespace).toBe(first.namespace);
    expect(nestedParent.parentAuthority()?.namespace).toBe(root.namespace);
    expect(root.parentAuthority()).toBeUndefined();
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

  it("serializes distinct lane paths injectively", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.array(fc.stringMatching(/^[A-Za-z0-9._-]{1,8}$/), { maxLength: 8 }), {
          minLength: 1,
          maxLength: 40,
          selector: (path) => JSON.stringify(path),
        }),
        (paths) => {
          const ids = paths.map((path) => {
            let allocator = new RuntimeIdAllocator("paths");
            for (const lane of path) allocator = allocator.fork(lane);
            return allocator.next("state");
          });
          expect(new Set(ids).size).toBe(ids.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
