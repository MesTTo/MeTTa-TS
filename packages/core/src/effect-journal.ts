// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

export const EFFECT_CLASSES = [
  "pure",
  "atomspace-read",
  "atomspace-write",
  "host-io",
  "time",
  "randomness",
  "suspension",
] as const;

export type EffectClass = (typeof EFFECT_CLASSES)[number];
export type EffectPhase = "pre" | "answer";
export type EffectCommitment = "reversible" | "captured" | "irrevocable";

export interface EffectEventId {
  readonly branch: string;
  readonly sequence: number;
}

export interface EffectRecord<P = unknown> {
  readonly id: EffectEventId;
  readonly class: EffectClass;
  readonly phase: EffectPhase;
  readonly operation: string;
  readonly commitment: EffectCommitment;
  readonly payload: P;
}

export type EffectRecordInput<P> = Omit<EffectRecord<P>, "id" | "commitment"> & {
  readonly commitment?: EffectCommitment;
};

interface EffectNode<P> {
  readonly record: EffectRecord<P>;
  readonly previous: EffectNode<P> | null;
  readonly depth: number;
}

export function defaultEffectCommitment(effectClass: EffectClass): EffectCommitment {
  switch (effectClass) {
    case "pure":
    case "atomspace-read":
      return "captured";
    case "atomspace-write":
      return "reversible";
    case "host-io":
      return "irrevocable";
    case "time":
    case "randomness":
    case "suspension":
      return "captured";
  }
}

export class NonAncestorEffectJournalError extends Error {
  constructor() {
    super("effect journal delta requires an ancestor prefix");
    this.name = "NonAncestorEffectJournalError";
  }
}

/**
 * An immutable append-only effect history.
 *
 * Forking shares the exact prefix. `since` walks only the child suffix, which
 * makes rollback O(1) and commit O(number of branch effects).
 */
export class EffectJournal<P = unknown> {
  readonly #tail: EffectNode<P> | null;
  readonly #nextSequence: number;

  private constructor(
    readonly branch: string,
    readonly depth: number,
    tail: EffectNode<P> | null,
    nextSequence: number,
  ) {
    this.#tail = tail;
    this.#nextSequence = nextSequence;
  }

  static root<P = unknown>(branch = "root"): EffectJournal<P> {
    if (branch.length === 0) throw new RangeError("effect branch id must not be empty");
    return new EffectJournal<P>(branch, 0, null, 0);
  }

