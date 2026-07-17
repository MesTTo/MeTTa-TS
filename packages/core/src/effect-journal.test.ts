// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { EffectAudit, EffectJournal, NonAncestorEffectJournalError } from "./effect-journal";

describe("effect journal", () => {
  it("shares prefixes and returns only a branch suffix in commit order", () => {
    const root = EffectJournal.root<string>("run").append({
      class: "atomspace-read",
      phase: "pre",
      operation: "match",
      payload: "read",
    });
    const branch = root
      .fork("branch-2")
      .append({
        class: "atomspace-write",
        phase: "answer",
        operation: "add-atom",
        payload: "first",
      })
      .append({
        class: "atomspace-write",
        phase: "answer",
        operation: "bind!",
        payload: "second",
      });

    expect(branch.since(root).map((event) => event.payload)).toEqual(["first", "second"]);
    expect(root.since(root)).toEqual([]);
    expect(branch.depth).toBe(root.depth + 2);
  });

  it("does not duplicate a shared prefix when child events are committed", () => {
    const root = EffectJournal.root<string>("run").append({
      class: "atomspace-write",
      phase: "pre",
      operation: "shared",
      payload: "shared",
    });
    const child = root.fork("child").append({
      class: "atomspace-write",
      phase: "answer",
      operation: "child",
      payload: "child",
    });
    const committed = root.commit(child.since(root));

    expect(committed.toArray().map((event) => event.payload)).toEqual(["shared", "child"]);
    expect(
      new Set(committed.toArray().map((event) => `${event.id.branch}:${event.id.sequence}`)).size,
    ).toBe(2);
  });

  it("rejects a delta between sibling journals", () => {
    const root = EffectJournal.root<string>("run");
    const left = root.fork("left").append({
      class: "atomspace-write",
      phase: "answer",
      operation: "left",
      payload: "left",
    });
    const right = root.fork("right").append({
      class: "atomspace-write",
      phase: "answer",
      operation: "right",
      payload: "right",
    });

    expect(() => left.since(right)).toThrow(NonAncestorEffectJournalError);
  });
});

describe("committed effect audit", () => {
  const entry = (sequence: number, operation = "add-atom") => ({
    id: { branch: "run", sequence },
    class: "atomspace-write" as const,
    phase: "answer" as const,
    operation,
    commitment: "reversible" as const,
  });

  it("retains a repeated metadata stream as one run", () => {
    let audit = EffectAudit.empty();
    for (let sequence = 0; sequence < 100_000; sequence += 1) audit = audit.append(entry(sequence));

    expect(audit.depth).toBe(100_000);
    expect(audit.runs).toBe(1);
  });

  it("keeps old boundaries valid while extending and splitting runs", () => {
    const first = EffectAudit.empty().append(entry(0));
    const second = first.append(entry(1));
    const third = second.append(entry(2, "remove-atom"));
    const divergent = first.append(entry(1, "remove-atom"));

    expect(first.toArray().map((effect) => effect.id.sequence)).toEqual([0]);
    expect(second.toArray().map((effect) => effect.id.sequence)).toEqual([0, 1]);
    expect(third.toArray().map((effect) => effect.operation)).toEqual([
      "add-atom",
      "add-atom",
      "remove-atom",
    ]);
    expect(third.runs).toBe(2);
    expect(divergent.toArray().map((effect) => effect.operation)).toEqual([
      "add-atom",
      "remove-atom",
    ]);
  });

  it("matches an uncompressed metadata stream over random run boundaries", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("add-atom", "remove-atom", "match"), {
          minLength: 0,
          maxLength: 200,
        }),
        (operations) => {
          let audit = EffectAudit.empty();
          for (let sequence = 0; sequence < operations.length; sequence += 1)
            audit = audit.append(entry(sequence, operations[sequence]!));
          const expanded = audit.toArray();
          const expectedRuns = operations.reduce(
            (count, operation, index) =>
              index === 0 || operation !== operations[index - 1] ? count + 1 : count,
            0,
          );
          return (
            expanded.every(
              (effect, index) =>
                effect.id.sequence === index && effect.operation === operations[index],
            ) &&
            audit.depth === operations.length &&
            audit.runs === expectedRuns
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
