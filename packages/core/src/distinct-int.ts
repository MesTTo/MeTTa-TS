// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Set-valued compiler for pure ground integer recurrences under unique(collapse ...). It follows clause
// order and left-to-right argument products, then keeps the first occurrence of each answer.
import { type Atom, gbool, gint } from "./atom";
import { type MinEnv } from "./eval";
import { addInt, cmpIntVal, type IntVal, mulInt, subInt } from "./number";
import { type TableBudget } from "./table-space";

type Value = IntVal | boolean;
type Frame = Value[];
type Node = (frame: Frame, context: EvalContext) => Value[];

interface EvalContext {
  readonly memo: Map<string, readonly Value[]>;
  readonly active: Set<string>;
  readonly budget: TableBudget;
  entries: number;
  answers: number;
  cells: number;
}

type Pattern =
  | { readonly kind: "slot"; readonly slot: number }
  | { readonly kind: "literal"; readonly value: Value };

interface Clause {
  readonly patterns: readonly Pattern[];
  readonly slotCount: number;
  readonly body: Node;
}

interface CompiledRelation {
  readonly arity: number;
  readonly evaluate: (args: readonly Value[], context: EvalContext) => readonly Value[];
}

export type DistinctIntResult =
  | { readonly tag: "ok"; readonly answers: readonly Atom[] }
  | { readonly tag: "limit" };

const BAIL = Symbol("distinct-int-bail");
const LIMIT = Symbol("distinct-int-limit");

function atomValue(atom: Atom): Value {
  if (atom.kind !== "gnd") throw BAIL;
  if (atom.value.g === "int") return atom.value.n;
  if (atom.value.g === "bool") return atom.value.b;
  throw BAIL;
}

function valueAtom(value: Value): Atom {
  return typeof value === "boolean" ? gbool(value) : gint(value);
}

function intValue(value: Value): IntVal {
  if (typeof value === "boolean") throw BAIL;
  return value;
}

function boolValue(value: Value): boolean {
  if (typeof value !== "boolean") throw BAIL;
  return value;
}

function valueKey(value: Value): string {
  return typeof value === "boolean" ? (value ? "b1" : "b0") : `i${String(value)}`;
}

function appendDistinct(
  out: Value[],
  seen: Set<string>,
  values: readonly Value[],
  maxAnswers: number,
): void {
  for (const value of values) {
    const key = valueKey(value);
    if (seen.has(key)) continue;
    if (out.length >= maxAnswers) throw LIMIT;
    seen.add(key);
    out.push(value);
  }
}

function constantNode(value: Value): Node {
  const result = [value];
  return () => result;
}

function compileBinaryValue(
  args: readonly Atom[],
  scope: ReadonlyMap<string, number>,
  target: string,
  callSelf: (args: readonly Value[], context: EvalContext) => readonly Value[],
  operation: (left: Value, right: Value) => Value,
): Node | undefined {
  if (args.length !== 2) return undefined;
  const left = compileNode(args[0]!, scope, target, callSelf);
  const right = compileNode(args[1]!, scope, target, callSelf);
  if (left === undefined || right === undefined) return undefined;
  return (frame, context) => {
    const out: Value[] = [];
    const seen = new Set<string>();
    for (const leftValue of left(frame, context))
      for (const rightValue of right(frame, context))
        appendDistinct(out, seen, [operation(leftValue, rightValue)], context.budget.maxEntryCells);
    return out;
  };
}

function compileIf(
  args: readonly Atom[],
  scope: ReadonlyMap<string, number>,
  target: string,
  callSelf: (args: readonly Value[], context: EvalContext) => readonly Value[],
): Node | undefined {
  if (args.length !== 3) return undefined;
  const condition = compileNode(args[0]!, scope, target, callSelf);
  const thenNode = compileNode(args[1]!, scope, target, callSelf);
  const elseNode = compileNode(args[2]!, scope, target, callSelf);
  if (condition === undefined || thenNode === undefined || elseNode === undefined) return undefined;
  return (frame, context) => {
    const out: Value[] = [];
    const seen = new Set<string>();
    for (const conditionValue of condition(frame, context))
      appendDistinct(
        out,
        seen,
        (boolValue(conditionValue) ? thenNode : elseNode)(frame, context),
        context.budget.maxEntryCells,
      );
    return out;
  };
}

