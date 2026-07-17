// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, atomEq, emptyExpr, expr, type ExprAtom, gint, sym, variable } from "../atom";
import { emptyLog, idxCount, logGroundIdx, logNonGround, logSize } from "../atomlog";
import { type Bindings, emptyBindings, hasLoop } from "../bindings";
import { runDistinctChoicePlanBound } from "../choice-plan";
import { evaluationCacheEnvironment } from "../eval/env";
import { inst, type MinEnv, type St, type World } from "../eval/machine";
import { choicePlanApplication, matchFromEmptyCollapseCheck } from "../eval/matchops";
import { appendSpace, subTokens } from "../eval/par";
import { candidatesW, resolveStates } from "../eval/query";
import {
  disableTabling,
  staticRulesChangedFor,
  visibleStaticRulesForHead,
} from "../eval/specializer";
import {
  canRunChoicePlan,
  choicePlanConstructor,
  choicePlanDataExpression,
  isClosedChoiceValue,
} from "../eval/tabling";
import { opOf } from "../eval/terms";
import { typeViewFor } from "../eval/typeops";
import { contextualSpaceName } from "../eval/world";
import { matchAtoms } from "../match";
import { addInt, type IntVal, subInt } from "../number";

export function tryFastNamedOnceMatch(
  env: MinEnv,
  st: St,
  body: Atom,
  b: Bindings,
): { value: Atom | undefined; state: St } | undefined {
  if (body.kind !== "expr" || opOf(body) !== "match" || body.items.length !== 4) return undefined;
  const sn = contextualSpaceName(env, st.world, inst(env, b, body.items[1]!));
  if (sn === undefined || sn === "&self") return undefined;
  const subbed = subTokens(st.world, body.items[2]!, env.intern);
  if (opOf(subbed) === "," && subbed.kind === "expr") return undefined;
  const pInst = inst(env, b, resolveStates(st.world, subbed));
  const space = st.world.spaces.get(sn) ?? emptyLog;
  if (!pInst.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const st2 = { counter: st.counter + logSize(space), world: st.world };
  if (idxCount(logGroundIdx(space), pInst) === 0) return { value: undefined, state: st2 };
  return { value: inst(env, b, body.items[3]!), state: st2 };
}

export function tryFastNamedAddIfAbsent(
  env: MinEnv,
  st: St,
  ifExpr: ExprAtom,
  b: Bindings,
): { added: boolean; state: St } | undefined {
  const match = matchFromEmptyCollapseCheck(ifExpr.items[1]!);
  if (match === undefined) return undefined;
  const add = ifExpr.items[2]!;
  const otherwise = ifExpr.items[3]!;
  if (
    add.kind !== "expr" ||
    opOf(add) !== "add-atom" ||
    add.items.length !== 3 ||
    otherwise.kind !== "expr" ||
    opOf(otherwise) !== "empty" ||
    otherwise.items.length !== 1
  )
    return undefined;
  const matchSpace = inst(env, b, match.items[1]!);
  const addSpace = inst(env, b, add.items[1]!);
  const matchAtom = inst(
    env,
    b,
    resolveStates(st.world, subTokens(st.world, match.items[2]!, env.intern)),
  );
  const addAtom = inst(env, b, add.items[2]!);
  if (!atomEq(matchSpace, addSpace) || !atomEq(matchAtom, addAtom)) return undefined;
  const name = contextualSpaceName(env, st.world, matchSpace);
  if (name === undefined || name === "&self") return undefined;
  const space = st.world.spaces.get(name) ?? emptyLog;
  if (!matchAtom.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const checked: St = { counter: st.counter + logSize(space), world: st.world };
  if (idxCount(logGroundIdx(space), matchAtom) !== 0) return { added: false, state: checked };
  if (opOf(addAtom) === "=") disableTabling(evaluationCacheEnvironment(env));
  return {
    added: true,
    state: {
      counter: checked.counter,
      world: appendSpace(env, checked.world, name, [addAtom]),
    },
  };
}

function isCanonicalAddUniqueRule(lhs: Atom, rhs: Atom): boolean {
  if (lhs.kind !== "expr" || opOf(lhs) !== "add-unique-or-fail" || lhs.items.length !== 3)
    return false;
  const spaceVar = lhs.items[1]!;
  const exprVar = lhs.items[2]!;
  if (spaceVar.kind !== "var" || exprVar.kind !== "var") return false;
  if (rhs.kind !== "expr" || opOf(rhs) !== "let" || rhs.items.length !== 4) return false;
  const stVar = rhs.items[1]!;
  const key = rhs.items[2]!;
  const body = rhs.items[3]!;
  if (stVar.kind !== "var") return false;
  if (
    key.kind !== "expr" ||
    opOf(key) !== "s" ||
    key.items.length !== 2 ||
    key.items[1]!.kind !== "expr" ||
    opOf(key.items[1]!) !== "repra" ||
    key.items[1]!.items.length !== 2 ||
    !atomEq(key.items[1]!.items[1]!, exprVar)
  )
    return false;
  if (body.kind !== "expr" || opOf(body) !== "if" || body.items.length !== 4) return false;
  const match = matchFromEmptyCollapseCheck(body.items[1]!);
  const add = body.items[2]!;
  const otherwise = body.items[3]!;
  return (
    match !== undefined &&
    atomEq(match.items[1]!, spaceVar) &&
    atomEq(match.items[2]!, stVar) &&
    add.kind === "expr" &&
    opOf(add) === "add-atom" &&
    add.items.length === 3 &&
    atomEq(add.items[1]!, spaceVar) &&
    atomEq(add.items[2]!, stVar) &&
    otherwise.kind === "expr" &&
    opOf(otherwise) === "empty" &&
    otherwise.items.length === 1
  );
}

export function tryFastAddUniqueOrFailCall(
  env: MinEnv,
  st: St,
  call: ExprAtom,
  b: Bindings,
): { added: boolean; state: St } | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalAddUniqueRule(rules[0]![0], rules[0]![1])) return undefined;
  const spaceAtom = inst(env, b, call.items[1]!);
  const name = contextualSpaceName(env, st.world, spaceAtom);
  if (name === undefined || name === "&self") return undefined;
  const value = inst(env, b, call.items[2]!);
  const key = expr([sym("s"), expr([sym("repra"), value])]);
  const space = st.world.spaces.get(name) ?? emptyLog;
  if (!key.ground || logNonGround(space) !== 0 || st.world.store.size !== 0) return undefined;
  const checked: St = {
    counter: st.counter + rules.length + logSize(space),
    world: st.world,
  };
  if (idxCount(logGroundIdx(space), key) !== 0) return { added: false, state: checked };
  return {
    added: true,
    state: {
      counter: checked.counter,
      world: appendSpace(env, checked.world, name, [key]),
    },
  };
}

