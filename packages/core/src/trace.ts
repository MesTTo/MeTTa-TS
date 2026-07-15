// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

export const RUNTIME_ID_KINDS = [
  "trace",
  "span",
  "event",
  "branch",
  "state",
  "scope",
  "space",
  "effect",
  "suspension",
] as const;

export type RuntimeIdKind = (typeof RUNTIME_ID_KINDS)[number];

declare const runtimeIdBrand: unique symbol;
export type RuntimeId<K extends RuntimeIdKind> = string & {
  readonly [runtimeIdBrand]: K;
};

export type TraceId = RuntimeId<"trace">;
export type SpanId = RuntimeId<"span">;
export type EventId = RuntimeId<"event">;
export type BranchId = RuntimeId<"branch">;
export type StateId = RuntimeId<"state">;
export type ScopeId = RuntimeId<"scope">;
export type SpaceId = RuntimeId<"space">;
export type EffectId = RuntimeId<"effect">;
export type SuspensionId = RuntimeId<"suspension">;

export interface ParsedRuntimeId<K extends RuntimeIdKind = RuntimeIdKind> {
  readonly kind: K;
  readonly namespace: string;
  readonly sequence: number;
}

const runtimeIdPattern = /^([a-z-]+):([^:]+):(0|[1-9][0-9]*)$/;
const namespacePattern = /^[A-Za-z0-9._-]+$/;

function isRuntimeIdKind(value: string): value is RuntimeIdKind {
  return (RUNTIME_ID_KINDS as readonly string[]).includes(value);
}

function assertNamespace(namespace: string): void {
  if (namespace.length > 128)
    throw new RangeError("runtime ID namespace must be at most 128 characters");
  if (!namespacePattern.test(namespace))
    throw new RangeError(
      "runtime ID namespace must contain only letters, digits, dot, underscore, or hyphen",
    );
}

export function makeRuntimeId<K extends RuntimeIdKind>(
  kind: K,
  namespace: string,
  sequence: number,
): RuntimeId<K> {
  assertNamespace(namespace);
  if (!Number.isSafeInteger(sequence) || sequence < 0)
    throw new RangeError("runtime ID sequence must be a non-negative safe integer");
  return `${kind}:${namespace}:${sequence}` as RuntimeId<K>;
}

export function parseRuntimeId(value: string): ParsedRuntimeId | undefined {
  const match = runtimeIdPattern.exec(value);
  if (match === null) return undefined;
  const kind = match[1]!;
  const namespace = match[2]!;
  if (!isRuntimeIdKind(kind) || !namespacePattern.test(namespace)) return undefined;
  const sequence = Number(match[3]!);
  if (!Number.isSafeInteger(sequence)) return undefined;
  return { kind, namespace, sequence };
}

export function isRuntimeId<K extends RuntimeIdKind>(
  value: unknown,
  kind: K,
): value is RuntimeId<K> {
  if (typeof value !== "string") return false;
  return parseRuntimeId(value)?.kind === kind;
}

/** Allocates disjoint identifier streams inside one serializable namespace. */
export class RuntimeIdAllocator {
  readonly #next = new Map<RuntimeIdKind, number>();
  readonly #forkedLanes = new Set<string>();

  constructor(readonly namespace: string) {
    assertNamespace(namespace);
  }

  next<K extends RuntimeIdKind>(kind: K): RuntimeId<K> {
    const sequence = this.#next.get(kind) ?? 0;
    if (sequence === Number.MAX_SAFE_INTEGER)
      throw new RangeError(`runtime ID stream '${kind}' is exhausted`);
    this.#next.set(kind, sequence + 1);
    return makeRuntimeId(kind, this.namespace, sequence);
  }

  /**
   * Create a worker or branch lane whose IDs cannot collide with this allocator.
   * Reusing a lane on the same allocator is rejected because it would duplicate IDs.
   */
  fork(lane: string): RuntimeIdAllocator {
    assertNamespace(lane);
    if (this.#forkedLanes.has(lane))
      throw new Error(`runtime ID lane '${lane}' has already been allocated`);
    this.#forkedLanes.add(lane);
    return new RuntimeIdAllocator(`${this.namespace}.${lane}`);
  }
}

export interface TraceContext {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly branchId: BranchId;
  readonly stateId: StateId;
  readonly parentSpanId?: SpanId;
}

export function rootTraceContext(allocator: RuntimeIdAllocator): TraceContext {
  return {
    traceId: allocator.next("trace"),
    spanId: allocator.next("span"),
    branchId: allocator.next("branch"),
    stateId: allocator.next("state"),
  };
}

export function childTraceContext(
  allocator: RuntimeIdAllocator,
  parent: TraceContext,
): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: allocator.next("span"),
    parentSpanId: parent.spanId,
    branchId: allocator.next("branch"),
    stateId: allocator.next("state"),
  };
}

