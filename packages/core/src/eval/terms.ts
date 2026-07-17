// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, atomEq, atomVars, collectVars, expr, sym } from "../atom";
import { type Bindings } from "../bindings";
import {
  AsyncInSyncError,
  cons,
  driverEffect,
  type DriverEffect,
  errTextAtom,
  frame,
  type Frame,
  inst,
  type Item,
  type MinEnv,
  type St,
  type Stack,
  type World,
} from "../eval/machine";
import { tryFormatTransportAtom } from "../standard-syntax";
import { uniqueVariablesInAtoms } from "../variable-scope";
import { isWorkerReplaySafeAtom } from "../worker-replay";

export function opOf(a: Atom): string | undefined {
  return a.kind === "expr" && a.items.length > 0 && a.items[0]!.kind === "sym"
    ? (a.items[0] as { name: string }).name
    : undefined;
}

function isStaticProgramWorld(world: World): boolean {
  return (
    world.generation === 0 &&
    world.moduleInstallations.length === 0 &&
    world.transactionDepth === 0 &&
    world.spaces.size === 0 &&
    world.store.size === 0 &&
    world.tokens.size === 0 &&
    world.selfExtra === null &&
    world.flatSelfExtra === undefined &&
    world.selfRules.size === 0 &&
    world.selfVarRules.length === 0 &&
    world.removedStatic === null &&
    !world.hasTypeMutations &&
    world.maxStackDepth === 0
  );
}

function legacyHyperposeBranchSources(
  env: MinEnv,
  world: World,
  bindings: Bindings,
  argument: Atom,
): string[] | undefined {
  if (!isStaticProgramWorld(world)) return undefined;
  const call = inst(env, bindings, argument);
  if (call.kind !== "expr" || opOf(call) !== "hyperpose" || call.items.length !== 2)
    return undefined;
  const tuple = call.items[1]!;
  if (tuple.kind !== "expr" || tuple.items.length === 0) return undefined;
  const safeFunctors = env.workerReplaySafeFunctors;
  if (safeFunctors === undefined) return undefined;
  const sources: string[] = [];
  for (const branch of tuple.items) {
    if (!branch.ground || !isWorkerReplaySafeAtom(env, branch, safeFunctors)) return undefined;
    const source = tryFormatTransportAtom(branch, "value");
    if (source === undefined) return undefined;
    sources.push(source);
  }
  return sources;
}

export function legacyHyperposeEffect(
  env: MinEnv,
  state: St,
  fuel: number,
  bindings: Bindings,
  argument: Atom,
): DriverEffect<{ readonly atoms: Atom[]; readonly counterDelta: number } | undefined> | undefined {
  if (env.parEval === undefined && env.parEvalAsync === undefined) return undefined;
  const branchSources = legacyHyperposeBranchSources(env, state.world, bindings, argument);
  if (branchSources === undefined) return undefined;
  const select = (
    branches: readonly ({ readonly atoms: Atom[]; readonly counterDelta: number } | null)[],
  ): { readonly atoms: Atom[]; readonly counterDelta: number } | undefined => {
    if (branches.some((branch) => branch === null)) return undefined;
    const completed = branches as readonly {
      readonly atoms: Atom[];
      readonly counterDelta: number;
    }[];
    const selected = completed.find((branch) => branch.atoms.length > 0) ?? {
      atoms: [],
      counterDelta: Math.max(0, ...completed.map((branch) => branch.counterDelta)),
    };
    if (
      selected.atoms.some((atom) => !atom.ground) ||
      selected.counterDelta > Number.MAX_SAFE_INTEGER - state.counter
    )
      return undefined;
    return selected;
  };
  return driverEffect(
    "legacy-hyperpose",
    () => {
      if (env.parEval === undefined) throw new AsyncInSyncError("legacy-hyperpose");
      return select(env.parEval(branchSources, true, fuel, state.counter));
    },
    async (signal) =>
      select(
        env.parEvalAsync !== undefined
          ? await env.parEvalAsync(branchSources, true, signal, fuel, state.counter)
          : env.parEval!(branchSources, true, fuel, state.counter),
      ),
  );
}

const EMBEDDED = new Set([
  "eval",
  "evalc",
  "chain",
  "unify",
  "cons-atom",
  "decons-atom",
  "function",
  "collapse-bind",
  "superpose-bind",
  "metta",
  "metta-thread",
  "capture",
  "context-space",
  "match",
  "get-type",
  "get-type-space",
  "check-types",
  "get-doc",
  "new-state",
  "get-state",
  "change-state!",
  "new-space",
  "new-mork-space",
  "fork-space",
  "add-atom",
  "remove-atom",
  "get-atoms",
  "bind!",
  "import!",
  // Sets interpreter settings in-language (Hyperon `pragma!`); stateful, so handled here not as a pure op.
  "pragma!",
  // TS-native extension (not upstream MeTTa): atomic space mutation with rollback.
  "transaction",
  // TS-native concurrency primitives (async-only); see docs/.../concurrency-primitives.md.
  "par",
  "race",
  "once",
  "with-mutex",
]);

export function isEmbeddedOp(a: Atom): boolean {
  const op = opOf(a);
  return op !== undefined && EMBEDDED.has(op);
}

const varsCopy = (prev: Stack): readonly string[] => (prev !== null ? prev.head.vars : []);

export function headKey(a: Atom): string | undefined {
  if (a.kind === "sym") return a.name;
  if (a.kind === "expr" && a.items.length > 0 && a.items[0]!.kind === "sym")
    return (a.items[0] as { name: string }).name;
  return undefined;
}

function malformedCoreInstruction(a: Atom, operation: string, expected: string): Frame {
  return frame(errTextAtom(a, `${operation}: expected ${expected}`), "none", [], "deliver");
}