type QueueParts = { inList: ExprAtom; outList: ExprAtom; size: IntVal };

type FastRuleResult = { results: Array<[Atom, Bindings]>; state: St };

const isExprOp = (a: Atom, op: string, len: number): a is ExprAtom =>
  a.kind === "expr" && a.items.length === len && opOf(a) === op;

const isRuleVar = (a: Atom): boolean => a.kind === "var";

const isIntLiteral = (a: Atom, n: IntVal): boolean => atomEq(a, gint(n));

const intValue = (a: Atom): IntVal | undefined =>
  a.kind === "gnd" && a.value.g === "int" ? a.value.n : undefined;

type QueueRuleArgs = { eVar: Atom; inVar: Atom; outAtom: Atom; nVar: Atom };

function queueRuleArgs(lhs: Atom, op: "enqueue" | "dequeue"): QueueRuleArgs | undefined {
  if (!isExprOp(lhs, op, 3)) return undefined;
  const eVar = lhs.items[1]!;
  const lhsQueue = lhs.items[2]!;
  if (!isRuleVar(eVar) || !isExprOp(lhsQueue, "queue", 4)) return undefined;
  return {
    eVar,
    inVar: lhsQueue.items[1]!,
    outAtom: lhsQueue.items[2]!,
    nVar: lhsQueue.items[3]!,
  };
}

