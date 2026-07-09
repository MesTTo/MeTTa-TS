// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { E, MeTTa, S, ValueAtom, VariableAtom } from "@metta-ts/hyperon";
import { registerPrologInterop } from "./prolog";
import { swiPrologBridge } from "./swi";
import { runLast } from "./testSupport";

const LIVE = process.env.PROLOG_LIVE === "1";
const d = LIVE ? describe : describe.skip;

d("SWI-Prolog bridge", () => {
  it("queries, asserts, retracts, and imports function wrappers", async () => {
    const bridge = swiPrologBridge();
    const m = new MeTTa();
    registerPrologInterop(m, bridge);
    try {
      await m.runAsync("!(assertzPredicate (Predicate (hello world)))");
      await m.runAsync("!(assertzPredicate (Predicate (hello mars)))");
      expect(
        await runLast(m, "!(let $temp (callPredicate (Predicate (hello $what))) $what)"),
      ).toEqual(["world", "mars"]);
      await m.runAsync("!(import_prolog_function hello)");
      expect(await runLast(m, "!(hello)")).toEqual(["world", "mars"]);
      expect(await runLast(m, "!(retractPredicate (Predicate (hello world)))")).toEqual(["True"]);
      expect(await runLast(m, "!(hello)")).toEqual(["mars"]);
    } finally {
      bridge.dispose();
    }
  });

  it("can query a built-in arithmetic relation", async () => {
    const bridge = swiPrologBridge();
    try {
      await expect(
        bridge.query(
          E(S("is"), VariableAtom.parseName("x"), E(S("+"), ValueAtom(1), ValueAtom(2))),
        ),
      ).resolves.toEqual([E(S("is"), ValueAtom(3), E(S("+"), ValueAtom(1), ValueAtom(2)))]);
    } finally {
      bridge.dispose();
    }
  });
});
