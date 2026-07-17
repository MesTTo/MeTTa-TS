// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, gbool, gfloat, gint, groundType, variableIdentity } from "./atom";
import { format, parseAll } from "./parser";
import { Tokenizer } from "./tokenizer";

/** The standard tokenizer used by program runners and source transport. */
export function standardTokenizer(): Tokenizer {
  const tokenizer = new Tokenizer();
  tokenizer.register(/^[+-]?\d+$/, (source) => gint(BigInt(source)));
  tokenizer.register(/^[+-]?\d+\.\d+$/, (source) => gfloat(Number(source)));
  tokenizer.register(/^[+-]?\d+(\.\d+)?[eE][-+]?\d+$/, (source) => gfloat(Number(source)));
  tokenizer.register(/^True$/, () => gbool(true));
  tokenizer.register(/^False$/, () => gbool(false));
  return tokenizer;
}

export type TransportAtomMode = "program" | "value";

function sameTransportAtom(left: Atom, right: Atom, mode: TransportAtomMode): boolean {
  const pending: Array<readonly [Atom, Atom]> = [[left, right]];
  while (pending.length > 0) {
    const [a, b] = pending.pop()!;
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
      case "sym":
        if (a.name !== b.name) return false;
        break;
      case "var": {
        if (mode === "value" || b.kind !== "var" || a.name !== b.name) return false;
        if (variableIdentity(a) !== undefined || variableIdentity(b) !== undefined) return false;
        break;
      }
      case "expr": {
        if (b.kind !== "expr" || a.items.length !== b.items.length) return false;
        for (let index = 0; index < a.items.length; index++)
          pending.push([a.items[index]!, b.items[index]!]);
        break;
      }
      case "gnd": {
        if (b.kind !== "gnd" || a.exec !== undefined || a.match !== undefined) return false;
        if (b.exec !== undefined || b.match !== undefined || a.value.g !== b.value.g) return false;
        switch (a.value.g) {
          case "int":
            if (
              b.value.g !== "int" ||
              typeof a.value.n !== typeof b.value.n ||
              !Object.is(a.value.n, b.value.n)
            )
              return false;
            break;
          case "float":
            if (b.value.g !== "float" || !Object.is(a.value.n, b.value.n)) return false;
            break;
          case "str":
            if (b.value.g !== "str" || a.value.s !== b.value.s) return false;
            break;
          case "bool":
            if (b.value.g !== "bool" || a.value.b !== b.value.b) return false;
            break;
          case "unit":
          case "error":
          case "ext":
            return false;
        }
        pending.push([a.typ, b.typ]);
        break;
      }
    }
  }
  return true;
}

function transportAtomAllowed(atom: Atom, mode: TransportAtomMode): boolean {
  const pending = [atom];
  while (pending.length > 0) {
    const current = pending.pop()!;
    switch (current.kind) {
      case "sym":
        break;
      case "var":
        if (mode === "value" || variableIdentity(current) !== undefined) return false;
        break;
      case "expr":
        for (const child of current.items) pending.push(child);
        break;
      case "gnd":
        if (current.exec !== undefined || current.match !== undefined) return false;
        if (current.value.g === "unit" || current.value.g === "error" || current.value.g === "ext")
          return false;
        if (!sameTransportAtom(current.typ, groundType(current.value), "program")) return false;
        break;
    }
  }
  return true;
}

function parseSingleTransportAtom(source: string): Atom | undefined {
  const parsed = parseAll(source, standardTokenizer());
  return parsed.length === 1 && parsed[0]!.bang === false ? parsed[0]!.atom : undefined;
}

/** Format one atom only when standard parsing reconstructs its exact transport-safe representation. */
export function tryFormatTransportAtom(atom: Atom, mode: TransportAtomMode): string | undefined {
  try {
    if (!transportAtomAllowed(atom, mode)) return undefined;
    const source = format(atom);
    const parsed = parseSingleTransportAtom(source);
    return parsed !== undefined && sameTransportAtom(atom, parsed, mode) ? source : undefined;
  } catch {
    return undefined;
  }
}

/** Parse one canonical transport atom. Comments, directives, bags, and noncanonical text are rejected. */
export function parseTransportAtom(source: string, mode: TransportAtomMode): Atom | undefined {
  try {
    const atom = parseSingleTransportAtom(source);
    if (atom === undefined || !transportAtomAllowed(atom, mode)) return undefined;
    return format(atom) === source ? atom : undefined;
  } catch {
    return undefined;
  }
}
