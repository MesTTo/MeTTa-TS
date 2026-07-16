// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  type Atom,
  type ExprAtom,
  type VariableId,
  type VarAtom,
  atomEq,
  scopedVariable,
  variable,
  variableIdentity,
  variableIdentityKey,
} from "./atom";
import {
  type Bindings,
  type BindingRel,
  fromRelations,
  makeEqRel,
  makeValRel,
  relations,
} from "./bindings";
import { mapAtomVariables, mapExpressionChildren } from "./map-expression";
import { parseRuntimeId } from "./trace";

/** A logic variable as seen by a binding frame. Its display name is never its scoped identity. */
export interface FrameVariable {
  readonly displayName: string;
  readonly id?: VariableId;
}

export interface BindingClassSnapshot {
  readonly representative: FrameVariable;
  readonly members: readonly FrameVariable[];
  readonly value?: Atom;
}

export type BindingFrameFaultCode = "conflict" | "occurs-check" | "cyclic-frame";

export interface BindingFrameFault {
  readonly code: BindingFrameFaultCode;
  readonly message: string;
  readonly variable?: FrameVariable;
  readonly left?: Atom;
  readonly right?: Atom;
}

export type BindingFrameResult<T = BindingFrame> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fault: BindingFrameFault };

interface VariableNode {
  readonly variable: FrameVariable;
  readonly parent: string;
  readonly rank: number;
  readonly value?: Atom;
}

const FRAME_NODES = new WeakMap<BindingFrame, ReadonlyMap<string, VariableNode>>();

function frameVariable(variableAtom: VarAtom): FrameVariable {
  const id = variableIdentity(variableAtom);
  return id === undefined
    ? { displayName: variableAtom.name }
    : { displayName: variableAtom.name, id };
}

function frameVariableKey(variableRef: FrameVariable): string {
  return variableIdentityKey(variableRef.displayName, variableRef.id);
}

function frameVariableAtom(variableRef: FrameVariable): VarAtom {
  return variableRef.id === undefined
    ? variable(variableRef.displayName)
    : scopedVariable(variableRef.displayName, variableRef.id);
}

function compareFrameVariables(a: FrameVariable, b: FrameVariable): number {
  return frameVariableKey(a).localeCompare(frameVariableKey(b));
}

function nodesOf(frame: BindingFrame): ReadonlyMap<string, VariableNode> {
  const nodes = FRAME_NODES.get(frame);
  if (nodes === undefined) throw new Error("BindingFrame invariant: missing node store");
  return nodes;
}

function frameFromNodes(nodes: ReadonlyMap<string, VariableNode>): BindingFrame {
  const frame = new BindingFrame();
  FRAME_NODES.set(frame, nodes);
  return frame;
}

function collectVariables(atom: Atom, into: Map<string, FrameVariable>): void {
  const stack: Atom[] = [atom];
  const seenExpressions = new Set<ExprAtom>();
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next.ground) continue;
    if (next.kind === "var") {
      const ref = frameVariable(next);
      into.set(frameVariableKey(ref), ref);
      continue;
    }
    if (next.kind !== "expr" || seenExpressions.has(next)) continue;
    seenExpressions.add(next);
    for (let index = next.items.length - 1; index >= 0; index--) stack.push(next.items[index]!);
  }
}

function immutableNodes(nodes: Map<string, VariableNode>): ReadonlyMap<string, VariableNode> {
  const copy = new Map<string, VariableNode>();
  for (const [key, node] of nodes) copy.set(key, Object.freeze({ ...node }));
  return copy;
}

function readonlyRoot(nodes: ReadonlyMap<string, VariableNode>, key: string): string {
  let current = key;
  for (;;) {
    const node = nodes.get(current);
    if (node === undefined)
      throw new Error(`BindingFrame invariant: unknown variable '${current}'`);
    if (node.parent === current) return current;
    current = node.parent;
  }
}

class BindingFrameBuilder {
  readonly nodes: Map<string, VariableNode>;

  constructor(frame: BindingFrame) {
    this.nodes = new Map(nodesOf(frame));
  }