function compileSelfCall(
  args: readonly Atom[],
  scope: ReadonlyMap<string, number>,
  target: string,
  callSelf: (args: readonly Value[], context: EvalContext) => readonly Value[],
): Node | undefined {
  const argumentNodes = args.map((arg) => compileNode(arg, scope, target, callSelf));
  if (argumentNodes.some((node) => node === undefined)) return undefined;
  const nodes = argumentNodes as Node[];
  return (frame, context) => {
    const out: Value[] = [];
    const seen = new Set<string>();
    const callArgs = new Array<Value>(nodes.length);
    const visit = (index: number): void => {
      if (index === nodes.length) {
        appendDistinct(out, seen, callSelf(callArgs, context), context.budget.maxEntryCells);
        return;
      }
      for (const value of nodes[index]!(frame, context)) {
        callArgs[index] = value;
        visit(index + 1);
      }
    };
    visit(0);
    return out;
  };
}

function compileNode(
  atom: Atom,
  scope: ReadonlyMap<string, number>,
  target: string,
  callSelf: (args: readonly Value[], context: EvalContext) => readonly Value[],
): Node | undefined {
  if (atom.kind === "var") {
    const slot = scope.get(atom.name);
    return slot === undefined ? undefined : (frame) => [frame[slot]!];
  }
  if (atom.kind === "gnd") {
    if (atom.value.g === "int") return constantNode(atom.value.n);
    if (atom.value.g === "bool") return constantNode(atom.value.b);
    return undefined;
  }
  if (atom.kind !== "expr" || atom.items.length === 0 || atom.items[0]!.kind !== "sym")
    return undefined;
  const op = atom.items[0]!.name;
  const args = atom.items.slice(1);
  if (op === target) return compileSelfCall(args, scope, target, callSelf);
  if (op === "+")
    return compileBinaryValue(args, scope, target, callSelf, (left, right) =>
      addInt(intValue(left), intValue(right)),
    );
  if (op === "-")
    return compileBinaryValue(args, scope, target, callSelf, (left, right) =>
      subInt(intValue(left), intValue(right)),
    );
  if (op === "*")
    return compileBinaryValue(args, scope, target, callSelf, (left, right) =>
      mulInt(intValue(left), intValue(right)),
    );
  if (op === "<")
    return compileBinaryValue(
      args,
      scope,
      target,
      callSelf,
      (left, right) => cmpIntVal(intValue(left), intValue(right)) < 0,
    );
  if (op === "<=")
    return compileBinaryValue(
      args,
      scope,
      target,
      callSelf,
      (left, right) => cmpIntVal(intValue(left), intValue(right)) <= 0,
    );
  if (op === ">")
    return compileBinaryValue(
      args,
      scope,
      target,
      callSelf,
      (left, right) => cmpIntVal(intValue(left), intValue(right)) > 0,
    );
  if (op === ">=")
    return compileBinaryValue(
      args,
      scope,
      target,
      callSelf,
      (left, right) => cmpIntVal(intValue(left), intValue(right)) >= 0,
    );
  if (op === "==")
    return compileBinaryValue(
      args,
      scope,
      target,
      callSelf,
      (left, right) => cmpIntVal(intValue(left), intValue(right)) === 0,
    );
  if (op === "if") return compileIf(args, scope, target, callSelf);
  return undefined;
}

function compilePattern(atom: Atom, scope: Map<string, number>): Pattern | undefined {
  if (atom.kind === "var") {
    if (scope.has(atom.name)) return undefined;
    const slot = scope.size;
    scope.set(atom.name, slot);
    return { kind: "slot", slot };
  }
  if (atom.kind === "gnd" && (atom.value.g === "int" || atom.value.g === "bool"))
    return { kind: "literal", value: atom.value.g === "int" ? atom.value.n : atom.value.b };
  return undefined;
}

