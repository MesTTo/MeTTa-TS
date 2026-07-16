// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, type GndAtom, type VarAtom, gnd, sym, variableKey } from "./atom";
import { type BindingFrame, type BindingFrameResult } from "./binding-frame";
import { RuntimeIdAllocator, type PacketId } from "./trace";
import { VariableScopeAllocator } from "./variable-scope";

export const BINDING_PACKET_VERSION = 1 as const;
export const BINDING_PACKET_KIND = "metta-ts.binding-packet.v1";

export interface BindingPacketProvenance {
  readonly operation: "collapse-bind";
  readonly source: Atom;
  readonly alternative: number;
}

/** An answer-local frame plus the caller variables that must retain their identities during replay. */
export interface BindingPacket {
  readonly version: typeof BINDING_PACKET_VERSION;
  readonly id: PacketId;
  readonly frame: BindingFrame;
  readonly exportedVariables: readonly VarAtom[];
  readonly provenance: BindingPacketProvenance;
}

export type BindingPacketReadResult =
  | { readonly ok: true; readonly packet: BindingPacket }
  | {
      readonly ok: false;
      readonly code: "not-binding-packet" | "unsupported-version" | "foreign-packet";
      readonly message: string;
    };

/** Owns opaque packet atoms for one evaluation environment and freshens packet-local variables on replay. */
export class BindingPacketRegistry {
  readonly #packets = new WeakMap<GndAtom, BindingPacket>();
  readonly #ids: RuntimeIdAllocator;
  readonly #scopes: VariableScopeAllocator;

  constructor(namespace: string) {
    this.#ids = new RuntimeIdAllocator(namespace);
    this.#scopes = new VariableScopeAllocator(this.#ids);
  }

  capture(
    frame: BindingFrame,
    exportedVariables: readonly VarAtom[],
    provenance: BindingPacketProvenance,
  ): GndAtom {
    const id = this.#ids.next("packet");
    const packet: BindingPacket = Object.freeze({
      version: BINDING_PACKET_VERSION,
      id,
      frame,
      exportedVariables: Object.freeze([...exportedVariables]),
      provenance: Object.freeze({ ...provenance }),
    });
    const atom = gnd(
      { g: "ext", kind: BINDING_PACKET_KIND, id: frame.isEmpty ? "()" : `#<${id}>` },
      sym("Bindings"),
    );
    this.#packets.set(atom, packet);
    return atom;
  }

  read(atom: Atom): BindingPacketReadResult {
    if (atom.kind !== "gnd" || atom.value.g !== "ext") {
      return {
        ok: false,
        code: "not-binding-packet",
        message: "expected a binding packet",
      };
    }
    if (atom.value.kind !== BINDING_PACKET_KIND) {
      return {
        ok: false,
        code: atom.value.kind.startsWith("metta-ts.binding-packet.")
          ? "unsupported-version"
          : "not-binding-packet",
        message: atom.value.kind.startsWith("metta-ts.binding-packet.")
          ? "unsupported binding packet version"
          : "expected a binding packet",
      };
    }
    const packet = this.#packets.get(atom);
    return packet === undefined
      ? {
          ok: false,
          code: "foreign-packet",
          message: "binding packet belongs to another evaluation environment",
        }
      : { ok: true, packet };
  }

  /** Preserve exported caller identities and allocate a fresh scope for packet-local variables. */
  prepareReplay(packet: BindingPacket): BindingFrameResult {
    const exported = new Set(packet.exportedVariables.map(variableKey));
    const replacements = new Map<string, VarAtom>();
    const scope = this.#scopes.next();
    return packet.frame.mapVariables((variable) => {
      const key = variableKey(variable);
      if (exported.has(key)) return variable;
      let replacement = replacements.get(key);
      if (replacement === undefined) {
        replacement = scope.fresh(variable.name);
        replacements.set(key, replacement);
      }
      return replacement;
    });
  }
}
