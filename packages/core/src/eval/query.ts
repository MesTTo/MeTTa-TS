// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  type Atom,
  atomEq,
  expr,
  type ExprAtom,
  sym,
  type VarAtom,
  variableIdentity,
  variableKey,
} from "../atom";
import { logToArray } from "../atomlog";
import {
  type BindingFrame,
  bindingFrameFromLegacy,
  bindingFrameToLegacy,
  emptyBindingFrame,
  frameDeltaView,
} from "../binding-frame";
import {
  type BindingRel,
  type Bindings,
  emptyBindings,
  eqRelations,
  fromRelations,
  hasEq,
  hasLoop,
  lookupVal,
  makeValRel,
} from "../bindings";
import { isContextIndependentGroundedOp, type ReduceEffect, type ReduceResult } from "../builtins";
import { combineInitiatingAndCleanupFailure } from "../cleanup-fault";
import { type EffectClass } from "../effect-journal";
import { infrastructureFaultFromUnknown, type InfrastructureFaultOutcome } from "../eval-outcome";
import { isNamedEvaluationEnvironment } from "../eval/env";
import {
  type CursorMode,
  type Gen,
  groundedCallContextWithSignal,
  groundedRuntimeSignal,
  isPromiseLike,
  NEVER_ABORTED_SIGNAL,
  pendingAsyncOpBox,
} from "../eval/geneval";
import {
  type ActiveGroundedV2Call,
  AsyncInSyncError,
  driverEffect,
  type GroundedEffectPolicy,
  inst,
  type Item,
  type MinEnv,
  type St,
  type Stack,
  type World,
} from "../eval/machine";
import { candidates, visibleStaticRules } from "../eval/specializer";
import { evalResult, finItem, headKey, opOf } from "../eval/terms";
import {
  checkWorldCancellation,
  checkWorldDeadline,
  consumeWorldResource,
  recordOperationEffect,
  worldRuntimeContext,
} from "../eval/world";
import {
  type GroundedAnswer,
  type GroundedAnswerCursor,
  groundedAnswerScopeFault,
  groundedAtomScopeFault,
  type GroundedCallContextV2,
  groundedEffectsScopeFault,
  type GroundedOperationV2Registration,
  type GroundedStart,
  groundedV2Registration,
} from "../grounded-v2";
import { matchAtoms, matchAtomsScoped, merge } from "../match";
import { isVariableHeadedPattern } from "../reduction-dependency";
import { ResourceLimitError } from "../resources";
import { DEFAULT_SEARCH_QUANTUM, type SearchEvent, validateChildEvent } from "../search-cursor";
import { applySubst } from "../substitution";
import { childTraceContext, isRuntimeId, type StateId } from "../trace";
import {
  legacyFreshVariableSuffix,
  uniqueVariablesInAtoms,
  VariableScope,
} from "../variable-scope";

export const notReducibleA = sym("NotReducible");

export const makeExpr = (_env: MinEnv, items: readonly Atom[]): ExprAtom => expr(items);

export type StateCellId = number | StateId;