function queueParts(a: Atom): QueueParts | undefined {
  if (!isExprOp(a, "queue", 4)) return undefined;
  const inList = a.items[1]!;
  const outList = a.items[2]!;
  const size = intValue(a.items[3]!);
  if (inList.kind !== "expr" || outList.kind !== "expr" || size === undefined) return undefined;
  return { inList, outList, size };
}

function plusOne(a: Atom, v: Atom): boolean {
  return isExprOp(a, "+", 3) && atomEq(a.items[1]!, v) && isIntLiteral(a.items[2]!, 1);
}

function minusOne(a: Atom, v: Atom): boolean {
  return isExprOp(a, "-", 3) && atomEq(a.items[1]!, v) && isIntLiteral(a.items[2]!, 1);
}

function isCanonicalEmptyQueueRule(lhs: Atom, rhs: Atom): boolean {
  return (
    isExprOp(lhs, "empty-queue", 1) &&
    isExprOp(rhs, "queue", 4) &&
    atomEq(rhs.items[1]!, emptyExpr) &&
    atomEq(rhs.items[2]!, emptyExpr) &&
    isIntLiteral(rhs.items[3]!, 0)
  );
}

function isCanonicalEnqueueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "enqueue");
  if (lhsVars === undefined || !isExprOp(rhs, "queue", 4)) return false;
  const { eVar, inVar, outAtom: outVar, nVar } = lhsVars;
  const rhsIn = rhs.items[1]!;
  return (
    isRuleVar(inVar) &&
    isRuleVar(outVar) &&
    isRuleVar(nVar) &&
    isExprOp(rhsIn, "cons", 3) &&
    atomEq(rhsIn.items[1]!, eVar) &&
    atomEq(rhsIn.items[2]!, inVar) &&
    atomEq(rhs.items[2]!, outVar) &&
    plusOne(rhs.items[3]!, nVar)
  );
}

function isCanonicalNormalDequeueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "dequeue");
  if (lhsVars === undefined || !isExprOp(rhs, "queue", 4)) return false;
  const { eVar, inVar, outAtom: outCons, nVar } = lhsVars;
  if (!isRuleVar(inVar) || !isRuleVar(nVar) || !isExprOp(outCons, "cons", 3)) return false;
  const outVar = outCons.items[2]!;
  return (
    isRuleVar(outVar) &&
    atomEq(outCons.items[1]!, eVar) &&
    atomEq(rhs.items[1]!, inVar) &&
    atomEq(rhs.items[2]!, outVar) &&
    minusOne(rhs.items[3]!, nVar)
  );
}

function isCanonicalReverseDequeueRule(lhs: Atom, rhs: Atom): boolean {
  const lhsVars = queueRuleArgs(lhs, "dequeue");
  if (lhsVars === undefined || !isExprOp(rhs, "let", 4)) return false;
  const { eVar, inVar, outAtom, nVar } = lhsVars;
  if (!isRuleVar(inVar) || !atomEq(outAtom, emptyExpr) || !isRuleVar(nVar)) return false;
  const pat = rhs.items[1]!;
  const rev = rhs.items[2]!;
  const body = rhs.items[3]!;
  if (!isExprOp(pat, "cons", 3) || !isExprOp(rev, "reverse", 2) || !isExprOp(body, "queue", 4))
    return false;
  const restVar = pat.items[2]!;
  return (
    isRuleVar(restVar) &&
    atomEq(pat.items[1]!, eVar) &&
    atomEq(rev.items[1]!, inVar) &&
    atomEq(body.items[1]!, emptyExpr) &&
    atomEq(body.items[2]!, restVar) &&
    minusOne(body.items[3]!, nVar)
  );
}