export function nextStateTraceContext(
  allocator: RuntimeIdAllocator,
  context: TraceContext,
): TraceContext {
  return { ...context, stateId: allocator.next("state") };
}

export const TRACE_EVENT_KINDS = [
  "branch-created",
  "step-started",
  "step-completed",
  "answer",
  "effect",
  "suspended",
  "resumed",
  "fault",
  "cancelled",
  "branch-closed",
] as const;

export type TraceEventKind = (typeof TRACE_EVENT_KINDS)[number];
export type TraceAttribute = string | number | boolean | null;
export type TraceAttributes = Readonly<Record<string, TraceAttribute>>;

export interface TraceEventInput {
  readonly kind: TraceEventKind;
  readonly context: TraceContext;
  readonly opcode?: string;
  readonly attributes?: TraceAttributes;
}

export interface TraceEvent extends TraceContext {
  readonly eventId: EventId;
  readonly sequence: number;
  readonly kind: TraceEventKind;
  readonly timestampMs?: number;
  readonly opcode?: string;
  readonly attributes?: TraceAttributes;
}

export type TraceRecordResult =
  | { readonly kind: "recorded"; readonly event: TraceEvent }
  | { readonly kind: "dropped"; readonly reason: "event-limit" | "byte-limit" }
  | { readonly kind: "ignored" };

export interface TraceSink {
  record(input: TraceEventInput): TraceRecordResult;
}

export interface TraceRecorderOptions {
  readonly maxEvents?: number;
  readonly maxBytes?: number;
  readonly clock?: () => number;
}

function assertOptionalLimit(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
    throw new RangeError(`${label} must be a non-negative safe integer`);
}

function estimateEventBytes(input: TraceEventInput): number {
  let bytes = 96 + input.kind.length * 2;
  if (input.opcode !== undefined) bytes += input.opcode.length * 2;
  if (input.attributes !== undefined) {
    for (const [key, value] of Object.entries(input.attributes)) {
      bytes += key.length * 2 + 8;
      if (typeof value === "string") bytes += value.length * 2;
    }
  }
  return bytes;
}

/** A bounded in-memory trace sink. Recording does not format or execute atoms. */
export class TraceRecorder implements TraceSink {
  readonly #events: TraceEvent[] = [];
  readonly #maxEvents: number | undefined;
  readonly #maxBytes: number | undefined;
  readonly #clock: (() => number) | undefined;
  #bytes = 0;

  constructor(
    readonly allocator: RuntimeIdAllocator,
    options: TraceRecorderOptions = {},
  ) {
    assertOptionalLimit(options.maxEvents, "trace event limit");
    assertOptionalLimit(options.maxBytes, "trace byte limit");
    this.#maxEvents = options.maxEvents;
    this.#maxBytes = options.maxBytes;
    this.#clock = options.clock;
  }

  record(input: TraceEventInput): TraceRecordResult {
    if (this.#maxEvents !== undefined && this.#events.length >= this.#maxEvents)
      return { kind: "dropped", reason: "event-limit" };
    const bytes = estimateEventBytes(input);
    if (this.#maxBytes !== undefined && bytes > this.#maxBytes - this.#bytes)
      return { kind: "dropped", reason: "byte-limit" };

    const timestampMs = this.#clock?.();
    if (timestampMs !== undefined && !Number.isFinite(timestampMs))
      throw new RangeError("trace clock must return a finite number");
    const event: TraceEvent = {
      ...input.context,
      eventId: this.allocator.next("event"),
      sequence: this.#events.length,
      kind: input.kind,
      ...(timestampMs === undefined ? {} : { timestampMs }),
      ...(input.opcode === undefined ? {} : { opcode: input.opcode }),
      ...(input.attributes === undefined ? {} : { attributes: { ...input.attributes } }),
    };
    this.#events.push(event);
    this.#bytes += bytes;
    return { kind: "recorded", event };
  }

  snapshot(): readonly TraceEvent[] {
    return this.#events.map((event) => ({
      ...event,
      ...(event.attributes === undefined ? {} : { attributes: { ...event.attributes } }),
    }));
  }

  get estimatedBytes(): number {
    return this.#bytes;
  }
}

export const NO_TRACE_SINK: TraceSink = {
  record: () => ({ kind: "ignored" }),
};