  ensure(variableRef: FrameVariable): string {
    const key = frameVariableKey(variableRef);
    const existing = this.nodes.get(key);
    if (existing === undefined) {
      this.nodes.set(key, { variable: variableRef, parent: key, rank: 0 });
    } else if (variableRef.displayName < existing.variable.displayName) {
      this.nodes.set(key, { ...existing, variable: variableRef });
    }
    return key;
  }

  ensureAtomVariables(atom: Atom): void {
    const variables = new Map<string, FrameVariable>();
    collectVariables(atom, variables);
    for (const variableRef of variables.values()) this.ensure(variableRef);
  }

  find(key: string): string {
    const path: string[] = [];
    let current = key;
    for (;;) {
      const node = this.nodes.get(current);
      if (node === undefined)
        throw new Error(`BindingFrame invariant: unknown variable '${current}'`);
      if (node.parent === current) break;
      path.push(current);
      current = node.parent;
    }
    for (const child of path) {
      const node = this.nodes.get(child)!;
      if (node.parent !== current) this.nodes.set(child, { ...node, parent: current });
    }
    return current;
  }

  rootNode(key: string): VariableNode {
    return this.nodes.get(this.find(key))!;
  }

  occurs(targetRoot: string, atom: Atom): boolean {
    const stack: Atom[] = [atom];
    const visitedRoots = new Set<string>();
    const visitedExpressions = new Set<ExprAtom>();
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next.ground) continue;
      if (next.kind === "var") {
        const key = this.ensure(frameVariable(next));
        const root = this.find(key);
        if (root === targetRoot) return true;
        if (visitedRoots.has(root)) continue;
        visitedRoots.add(root);
        const value = this.nodes.get(root)!.value;
        if (value !== undefined) stack.push(value);
        continue;
      }
      if (next.kind !== "expr" || visitedExpressions.has(next)) continue;
      visitedExpressions.add(next);
      for (let index = next.items.length - 1; index >= 0; index--) stack.push(next.items[index]!);
    }
    return false;
  }

  bindVariable(variableAtom: VarAtom, value: Atom): BindingFrameFault | undefined {
    if (value.kind === "var") return this.equateVariables(variableAtom, value);
    const key = this.ensure(frameVariable(variableAtom));
    const root = this.find(key);
    const rootNode = this.nodes.get(root)!;
    if (rootNode.value !== undefined) return this.unify(rootNode.value, value);
    if (this.occurs(root, value)) {
      return {
        code: "occurs-check",
        message: "finite-tree unification rejected a variable inside its own value",
        variable: rootNode.variable,
        right: value,
      };
    }
    this.ensureAtomVariables(value);
    this.nodes.set(root, { ...rootNode, value });
    return undefined;
  }

  equateVariables(left: VarAtom, right: VarAtom): BindingFrameFault | undefined {
    const leftKey = this.ensure(frameVariable(left));
    const rightKey = this.ensure(frameVariable(right));
    let leftRoot = this.find(leftKey);
    let rightRoot = this.find(rightKey);
    if (leftRoot === rightRoot) return undefined;

    let leftNode = this.nodes.get(leftRoot)!;
    let rightNode = this.nodes.get(rightRoot)!;
    const leftValue = leftNode.value;
    const rightValue = rightNode.value;
    if (leftValue !== undefined && rightValue !== undefined) {
      const fault = this.unify(leftValue, rightValue);
      if (fault !== undefined) return fault;
      leftRoot = this.find(leftRoot);
      rightRoot = this.find(rightRoot);
      if (leftRoot === rightRoot) return undefined;
      leftNode = this.nodes.get(leftRoot)!;
      rightNode = this.nodes.get(rightRoot)!;
    } else if (leftValue !== undefined && this.occurs(rightRoot, leftValue)) {
      return {
        code: "occurs-check",
        message: "equating variable classes would create a finite-tree cycle",
        variable: rightNode.variable,
        right: leftValue,
      };
    } else if (rightValue !== undefined && this.occurs(leftRoot, rightValue)) {
      return {
        code: "occurs-check",
        message: "equating variable classes would create a finite-tree cycle",
        variable: leftNode.variable,
        right: rightValue,
      };
    }

    let parentRoot = leftRoot;
    let childRoot = rightRoot;
    if (
      leftNode.rank < rightNode.rank ||
      (leftNode.rank === rightNode.rank && rightRoot.localeCompare(leftRoot) < 0)
    ) {
      parentRoot = rightRoot;
      childRoot = leftRoot;
    }
    const parent = this.nodes.get(parentRoot)!;
    const child = this.nodes.get(childRoot)!;
    const value = parent.value ?? child.value;
    const rank = parent.rank === child.rank ? parent.rank + 1 : parent.rank;
    this.nodes.set(parentRoot, {
      ...parent,
      rank,
      ...(value === undefined ? {} : { value }),
    });
    this.nodes.set(childRoot, {
      variable: child.variable,
      parent: parentRoot,
      rank: child.rank,
    });
    return undefined;
  }

  unify(left: Atom, right: Atom): BindingFrameFault | undefined {
    const pending: Array<readonly [Atom, Atom]> = [[left, right]];
    while (pending.length > 0) {
      const [nextLeft, nextRight] = pending.pop()!;
      if (nextLeft.kind === "var" && nextRight.kind === "var") {
        const fault = this.equateVariables(nextLeft, nextRight);
        if (fault !== undefined) return fault;
        continue;
      }
      if (nextLeft.kind === "var") {
        const fault = this.bindVariable(nextLeft, nextRight);
        if (fault !== undefined) return fault;
        continue;
      }
      if (nextRight.kind === "var") {
        const fault = this.bindVariable(nextRight, nextLeft);
        if (fault !== undefined) return fault;
        continue;
      }
      if (nextLeft.kind === "expr" && nextRight.kind === "expr") {
        if (nextLeft.items.length !== nextRight.items.length)
          return {
            code: "conflict",
            message: "expressions with different arities do not unify",
            left: nextLeft,
            right: nextRight,
          };
        for (let index = nextLeft.items.length - 1; index >= 0; index--)
          pending.push([nextLeft.items[index]!, nextRight.items[index]!]);
        continue;
      }
      if (!atomEq(nextLeft, nextRight))
        return {
          code: "conflict",
          message: "atoms do not unify",
          left: nextLeft,
          right: nextRight,
        };
    }
    return undefined;
  }

  replayClass(
    bindingClass: BindingClassSnapshot,
    members: readonly FrameVariable[] = bindingClass.members,
  ): BindingFrameFault | undefined {
    if (members.length === 0) return undefined;
    const representative = frameVariableAtom(members[0]!);
    for (const member of members.slice(1)) {
      const fault = this.equateVariables(representative, frameVariableAtom(member));
      if (fault !== undefined) return fault;
    }
    return bindingClass.value === undefined
      ? undefined
      : this.bindVariable(representative, bindingClass.value);
  }

  finish(): BindingFrame {
    return frameFromNodes(immutableNodes(this.nodes));
  }
}

