<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Grounded operations

A grounded operation is a TypeScript function the MeTTa evaluator can call by name. It is how you extend the language: arithmetic, I/O, and your own domain logic all enter MeTTa as grounded operations. Register one with `registerOperation` on a `MeTTa` runner.

```ts
import { MeTTa, ValueAtom, type GroundedAtom, type Atom } from "@metta-ts/hyperon";

const metta = new MeTTa();
metta.registerOperation("double", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  return [ValueAtom(n * 2)];
});

console.log(metta.run("!(double 21)")[0].map(String)); // [ '42' ]
```

The function receives the argument atoms and returns an array of result atoms (an array, because a MeTTa operation may be nondeterministic). `jsValue<T>()` unwraps a grounded argument to its TypeScript value, and `ValueAtom` wraps a TypeScript value back into a grounded atom.

## Errors are values

If your function throws, the error does not crash the run. It becomes a MeTTa `(Error ...)` atom that the program can inspect:

```ts
metta.registerOperation("checked-sqrt", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  if (n < 0) throw new Error("negative input");
  return [ValueAtom(Math.sqrt(n))];
});

metta.run("!(checked-sqrt -1)"); // [ (Error (checked-sqrt -1) "negative input") ]
```

## Falling through to other rules

Sometimes the right behavior on the wrong argument is not an error but "this rule does not apply, let another one try". That is MeTTa's multiple dispatch. Throw `IncorrectArgumentError` to leave the expression unevaluated instead of producing an error atom:

```ts
import { IncorrectArgumentError } from "@metta-ts/hyperon";

metta.registerOperation("only-positive", (args: Atom[]) => {
  const n = (args[0] as GroundedAtom).jsValue<number>();
  if (n <= 0) throw new IncorrectArgumentError("not for me");
  return [ValueAtom(n)];
});
```

Now `(only-positive -3)` is left as-is, so a separate `=` rule for non-positive inputs can match it.

## Returning several results

Because the return type is `Atom[]`, an operation can be nondeterministic. Return more than one atom and each becomes a result:

```ts
metta.registerOperation("pair", (args: Atom[]) => [args[0]!, args[1]!]);
metta.run("!(pair A B)")[0].map(String); // [ 'A', 'B' ]
```

## Streaming operations

`registerOperation` collects every result eagerly. `registerStreamingOperation` takes a generator instead, and the evaluator pulls one answer at a time. A consumer that stops early, such as `once`, closes the tail and the producer never runs past the answers actually used:

```ts
const metta = new MeTTa();
metta.registerStreamingOperation("naturals", function* () {
  for (let n = 0; ; n += 1) yield ValueAtom(n);
});
metta.run("!(once (naturals))")[0].map(String); // [ '0' ]: one pull, the infinite tail is closed
```

An answer can also be an object `{ atom, bindings, effects }`. `bindings` gives values for variables that appear in the call's arguments, keyed by variable name, so an operation can bind caller variables per alternative, Prolog-style. `effects` (add or remove an atom, bind a token) apply only when that answer's branch is accepted:

```ts
metta.registerStreamingOperation("digits-of", function* (args) {
  for (const ch of String(args[0])) yield { atom: args[1]!, bindings: { d: ValueAtom(Number(ch)) } };
});
metta.run("!(digits-of 305 $d)")[0].map(String); // [ '3', '0', '5' ]
```

`registerAsyncStreamingOperation` is the asynchronous twin for producers that await between answers. The `signal` argument aborts when the evaluation is cancelled, so a paginated fetch stops requesting pages as soon as the consumer stops pulling:

```ts
metta.registerAsyncStreamingOperation("issues", async function* (args, signal) {
  for (let page = 1; ; page += 1) {
    const response = await fetch(`https://api.example.com/issues?page=${page}`, { signal });
    const rows: { id: number }[] = await response.json();
    if (rows.length === 0) return;
    for (const row of rows) yield { atom: args[0]!, bindings: { id: ValueAtom(row.id) } };
  }
});
// One page is fetched, one row is used, and the tail never requests page 2:
await metta.runAsync("!(once (issues $id))");
```

Error behavior matches the eager API: a throw before the first answer becomes an `(Error ...)` result, `IncorrectArgumentError` leaves the expression unevaluated for other rules, and a throw mid-stream ends the stream with an `(Error ...)` answer after the answers already produced. Registrations default to the `atomspace-write` effect class with speculative answers; pass `{ effects, speculative }` options to declare something stricter.

## Streaming operations with bindings (core API)

The low-level `@metta-ts/core` API has the pull-based registration underneath, `registerGroundedOperationV2`, for operations that need the full protocol: explicit binding-frame deltas, per-answer effect lists, mode and capability declarations. The minimal MeTTa document lists grounded operations returning bindings as future work; this is that surface in MeTTa TS.

```ts
import {
  buildEnv,
  preludeAtoms,
  stdlibAtoms,
  stdTable,
  registerGroundedOperationV2,
  groundedSyncAnswers,
  mettaEval,
  initSt,
  parseAll,
  standardTokenizer,
  format,
  gint,
} from "@metta-ts/core";

const env = buildEnv([...preludeAtoms(), ...stdlibAtoms()], stdTable());

registerGroundedOperationV2(
  env,
  "naturals",
  () => ({
    tag: "answers",
    answers: groundedSyncAnswers(
      (function* () {
        for (let n = 0; ; n += 1) yield { atom: gint(n) };
      })(),
    ),
  }),
  { mode: "sync", effects: { classes: ["pure"], speculative: true } },
);

const query = parseAll("!(once (naturals))", standardTokenizer())[0].atom;
const [pairs] = mettaEval(env, 100_000, initSt(), [], query);
console.log(pairs.map(([atom]) => format(atom))); // [ '0' ]: one pull, tail closed
```

The operation returns a cursor instead of an array, so the evaluator pulls answers one at a time: `once` above observes one answer and closes the infinite tail instead of enumerating it. An answer can also carry a `bindingDelta` built from `context.bindings` (the caller's binding frame) to bind caller variables per alternative, and an `effects` list applied only on that alternative's branch. Registrations declare their mode, effect classes, and required capabilities explicitly.

`MeTTa.registerStreamingOperation` and `registerAsyncStreamingOperation` wrap this protocol for the common cases; `registerOperation` and `registerAsyncOperation` remain the eager array API. The full protocol contract (cursor ownership, pull allowances, binding deltas, and scope rules) is specified in the repository's `docs/minimal-metta-runtime.md`.

Next: pass whole TypeScript objects, not just primitives, into the atomspace. See **[Embedding TypeScript objects](/typescript/embedding-objects)**.
