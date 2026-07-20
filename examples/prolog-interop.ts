// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Run it after building packages: `npx tsx examples/prolog-interop.ts`.
import { MeTTa } from "@mettascript/hyperon";
import { registerPrologInterop } from "@mettascript/prolog";
import { swiPrologBridge } from "@mettascript/prolog/swi-node";

const bridge = swiPrologBridge();
const metta = new MeTTa();
registerPrologInterop(metta, bridge);

const run1 = async (src: string): Promise<string[]> =>
  (await metta.runAsync(src)).at(-1)!.map((atom) => atom.toString());

try {
  await metta.runAsync(`
    !(assertzPredicate (Predicate (hello world)))
    !(assertzPredicate (Predicate (hello mars)))
  `);

  console.log(
    "callPredicate:",
    await run1("!(let $temp (callPredicate (Predicate (hello $what))) $what)"),
  );

  await metta.runAsync("!(import_prolog_function hello)");
  console.log("hello():", await run1("!(hello)"));

  await metta.runAsync("!(import_prolog_function succ)");
  console.log("succ(41):", await run1("!(succ 41)"));
} finally {
  bridge.dispose();
}
