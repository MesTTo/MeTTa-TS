// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Property fuzz over the Grounded V2 pull protocol: random event scripts (valid answers,
// pendings, terminals, malformed replies, producer throws, over-allowance step reports) driven
// through random consumer shapes. The properties pin the ownership and containment contract:
// the evaluator either returns answers or throws a typed failure (never an untyped engine
// crash), and every cursor it opens is closed exactly once, with async cleanup joined.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { gint, sym } from "./index";
import { buildEnv, initSt, mettaEval, mettaEvalAsync, registerGroundedOperationV2 } from "./eval";
import type { GroundedAnswer } from "./grounded-v2";
import type { SearchEvent, SearchNextOptions } from "./search-cursor";
import type { Atom } from "./atom";
import { parseAll } from "./parser";
import { preludeAtoms } from "./runner";
import { standardTokenizer } from "./standard-syntax";
import { stdlibAtoms } from "./stdlib";
import { stdTable } from "./builtins";
import {
  ScriptedAsyncCursor,
  ScriptedSyncCursor,
  type ScriptedSyncEntry,
} from "./grounded-v2-test-utils";

const pureSync = {
  mode: "sync" as const,
  effects: { classes: ["pure" as const], speculative: true },
};
const pureAsync = {
  mode: "async" as const,
  effects: { classes: ["pure" as const], speculative: true },
};

function atom(source: string): Atom {
  return parseAll(source, standardTokenizer())[0]!.atom;
}

const answerAtomArb: fc.Arbitrary<Atom> = fc.oneof(
  fc.constantFrom("a", "b", "c").map((name) => sym(name)),
  fc.integer({ min: 0, max: 99 }).map((value) => gint(value)),
);

const RAISED = new Error("fuzz-raise");
const FAULTED = new Error("fuzz-fault");

/** Mid-script entries: answers, pendings, malformed replies, producer throws. */
const middleEntryArb: fc.Arbitrary<ScriptedSyncEntry> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .tuple(answerAtomArb, fc.integer({ min: 0, max: 3 }))
      .map(
        ([value, steps]): ScriptedSyncEntry => ({ kind: "answer", value: { atom: value }, steps }),
      ),
  },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: 1, max: 2 })
      .map((steps): ScriptedSyncEntry => ({ kind: "pending", steps }) as never),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom<ScriptedSyncEntry>(
      null as never,
      42 as never,
      {} as never,
      { kind: "bogus", steps: 1 } as never,
      { kind: "answer", steps: 1 } as never,
      { kind: "answer", value: { atom: sym("x") }, steps: -1 } as never,
      ((options: SearchNextOptions): SearchEvent<GroundedAnswer, void> => ({
        kind: "answer",
        value: { atom: sym("over") },
        steps: (options.maxSteps ?? 256) + 1,
      })) as ScriptedSyncEntry,
      { raise: RAISED },
    ),
  },
);

/** Every script ends in a terminal so a truncated consumer drain cannot spin forever. */
const terminalEntryArb: fc.Arbitrary<ScriptedSyncEntry> = fc.constantFrom<ScriptedSyncEntry>(
  { kind: "exhausted", terminal: undefined, steps: 1 },
  { kind: "exhausted", terminal: undefined, steps: 0 },
  { kind: "cancelled", reason: { code: "closed" }, steps: 0 } as never,
  { kind: "fault", error: FAULTED, steps: 0 } as never,
  { raise: RAISED },
);

const scriptArb: fc.Arbitrary<ScriptedSyncEntry[]> = fc
  .tuple(fc.array(middleEntryArb, { maxLength: 6 }), terminalEntryArb)
  .map(([middle, terminal]) => [...middle, terminal]);

const consumerArb = fc.constantFrom(
  "!(fuzz-op)",
  "!(once (fuzz-op))",
  "!(superpose ((fuzz-op) z))",
  "!(collapse (fuzz-op))",
  "!(quote (fuzz-op))",
);

/** A thrown value is legal iff it is a typed protocol failure or the script's own raise; an
 *  untyped engine crash (TypeError and friends we never threw) fails the property. */
function assertLegalThrow(thrown: unknown): void {
  expect(
    thrown instanceof TypeError ||
      thrown instanceof ReferenceError ||
      (thrown instanceof RangeError && !String((thrown as Error).message).includes("call stack")),
  ).toBe(false);
  const kind =
    typeof thrown === "object" && thrown !== null && "kind" in thrown
      ? (thrown as { kind: unknown }).kind
      : undefined;
  const typed = kind === "infrastructure-fault" || kind === "cancelled" || thrown instanceof Error;
  expect(typed).toBe(true);
}

function fuzzRuntime() {
  return buildEnv([...preludeAtoms(), ...stdlibAtoms()], stdTable());
}

describe("Grounded V2 protocol fuzz", () => {
  it("contains every sync script in typed failures with exactly one close", () => {
    fc.assert(
      fc.property(scriptArb, consumerArb, (script, consumer) => {
        const env = fuzzRuntime();
        const cursors: ScriptedSyncCursor[] = [];
        registerGroundedOperationV2(
          env,
          "fuzz-op",
          () => {
            const cursor = new ScriptedSyncCursor(script);
            cursors.push(cursor);
            return { tag: "answers", answers: cursor };
          },
          pureSync,
        );
        try {
          mettaEval(env, 1_000_000, initSt(), [], atom(consumer));
        } catch (thrown) {
          assertLegalThrow(thrown);
        }
        for (const cursor of cursors) {
          expect(cursor.closeCalls).toBe(1);
          const closeAt = cursor.pullsAtClose;
          expect(cursor.pulls).toBe(closeAt);
        }
      }),
      { numRuns: 160 },
    );
  });

  it("contains every async script with joined close", async () => {
    await fc.assert(
      fc.asyncProperty(scriptArb, consumerArb, async (script, consumer) => {
        const env = fuzzRuntime();
        const cursors: ScriptedAsyncCursor[] = [];
        registerGroundedOperationV2(
          env,
          "fuzz-op",
          () => {
            const cursor = new ScriptedAsyncCursor(script);
            cursors.push(cursor);
            return { tag: "answers", answers: cursor };
          },
          pureAsync,
        );
        try {
          await mettaEvalAsync(env, 1_000_000, initSt(), [], atom(consumer));
        } catch (thrown) {
          assertLegalThrow(thrown);
        }
        await new Promise((resolve) => setImmediate(resolve));
        for (const cursor of cursors) {
          expect(cursor.closeCalls).toBe(1);
          expect(cursor.closeSettled).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });

  it("keeps a wrong-mode cursor closed and the failure typed", () => {
    fc.assert(
      fc.property(scriptArb, (script) => {
        const env = fuzzRuntime();
        const cursors: ScriptedAsyncCursor[] = [];
        registerGroundedOperationV2(
          env,
          "fuzz-op",
          () => {
            const cursor = new ScriptedAsyncCursor(script);
            cursors.push(cursor);
            return { tag: "answers", answers: cursor as never };
          },
          pureSync,
        );
        try {
          mettaEval(env, 1_000_000, initSt(), [], atom("!(fuzz-op)"));
        } catch (thrown) {
          assertLegalThrow(thrown);
        }
        for (const cursor of cursors) expect(cursor.closeCalls).toBe(1);
      }),
      { numRuns: 60 },
    );
  });
});