function canonicalMembers(nodes: ReadonlyMap<string, VariableNode>): Map<string, FrameVariable[]> {
  const grouped = new Map<string, FrameVariable[]>();
  for (const [key, node] of nodes) {
    const root = readonlyRoot(nodes, key);
    const members = grouped.get(root);
    if (members === undefined) grouped.set(root, [node.variable]);
    else members.push(node.variable);
  }
  for (const members of grouped.values()) members.sort(compareFrameVariables);
  return grouped;
}

function canonicalVariablesByRoot(
  grouped: ReadonlyMap<string, readonly FrameVariable[]>,
): Map<string, FrameVariable> {
  const canonical = new Map<string, FrameVariable>();
  for (const [root, members] of grouped) canonical.set(root, members[0]!);
  return canonical;
}

function resolveAtom(
  frame: BindingFrame,
  atom: Atom,
  canonicalByRoot: ReadonlyMap<string, FrameVariable>,
  visitingRoots: Set<string>,
  expressionMemo: Map<ExprAtom, Atom>,
): Atom {
  if (atom.ground) return atom;
  if (atom.kind === "var") {
    const nodes = nodesOf(frame);
    const key = frameVariableKey(frameVariable(atom));
    if (!nodes.has(key)) return atom;
    const root = readonlyRoot(nodes, key);
    const node = nodes.get(root)!;
    if (node.value === undefined)
      return frameVariableAtom(canonicalByRoot.get(root) ?? node.variable);
    if (visitingRoots.has(root))
      throw new Error("BindingFrame invariant: cyclic frame reached during instantiation");
    visitingRoots.add(root);
    const result = resolveAtom(frame, node.value, canonicalByRoot, visitingRoots, expressionMemo);
    visitingRoots.delete(root);
    return result;
  }
  if (atom.kind !== "expr") return atom;
  return mapExpressionChildren(atom, expressionMemo, (item) =>
    resolveAtom(frame, item, canonicalByRoot, visitingRoots, expressionMemo),
  );
}

