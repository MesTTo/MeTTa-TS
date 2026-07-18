<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Experimental features

MeTTa TS ships in-progress work on a separate prerelease line before it reaches a stable release. This page explains what that line is, how to opt into it, and what it currently contains.

## The two channels

Every package publishes to one of two npm dist-tags:

- `latest` is the stable line. A plain `npm install @metta-ts/core` installs it, and its API does not change under you within a major version. This is what you want for production.
- `experimental` is the prerelease line. It carries features that are complete and tested but whose public surface may still change before they land in a stable release. Its versions carry an `-experimental.N` suffix, for example `1.2.0-experimental.0`.

The stable line never depends on the experimental one, so installing stable is unaffected by anything here.

## Installing the experimental line

Opt in per package by asking for the tag:

```bash
npm install @metta-ts/core@experimental
npm install @metta-ts/hyperon@experimental
```

For a reproducible build, pin the exact version instead of the moving tag:

```bash
npm install @metta-ts/core@1.2.0-experimental.0
```

A plain install stays on stable:

```bash
npm install @metta-ts/core          # resolves the latest tag
```

## What to expect

The experimental features work and are covered by the test suite, but treat them as a preview:

- The API may change between experimental versions. Read the [release notes](https://github.com/MesTTo/MeTTa-TS/releases) before upgrading, and pin an exact version if you depend on the current shape.
- The semantics of stable MeTTa evaluation are unchanged. The experimental line adds new surfaces; it does not alter how existing programs evaluate.
- Feedback is the point. If something is awkward or missing, open an issue on [GitHub](https://github.com/MesTTo/MeTTa-TS/issues); this line exists so that the stable shape can be informed by real use.

## What is in it now

The current experimental line (`1.2.0-experimental.0`) contains:

- **The Grounded V2 operation protocol.** A grounded operation can return an owned, pull-based stream of answers, each carrying its own binding delta and effects, rather than one eagerly collected array. The evaluator owns the stream and closes it exactly once, so a consumer that stops early stops the producer.
- **Streaming operations on the runner.** `MeTTa.registerStreamingOperation` and `registerAsyncStreamingOperation` wrap that protocol for everyday use.
- **Cursor streaming through interpreted evaluation.** A `metta`/`metta-thread` call and interpreted rule alternatives stream one answer per pull, so `once` over a large interpreted producer does one step and closes the tail.
- **Minimal MeTTa runtime foundations.** Typed runtime foundations for the minimal machine: scoped variables and canonical persistent binding frames, binding capture and replay, coherent evaluation contexts with logical snapshots, explicit control semantics, resumable search cursors, and persistent branch worlds with bounded effect replay.

## Streaming grounded operations

The headline feature is streaming grounded operations. A normal grounded operation collects every result into an array before the evaluator sees any of them. A streaming operation hands the evaluator a generator instead, and the evaluator pulls one answer at a time. A consumer such as `once` then stops the producer rather than draining it.

```ts
// requires @metta-ts/hyperon@experimental
import { MeTTa, ValueAtom } from "@metta-ts/hyperon";

const metta = new MeTTa();

metta.registerStreamingOperation("naturals", function* () {
  for (let n = 0; ; n += 1) yield ValueAtom(n);
});

metta.run("!(once (naturals))")[0].map(String); // [ '0' ]: one pull, the infinite tail is closed
```

An answer can also be an object `{ atom, bindings, effects }`. `bindings` gives values for variables that appear in the call's arguments, keyed by variable name, so an operation can bind caller variables per alternative. `effects` (add or remove an atom, bind a token) apply only when that answer's branch is accepted:

```ts
metta.registerStreamingOperation("digits-of", function* (args) {
  for (const ch of String(args[0]))
    yield { atom: args[1]!, bindings: { d: ValueAtom(Number(ch)) } };
});

metta.run("!(digits-of 305 $d)")[0].map(String); // [ '3', '0', '5' ]
```

`registerAsyncStreamingOperation` is the asynchronous twin, for producers that await between answers (a paginated fetch, a database cursor). Its `signal` argument aborts when the evaluation is cancelled, so the producer stops requesting more as soon as the consumer stops pulling.

The full protocol underneath, `registerGroundedOperationV2`, and its ownership, binding-delta, and effect rules are described in the [1.2.0-experimental.0 release notes](https://github.com/MesTTo/MeTTa-TS/releases/tag/v1.2.0-experimental.0) and in [`docs/minimal-metta-runtime.md`](https://github.com/MesTTo/MeTTa-TS/blob/experimental/docs/minimal-metta-runtime.md) on the experimental branch.

## Where the work happens

The experimental line is built on the [`experimental` branch](https://github.com/MesTTo/MeTTa-TS/tree/experimental) of the repository, and each prerelease is cut from there. The stable site you are reading tracks `main`; the experimental branch carries the same guide plus the detailed reference for the surfaces above.
