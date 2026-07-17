// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, emptyExpr, expr, sym } from "../atom";
import { type Bindings } from "../bindings";
import { pettaOpNames } from "../builtins";
import { tryFastNamedAddIfAbsent, tryFastNamedOnceMatch } from "./fastpaths";
import {
  callGroundedG,
  type CursorMode,
  type Gen,
  groundedCallContext,
  groundedCallContextWithSignal,
  isPromiseLike,
  NEVER_ABORTED_SIGNAL,
  pendingAsyncOpBox,
} from "./geneval";
import {
  AsyncInSyncError,
  driverEffect,
  errTextAtom,
  type GroundedEffectPolicy,
  inst,
  type Item,
  type MinEnv,
  type St,
  type Stack,
} from "./machine";
import { errAtom, hasRuleFor, matchInsideOnce, partialApplicationView } from "./matchops";
import { applyReduceEffects } from "./mutate";
import { subTokens } from "./par";
import {
  groundedEffectPolicy,
  groundedEffectRejected,
  groundedV2For,
  queryOp,
  recordGroundedOperationEffects,
  resolveStates,
} from "./query";
import { startMinimalGroundedV2G } from "./schedule";
import { admitAtom, evalResult, finItem, isEmbeddedOp, opOf } from "./terms";
import { groundedV2Registration } from "../grounded-v2";
import { isWorkerQuiescenceError } from "../worker-protocol";

