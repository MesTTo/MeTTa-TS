// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT

// An LSP-structural diagnostic model with rustc-style suggestions. Fields mirror
// vscode-languageserver's Diagnostic so a server can consume these directly; core keeps
// ranges source-relative (no URI) and the server attaches the URI when it has one.

/** 0-based line and UTF-16 character offset, matching the LSP Position. MeTTa source offsets are
 *  JS string indices, which are already UTF-16 code units, so the mapping is direct. */
export interface Position {
  readonly line: number;
  readonly character: number;
}
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

/** rustc's confidence tiers for a suggested fix. Phase 1 records the tier; applying the fix is later work. */
export enum Applicability {
  MachineApplicable = "machine-applicable",
  MaybeIncorrect = "maybe-incorrect",
  HasPlaceholders = "has-placeholders",
}

export interface Suggestion {
  readonly span: Range;
  readonly replacement: string;
  readonly applicability: Applicability;
  readonly message: string;
}

/** A secondary labeled span or a spanless note/help line (rustc's sub-diagnostics; LSP relatedInformation
 *  without the URI, which the server adds). */
export interface RelatedInformation {
  readonly range?: Range;
  readonly message: string;
}

export interface Diagnostic {
  readonly range: Range; // primary span
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly relatedInformation?: readonly RelatedInformation[];
  readonly suggestions?: readonly Suggestion[];
}

/** Map a source string index to a 0-based line/character position. */
export function offsetToPosition(src: string, offset: number): Position {
  let line = 0;
  let lineStart = 0;
  const end = Math.min(offset, src.length);
  for (let i = 0; i < end; i++) {
    if (src[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

/** Build an LSP Range from two source string indices. */
export function spanToRange(src: string, start: number, end: number): Range {
  return { start: offsetToPosition(src, start), end: offsetToPosition(src, end) };
}