/** Immutable finite-tree constraint graph over legacy or scoped variables. */
export class BindingFrame {
  constructor() {
    FRAME_NODES.set(this, new Map());
  }

  get variableCount(): number {
    return nodesOf(this).size;
  }

  get isEmpty(): boolean {
    for (const [key, node] of nodesOf(this)) {
      if (node.parent !== key || node.value !== undefined) return false;
    }
    return true;
  }

  classes(): readonly BindingClassSnapshot[] {
    const nodes = nodesOf(this);
    const grouped = canonicalMembers(nodes);
    const canonicalByRoot = canonicalVariablesByRoot(grouped);
    const snapshots: BindingClassSnapshot[] = [];
    for (const [root, members] of grouped) {
      const value = nodes.get(root)!.value;
      snapshots.push({
        representative: members[0]!,
        members: [...members],
        ...(value === undefined
          ? {}
          : {
              value: resolveAtom(this, value, canonicalByRoot, new Set([root]), new Map()),
            }),
      });
    }
    snapshots.sort((a, b) => compareFrameVariables(a.representative, b.representative));
    return snapshots;
  }

  unify(left: Atom, right: Atom): BindingFrameResult {
    const builder = new BindingFrameBuilder(this);
    const fault = builder.unify(left, right);
    return fault === undefined ? { ok: true, value: builder.finish() } : { ok: false, fault };
  }

  bind(variableAtom: VarAtom, value: Atom): BindingFrameResult {
    return this.unify(variableAtom, value);
  }

  equate(left: VarAtom, right: VarAtom): BindingFrameResult {
    return this.unify(left, right);
  }

  merge(other: BindingFrame): BindingFrameResult {
    const builder = new BindingFrameBuilder(this);
    for (const bindingClass of other.classes()) {
      const fault = builder.replayClass(bindingClass);
      if (fault !== undefined) return { ok: false, fault };
    }
    return { ok: true, value: builder.finish() };
  }

  /** Rename variable identities while preserving complete equivalence classes and checked values. */
  mapVariables(mapVariable: (variable: VarAtom) => VarAtom): BindingFrameResult {
    const builder = new BindingFrameBuilder(new BindingFrame());
    const memo = new Map<ExprAtom, Atom>();
    for (const bindingClass of this.classes()) {
      const members = bindingClass.members.map((member) =>
        frameVariable(mapVariable(frameVariableAtom(member))),
      );
      const value =
        bindingClass.value === undefined
          ? undefined
          : mapAtomVariables(bindingClass.value, mapVariable, memo);
      const fault = builder.replayClass({
        representative: members[0]!,
        members,
        ...(value === undefined ? {} : { value }),
      });
      if (fault !== undefined) return { ok: false, fault };
    }
    return { ok: true, value: builder.finish() };
  }

  instantiate(atom: Atom): Atom {
    const nodes = nodesOf(this);
    const grouped = canonicalMembers(nodes);
    const canonicalByRoot = canonicalVariablesByRoot(grouped);
    return resolveAtom(this, atom, canonicalByRoot, new Set(), new Map());
  }

  resolve(variableAtom: VarAtom): Atom | undefined {
    const key = frameVariableKey(frameVariable(variableAtom));
    if (!nodesOf(this).has(key)) return undefined;
    return this.instantiate(variableAtom);
  }

