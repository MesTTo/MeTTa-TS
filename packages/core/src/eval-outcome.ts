// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, sym } from "./atom";
import type { Bindings } from "./bindings";
import type { CancellationReason, ResourceLimitFault } from "./resources";
import type { SuspensionId, TraceContext } from "./trace";

interface TracedOutcome {
  readonly trace?: TraceContext;
}

export interface AnswerOutcome<F = Bindings> extends TracedOutcome {
  readonly kind: "answer";
  readonly atom: Atom;
  readonly bindings: F;
}

/** The search cursor is complete and no further answer exists. */
export interface ExhaustedOutcome extends TracedOutcome {
  readonly kind: "exhausted";
}

/** A finite term has no applicable transition but remains observable. */
export interface StuckOutcome<F = Bindings> extends TracedOutcome {
  readonly kind: "stuck";
  readonly atom: Atom;
  readonly bindings: F;
  readonly reason: "no-rule" | "no-reduce" | "partial-function" | "constructor";
}

/** A MeTTa-visible error. The error atom remains matchable at legacy boundaries. */
export interface LanguageFaultOutcome<F = Bindings> extends TracedOutcome {
  readonly kind: "language-fault";
  readonly error: Atom;
  readonly bindings: F;
}

export interface ResourceFaultOutcome<F = Bindings> extends TracedOutcome {
  readonly kind: "resource-fault";
  readonly fault: ResourceLimitFault;
  readonly bindings?: F;
  readonly subject?: Atom;
}

export interface InfrastructureFaultOutcome<F = Bindings> extends TracedOutcome {
  readonly kind: "infrastructure-fault";
  readonly phase: string;
  readonly message: string;
  readonly name?: string;
  readonly stack?: string;
  readonly bindings?: F;
  readonly subject?: Atom;
}

export interface SuspendedOutcome<F = Bindings> extends TracedOutcome {
  readonly kind: "suspended";
  readonly token: SuspensionId;
  readonly reason: string;
  readonly bindings?: F;
}

export interface CancelledOutcome<F = Bindings> extends TracedOutcome {
  readonly kind: "cancelled";
  readonly reason: CancellationReason;
  readonly bindings?: F;
  readonly subject?: Atom;
}

export type EvaluationOutcome<F = Bindings> =
  | AnswerOutcome<F>
  | ExhaustedOutcome
  | StuckOutcome<F>
  | LanguageFaultOutcome<F>
  | ResourceFaultOutcome<F>
  | InfrastructureFaultOutcome<F>
  | SuspendedOutcome<F>
  | CancelledOutcome<F>;

export type EvaluationFault<F = Bindings> =
  | ResourceFaultOutcome<F>
  | InfrastructureFaultOutcome<F>
  | CancelledOutcome<F>;

export const answerOutcome = <F>(
  atom: Atom,
  bindings: F,
  trace?: TraceContext,
): AnswerOutcome<F> => ({
  kind: "answer",
  atom,
  bindings,
  ...(trace === undefined ? {} : { trace }),
});

export const exhaustedOutcome = (trace?: TraceContext): ExhaustedOutcome => ({
  kind: "exhausted",
  ...(trace === undefined ? {} : { trace }),
});

export const stuckOutcome = <F>(
  atom: Atom,
  bindings: F,
  reason: StuckOutcome["reason"],
  trace?: TraceContext,
): StuckOutcome<F> => ({
  kind: "stuck",
  atom,
  bindings,
  reason,
  ...(trace === undefined ? {} : { trace }),
});

export const languageFaultOutcome = <F>(
  error: Atom,
  bindings: F,
  trace?: TraceContext,
): LanguageFaultOutcome<F> => ({
  kind: "language-fault",
  error,
  bindings,
  ...(trace === undefined ? {} : { trace }),
});