export function malformedCoreInstructionAtom(a: Atom, operation: string): Atom | undefined {
  switch (operation) {
    case "eval":
      return errTextAtom(a, "eval: expected one atom");
    case "chain":
      return errTextAtom(a, "chain: expected a source, variable, and template");
    case "function":
      return errTextAtom(a, "function: expected one body");
    case "unify":
      return errTextAtom(a, "unify: expected an atom, pattern, then branch, and else branch");
    default:
      return undefined;
  }
}

/** Admit an atom as code. Delivered atoms never pass through this function implicitly. */
export function admitAtom(a: Atom, prev: Stack, callAtom?: Atom): Stack {
  if (a.kind === "expr") {
    const op = opOf(a);
    const it = a.items;
    if (op === "chain" && it.length === 4 && it[2]!.kind === "var") {
      return admitAtom(it[1]!, cons(frame(a, "chain", varsCopy(prev)), prev));
    }
    if (op === "function" && it.length === 2) {
      const delimiter = frame(a, "function", varsCopy(prev), "execute", callAtom ?? a);
      return admitAtom(it[1]!, cons(delimiter, prev));
    }
    if (op === "unify" && it.length === 5) {
      return cons(frame(a, "none"), prev);
    }
    if (op === "chain") {
      return cons(malformedCoreInstruction(a, "chain", "a source, variable, and template"), prev);
    }
    if (op === "function") return cons(malformedCoreInstruction(a, "function", "one body"), prev);
    if (op === "unify")
      return cons(
        malformedCoreInstruction(a, "unify", "an atom, pattern, then branch, and else branch"),
        prev,
      );
  }
  return cons(frame(a, "none", varsCopy(prev)), prev);
}

export function finItem(st: Stack, a: Atom, b: Bindings): Item {
  return { stack: cons(frame(a, "none", [], "deliver"), st), bnd: b };
}

export function evalResult(prev: Stack, r: Atom, b: Bindings, callAtom?: Atom): Item {
  if (opOf(r) === "function") return { stack: admitAtom(r, prev, callAtom), bnd: b };
  return finItem(prev, r, b);
}

export const isFinal = (it: Item): boolean =>
  it.stack !== null && it.stack.tail === null && it.stack.head.fin;

export function queryVarsOf(args: readonly Atom[]): readonly string[] {
  const out: string[] = [];
  for (const a of args) if (!a.ground) out.push(...atomVars(a));
  return out;
}

export function scopeVars(env: MinEnv, b: Bindings, prev: Stack): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let p = prev; p !== null; p = p.tail) collectVars(inst(env, b, p.head.atom), out, seen);
  return out;
}

export function chainLiveVars(cont: Atom, prev: Stack): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let p = prev; p !== null; p = p.tail) collectVars(p.head.atom, out, seen);
  collectVars(cont, out, seen);
  return out;
}

export function bindingPacketVisibleVariables(source: Atom, result: Atom, prev: Stack) {
  const atoms: Atom[] = [source, result];
  for (let frameStack = prev; frameStack !== null; frameStack = frameStack.tail)
    atoms.push(frameStack.head.atom);
  return uniqueVariablesInAtoms(atoms);
}

/** The stdlib `collapse` continuation observes only each pair's first item through `collapse-extract`. */
export function collapseBindDiscardsBindings(prev: Stack): boolean {
  if (prev === null || prev.head.ret !== "chain") return false;
  const outer = prev.head.atom;
  if (outer.kind !== "expr" || opOf(outer) !== "chain" || outer.items.length !== 4) return false;
  const packetVariable = outer.items[2]!;
  const continuation = outer.items[3]!;
  if (
    packetVariable.kind !== "var" ||
    continuation.kind !== "expr" ||
    opOf(continuation) !== "chain" ||
    continuation.items.length !== 4
  )
    return false;
  const source = continuation.items[1]!;
  if (source.kind !== "expr" || opOf(source) !== "eval" || source.items.length !== 2) return false;
  const extract = source.items[1]!;
  return (
    extract.kind === "expr" &&
    opOf(extract) === "collapse-extract" &&
    extract.items.length === 2 &&
    atomEq(extract.items[1]!, packetVariable)
  );
}

export function argMask(ts: Atom[] | undefined, arity: number): boolean[] {
  const mask = new Array<boolean>(arity);
  if (ts === undefined) {
    mask.fill(true);
    return mask;
  }
  // A parameter typed Atom/Variable/Expression accepts its argument unreduced (gradual top plus
  // meta-types), so that position is not evaluated; every other position is. Checked by name to avoid
  // allocating throwaway symbols for `atomEq` on this per-reduction hot path.
  for (let i = 0; i < arity; i++) {
    const t = ts[i];
    mask[i] =
      t === undefined ||
      !(
        t.kind === "sym" &&
        (t.name === "Atom" || t.name === "Variable" || t.name === "Expression")
      );
  }
  return mask;
}

export const lowerFunctionHead = /^[a-z_]/;

const STRICT_HYPERON_ARITY = new Map<string, number>([
  ["==", 2],
  ["!=", 2],
  ["=alpha", 2],
  ["if-equal", 4],
  ["unquote", 1],
  ["cons-atom", 2],
  ["size-atom", 1],
]);

export function strictArityError(op: string, args: readonly Atom[]): Atom | null {
  const arity = STRICT_HYPERON_ARITY.get(op);
  if (arity === undefined || args.length === arity) return null;
  return expr([sym("Error"), expr([sym(op), ...args]), sym("IncorrectNumberOfArguments")]);
}

export function skipApplicationCheck(op: string, args: readonly Atom[]): boolean {
  return op === "random-int" && (args.length === 2 || args.length === 3);
}
