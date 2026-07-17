// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { emptyBindings } from "./bindings";
import { stdTable } from "./builtins";
import { buildEnv, initSt, mettaEval, mettaEvalAsync, WorldConflictError } from "./eval";
import { format, parseAll } from "./parser";
import { preludeAtoms, runProgram, runProgramAsync, standardTokenizer } from "./runner";
import { parseRuntimeId, RuntimeIdAllocator } from "./trace";

const firstResults = (runs: ReturnType<typeof runProgram>): string[] =>
  runs[0]?.results.map(format) ?? [];

function expectTwoDistinctHandles(runs: ReturnType<typeof runProgram>): void {
  const handles = runs.flatMap((run) => run.results.map(format));
  expect(handles).toHaveLength(2);
  expect(new Set(handles).size).toBe(2);
}

function expectReservedParentAuthority(state: ReturnType<typeof initSt>): void {
  expect(state.world.allocation.ids.namespace).toBe("metta");
  expect(parseRuntimeId(state.world.allocation.ids.next("branch"))?.sequence).toBe(1);
}

describe("parallel runtime-handle allocation", () => {
  it("preserves sequential state and space handle vectors", () => {
    expect(
      runProgram("!(new-state A)\n!(new-state B)").map((run) => run.results.map(format)),
    ).toEqual([["(State 0)"], ["(State 1)"]]);
    expect(runProgram("!(new-space)\n!(new-space)").map((run) => run.results.map(format))).toEqual([
      ["&space-0"],
      ["&space-1"],
    ]);
  });

  it("gives par siblings distinct state handles", async () => {
    const states = firstResults(await runProgramAsync("!(par (new-state A) (new-state B))"));

    expect(states).toHaveLength(2);
    expect(new Set(states).size).toBe(2);
  });

  it("gives par siblings distinct space handles", async () => {
    const spaces = firstResults(await runProgramAsync("!(par (new-space) (new-space))"));

    expect(spaces).toHaveLength(2);
    expect(new Set(spaces).size).toBe(2);
  });

  it("reserves the parent branch group after eager par exhaustion", async () => {
    const env = buildEnv(preludeAtoms(), stdTable());
    const atom = parseAll("(par A B)", standardTokenizer())[0]!.atom;
    const [, state] = await mettaEvalAsync(env, 100_000, initSt(), emptyBindings, atom);

    expect(parseRuntimeId(state.world.allocation.ids.next("branch"))?.sequence).toBe(1);
  });

  it("does not recycle race branch lanes after selecting a winner", async () => {
    expectTwoDistinctHandles(
      await runProgramAsync(`
        !(race (new-state first-left) (new-state first-right))
        !(race (new-state second-left) (new-state second-right))
      `),
    );
  });

  it("retains the reserved parent allocation authority after race", async () => {
    const env = buildEnv(preludeAtoms(), stdTable());
    const atom = parseAll("(race A B)", standardTokenizer())[0]!.atom;
    const [, state] = await mettaEvalAsync(env, 100_000, initSt(), emptyBindings, atom);

    expectReservedParentAuthority(state);
  });

  it("does not recycle cut Hyperpose lanes after once selects an answer", () => {
    expectTwoDistinctHandles(
      runProgram(`
        !(once (hyperpose ((new-state first-left) (new-state first-right))))
        !(once (hyperpose ((new-state second-left) (new-state second-right))))
      `),
    );
  });

  it("retains the reserved parent allocation authority after a cut Hyperpose", () => {
    const env = buildEnv(preludeAtoms(), stdTable());
    const atom = parseAll("(once (hyperpose (A B)))", standardTokenizer())[0]!.atom;
    const [, state] = mettaEval(env, 100_000, initSt(), emptyBindings, atom);

    expectReservedParentAuthority(state);
  });

  it("gives Hyperpose siblings distinct state handles", () => {
    const states = firstResults(runProgram("!(hyperpose ((new-state A) (new-state B)))"));

    expect(states).toHaveLength(2);
    expect(new Set(states).size).toBe(2);
  });

  it("gives Hyperpose siblings distinct space handles", () => {
    const spaces = firstResults(runProgram("!(hyperpose ((new-space) (new-space)))"));

    expect(spaces).toHaveLength(2);
    expect(new Set(spaces).size).toBe(2);
  });

  it("does not overwrite a sibling's newly allocated state during Hyperpose merge", () => {
    const results = firstResults(
      runProgram("!(collapse (hyperpose ((new-state A) (new-state B))))"),
    );

    expect(results).toEqual(["(, A B)"]);
  });

  it("rejects conflicting writes to an existing shared state", async () => {
    await expect(
      runProgramAsync(`
        !(new-state initial)
        !(par
          (change-state! (State 0) left)
          (change-state! (State 0) right))
      `),
    ).rejects.toBeInstanceOf(WorldConflictError);
  });

  it("does not collide after a wide fan-out followed by later groups", () => {
    const groups = [
      "!(hyperpose (A))",
      `!(hyperpose (${Array.from({ length: 397 }, () => "A").join(" ")}))`,
      ...Array.from({ length: 46 }, () => "!(hyperpose (A))"),
    ];

    expect(() => runProgram(groups.join("\n"))).not.toThrow();
  });

  it("allocates distinct state and space handles through wide Hyperpose fan-out", () => {
    const width = 512;
    const states = firstResults(
      runProgram(
        `!(hyperpose (${Array.from({ length: width }, (_, index) => `(new-state S-${index})`).join(" ")}))`,
      ),
    );
    const spaces = firstResults(
      runProgram(`!(hyperpose (${Array.from({ length: width }, () => "(new-space)").join(" ")}))`),
    );

    expect(states).toHaveLength(width);
    expect(new Set(states).size).toBe(width);
    expect(spaces).toHaveLength(width);
    expect(new Set(spaces).size).toBe(width);
  });

  it("allocates distinct state handles through 128 nested Hyperposes", () => {
    let query = "(new-state leaf)";
    for (let depth = 0; depth < 128; depth++)
      query = `(hyperpose ((new-state side-${depth}) ${query}))`;

    const states = firstResults(runProgram(`!${query}`));
    expect(states).toHaveLength(129);
    expect(new Set(states).size).toBe(129);
    expect(states.every((state) => /^\(State state:/.test(state))).toBe(true);
  });

  it("does not overwrite a pre-existing opaque state ID", () => {
    const oldPredicted = new RuntimeIdAllocator("metta").fork("f0b0").next("state");
    const predictedAllocator = new RuntimeIdAllocator("metta").fork("fanout-0-0");
    const occupied = Array.from({ length: 8 }, () => predictedAllocator.next("state"));
    const expected = predictedAllocator.next("state");
    const runs = runProgram(`
      !(change-state! (State ${oldPredicted}) old-forged)
      ${occupied.map((id, index) => `!(change-state! (State ${id}) forged-${index})`).join("\n")}
      !(hyperpose ((new-state branch)))
      ${occupied.map((id) => `!(get-state (State ${id}))`).join("\n")}
      !(get-state (State ${oldPredicted}))
    `);
    const branchRunIndex = occupied.length + 1;

    expect(runs[branchRunIndex]?.results.map(format)).toEqual([`(State ${expected})`]);
    for (let index = 0; index < occupied.length; index++)
      expect(runs[branchRunIndex + index + 1]?.results.map(format)).toEqual([`forged-${index}`]);
    expect(runs.at(-1)?.results.map(format)).toEqual(["old-forged"]);
  });

  it("does not erase a pre-existing opaque space ID", () => {
    const oldPredicted = `&${new RuntimeIdAllocator("metta").fork("f0b0").next("space")}`;
    const predictedAllocator = new RuntimeIdAllocator("metta").fork("fanout-0-0");
    const occupied = Array.from({ length: 8 }, () => `&${predictedAllocator.next("space")}`);
    const expected = `&${predictedAllocator.next("space")}`;
    const runs = runProgram(`
      !(add-atom ${oldPredicted} old-sentinel)
      ${occupied.map((space, index) => `!(add-atom ${space} sentinel-${index})`).join("\n")}
      !(hyperpose ((new-space)))
      ${occupied.map((space) => `!(get-atoms ${space})`).join("\n")}
      !(get-atoms ${oldPredicted})
    `);
    const branchRunIndex = occupied.length + 1;

    expect(runs[branchRunIndex]?.results.map(format)).toEqual([expected]);
    for (let index = 0; index < occupied.length; index++)
      expect(runs[branchRunIndex + index + 1]?.results.map(format)).toEqual([`sentinel-${index}`]);
    expect(runs.at(-1)?.results.map(format)).toEqual(["old-sentinel"]);
  });

  it("replays the same explicit state without mutating its allocation authority", () => {
    const env = buildEnv(preludeAtoms(), stdTable());
    const atom = parseAll("(hyperpose ((new-state A)))", standardTokenizer())[0]!.atom;
    const state = initSt();

    const [first] = mettaEval(env, 100_000, state, emptyBindings, atom);
    const [second] = mettaEval(env, 100_000, state, emptyBindings, atom);

    expect(first.map(([result]) => format(result))).toEqual(
      second.map(([result]) => format(result)),
    );
  });

  it("rejects two branches that introduce the same opaque state key", async () => {
    const forged = new RuntimeIdAllocator("external").fork("same").next("state");

    await expect(
      runProgramAsync(`
        !(par
          (change-state! (State ${forged}) A)
          (change-state! (State ${forged}) B))
      `),
    ).rejects.toThrow("branch allocation collision");
  });

  it("rejects two branches that introduce the same opaque space key", async () => {
    const forged = `&${new RuntimeIdAllocator("external").fork("same").next("space")}`;

    await expect(
      runProgramAsync(`
        !(par
          (add-atom ${forged} A)
          (add-atom ${forged} B))
      `),
    ).rejects.toThrow("branch allocation collision");
  });
});