function isCanonicalEmptyQueueCall(a: Atom): boolean {
  return isExprOp(a, "empty-queue", 1);
}

function isCanonicalAddUniqueOrFailCall(a: Atom, space: Atom, value: Atom): boolean {
  return (
    isExprOp(a, "add-unique-or-fail", 3) && atomEq(a.items[1]!, space) && atomEq(a.items[2]!, value)
  );
}

function letStarParts(
  a: Atom,
): { readonly bindings: readonly Atom[]; readonly body: Atom } | undefined {
  if (!isExprOp(a, "let*", 3)) return undefined;
  const bindings = a.items[1]!;
  return bindings.kind === "expr" ? { bindings: bindings.items, body: a.items[2]! } : undefined;
}

function bindingPair(a: Atom): readonly [Atom, Atom] | undefined {
  return a.kind === "expr" && a.items.length === 2 ? [a.items[0]!, a.items[1]!] : undefined;
}

function isMoveAnyCall(a: Atom, state: Atom): boolean {
  return isExprOp(a, "move", 3) && atomEq(a.items[1]!, state) && a.items[2]!.kind === "var";
}

function isCanonicalTilePuzzleBfsAllRule(lhs: Atom, rhs: Atom): boolean {
  if (!isExprOp(lhs, "bfs_all", 2)) return false;
  const start = lhs.items[1]!;
  if (start.kind !== "var") return false;
  const parts = letStarParts(rhs);
  if (parts === undefined || parts.bindings.length !== 2) return false;
  const first = bindingPair(parts.bindings[0]!);
  const second = bindingPair(parts.bindings[1]!);
  if (first === undefined || second === undefined) return false;
  const [ptVar, markStart] = first;
  const [qVar, enqueueStart] = second;
  if (ptVar.kind !== "var" || qVar.kind !== "var") return false;
  if (!isCanonicalAddUniqueOrFailCall(markStart, sym("&dup"), start)) return false;
  if (!isExprOp(enqueueStart, "enqueue", 3)) return false;
  if (!atomEq(enqueueStart.items[1]!, start)) return false;
  if (!isCanonicalEmptyQueueCall(enqueueStart.items[2]!)) return false;
  return (
    isExprOp(parts.body, "bfs_loop", 3) &&
    atomEq(parts.body.items[1]!, qVar) &&
    isIntLiteral(parts.body.items[2]!, 0)
  );
}

function isCanonicalTilePuzzleBfsLoopEmptyRule(lhs: Atom, rhs: Atom): boolean {
  return (
    isExprOp(lhs, "bfs_loop", 3) &&
    isCanonicalEmptyQueueCall(lhs.items[1]!) &&
    lhs.items[2]!.kind === "var" &&
    atomEq(lhs.items[2]!, rhs)
  );
}