  /** Keep requested variables and the transitive variables needed by their resolved values. */
  project(variables: readonly VarAtom[]): BindingFrameResult {
    const classes = this.classes();
    const classByMember = new Map<string, BindingClassSnapshot>();
    for (const bindingClass of classes)
      for (const member of bindingClass.members)
        classByMember.set(frameVariableKey(member), bindingClass);

    const included = new Map<string, FrameVariable>();
    const pending = variables.map(frameVariable);
    while (pending.length > 0) {
      const next = pending.pop()!;
      const key = frameVariableKey(next);
      if (included.has(key)) continue;
      const bindingClass = classByMember.get(key);
      if (bindingClass === undefined) continue;
      included.set(key, next);
      if (bindingClass.value !== undefined) {
        const dependencies = new Map<string, FrameVariable>();
        collectVariables(bindingClass.value, dependencies);
        for (const dependency of dependencies.values()) pending.push(dependency);
      }
    }

    const builder = new BindingFrameBuilder(new BindingFrame());
    for (const bindingClass of classes) {
      const kept = bindingClass.members.filter((member) => included.has(frameVariableKey(member)));
      if (kept.length === 0) continue;
      const fault = builder.replayClass(bindingClass, kept);
      if (fault !== undefined) return { ok: false, fault };
    }
    return { ok: true, value: builder.finish() };
  }
}

export const emptyBindingFrame = new BindingFrame();

/** Convert the complete legacy relation list into a checked canonical frame. */
export function bindingFrameFromLegacy(bindings: Bindings): BindingFrameResult {
  const builder = new BindingFrameBuilder(new BindingFrame());
  const seenValues = new Set<string>();
  for (const relation of relations(bindings)) {
    let fault: BindingFrameFault | undefined;
    if (relation.tag === "eq") {
      fault = builder.equateVariables(variable(relation.x), variable(relation.y));
    } else {
      if (seenValues.has(relation.x)) continue;
      seenValues.add(relation.x);
      fault = builder.bindVariable(variable(relation.x), relation.a);
    }
    if (fault !== undefined) return { ok: false, fault };
  }
  return { ok: true, value: builder.finish() };
}

class LegacyVariableProjection {
  readonly #names = new Map<string, string>();

  constructor(variables: readonly FrameVariable[]) {
    const reserved = new Set<string>();
    for (const variableRef of variables) {
      if (variableRef.id === undefined) {
        reserved.add(variableRef.displayName);
        this.#names.set(frameVariableKey(variableRef), variableRef.displayName);
      }
    }
    const scoped = variables
      .filter((variableRef) => variableRef.id !== undefined)
      .sort(compareFrameVariables);
    for (const variableRef of scoped) {
      const id = variableRef.id!;
      const sequence = parseRuntimeId(id.scope)?.sequence ?? id.slot;
      let suffix = sequence;
      let candidate = `${variableRef.displayName}#${suffix}`;
      while (reserved.has(candidate)) candidate = `${variableRef.displayName}#${++suffix}`;
      reserved.add(candidate);
      this.#names.set(frameVariableKey(variableRef), candidate);
    }
  }

  name(variableRef: FrameVariable): string {
    const projected = this.#names.get(frameVariableKey(variableRef));
    if (projected === undefined)
      throw new Error("BindingFrame invariant: variable missing from legacy projection");
    return projected;
  }
}

function projectAtomToLegacy(
  atom: Atom,
  projection: LegacyVariableProjection,
  memo: Map<ExprAtom, Atom>,
): Atom {
  if (atom.ground) return atom;
  if (atom.kind === "var") return variable(projection.name(frameVariable(atom)));
  if (atom.kind !== "expr") return atom;
  return mapExpressionChildren(atom, memo, (item) => projectAtomToLegacy(item, projection, memo));
}

/**
 * Project a scoped frame onto the existing string-keyed relation API. Scoped names receive deterministic
 * `#N` suffixes only at this compatibility boundary.
 */
export function bindingFrameToLegacy(frame: BindingFrame): Bindings {
  const classes = frame.classes();
  const variables = classes.flatMap((bindingClass) => [...bindingClass.members]);
  const projection = new LegacyVariableProjection(variables);
  const output: BindingRel[] = [];
  const atomMemo = new Map<ExprAtom, Atom>();
  for (const bindingClass of classes) {
    const names = bindingClass.members.map((member) => projection.name(member));
    if (bindingClass.value !== undefined) {
      const value = projectAtomToLegacy(bindingClass.value, projection, atomMemo);
      for (const name of names) output.push(makeValRel(name, value));
    }
    for (let index = 1; index < names.length; index++)
      output.push(makeEqRel(names[0]!, names[index]!));
  }
  return fromRelations(output);
}