  append(input: EffectRecordInput<P>): EffectJournal<P> {
    const record: EffectRecord<P> = Object.freeze({
      id: Object.freeze({ branch: this.branch, sequence: this.#nextSequence }),
      class: input.class,
      phase: input.phase,
      operation: input.operation,
      commitment: input.commitment ?? defaultEffectCommitment(input.class),
      payload: input.payload,
    });
    const node: EffectNode<P> = Object.freeze({
      record,
      previous: this.#tail,
      depth: this.depth + 1,
    });
    return new EffectJournal(this.branch, node.depth, node, this.#nextSequence + 1);
  }

  fork(branch: string): EffectJournal<P> {
    if (branch.length === 0) throw new RangeError("effect branch id must not be empty");
    return new EffectJournal(branch, this.depth, this.#tail, 0);
  }

  since(ancestor: EffectJournal<P>): readonly EffectRecord<P>[] {
    if (ancestor.depth > this.depth) throw new NonAncestorEffectJournalError();
    const suffix: EffectRecord<P>[] = [];
    let node = this.#tail;
    while (node !== null && node.depth > ancestor.depth) {
      suffix.push(node.record);
      node = node.previous;
    }
    if (node !== ancestor.#tail) throw new NonAncestorEffectJournalError();
    suffix.reverse();
    return Object.freeze(suffix);
  }

  commit(records: readonly EffectRecord<P>[]): EffectJournal<P> {
    let tail = this.#tail;
    let depth = this.depth;
    for (const record of records) {
      depth += 1;
      tail = Object.freeze({ record, previous: tail, depth });
    }
    return new EffectJournal(this.branch, depth, tail, this.#nextSequence);
  }

  toArray(): readonly EffectRecord<P>[] {
    const records = new Array<EffectRecord<P>>(this.depth);
    let node = this.#tail;
    for (let index = this.depth - 1; index >= 0; index -= 1) {
      if (node === null) throw new Error("effect journal depth does not match its ancestry");
      records[index] = node.record;
      node = node.previous;
    }
    return Object.freeze(records);
  }
}

export type EffectAuditEntry = Omit<EffectRecord<never>, "payload">;

interface EffectAuditRun {
  readonly branch: string;
  readonly firstSequence: number;
  count: number;
  readonly class: EffectClass;
  readonly phase: EffectPhase;
  readonly operation: string;
  readonly commitment: EffectCommitment;
  readonly previous: EffectAuditPosition | null;
}

interface EffectAuditPosition {
  readonly run: EffectAuditRun;
  readonly count: number;
}

/**
 * Persistent metadata history for effects whose payloads are already committed.
 *
 * Adjacent equal events are retained as one append-only run. Each audit snapshot stores
 * its visible length in that run, so extending the current tip does not change an older
 * snapshot. A divergent append starts a new run linked to the exact old position. Forking
 * is O(1), append is O(1), total run allocation and retained storage are O(number of
 * metadata runs), and `toArray` expands event boundaries only on explicit inspection.
 */
export class EffectAudit {
  readonly #tailRun: EffectAuditRun | null;
  readonly #tailCount: number;

  private constructor(
    readonly depth: number,
    readonly runs: number,
    tailRun: EffectAuditRun | null,
    tailCount: number,
  ) {
    this.#tailRun = tailRun;
    this.#tailCount = tailCount;
  }

  static empty(): EffectAudit {
    return new EffectAudit(0, 0, null, 0);
  }

  append(entry: EffectAuditEntry): EffectAudit {
    return this.appendFields(
      entry.id.branch,
      entry.id.sequence,
      entry.class,
      entry.phase,
      entry.operation,
      entry.commitment,
    );
  }

  appendFields(
    branch: string,
    sequence: number,
    effectClass: EffectClass,
    phase: EffectPhase,
    operation: string,
    commitment: EffectCommitment,
  ): EffectAudit {
    const tail = this.#tailRun;
    if (
      tail !== null &&
      this.#tailCount === tail.count &&
      tail.branch === branch &&
      tail.firstSequence + this.#tailCount === sequence &&
      tail.class === effectClass &&
      tail.phase === phase &&
      tail.operation === operation &&
      tail.commitment === commitment
    ) {
      tail.count += 1;
      return new EffectAudit(this.depth + 1, this.runs, tail, this.#tailCount + 1);
    }
    const previous = tail === null ? null : Object.freeze({ run: tail, count: this.#tailCount });
    const next: EffectAuditRun = {
      branch,
      firstSequence: sequence,
      count: 1,
      class: effectClass,
      phase,
      operation,
      commitment,
      previous,
    };
    return new EffectAudit(this.depth + 1, this.runs + 1, next, 1);
  }

  commit<P>(records: readonly EffectRecord<P>[]): EffectAudit {
    return records.reduce<EffectAudit>((audit, record) => audit.append(record), this);
  }

  toArray(): readonly EffectAuditEntry[] {
    const entries = new Array<EffectAuditEntry>(this.depth);
    let index = this.depth;
    let run = this.#tailRun;
    let count = this.#tailCount;
    while (run !== null) {
      index -= count;
      for (let offset = 0; offset < count; offset += 1) {
        entries[index + offset] = Object.freeze({
          id: Object.freeze({
            branch: run.branch,
            sequence: run.firstSequence + offset,
          }),
          class: run.class,
          phase: run.phase,
          operation: run.operation,
          commitment: run.commitment,
        });
      }
      const previous = run.previous;
      run = previous?.run ?? null;
      count = previous?.count ?? 0;
    }
    if (index !== 0) throw new Error("effect audit depth does not match its runs");
    return Object.freeze(entries);
  }
}