function isCanonicalTilePuzzleBfsLoopStepRule(lhs: Atom, rhs: Atom): boolean {
  if (!isExprOp(lhs, "bfs_loop", 3)) return false;
  const q = lhs.items[1]!;
  const n0 = lhs.items[2]!;
  if (q.kind !== "var" || n0.kind !== "var") return false;
  const parts = letStarParts(rhs);
  if (parts === undefined || parts.bindings.length !== 4) return false;
  const q1 = bindingPair(parts.bindings[0]!);
  const ln = bindingPair(parts.bindings[1]!);
  const q2 = bindingPair(parts.bindings[2]!);
  const n1 = bindingPair(parts.bindings[3]!);
  if (q1 === undefined || ln === undefined || q2 === undefined || n1 === undefined) return false;
  const [q1Var, dequeueCall] = q1;
  const [lnVar, collapseCall] = ln;
  const [q2Var, foldCall] = q2;
  const [n1Var, plusCall] = n1;
  if (q1Var.kind !== "var" || lnVar.kind !== "var" || q2Var.kind !== "var" || n1Var.kind !== "var")
    return false;
  if (!isExprOp(dequeueCall, "once", 2)) return false;
  const dequeue = dequeueCall.items[1]!;
  if (!isExprOp(dequeue, "dequeue", 3) || dequeue.items[1]!.kind !== "var") return false;
  const stateVar = dequeue.items[1]!;
  if (!atomEq(dequeue.items[2]!, q)) return false;
  if (!isExprOp(collapseCall, "collapse", 2)) return false;
  const collapseBody = collapseCall.items[1]!;
  const inner = letStarParts(collapseBody);
  if (inner === undefined || inner.bindings.length !== 2) return false;
  const snew = bindingPair(inner.bindings[0]!);
  const marker = bindingPair(inner.bindings[1]!);
  if (snew === undefined || marker === undefined) return false;
  const [snewVar, moveCall] = snew;
  const [, markCall] = marker;
  if (snewVar.kind !== "var") return false;
  if (!isMoveAnyCall(moveCall, stateVar)) return false;
  if (!isCanonicalAddUniqueOrFailCall(markCall, sym("&dup"), snewVar)) return false;
  if (!atomEq(inner.body, snewVar)) return false;
  if (!isExprOp(foldCall, "foldl", 4)) return false;
  if (!atomEq(foldCall.items[1]!, sym("enqueue"))) return false;
  if (!atomEq(foldCall.items[2]!, lnVar) || !atomEq(foldCall.items[3]!, q1Var)) return false;
  if (
    !isExprOp(plusCall, "+", 3) ||
    !atomEq(plusCall.items[1]!, n0) ||
    !isIntLiteral(plusCall.items[2]!, 1)
  )
    return false;
  return (
    isExprOp(parts.body, "bfs_loop", 3) &&
    atomEq(parts.body.items[1]!, q2Var) &&
    atomEq(parts.body.items[2]!, n1Var)
  );
}

function tryFastEmptyQueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalEmptyQueueRule(rules[0]![0], rules[0]![1]))
    return undefined;
  return {
    results: [[expr([sym("queue"), emptyExpr, emptyExpr, gint(0)]), emptyBindings]],
    state: { counter: st.counter + rules.length, world: st.world },
  };
}

function tryFastEnqueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (rules.length !== 1 || !isCanonicalEnqueueRule(rules[0]![0], rules[0]![1])) return undefined;
  const q = queueParts(call.items[2]!);
  if (q === undefined) return undefined;
  const nextIn = expr([call.items[1]!, ...q.inList.items]);
  return {
    results: [[expr([sym("queue"), nextIn, q.outList, gint(addInt(q.size, 1))]), emptyBindings]],
    // The interpreted RHS calls the stdlib `(cons ...)` rule once before `queue` becomes inert.
    state: { counter: st.counter + rules.length + 1, world: st.world },
  };
}

function queuePopBindings(want: Atom, got: Atom): Bindings[] | undefined {
  const ms = matchAtoms(want, got).filter((m) => !hasLoop(m));
  return ms.length === 0 ? undefined : ms;
}

function tryFastDequeueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const rules = candidatesW(env, st.world, call);
  if (
    rules.length !== 2 ||
    !isCanonicalNormalDequeueRule(rules[0]![0], rules[0]![1]) ||
    !isCanonicalReverseDequeueRule(rules[1]![0], rules[1]![1])
  )
    return undefined;
  const q = queueParts(call.items[2]!);
  if (q === undefined) return undefined;
  const wanted = call.items[1]!;
  if (q.outList.items.length > 0) {
    const got = q.outList.items[0]!;
    const ms = queuePopBindings(wanted, got);
    if (ms === undefined) return undefined;
    const next = expr([
      sym("queue"),
      q.inList,
      expr(q.outList.items.slice(1)),
      gint(subInt(q.size, 1)),
    ]);
    return {
      results: ms.map((m) => [next, m]),
      state: { counter: st.counter + rules.length, world: st.world },
    };
  }
  if (q.inList.items.length === 0) return undefined;
  const reversed = [...q.inList.items].reverse();
  const got = reversed[0]!;
  const ms = queuePopBindings(wanted, got);
  if (ms === undefined) return undefined;
  const next = expr([sym("queue"), emptyExpr, expr(reversed.slice(1)), gint(subInt(q.size, 1))]);
  return {
    results: ms.map((m) => [next, m]),
    // The reverse branch applies the dequeue rule, then the stdlib `let` rule.
    state: { counter: st.counter + rules.length + 1, world: st.world },
  };
}