export function infrastructureFaultFromUnknown<F>(
  phase: string,
  cause: unknown,
  context: {
    readonly bindings?: F;
    readonly subject?: Atom;
    readonly trace?: TraceContext;
  } = {},
): InfrastructureFaultOutcome<F> {
  const error = cause instanceof Error ? cause : undefined;
  const primitiveMessage =
    cause === null ||
    typeof cause === "string" ||
    typeof cause === "number" ||
    typeof cause === "bigint" ||
    typeof cause === "boolean" ||
    typeof cause === "symbol" ||
    typeof cause === "undefined"
      ? String(cause)
      : "Unknown infrastructure failure";
  return {
    kind: "infrastructure-fault",
    phase,
    message: error?.message ?? primitiveMessage,
    ...(error?.name === undefined ? {} : { name: error.name }),
    ...(error?.stack === undefined ? {} : { stack: error.stack }),
    ...(context.bindings === undefined ? {} : { bindings: context.bindings }),
    ...(context.subject === undefined ? {} : { subject: context.subject }),
    ...(context.trace === undefined ? {} : { trace: context.trace }),
  };
}

export function isEvaluationFault<F>(outcome: EvaluationOutcome<F>): outcome is EvaluationFault<F> {
  return (
    outcome.kind === "resource-fault" ||
    outcome.kind === "infrastructure-fault" ||
    outcome.kind === "cancelled"
  );
}

export type LegacyPair<F = Bindings> = readonly [Atom, F];

export type LegacyOutcomeProjection<F = Bindings> =
  | { readonly kind: "pairs"; readonly pairs: readonly LegacyPair<F>[] }
  | { readonly kind: "fault"; readonly fault: EvaluationFault<F> }
  | { readonly kind: "suspended"; readonly suspension: SuspendedOutcome<F> };

/** Explicit rules for materializing typed control outcomes as legacy answer atoms. */
export interface LegacyOutcomeMaterializers<F = Bindings> {
  readonly stuck?: (outcome: StuckOutcome<F>) => Atom;
  readonly languageFault?: (outcome: LanguageFaultOutcome<F>) => Atom;
  readonly resourceFault?: (outcome: ResourceFaultOutcome<F>) => Atom;
  readonly infrastructureFault?: (outcome: InfrastructureFaultOutcome<F>) => Atom;
  readonly cancelled?: (outcome: CancelledOutcome<F>) => Atom;
}

function pairProjection<F>(atom: Atom, bindings: F): LegacyOutcomeProjection<F> {
  return { kind: "pairs", pairs: [[atom, bindings]] };
}

/**
 * Project one typed outcome into the old `(atom, bindings)` protocol.
 *
 * Answer, exhaustion, stuck, and language faults have Minimal MeTTa mappings.
 * Resource, infrastructure, and cancellation faults stay typed unless the
 * caller supplies a materializer. Suspension is never mistaken for completion.
 */
export function projectLegacyOutcome<F>(
  outcome: EvaluationOutcome<F>,
  materializers: LegacyOutcomeMaterializers<F> = {},
): LegacyOutcomeProjection<F> {
  switch (outcome.kind) {
    case "answer":
      return pairProjection(outcome.atom, outcome.bindings);
    case "exhausted":
      return { kind: "pairs", pairs: [] };
    case "stuck":
      return pairProjection(
        materializers.stuck?.(outcome) ?? sym("NotReducible"),
        outcome.bindings,
      );
    case "language-fault":
      return pairProjection(
        materializers.languageFault?.(outcome) ?? outcome.error,
        outcome.bindings,
      );
    case "resource-fault": {
      const atom = materializers.resourceFault?.(outcome);
      if (atom === undefined || outcome.bindings === undefined)
        return { kind: "fault", fault: outcome };
      return pairProjection(atom, outcome.bindings);
    }
    case "infrastructure-fault": {
      const atom = materializers.infrastructureFault?.(outcome);
      if (atom === undefined || outcome.bindings === undefined)
        return { kind: "fault", fault: outcome };
      return pairProjection(atom, outcome.bindings);
    }
    case "cancelled": {
      const atom = materializers.cancelled?.(outcome);
      if (atom === undefined || outcome.bindings === undefined)
        return { kind: "fault", fault: outcome };
      return pairProjection(atom, outcome.bindings);
    }
    case "suspended":
      return { kind: "suspended", suspension: outcome };
  }
}
