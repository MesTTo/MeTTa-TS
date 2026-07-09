// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { emptyExpr, format, type HostInterop, type ReduceResult } from "@metta-ts/core";
import { createBrowserRunner, createBrowserTextLoader } from "./host";

const okUnit: ReduceResult = { tag: "ok", results: [emptyExpr] };

describe("createBrowserTextLoader", () => {
  it("loads exact and .metta VFS keys before fetching", async () => {
    const loadText = createBrowserTextLoader({
      files: new Map([
        ["plain", "A"],
        ["with-ext.metta", "B"],
      ]),
    });
    await expect(loadText("plain")).resolves.toBe("A");
    await expect(loadText("with-ext")).resolves.toBe("B");
    await expect(loadText("with-ext.metta")).resolves.toBe("B");
  });
});

describe("createBrowserRunner", () => {
  it("runs pure browser source with VFS imports", async () => {
    const runner = createBrowserRunner({
      files: new Map([["lib.metta", "(= (answer) 42)"]]),
    });
    const results = await runner.run(`
      !(import! &self "lib")
      !(answer)
    `);
    expect(results.map((result) => result.results.map(format))).toEqual([["()"], ["42"]]);
  });

  it("prepends interop preludes and passes async ops", async () => {
    const interop: HostInterop = {
      name: "test",
      prelude: "(= (from-prelude) (async-id 42))",
      asyncOps: new Map([
        ["async-id", async (args): Promise<ReduceResult> => ({ tag: "ok", results: [args[0]!] })],
      ]),
    };
    const runner = createBrowserRunner({ interops: [interop] });
    const results = await runner.run("!(from-prelude)");
    expect(results[0]!.results.map(format)).toEqual(["42"]);
  });

  it("disposes composed interops", async () => {
    let disposed = false;
    const runner = createBrowserRunner({
      interops: [{ name: "test", dispose: () => void (disposed = true) }],
    });
    await runner.dispose();
    expect(disposed).toBe(true);
  });

  it("threads host import through the async runner", async () => {
    const interop: HostInterop = {
      name: "host",
      hostImport: (_space, file) =>
        file.kind === "gnd" && file.value.g === "str" && file.value.s === "host.pl"
          ? okUnit
          : { tag: "noReduce" },
    };
    const runner = createBrowserRunner({ interops: [interop] });
    const results = await runner.run('!(import! &self "host.pl")');
    expect(results[0]!.results.map(format)).toEqual(["()"]);
  });
});