export function tryFastQueueCall(env: MinEnv, st: St, call: ExprAtom): FastRuleResult | undefined {
  const op = opOf(call);
  if (op === "empty-queue" && call.items.length === 1) return tryFastEmptyQueueCall(env, st, call);
  if (op === "enqueue" && call.items.length === 3) return tryFastEnqueueCall(env, st, call);
  if (op === "dequeue" && call.items.length === 3) return tryFastDequeueCall(env, st, call);
  return undefined;
}

function tileCellKey(a: Atom): string | undefined {
  if (a.kind === "sym") return "s:" + a.name;
  if (a.kind === "gnd" && a.value.g === "int") return "i:" + String(a.value.n);
  return undefined;
}

function tileStateKey(a: Atom): string | undefined {
  if (a.kind !== "expr" || a.items.length !== 9) return undefined;
  const parts: string[] = [];
  let blanks = 0;
  for (const cell of a.items) {
    if (cell.kind === "sym" && cell.name === "___") blanks += 1;
    const k = tileCellKey(cell);
    if (k === undefined) return undefined;
    parts.push(k);
  }
  return blanks === 1 ? parts.join("|") : undefined;
}

function tileNeighbors(state: ExprAtom): ExprAtom[] {
  const blank = state.items.findIndex((x) => x.kind === "sym" && x.name === "___");
  const swaps =
    blank === 0
      ? [1, 3]
      : blank === 1
        ? [0, 2, 4]
        : blank === 2
          ? [1, 5]
          : blank === 3
            ? [0, 4, 6]
            : blank === 4
              ? [1, 3, 5, 7]
              : blank === 5
                ? [2, 4, 8]
                : blank === 6
                  ? [3, 7]
                  : blank === 7
                    ? [4, 6, 8]
                    : [5, 7];
  const out: ExprAtom[] = [];
  for (const j of swaps) {
    const items = state.items.slice();
    [items[blank], items[j]] = [items[j]!, items[blank]!];
    out.push(expr(items));
  }
  return out;
}

function tileVisitedAtom(state: Atom): Atom {
  return expr([sym("s"), expr([sym("repra"), state])]);
}

function hasCanonicalTilePuzzleRuntime(env: MinEnv, w: World): boolean {
  if ((env.ruleIndex.get("move")?.length ?? 0) !== 24) return false;
  const bfsAllRules = visibleStaticRulesForHead(env, w, "bfs_all");
  if (
    bfsAllRules.length !== 1 ||
    !isCanonicalTilePuzzleBfsAllRule(bfsAllRules[0]![0], bfsAllRules[0]![1])
  )
    return false;
  const bfsLoopRules = visibleStaticRulesForHead(env, w, "bfs_loop");
  if (
    bfsLoopRules.length !== 2 ||
    !isCanonicalTilePuzzleBfsLoopEmptyRule(bfsLoopRules[0]![0], bfsLoopRules[0]![1]) ||
    !isCanonicalTilePuzzleBfsLoopStepRule(bfsLoopRules[1]![0], bfsLoopRules[1]![1])
  )
    return false;
  if (logSize(w.spaces.get("&dup") ?? emptyLog) !== 0) return false;
  const emptyRules = candidatesW(env, w, expr([sym("empty-queue")]));
  if (emptyRules.length !== 1 || !isCanonicalEmptyQueueRule(emptyRules[0]![0], emptyRules[0]![1]))
    return false;
  const enqueueRules = candidatesW(
    env,
    w,
    expr([sym("enqueue"), emptyExpr, expr([sym("queue"), emptyExpr, emptyExpr, gint(0)])]),
  );
  if (
    enqueueRules.length !== 1 ||
    !isCanonicalEnqueueRule(enqueueRules[0]![0], enqueueRules[0]![1])
  )
    return false;
  const dequeueRules = candidatesW(
    env,
    w,
    expr([sym("dequeue"), variable("_"), expr([sym("queue"), emptyExpr, emptyExpr, gint(0)])]),
  );
  if (
    dequeueRules.length !== 2 ||
    !isCanonicalNormalDequeueRule(dequeueRules[0]![0], dequeueRules[0]![1]) ||
    !isCanonicalReverseDequeueRule(dequeueRules[1]![0], dequeueRules[1]![1])
  )
    return false;
  const addUniqueRules = candidatesW(
    env,
    w,
    expr([sym("add-unique-or-fail"), sym("&dup"), emptyExpr]),
  );
  return (
    addUniqueRules.length === 1 &&
    isCanonicalAddUniqueRule(addUniqueRules[0]![0], addUniqueRules[0]![1])
  );
}