export function* evalOpG(
  env: MinEnv,
  st: St,
  prev: Stack,
  x: Atom,
  b: Bindings,
  cursor?: CursorMode,
): Gen<[Item[], St]> {
  const x2 = inst(env, b, x);
  const op = opOf(x2);
  if (op === "collapse" && x2.kind === "expr" && x2.items.length === 2) {
    const match = matchInsideOnce(x2.items[1]!);
    if (match !== undefined) {
      const namedMatch = tryFastNamedOnceMatch(env, st, match, b);
      if (namedMatch !== undefined) {
        const items = namedMatch.value === undefined ? [] : [namedMatch.value];
        return [[evalResult(prev, expr([sym(","), ...items]), b)], namedMatch.state];
      }
    }
  }
  if (op === "if" && x2.kind === "expr" && x2.items.length === 4) {
    const added = tryFastNamedAddIfAbsent(env, st, x2, b);
    if (added !== undefined) {
      const out = added.added ? [finItem(prev, emptyExpr, b)] : [];
      return [out, added.state];
    }
  }
  // A PeTTa-compat grounded op (length, sort, append, …) defers to a user `=` rule of the same head, so the
  // stdlib never shadows a program's own definition; every other grounded op applies eagerly as before.
  const useGrounded =
    op !== undefined &&
    x2.kind === "expr" &&
    !(pettaOpNames.has(op) && hasRuleFor(env, st.world, st.counter, x2));
  if (useGrounded) {
    let args = x2.items
      .slice(1)
      .map((a) => resolveStates(st.world, subTokens(st.world, a, env.intern)));
    if (op === "repr" && args.length === 1)
      args = [partialApplicationView(env, st.world, args[0]!)];
    const effectPolicy = groundedEffectPolicy(env, op!);
    if (groundedEffectRejected(st.world, effectPolicy))
      return [
        [
          finItem(
            prev,
            errTextAtom(x2, `${op}: irreversible effect is not allowed in an isolated branch`),
            b,
          ),
        ],
        st,
      ];
    const groundedV2 = groundedV2For(env, op!);
    if (groundedV2 !== undefined)
      return yield* startMinimalGroundedV2G(
        groundedV2,
        env,
        st,
        prev,
        x2,
        op!,
        x.kind === "expr" ? x.items.slice(1) : x2.items.slice(1),
        args,
        b,
        cursor,
      );
    const r = yield* callGroundedG(env, st.world, op!, args);
    if (r.tag === "ok") {
      recordGroundedOperationEffects(st.world, op!, effectPolicy, r.results);
      const effects = applyReduceEffects(env, st, b, r.effects);
      if (effects.tag === "error") return [[finItem(prev, errAtom(x2, effects.msg), b)], st];
      return [r.results.map((res) => evalResult(prev, res, b, x2)), effects.state];
    }
    if (r.tag === "runtimeError") return [[finItem(prev, errAtom(x2, r.msg), b)], st];
    if (r.tag === "incorrectArgument") return [[finItem(prev, errTextAtom(x2, r.msg), b)], st];
    // noReduce
  }
  // Executable grounded-atom head: `(<gnd-with-exec> arg...)`. This is what makes a grounded operation
  // produced at runtime (e.g. `(bind! abs (op-atom ...))` then `(abs -5)`, or the js-* interop) callable
  // in-language, the TS-native analogue of Python's py-atom/OperationAtom. The interpreter dispatches
  // built-in ops by symbol; this dispatches by the head atom's own `exec`.
  if (x2.kind === "expr" && x2.items.length > 0) {
    const head = x2.items[0]!;
    if (head.kind === "gnd" && head.exec !== undefined) {
      const groundedV2 = groundedV2Registration(head.exec);
      const effectPolicy: GroundedEffectPolicy = groundedV2?.options.effects ?? {
        classes: ["host-io"],
        speculative: false,
      };
      if (groundedEffectRejected(st.world, effectPolicy))
        return [
          [
            finItem(
              prev,
              errTextAtom(
                x2,
                "<grounded-exec>: irreversible effect is not allowed in an isolated branch",
              ),
              b,
            ),
          ],
          st,
        ];
      const args = x2.items
        .slice(1)
        .map((a) => resolveStates(st.world, subTokens(st.world, a, env.intern)));
      if (groundedV2 !== undefined)
        return yield* startMinimalGroundedV2G(
          groundedV2,
          env,
          st,
          prev,
          x2,
          "<grounded-exec>",
          x.kind === "expr" ? x.items.slice(1) : x2.items.slice(1),
          args,
          b,
          cursor,
        );
      pendingAsyncOpBox.op = "<grounded-exec>";
      type GroundedExecResult =
        | { readonly tag: "ok"; readonly results: readonly Atom[] }
        | { readonly tag: "error"; readonly message: string };
      const settled = (yield driverEffect(
        "<grounded-exec>",
        (): GroundedExecResult => {
          let results: readonly Atom[] | Promise<readonly Atom[]>;
          try {
            results = head.exec!(args, groundedCallContext(env, st.world));
          } catch (error) {
            if (isWorkerQuiescenceError(error)) throw error;
            return {
              tag: "error",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          if (isPromiseLike(results)) throw new AsyncInSyncError("<grounded-exec>");
          return { tag: "ok", results };
        },
        async (signal): Promise<GroundedExecResult> => {
          try {
            const results = await head.exec!(
              args,
              signal === NEVER_ABORTED_SIGNAL
                ? groundedCallContext(env, st.world)
                : groundedCallContextWithSignal(env, st.world, signal),
            );
            signal.throwIfAborted();
            return { tag: "ok", results };
          } catch (error) {
            if (isWorkerQuiescenceError(error)) throw error;
            signal.throwIfAborted();
            return {
              tag: "error",
              message: error instanceof Error ? error.message : String(error),
            };
          }
        },
      )) as GroundedExecResult;
      if (settled.tag === "error") return [[finItem(prev, errAtom(x2, settled.message), b)], st];
      recordGroundedOperationEffects(st.world, "<grounded-exec>", effectPolicy, settled.results);
      return [settled.results.map((res) => evalResult(prev, res, b, x2)), st];
    }
  }
  if (isEmbeddedOp(x2)) return [[{ stack: admitAtom(x2, prev), bnd: b }], st];
  return queryOp(env, st, prev, x2, b);
}
