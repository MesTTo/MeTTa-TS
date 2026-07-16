// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { type Atom, expr, gnd, sym, variable, variableKey } from "./atom";
import { BindingFrame } from "./binding-frame";
import { BINDING_PACKET_KIND, BindingPacketRegistry } from "./binding-packet";
import { format } from "./parser";
import { runProgram } from "./runner";

function query(source: string): Atom[] {
  const results = runProgram(source);
  return results.at(-1)?.results ?? [];
}

describe("collapse-bind and superpose-bind packets", () => {
  it("replays each captured alternative's bindings into the caller", () => {
    const results = query(`
      (= (foo a) xa)
      (= (foo b) xb)
      !(chain (collapse-bind (eval (foo $a))) $collapsed
        (chain (superpose-bind $collapsed) $x
          ($x $a)))
    `);
    expect(results.map(format)).toEqual(["(xa a)", "(xb b)"]);
  });

  it("stores an opaque binding packet in every captured pair", () => {
    const [collapsed] = query("!(collapse-bind (unify $x A $x Empty))");
    expect(collapsed?.kind).toBe("expr");
    const pair = collapsed?.kind === "expr" ? collapsed.items[0] : undefined;
    expect(pair?.kind).toBe("expr");
    const packet = pair?.kind === "expr" ? pair.items[1] : undefined;
    expect(packet).toMatchObject({
      kind: "gnd",
      value: { g: "ext", kind: "metta-ts.binding-packet.v1" },
    });
  });

  it("prunes a replay whose captured frame conflicts with the caller", () => {
    const results = query(`
      !(chain (collapse-bind (unify $x A captured Empty)) $captured
        (unify $x B (superpose-bind $captured) mismatch))
    `);
    expect(results).toEqual([]);
  });

  it("retains unresolved equality classes across capture and replay", () => {
    const results = query(`
      !(chain (collapse-bind (unify $x $y ready Empty)) $captured
        (chain (superpose-bind $captured) $_
          (unify $x A
            (unify $y A aliases-preserved aliases-lost)
            bind-failed)))
    `);
    expect(results.map(format)).toEqual(["aliases-preserved"]);
  });

  it("keeps the old unit payload as an empty-frame compatibility form", () => {
    expect(query("!(superpose-bind ((A ())))").map(format)).toEqual(["A"]);
  });

  it("returns a language error for a malformed binding payload", () => {
    expect(query("!(superpose-bind ((A bad)))").map(format)).toEqual([
      '(Error (superpose-bind ((A bad))) "superpose-bind: expected a binding packet")',
    ]);
  });

  it("rejects packet handles owned by another environment", () => {
    const owner = new BindingPacketRegistry("owner");
    const other = new BindingPacketRegistry("other");
    const packet = owner.capture(new BindingFrame(), [], {
      operation: "collapse-bind",
      source: sym("source"),
      alternative: 0,
    });
    expect(owner.read(packet)).toMatchObject({ ok: true });
    expect(other.read(packet)).toEqual({
      ok: false,
      code: "foreign-packet",
      message: "binding packet belongs to another evaluation environment",
    });
    expect(
      owner.read(gnd({ g: "ext", kind: "metta-ts.binding-packet.v2", id: "packet" })),
    ).toMatchObject({ ok: false, code: "unsupported-version" });
  });

  it("freshens packet-local variables on every replay while retaining exported variables", () => {
    const registry = new BindingPacketRegistry("fresh-replay");
    const exported = variable("x");
    const local = variable("hidden");
    const bound = new BindingFrame().bind(exported, expr([sym("F"), local]));
    expect(bound.ok, bound.ok ? undefined : bound.fault.message).toBe(true);
    if (!bound.ok) return;
    const frame = bound.value;
    const packetAtom = registry.capture(frame, [exported], {
      operation: "collapse-bind",
      source: exported,
      alternative: 0,
    });
    const read = registry.read(packetAtom);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const first = registry.prepareReplay(read.packet);
    const second = registry.prepareReplay(read.packet);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const firstValue = first.value.resolve(exported);
    const secondValue = second.value.resolve(exported);
    expect(firstValue?.kind).toBe("expr");
    expect(secondValue?.kind).toBe("expr");
    const firstLocal = firstValue?.kind === "expr" ? firstValue.items[1] : undefined;
    const secondLocal = secondValue?.kind === "expr" ? secondValue.items[1] : undefined;
    expect(firstLocal?.kind).toBe("var");
    expect(secondLocal?.kind).toBe("var");
    if (firstLocal?.kind !== "var" || secondLocal?.kind !== "var") return;
    expect(variableKey(firstLocal)).not.toBe(variableKey(secondLocal));
    expect(first.value.resolve(exported)?.kind).toBe("expr");
    expect(packetAtom).toMatchObject({
      value: { g: "ext", kind: BINDING_PACKET_KIND },
    });
  });
});
