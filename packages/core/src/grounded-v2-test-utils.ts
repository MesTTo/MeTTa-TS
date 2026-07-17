// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Shared scripted-cursor test doubles for the Grounded V2 protocol suites: hand-written cursors
// that record every pull and close so ownership and validation laws can count them exactly.

import type {
  GroundedAnswer,
  GroundedAsyncAnswerCursor,
  GroundedSyncAnswerCursor,
} from "./grounded-v2";
import type { SearchEvent, SearchNextOptions } from "./search-cursor";
import type { CancellationReason } from "./resources";
import type { Atom } from "./atom";

export type ScriptedSyncEntry =
  | SearchEvent<GroundedAnswer, void>
  | ((options: SearchNextOptions) => SearchEvent<GroundedAnswer, void>)
  | { readonly raise: unknown };

/** A hand-written cursor that records every pull and close so ownership laws can count them. */
export class ScriptedSyncCursor implements GroundedSyncAnswerCursor {
  readonly mode = "sync" as const;
  readonly pullOptions: SearchNextOptions[] = [];
  readonly closeReasons: CancellationReason[] = [];
  /** Pull count observed at the first close; -1 while never closed. */
  pullsAtClose = -1;
  #index = 0;
  #closed = false;

  constructor(
    private readonly script: readonly ScriptedSyncEntry[],
    private readonly closeError?: Error,
  ) {}

  get closed(): boolean {
    return this.#closed;
  }

  get pulls(): number {
    return this.pullOptions.length;
  }

  get closeCalls(): number {
    return this.closeReasons.length;
  }

  next(options: SearchNextOptions = {}): SearchEvent<GroundedAnswer, void> {
    this.pullOptions.push(options);
    const entry = this.script[Math.min(this.#index, this.script.length - 1)]!;
    this.#index += 1;
    if (typeof entry === "function") return entry(options);
    if ("raise" in entry) throw entry.raise;
    return entry;
  }

  close(reason: CancellationReason = { code: "closed" }): void {
    if (this.pullsAtClose < 0) this.pullsAtClose = this.pullOptions.length;
    this.closeReasons.push(reason);
    this.#closed = true;
    if (this.closeError !== undefined) throw this.closeError;
  }
}

export class ScriptedAsyncCursor implements GroundedAsyncAnswerCursor {
  readonly mode = "async" as const;
  readonly pullOptions: SearchNextOptions[] = [];
  readonly closeReasons: CancellationReason[] = [];
  closeSettled = false;
  /** Pull count observed at the first close; -1 while never closed. */
  pullsAtClose = -1;
  #index = 0;
  #closed = false;

  constructor(
    private readonly script: readonly ScriptedSyncEntry[],
    private readonly closeError?: Error,
  ) {}

  get closed(): boolean {
    return this.#closed;
  }

  get pulls(): number {
    return this.pullOptions.length;
  }

  get closeCalls(): number {
    return this.closeReasons.length;
  }

  next(options: SearchNextOptions = {}): Promise<SearchEvent<GroundedAnswer, void>> {
    this.pullOptions.push(options);
    const entry = this.script[Math.min(this.#index, this.script.length - 1)]!;
    this.#index += 1;
    if (typeof entry === "function") return Promise.resolve(entry(options));
    if ("raise" in entry) return Promise.reject(entry.raise);
    return Promise.resolve(entry);
  }

  close(reason: CancellationReason = { code: "closed" }): Promise<void> {
    if (this.pullsAtClose < 0) this.pullsAtClose = this.pullOptions.length;
    this.closeReasons.push(reason);
    this.#closed = true;
    const closeError = this.closeError;
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        this.closeSettled = true;
        if (closeError !== undefined) reject(closeError);
        else resolve();
      });
    });
  }
}

export const answerEvent = (value: Atom, steps = 1): SearchEvent<GroundedAnswer, void> => ({
  kind: "answer",
  value: { atom: value },
  steps,
});

export const exhaustedEvent: SearchEvent<GroundedAnswer, void> = {
  kind: "exhausted",
  terminal: undefined,
  steps: 1,
};
