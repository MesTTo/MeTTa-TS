// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { format, gstr, runProgramAsync, sym } from "@mettascript/core";
import { E, S, VariableAtom } from "@mettascript/hyperon";
import {
  createSwiWasmInterop,
  swiWasmBridge,
  type SwiWasmQuery,
  type SwiWasmRuntime,
} from "./swi-wasm";

class FakeQuery implements SwiWasmQuery {
  private index = 0;

  constructor(private readonly answers: readonly unknown[]) {}

  next(): unknown {
    if (this.index >= this.answers.length) return { done: true };
    const value = this.answers[this.index++];
    return { done: this.index >= this.answers.length, value };
  }

  once(): unknown {
    return this.answers[0] ?? { success: false };
  }
}

function fakeRuntime(): SwiWasmRuntime & {
  readonly files: Map<string, string>;
  readonly queries: string[];
} {
  const files = new Map<string, string>();
  const queries: string[] = [];
  return {
    files,
    queries,
    FS: {
      writeFile: (path, data) => void files.set(path, data),
      mkdirTree: () => undefined,
    },
    prolog: {
      query(goal) {
        queries.push(goal);
        if (goal === "'edge'('alice',V0).")
          return new FakeQuery([
            { $tag: "bindings", V0: "bob" },
            { $tag: "bindings", V0: "mars" },
          ]);
        if (goal === "current_predicate('edge'/A).")
          return new FakeQuery([{ $tag: "bindings", A: 2 }]);
        return new FakeQuery([{ $tag: "bindings", success: true }]);
      },
    },
  };
}

describe("swiWasmBridge", () => {
  it("serializes MeTTa goals to quoted Prolog source and returns solved goals", async () => {
    const runtime = fakeRuntime();
    const bridge = swiWasmBridge(runtime);
    const answers = await bridge.query(E(S("edge"), S("alice"), VariableAtom.parseName("x")));
    expect(runtime.queries[0]).toBe("'edge'('alice',V0).");
    expect(answers.map((atom) => atom.toString())).toEqual([
      "(edge alice bob)",
      "(edge alice mars)",
    ]);
  });

  it("consults logical files through the SWI virtual filesystem once", async () => {
    const runtime = fakeRuntime();
    const bridge = swiWasmBridge(runtime, {
      loadText: async (path) => `edge(${path}, loaded).\n`,
    });
    await bridge.consult("facts.pl");
    await bridge.consult("facts.pl");
    expect(runtime.files.get("/metta-ts-prolog/facts.pl")).toBe("edge(facts.pl, loaded).\n");
    expect(
      runtime.queries.filter((goal) => goal === "consult('/metta-ts-prolog/facts.pl')."),
    ).toHaveLength(1);
  });

  it("exposes the shared host interop shape for .pl imports", async () => {
    const runtime = fakeRuntime();
    const interop = await createSwiWasmInterop({
      prolog: runtime,
      loadText: async () => "edge(alice, bob).\n",
    });
    const imported = await interop.hostImport?.(sym("&self"), gstr("facts.pl"));
    expect(imported?.tag).toBe("ok");
    expect(imported?.tag === "ok" ? imported.results.map(format) : []).toEqual(["()"]);
    await expect(interop.hostImport?.(sym("&self"), gstr("facts.txt"))).resolves.toEqual({
      tag: "noReduce",
    });
  });
});

const liveIt = process.env.SWI_WASM_LIVE === "1" ? it : it.skip;

describe("createSwiWasmInterop live", () => {
  liveIt("imports a Prolog file and runs prolog-call through real SWI-WASM", async () => {
    const interop = await createSwiWasmInterop({
      loadText: async () => "edge(alice, bob).\nedge(alice, mars).\n",
    });
    try {
      const results = await runProgramAsync(
        `${interop.prelude ?? ""}\n!(import! &self "facts.pl")\n!(prolog-call (edge alice $x))\n!(import_prolog_function edge)\n!(edge alice)`,
        new Map(interop.asyncOps ?? []),
        undefined,
        new Map(),
        interop.hostImport === undefined ? {} : { hostImport: interop.hostImport },
      );
      expect(results[1]!.results.map(format)).toEqual(["(edge alice bob)", "(edge alice mars)"]);
      expect(results[3]!.results.map(format)).toEqual(["bob", "mars"]);
    } finally {
      await interop.dispose?.();
    }
  });
});