export function parsedStateId(a: Atom): StateCellId | undefined {
  if (opOf(a) !== "State" || a.kind !== "expr" || a.items.length !== 2) return undefined;
  const id = a.items[1]!;
  if (id.kind === "gnd" && id.value.g === "int") {
    const value = Number(id.value.n);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  return id.kind === "sym" && isRuntimeId(id.name, "state") ? id.name : undefined;
}

export function resolveStates(w: World, a: Atom): Atom {
  if (w.store.size === 0) return a; // no state cells: identity, skip the tree clone (hot path)
  if (a.kind === "expr") {
    const id = parsedStateId(a);
    if (id !== undefined) return w.store.get(id) ?? a;
    return expr(a.items.map((x) => resolveStates(w, x)));
  }
  return a;
}

export function candidatesW(env: MinEnv, w: World, toEval: Atom): Array<[Atom, Atom]> {
  if (isNamedEvaluationEnvironment(env)) return candidates(env, toEval);
  // Runtime rules come from the index (head-matched bucket plus var-headed), not a scan of the log.
  const k2 = headKey(toEval);
  const headRules = k2 !== undefined ? (w.selfRules.get(k2) ?? []) : [];
  return [...visibleStaticRules(env, w, toEval), ...headRules, ...w.selfVarRules];
}

export function branchVariableNamespace(world: World): string | undefined {
  return world.allocation.branchScoped ? world.allocation.ids.namespace : undefined;
}

export function worldFreshVariableSuffix(world: World, counter: number): string {
  return legacyFreshVariableSuffix(counter, branchVariableNamespace(world));
}

// A sound, allocation-free pre-check: can a rule LHS possibly match `toEval` regardless of how its
// variables rename? Compares arity and the head shape (one level). Conservative; only returns false when a
// match is structurally impossible (different arity, or two distinct ground heads). Lets queryOp skip the
// freshen+match of a candidate that cannot fire. `candidates` appends every variable-headed rule (the `|->`
// lambda applicators) to every query, and they can never match a symbol-headed call, so this is where most
// of the saving is.
export function canMatchShallow(lhs: Atom, toEval: Atom): boolean {
  if (lhs.kind === "var" || toEval.kind === "var") return true;
  if (lhs.kind === "sym") return toEval.kind === "sym" && toEval.name === lhs.name;
  if (lhs.kind === "gnd") return atomEq(lhs, toEval);
  // lhs is an expression: same length, and a head that can itself match.
  return (
    toEval.kind === "expr" &&
    toEval.items.length === lhs.items.length &&
    canMatchShallow(lhs.items[0]!, toEval.items[0]!)
  );
}

function queryOpWithCandidates(
  env: MinEnv,
  st: St,
  prev: Stack,
  toEval: Atom,
  b: Bindings,
  cands: Array<[Atom, Atom]>,
  noRule: Atom = notReducibleA,
): [Item[], St] {
  if (isVariableHeadedPattern(toEval)) return [[finItem(prev, noRule, b)], st];
  const out: Item[] = [];
  let counter = st.counter;
  for (const [lhs0, rhs0] of cands) {
    // Skip a candidate that cannot possibly match before paying for its scope. The counter is still advanced
    // (one per candidate, as before) so the fresh-variable numbering, including any unbound fresh var that
    // survives into a result, is byte-identical to not skipping.
    if (!canMatchShallow(lhs0, toEval)) {
      counter += 1;
      continue;
    }
    // Scope this rule's variables with a per-application suffix instead of cloning the rule with freshened
    // variables: matchAtomsScoped renames the LHS variables at bind time, and instantiate renames the RHS's
    // on the (already-walked) result, so each application avoids the two applySubst clones that freshening
    // cost. The scoped path is byte-identical, since the fresh names (`name<suffix>`) are the same. The RHS
    // is instantiated only when a match actually fires.
    const suffix = worldFreshVariableSuffix(st.world, counter);
    counter += 1;
    for (const mb of matchAtomsScoped(lhs0, toEval, suffix)) {
      for (const m of merge(b, mb)) {
        if (!hasLoop(m)) out.push(evalResult(prev, inst(env, m, rhs0, suffix), m, toEval));
      }
    }
  }
  const st2: St = { counter, world: st.world };
  if (out.length === 0) return [[finItem(prev, noRule, b)], st2];
  return [out, st2];
}

export function queryOp(env: MinEnv, st: St, prev: Stack, toEval: Atom, b: Bindings): [Item[], St] {
  return queryOpWithCandidates(env, st, prev, toEval, b, candidatesW(env, st.world, toEval));
}

const HOST_IO_GROUNDED_OPERATIONS = new Set([
  "catalog-clear!",
  "catalog-list!",
  "catalog-update!",
  "file-close!",
  "file-get-size!",
  "file-open!",
  "file-read-exact!",
  "file-read-to-string!",
  "file-seek!",
  "file-write!",
  "git-import!",
  "help!",
  "print!",
  "println!",
  "register-module!",
  "test",
]);

const TIME_GROUNDED_OPERATIONS = new Set(["current-time"]);

const RANDOM_GROUNDED_OPERATIONS = new Set(["random-float", "random-int", "sealed"]);

export function groundedEffectPolicy(env: MinEnv, operation: string): GroundedEffectPolicy {
  const declared = env.groundedEffects?.get(operation);
  if (declared !== undefined) return declared;
  const asyncOperation = env.agt.get(operation);
  if (asyncOperation !== undefined)
    return { classes: ["suspension", "host-io"], speculative: false };
  const syncOperation = env.gt.get(operation);
  if (syncOperation !== undefined) {
    if (TIME_GROUNDED_OPERATIONS.has(operation)) return { classes: ["time"], speculative: false };
    if (RANDOM_GROUNDED_OPERATIONS.has(operation))
      return { classes: ["randomness"], speculative: false };
    if (HOST_IO_GROUNDED_OPERATIONS.has(operation))
      return { classes: ["host-io"], speculative: false };
    if (isContextIndependentGroundedOp(syncOperation))
      return { classes: ["pure"], speculative: true };
    return { classes: ["host-io"], speculative: false };
  }
  return { classes: ["pure"], speculative: true };
}

export function groundedEffectRejected(world: World, policy: GroundedEffectPolicy): boolean {
  return worldRuntimeContext(world).irreversibleEffects === "reject" && !policy.speculative;
}

export function recordGroundedOperationEffects(
  world: World,
  operation: string,
  policy: GroundedEffectPolicy,
  results: readonly Atom[],
): void {
  const recorded = new Set<EffectClass>();
  for (const effectClass of policy.classes) {
    if (effectClass === "pure" || recorded.has(effectClass)) continue;
    recorded.add(effectClass);
    recordOperationEffect(world, operation, effectClass, results);
  }
}

export function groundedV2For(
  env: MinEnv,
  operation: string,
): GroundedOperationV2Registration | undefined {
  return groundedV2Registration(env.agt.get(operation) ?? env.gt.get(operation));
}

export function createGroundedV2Call(
  env: MinEnv,
  world: World,
  operation: string,
  originalArgs: readonly Atom[],
  bindings: Bindings,
): ActiveGroundedV2Call {
  const converted = bindingFrameFromLegacy(bindings);
  if (!converted.ok)
    throw infrastructureFaultFromUnknown("grounded-context", new Error(converted.fault.message), {
      bindings: emptyBindingFrame,
    });
  const runtime = worldRuntimeContext(world);
  const trace = childTraceContext(runtime.ids, runtime.trace);
  const resources = runtime.resources.fork(`${operation}-call`);
  const scope = new VariableScope(runtime.ids.next("scope"));
  const visibleVariables = Object.freeze(uniqueVariablesInAtoms(originalArgs));
  const frozenOriginalArgs = Object.freeze(originalArgs.slice());
  let closed = false;
  return {
    frame: converted.value,
    trace,
    resources,
    cache: {},
    context(signal: AbortSignal): GroundedCallContextV2 {
      const base =
        signal === NEVER_ABORTED_SIGNAL
          ? groundedCallContextWithSignal(env, world, groundedRuntimeSignal(world, signal))
          : groundedCallContextWithSignal(env, world, signal);
      return Object.freeze({
        currentSpace: base.currentSpace,
        visibleSpaces: base.visibleSpaces,
        expectedType: base.expectedType,
        generation: base.generation,
        get typeEnvironment() {
          return base.typeEnvironment;
        },
        get groundingEnvironment() {
          return base.groundingEnvironment;
        },
        get imports() {
          return base.imports;
        },
        get moduleInstallations() {
          return base.moduleInstallations;
        },
        capabilities: base.capabilities,
        originalArgs: frozenOriginalArgs,
        bindings: converted.value,
        visibleVariables,
        scope,
        resources,
        trace,
        signal: base.signal,
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      resources.close();
    },
  };
}

export function groundedV2Fault(
  phase: string,
  error: unknown,
  call: ActiveGroundedV2Call,
  subject: Atom,
): InfrastructureFaultOutcome<BindingFrame> {
  return infrastructureFaultFromUnknown(phase, error, {
    bindings: call.frame,
    subject,
    trace: call.trace,
  });
}

export function* startGroundedV2G(
  registration: GroundedOperationV2Registration,
  world: World,
  operation: string,
  args: readonly Atom[],
  call: ActiveGroundedV2Call,
  subject: Atom,
): Gen<GroundedStart> {
  const invoke = (signal: AbortSignal): GroundedStart | Promise<GroundedStart> => {
    const context = call.context(signal);
    for (const capability of registration.options.requiredCapabilities ?? [])
      if (!context.capabilities.has(capability))
        throw groundedV2Fault(
          "grounded-capability",
          new Error(`${operation}: missing required capability '${capability}'`),
          call,
          subject,
        );
    return registration.operation(args, context);
  };
  try {
    if (registration.options.mode === "sync") {
      const start = invoke(NEVER_ABORTED_SIGNAL);
      if (isPromiseLike(start))
        throw new TypeError("synchronous grounded V2 operation returned a Promise");
      checkWorldDeadline(world, operation);
      return start;
    }
    pendingAsyncOpBox.op = operation;
    return (yield driverEffect(
      operation,
      () => {
        throw new AsyncInSyncError(operation);
      },
      async (signal) => {
        const start = await invoke(signal);
        checkWorldDeadline(world, operation);
        return start;
      },
    )) as GroundedStart;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      error.kind === "infrastructure-fault"
    )
      throw error;
    throw groundedV2Fault("grounded-start", error, call, subject);
  }
}

/**
 * The finite work permit issued to one grounded pull: the scheduler remainder when a cursor is
 * driving, the remaining step budget when one is configured, and the default search quantum
 * otherwise. A pull is never issued an unbounded allowance.
 */
function groundedPullAllowance(world: World, scheduler: CursorMode | undefined): number {
  if (scheduler !== undefined) {
    const remaining = scheduler.budget.remaining;
    if (remaining <= 0) throw new Error("grounded answer pull started without scheduler allowance");
    return remaining;
  }
  const ledger = worldRuntimeContext(world).resources.ledger;
  const limit = ledger.limit("steps");
  if (limit === undefined) return DEFAULT_SEARCH_QUANTUM;
  // An exhausted budget still issues one permit so the debit below reports the resource fault.
  return Math.max(1, limit - ledger.used("steps"));
}

export function* pullGroundedV2G(
  answers: GroundedAnswerCursor,
  world: World,
  operation: string,
  call: ActiveGroundedV2Call,
  subject: Atom,
  scheduler?: CursorMode,
): Gen<SearchEvent<GroundedAnswer, void>> {
  const maxSteps = groundedPullAllowance(world, scheduler);
  let activeSignal: AbortSignal | undefined;
  try {
    if (answers.mode === "sync") {
      checkWorldCancellation(world);
      const event = validateChildEvent<GroundedAnswer, void>(answers.next({ maxSteps }), maxSteps);
      checkWorldDeadline(world, operation);
      return event;
    }
    pendingAsyncOpBox.op = operation;
    return (yield driverEffect(
      operation,
      () => {
        throw new AsyncInSyncError(operation);
      },
      async (signal) => {
        activeSignal = signal;
        const event = validateChildEvent<GroundedAnswer, void>(
          await answers.next({ signal, maxSteps }),
          maxSteps,
        );
        checkWorldDeadline(world, operation);
        return event;
      },
    )) as SearchEvent<GroundedAnswer, void>;
  } catch (error) {
    if (activeSignal?.aborted === true && Object.is(error, activeSignal.reason)) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      error.kind === "infrastructure-fault"
    )
      throw error;
    throw groundedV2Fault("grounded-next", error, call, subject);
  }
}

export function* closeGroundedV2G(
  cursor: GroundedAnswerCursor,
  operation: string,
  call: ActiveGroundedV2Call,
  subject: Atom,
  initiating: SchedulerUnwindFailure = { active: false, error: undefined },
): Gen<void> {
  if (cursor.closed) return;
  const reason = { code: "parent-closed", message: `${operation} consumer closed` };
  try {
    if (cursor.mode === "sync") {
      cursor.close(reason);
      return;
    }
    pendingAsyncOpBox.op = operation;
    yield driverEffect(
      operation,
      () => {
        // A synchronous evaluation cannot join asynchronous cleanup. The cursor contract keeps a
        // close failure on the cursor's sticky terminal, so initiation is still observed there;
        // the rejection handler only prevents an unhandled-rejection crash for a producer this
        // evaluation no longer owns. A synchronous throw still reaches the combiner below.
        void cursor.close(reason).catch(() => undefined);
        return undefined;
      },
      async () => await cursor.close(reason),
    );
  } catch (error) {
    const cleanupFault = groundedV2Fault("grounded-close", error, call, subject);
    if (!initiating.active) throw cleanupFault;
    throw Object.is(error, initiating.error)
      ? initiating.error
      : combineInitiatingAndCleanupFailure(
          initiating.error,
          cleanupFault,
          "grounded operation and cleanup both failed",
        );
  }
}

function atomCellCount(roots: readonly Atom[]): number {
  const seen = new Set<Atom>();
  const pending = [...roots];
  while (pending.length > 0) {
    const atom = pending.pop()!;
    if (seen.has(atom)) continue;
    seen.add(atom);
    if (atom.kind === "expr")
      for (let index = atom.items.length - 1; index >= 0; index--) pending.push(atom.items[index]!);
  }
  return seen.size;
}

export function consumeGroundedPayloadResources(
  world: World,
  operation: string,
  atoms: readonly Atom[],
  result: boolean,
): void {
  const lease = worldRuntimeContext(world).resources;
  if (!lease.ledger.tracked) return;
  const fault = lease.tryConsumeMany(
    {
      ...(result ? { results: 1 } : {}),
      "atom-cells": atomCellCount(atoms),
    },
    `${operation}-${result ? "answer" : "pre-effects"}`,
  );
  if (fault !== undefined) throw new ResourceLimitError(fault);
}

export function reduceEffectAtoms(effects: readonly ReduceEffect[] | undefined): Atom[] {
  if (effects === undefined) return [];
  const atoms: Atom[] = [];
  for (const effect of effects) {
    if (effect.kind === "addAtom" || effect.kind === "removeAtom") atoms.push(effect.space);
    atoms.push(effect.atom);
  }
  return atoms;
}

export function instantiateReduceEffects(
  frame: BindingFrame,
  effects: readonly ReduceEffect[] | undefined,
): readonly ReduceEffect[] | undefined {
  if (effects === undefined || effects.length === 0) return effects;
  return effects.map((effect) => {
    switch (effect.kind) {
      case "addAtom":
      case "removeAtom":
        return {
          ...effect,
          space: frame.instantiate(effect.space),
          atom: frame.instantiate(effect.atom),
        };
      case "bindToken":
        return { ...effect, atom: frame.instantiate(effect.atom) };
    }
  });
}

export function checkedGroundedLanguageError(
  error: Atom,
  call: ActiveGroundedV2Call,
  context: GroundedCallContextV2,
  subject: Atom,
): Atom {
  const scopeFault = groundedAtomScopeFault(error, call.frame, context);
  if (scopeFault !== undefined)
    throw groundedV2Fault("grounded-bindings", new Error(scopeFault), call, subject);
  return call.frame.instantiate(error);
}

export function checkGroundedEffectsScope(
  effects: readonly ReduceEffect[] | undefined,
  call: ActiveGroundedV2Call,
  context: GroundedCallContextV2,
  subject: Atom,
): void {
  const scopeFault = groundedEffectsScopeFault(effects, call.frame, context);
  if (scopeFault !== undefined)
    throw groundedV2Fault("grounded-bindings", new Error(scopeFault), call, subject);
}

interface PreparedGroundedAnswer {
  readonly atom: Atom;
  readonly bindings: Bindings;
  readonly effects?: readonly ReduceEffect[];
  readonly resourceAtoms: readonly Atom[];
}

function answerVariablesWithinVisible(
  call: ActiveGroundedV2Call,
  context: GroundedCallContextV2,
  answerVariables: readonly VarAtom[],
): boolean {
  if (answerVariables.length === 0) return true;
  let visibleKeys = call.cache.visibleKeys;
  if (visibleKeys === undefined) {
    visibleKeys = new Set(context.visibleVariables.map(variableKey));
    call.cache.visibleKeys = visibleKeys;
  }
  const keys = visibleKeys;
  return answerVariables.every((variableAtom) => keys.has(variableKey(variableAtom)));
}

function preparedGroundedBindings(
  env: MinEnv,
  answer: GroundedAnswer,
  call: ActiveGroundedV2Call,
  context: GroundedCallContextV2,
  merged: BindingFrame,
  answerVariables: readonly VarAtom[],
  subject: Atom,
  queryVars: readonly string[] | undefined,
): Bindings {
  // A delta-free answer over caller-visible variables projects the same caller frame every time,
  // so the projection and its legacy conversion are computed once per call, not once per answer.
  const constantProjection =
    answer.bindingDelta === undefined &&
    answerVariablesWithinVisible(call, context, answerVariables);
  if (constantProjection) {
    const cached = call.cache.zeroDelta;
    if (cached !== undefined && cached.queryVars === queryVars) return cached.bindings;
  }
  const projected = merged.project([...context.visibleVariables, ...answerVariables]);
  if (!projected.ok)
    throw groundedV2Fault("grounded-bindings", new Error(projected.fault.message), call, subject);
  const legacy = bindingFrameToLegacy(projected.value);
  const bindings = queryVars === undefined ? legacy : restrictBnd(env, queryVars, legacy);
  if (constantProjection) call.cache.zeroDelta = { queryVars, bindings };
  return bindings;
}

export function prepareGroundedAnswer(
  env: MinEnv,
  answer: GroundedAnswer,
  call: ActiveGroundedV2Call,
  context: GroundedCallContextV2,
  subject: Atom,
  queryVars?: readonly string[],
):
  | { readonly kind: "answer"; readonly value: PreparedGroundedAnswer }
  | { readonly kind: "conflict" } {
  const scopeFault = groundedAnswerScopeFault(answer, call.frame, context);
  if (scopeFault !== undefined)
    throw groundedV2Fault("grounded-bindings", new Error(scopeFault), call, subject);
  const merged =
    answer.bindingDelta === undefined
      ? { ok: true as const, value: call.frame }
      : call.frame.merge(answer.bindingDelta);
  if (!merged.ok) {
    if (merged.fault.code === "conflict") return { kind: "conflict" };
    throw groundedV2Fault("grounded-bindings", new Error(merged.fault.message), call, subject);
  }
  const answerVariables = uniqueVariablesInAtoms([answer.atom]);
  const bindings = preparedGroundedBindings(
    env,
    answer,
    call,
    context,
    merged.value,
    answerVariables,
    subject,
    queryVars,
  );
  const effects = instantiateReduceEffects(merged.value, answer.effects);
  const atom = merged.value.instantiate(answer.atom);
  const resourceAtoms = [atom, ...reduceEffectAtoms(effects)];
  if (answer.bindingDelta !== undefined) {
    // Only the classes the delta touched carry newly published binding atoms.
    const deltaView = frameDeltaView(call.frame, answer.bindingDelta);
    if (deltaView !== undefined) {
      for (const value of deltaView.values) resourceAtoms.push(merged.value.instantiate(value));
    } else {
      for (const bindingClass of answer.bindingDelta.classes())
        if (bindingClass.value !== undefined)
          resourceAtoms.push(merged.value.instantiate(bindingClass.value));
    }
  }
  return {
    kind: "answer",
    value: {
      atom,
      bindings,
      ...(effects === undefined ? {} : { effects }),
      resourceAtoms,
    },
  };
}

export function* collectGroundedV2LegacyG(
  registration: GroundedOperationV2Registration,
  env: MinEnv,
  world: World,
  operation: string,
  args: readonly Atom[],
  bindings: Bindings,
  subject: Atom,
): Gen<ReduceResult> {
  const call = createGroundedV2Call(env, world, operation, args, bindings);
  let cursor: GroundedAnswerCursor | undefined;
  const unwind: SchedulerUnwindFailure = { active: false, error: undefined };
  try {
    const context = call.context(NEVER_ABORTED_SIGNAL);
    const start = yield* startGroundedV2G(registration, world, operation, args, call, subject);
    if (start.tag === "host-fault") throw start.fault;
    if (start.tag === "stuck") return { tag: "noReduce" };
    if (start.tag === "language-error") {
      const error = checkedGroundedLanguageError(start.error, call, context, subject);
      consumeGroundedPayloadResources(world, operation, [error], true);
      return { tag: "ok", results: [error] };
    }
    cursor = start.answers;
    if (cursor.mode !== registration.options.mode)
      throw groundedV2Fault(
        "grounded-start",
        new TypeError(
          `${operation}: ${registration.options.mode} operation returned ${cursor.mode} cursor`,
        ),
        call,
        subject,
      );
    const results: Atom[] = [];
    checkGroundedEffectsScope(start.preEffects, call, context, subject);
    const instantiatedPreEffects = instantiateReduceEffects(call.frame, start.preEffects);
    consumeGroundedPayloadResources(
      world,
      operation,
      reduceEffectAtoms(instantiatedPreEffects),
      false,
    );
    const effects: ReduceEffect[] = [...(instantiatedPreEffects ?? [])];
    for (;;) {
      const event = yield* pullGroundedV2G(cursor, world, operation, call, subject);
      consumeWorldResource(world, "steps", event.steps, `${operation}-pull`);
      if (event.kind === "pending") continue;
      if (event.kind === "exhausted")
        return effects.length === 0 ? { tag: "ok", results } : { tag: "ok", results, effects };
      if (event.kind === "cancelled")
        throw {
          kind: "cancelled",
          reason: event.reason,
          bindings: call.frame,
          subject,
          trace: call.trace,
        };
      if (event.kind === "fault")
        throw groundedV2Fault("grounded-next", event.error, call, subject);
      const prepared = prepareGroundedAnswer(env, event.value, call, context, subject);
      if (prepared.kind === "conflict") continue;
      consumeGroundedPayloadResources(world, operation, prepared.value.resourceAtoms, true);
      results.push(prepared.value.atom);
      if (prepared.value.effects !== undefined) effects.push(...prepared.value.effects);
    }
  } catch (error) {
    unwind.active = true;
    unwind.error = error;
    throw error;
  } finally {
    try {
      if (cursor !== undefined) yield* closeGroundedV2G(cursor, operation, call, subject, unwind);
    } finally {
      call.close();
    }
  }
}

export function unifyOp(
  env: MinEnv,
  prev: Stack,
  a: Atom,
  p: Atom,
  t: Atom,
  e: Atom,
  b: Bindings,
): Item[] {
  const ms: Item[] = [];
  let matched = false;
  for (const mb of matchAtoms(a, p))
    for (const m of merge(b, mb))
      if (!hasLoop(m)) {
        matched = true;
        ms.push(finItem(prev, inst(env, m, t), m));
      }
  if (matched) return ms;
  return [finItem(prev, e, b)];
}

/** Apply a chain-local binder without extending the source answer's frame. */
export function bindChainAnswer(
  variableAtom: Extract<Atom, { kind: "var" }>,
  answer: Atom,
  template: Atom,
): readonly Atom[] {
  // Pinned Hyperon applies one local substitution here and returns the source bindings unchanged. Keep
  // that hot path for legacy variables. Scoped variables use the identity-aware frame so another scope's
  // same-spelled variable is not captured.
  if (variableIdentity(variableAtom) === undefined)
    return [applySubst([[variableAtom.name, answer]], template)];

  const constrained = emptyBindingFrame.bind(variableAtom, answer);
  return constrained.ok ? [constrained.value.instantiate(template)] : [];
}

// Resolve an atom to its transitive value under `b`, following variable→value chains but stopping at
// cycles: a variable already on the current resolution path (`visiting`) is left unexpanded. The return
// is `[resolved, clean]` — `clean` is false when an active-cycle variable was truncated somewhere inside,
// which marks the result as depending on the current path and so unsafe to memoise.
//
// On any ACYCLIC binding set this returns exactly what a fixpoint of single-pass `instantiate` returned
// (both reach the same fixed point, since with no cycle nothing is ever truncated), so it is
// behaviour-identical to the previous loop wherever that loop terminated. The only behavioural change is
// the cyclic case. A direct match can bind `$x ↦ (… $x …)` with no occurs check — `matchAtomsWith` has
// none, faithfully: LeaTTa's occurs check lives only in reconcile (`Unify.unifyTop` in `addVarBinding`),
// not in first-bind matching (`Core/Matching.lean`) — and LeaTTa's `instantiate` is single-pass
// (`Subst.apply`: "the substituted value is not itself re-substituted"), so it never expands such a
// binding. The old fixpoint loop instead unrolled the cycle one level per iteration up to `size(b)+1`,
// building a term that many levels deep and overflowing the native stack in `atomEq` — Nil Geisweiller's
// `bfc-xp.metta` obc/obc-gtz proof search, which sets `occurs_check True` so its Prolog reference prunes
// exactly these branches, overflowed here at size >= 7. Truncating at the cycle matches LeaTTa's
// single-pass result and terminates.
//
// `memo` caches only clean (fully-resolved, no truncation inside) expression nodes by object identity, so
// a DAG-shared subterm (`instantiate` shares unchanged subterms by reference; a reconciled type term has
// far more paths than nodes) is resolved once per `restrictBnd` call, not once per path — the same
// DAG-vs-tree reasoning as `instantiate`/`occursThrough`/`atomEq`. An unclean node is never cached: its
// truncated form is valid only while its cycle variable is on the path.
function resolveTermDeep(
  env: MinEnv,
  b: Bindings,
  a: Atom,
  visiting: Set<string>,
  memo: Map<Atom, Atom>,
): [Atom, boolean] {
  if (a.ground) return [a, true];
  if (a.kind === "var") {
    if (visiting.has(a.name)) return [a, false];
    const v = lookupVal(b, a.name);
    if (v === undefined) return [a, true];
    visiting.add(a.name);
    const r = resolveTermDeep(env, b, v, visiting, memo);
    visiting.delete(a.name);
    return r;
  }
  if (a.kind === "expr") {
    const cached = memo.get(a);
    if (cached !== undefined) return [cached, true];
    const its = a.items;
    let items: Atom[] | null = null;
    let clean = true;
    for (let i = 0; i < its.length; i++) {
      const [r, rc] = resolveTermDeep(env, b, its[i]!, visiting, memo);
      if (!rc) clean = false;
      if (items !== null) items.push(r);
      else if (r !== its[i]) {
        items = its.slice(0, i);
        items.push(r);
      }
    }
    const result = items === null ? a : makeExpr(env, items);
    if (clean) memo.set(a, result);
    return [result, clean];
  }
  return [a, true];
}

function resolveBoundVarFix(
  env: MinEnv,
  b: Bindings,
  x: string,
  memo: Map<Atom, Atom>,
): Atom | undefined {
  const cur = lookupVal(b, x);
  if (cur === undefined || cur.ground) return cur;
  return resolveTermDeep(env, b, cur, new Set([x]), memo)[0];
}

export function restrictBnd(env: MinEnv, vars: readonly string[], b: Bindings): Bindings {
  if (vars.length === 0) return emptyBindings;
  const solved: BindingRel[] = [];
  // Shared across every `x` below: they resolve against the same immutable `b`, so a clean subterm's
  // resolved form is identical whichever query variable reached it.
  const memo = new Map<Atom, Atom>();
  for (const x of vars) {
    const v = resolveBoundVarFix(env, b, x, memo);
    if (v !== undefined && !(v.kind === "var" && v.name === x)) solved.push(makeValRel(x, v));
  }
  // The eq filter only matters when `b` actually carries an alias; most bindings are pure `val`, so skip
  // both the scan and the Set allocation in that common case. When there are aliases, use a Set for O(1)
  // membership (was `vars.includes` twice per binding, O(|vars|*|b|), the dominant cost on a large binding).
  if (!hasEq(b)) return fromRelations(solved);
  const vset = new Set(vars);
  const eqs: BindingRel[] = [];
  for (const r of eqRelations(b)) if (vset.has(r.x) && vset.has(r.y)) eqs.push(r);
  return fromRelations(solved.length === 0 ? eqs : [...solved, ...eqs]);
}

// Narrow a reduction result's bindings to the query variables: merge the result's bindings `pb` onto the
// base `baseB`, then keep only `vars`. If the merge is incompatible (no solution), fall back to `pb` alone.
// This is the standard post-reduction binding step, used after every metta-call and rule application.
export function mergeRestrict(
  env: MinEnv,
  vars: readonly string[],
  baseB: Bindings,
  pb: Bindings,
): Bindings {
  if (vars.length === 0) return emptyBindings;
  const merged = merge(baseB, pb);
  return restrictBnd(env, vars, merged.length > 0 ? merged[0]! : pb);
}

/** Apply state resolution to candidate atoms only when the world actually holds state. */
export function resolveAll(w: World, atoms: Atom[]): readonly Atom[] {
  return w.store.size === 0 ? atoms : atoms.map((x) => resolveStates(w, x));
}

export function* runtimeCandidates(
  w: World,
  k: string | undefined,
  pattern?: Atom,
): Iterable<Atom> {
  if (w.flatSelfExtra !== undefined) {
    for (const a of w.flatSelfExtra.candidatesFor(k, pattern)) yield resolveStates(w, a);
  }
  for (const a of logToArray(w.selfExtra)) {
    if (k === undefined) yield resolveStates(w, a);
    else {
      const akk = headKey(a);
      if (akk === undefined || akk === k) yield resolveStates(w, a);
    }
  }
}

export interface SchedulerUnwindFailure {
  active: boolean;
  error: unknown;
}