function compileRelation(env: MinEnv, target: string): CompiledRelation | undefined {
  const equations = env.ruleIndex.get(target);
  if (equations === undefined || equations.length === 0) return undefined;
  let arity: number | undefined;
  let evaluate: (args: readonly Value[], context: EvalContext) => readonly Value[] = () => {
    throw BAIL;
  };
  const callSelf = (args: readonly Value[], context: EvalContext): readonly Value[] =>
    evaluate(args, context);
  const clauses: Clause[] = [];
  for (const [lhs, rhs] of equations) {
    if (
      lhs.kind !== "expr" ||
      lhs.items.length === 0 ||
      lhs.items[0]!.kind !== "sym" ||
      lhs.items[0]!.name !== target
    )
      return undefined;
    const clauseArity = lhs.items.length - 1;
    arity ??= clauseArity;
    if (clauseArity !== arity) return undefined;
    const scope = new Map<string, number>();
    const patterns = lhs.items.slice(1).map((arg) => compilePattern(arg, scope));
    if (patterns.some((pattern) => pattern === undefined)) return undefined;
    const body = compileNode(rhs, scope, target, callSelf);
    if (body === undefined) return undefined;
    clauses.push({ patterns: patterns as Pattern[], slotCount: scope.size, body });
  }
  if (arity === undefined) return undefined;
  evaluate = (args, context) => {
    if (args.length !== arity) throw BAIL;
    const key = args.map(valueKey).join("\u0000");
    const memoized = context.memo.get(key);
    if (memoized !== undefined) return memoized;
    if (context.active.has(key)) throw BAIL;
    const callCells = 1 + args.length;
    if (
      context.entries >= context.budget.maxCompletedEntries ||
      context.cells + callCells > context.budget.maxApproxCells
    )
      throw LIMIT;
    context.entries += 1;
    context.cells += callCells;
    context.active.add(key);
    try {
      const out: Value[] = [];
      const seen = new Set<string>();
      for (const clause of clauses) {
        const frame = new Array<Value>(clause.slotCount);
        let matched = true;
        for (let index = 0; index < clause.patterns.length; index++) {
          const pattern = clause.patterns[index]!;
          const actual = args[index]!;
          if (pattern.kind === "slot") frame[pattern.slot] = actual;
          else if (valueKey(pattern.value) !== valueKey(actual)) {
            matched = false;
            break;
          }
        }
        if (matched)
          appendDistinct(out, seen, clause.body(frame, context), context.budget.maxEntryCells);
      }
      if (
        callCells + out.length > context.budget.maxEntryCells ||
        context.answers + out.length > context.budget.maxCompletedAnswers ||
        context.cells + out.length > context.budget.maxApproxCells
      )
        throw LIMIT;
      context.answers += out.length;
      context.cells += out.length;
      context.memo.set(key, out);
      return out;
    } finally {
      context.active.delete(key);
    }
  };
  return { arity, evaluate };
}

/** Run a supported static relation as a bounded stable answer set. Undefined means use the evaluator. */
export function runDistinctIntRelation(
  env: MinEnv,
  target: string,
  args: readonly Atom[],
  budget: TableBudget,
): DistinctIntResult | undefined {
  const relation = compileRelation(env, target);
  if (relation === undefined || args.length !== relation.arity) return undefined;
  try {
    const values = args.map(atomValue);
    const answers = relation.evaluate(values, {
      memo: new Map(),
      active: new Set(),
      budget,
      entries: 0,
      answers: 0,
      cells: 0,
    });
    return { tag: "ok", answers: answers.map(valueAtom) };
  } catch (error) {
    if (error === LIMIT) return { tag: "limit" };
    if (error === BAIL) return undefined;
    throw error;
  }
}
