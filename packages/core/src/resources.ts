// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

/** Resources that an evaluation can account for independently. */
export const RESOURCE_KINDS = [
  "steps",
  "stack-depth",
  "branches",
  "results",
  "atom-cells",
  "bytes",
  "table-cells",
  "worker-tasks",
  "wall-time-ms",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type ResourceLimits = Partial<Readonly<Record<ResourceKind, number>>>;
export type ResourceUsage = Readonly<Record<ResourceKind, number>>;

export interface ResourcePolicy {
  readonly limits?: ResourceLimits;
  /** Millisecond origin used by `checkTime`. Defaults to `Date.now()`. */
  readonly startedAtMs?: number;
}

/** A failed resource debit. The ledger is not changed when this value is returned. */
export interface ResourceLimitFault {
  readonly kind: "resource-limit";
  readonly resource: ResourceKind;
  readonly limit: number;
  readonly consumed: number;
  readonly requested: number;
  readonly operation?: string;
}

export interface ResourceSnapshot {
  readonly limits: ResourceLimits;
  readonly used: ResourceUsage;
  readonly startedAtMs: number;
}

export interface CancellationReason {
  readonly code: string;
  readonly message?: string;
}

export interface CancellationRecord {
  readonly kind: "cancelled";
  readonly reason: CancellationReason;
  readonly operation?: string;
}

const emptyUsage = (): Record<ResourceKind, number> => ({
  steps: 0,
  "stack-depth": 0,
  branches: 0,
  results: 0,
  "atom-cells": 0,
  bytes: 0,
  "table-cells": 0,
  "worker-tasks": 0,
  "wall-time-ms": 0,
});

function validAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertAmount(value: number, label: string): void {
  if (!validAmount(value)) throw new RangeError(`${label} must be a non-negative safe integer`);
}

function copyLimits(limits: ResourceLimits): ResourceLimits {
  const out: Partial<Record<ResourceKind, number>> = {};
  for (const kind of RESOURCE_KINDS) {
    const limit = limits[kind];
    if (limit === undefined) continue;
    assertAmount(limit, `${kind} limit`);
    out[kind] = limit;
  }
  return out;
}

function limitFault(
  resource: ResourceKind,
  limit: number,
  consumed: number,
  requested: number,
  operation?: string,
): ResourceLimitFault {
  return {
    kind: "resource-limit",
    resource,
    limit,
    consumed,
    requested,
    ...(operation === undefined ? {} : { operation }),
  };
}

/**
 * One aggregate counter set shared by nested evaluations and leases.
 *
 * A multi-resource debit is atomic. If one limit would be crossed, none of the
 * counters advance. Leases share the same ledger instead of copying a budget.
 */
export class ResourceLedger {
  readonly #limits: ResourceLimits;
  readonly #used = emptyUsage();
  readonly #startedAtMs: number;

  constructor(policy: ResourcePolicy = {}) {
    this.#limits = copyLimits(policy.limits ?? {});
    const startedAtMs = policy.startedAtMs ?? Date.now();
    assertAmount(startedAtMs, "resource clock origin");
    this.#startedAtMs = startedAtMs;
  }

  tryConsume(
    resource: ResourceKind,
    amount = 1,
    operation?: string,
  ): ResourceLimitFault | undefined {
    return this.tryConsumeMany({ [resource]: amount }, operation);
  }

  tryConsumeMany(amounts: ResourceLimits, operation?: string): ResourceLimitFault | undefined {
    const checked: Array<readonly [ResourceKind, number]> = [];
    for (const resource of RESOURCE_KINDS) {
      const requested = amounts[resource];
      if (requested === undefined) continue;
      assertAmount(requested, `${resource} debit`);
      const consumed = this.#used[resource];
      const limit = this.#limits[resource];
      if (limit !== undefined && requested > limit - consumed)
        return limitFault(resource, limit, consumed, requested, operation);
      checked.push([resource, requested]);
    }
    for (const [resource, requested] of checked) this.#used[resource] += requested;
    return undefined;
  }

  /** Account elapsed wall time without double-counting prior checks. */
  checkTime(nowMs = Date.now(), operation?: string): ResourceLimitFault | undefined {
    assertAmount(nowMs, "resource clock reading");
    const elapsed = Math.max(0, nowMs - this.#startedAtMs);
    const alreadyObserved = this.#used["wall-time-ms"];
    if (elapsed <= alreadyObserved) return undefined;
    return this.tryConsume("wall-time-ms", elapsed - alreadyObserved, operation);
  }

  used(resource: ResourceKind): number {
    return this.#used[resource];
  }

  limit(resource: ResourceKind): number | undefined {
    return this.#limits[resource];
  }

  snapshot(): ResourceSnapshot {
    return {
      limits: copyLimits(this.#limits),
      used: { ...this.#used },
      startedAtMs: this.#startedAtMs,
    };
  }

  lease(label: string): ResourceLease {
    return new ResourceLease(this, label);
  }
}

/** A closeable view of a shared resource ledger. */
export class ResourceLease {
  #closed = false;

  constructor(
    readonly ledger: ResourceLedger,
    readonly label: string,
  ) {
    if (label.length === 0) throw new RangeError("resource lease label must not be empty");
  }

  get closed(): boolean {
    return this.#closed;
  }

  tryConsume(
    resource: ResourceKind,
    amount = 1,
    operation?: string,
  ): ResourceLimitFault | undefined {
    this.#assertOpen();
    return this.ledger.tryConsume(resource, amount, operation ?? this.label);
  }

  tryConsumeMany(amounts: ResourceLimits, operation?: string): ResourceLimitFault | undefined {
    this.#assertOpen();
    return this.ledger.tryConsumeMany(amounts, operation ?? this.label);
  }

  checkTime(nowMs = Date.now(), operation?: string): ResourceLimitFault | undefined {
    this.#assertOpen();
    return this.ledger.checkTime(nowMs, operation ?? this.label);
  }

  fork(label: string): ResourceLease {
    this.#assertOpen();
    if (label.length === 0) throw new RangeError("resource lease label must not be empty");
    return new ResourceLease(this.ledger, `${this.label}/${label}`);
  }

  close(): void {
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`resource lease '${this.label}' is closed`);
  }
}

/** Convert an arbitrary abort reason into a serializable record. */
export function normalizeCancellationReason(reason: unknown): CancellationReason {
  try {
    if (typeof reason === "string") return { code: "aborted", message: reason };
    if (reason instanceof Error)
      return {
        code: reason.name.length === 0 ? "aborted" : reason.name,
        ...(reason.message.length === 0 ? {} : { message: reason.message }),
      };
    if (typeof reason === "object" && reason !== null) {
      const candidate = reason as { readonly code?: unknown; readonly message?: unknown };
      if (typeof candidate.code === "string" && candidate.code.length !== 0)
        return {
          code: candidate.code,
          ...(typeof candidate.message === "string" ? { message: candidate.message } : {}),
        };
    }
  } catch {
    // Host objects may be proxies or expose throwing accessors. They are never retained.
  }
  return { code: "aborted" };
}

/** Return a typed cancellation only after the signal has been aborted. */
export function cancellationFromSignal(
  signal: AbortSignal | undefined,
  operation?: string,
): CancellationRecord | undefined {
  if (signal?.aborted !== true) return undefined;
  return {
    kind: "cancelled",
    reason: normalizeCancellationReason(signal.reason),
    ...(operation === undefined ? {} : { operation }),
  };
}

/** Difference between two snapshots, for reporting worker or branch consumption. */
export function resourceUsageDelta(
  before: ResourceSnapshot,
  after: ResourceSnapshot,
): ResourceUsage {
  const delta = emptyUsage();
  for (const kind of RESOURCE_KINDS) {
    const amount = after.used[kind] - before.used[kind];
    if (amount < 0) throw new RangeError(`resource usage for '${kind}' moved backwards`);
    delta[kind] = amount;
  }
  return delta;
}