export function tryFastTilePuzzleBfsAll(
  env: MinEnv,
  st: St,
  call: ExprAtom,
): FastRuleResult | undefined {
  if (opOf(call) !== "bfs_all" || call.items.length !== 2 || st.world.store.size !== 0)
    return undefined;
  const start = call.items[1]!;
  const startKey = tileStateKey(start);
  if (start.kind !== "expr" || startKey === undefined) return undefined;
  if (!hasCanonicalTilePuzzleRuntime(env, st.world)) return undefined;
  const seen = new Set<string>();
  const added: Atom[] = [];
  const queue: ExprAtom[] = [start];
  let head = 0;
  while (head < queue.length) {
    const state = queue[head++]!;
    for (const next of tileNeighbors(state)) {
      const key = tileStateKey(next)!;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(tileVisitedAtom(next));
      queue.push(next);
    }
  }
  return {
    results: [[gint(queue.length), emptyBindings]],
    state: {
      counter: st.counter,
      world: appendSpace(env, st.world, "&dup", added),
    },
  };
}

export function tryFastUniqueChoiceFunction(
  env: MinEnv,
  world: World,
  op: string,
  args: readonly Atom[],
): Atom[] | undefined {
  if (
    typeViewFor(env, world).sigs.has(op) ||
    world.selfRules.has(op) ||
    staticRulesChangedFor(world, op)
  )
    return undefined;
  const rules = env.ruleIndex.get(op);
  if (rules?.length !== 1) return undefined;
  const [lhs, rhs] = rules[0]!;
  if (
    lhs.kind !== "expr" ||
    lhs.items.length !== args.length + 1 ||
    lhs.items[0]!.kind !== "sym" ||
    lhs.items[0]!.name !== op ||
    rhs.kind !== "expr" ||
    opOf(rhs) !== "unique-atom" ||
    rhs.items.length !== 2
  )
    return undefined;
  const collapse = rhs.items[1]!;
  if (collapse.kind !== "expr" || opOf(collapse) !== "collapse" || collapse.items.length !== 2)
    return undefined;
  if (!canRunChoicePlan(env, world) || !args.every((arg) => isClosedChoiceValue(env, world, arg)))
    return undefined;
  const bindings = new Map<string, Atom>();
  for (let index = 0; index < args.length; index++) {
    const parameter = lhs.items[index + 1]!;
    if (parameter.kind !== "var" || bindings.has(parameter.name)) return undefined;
    bindings.set(parameter.name, args[index]!);
  }
  const planned = runDistinctChoicePlanBound(
    collapse.items[1]!,
    bindings,
    choicePlanConstructor(env, world),
    choicePlanDataExpression(env, world),
    choicePlanApplication(env, world),
  );
  if (planned === undefined) return undefined;
  return [sym(","), ...planned];
}
