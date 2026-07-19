# @metta-ts/node

Node.js entry for [MeTTa TS](https://github.com/MesTTo/MeTTa-TS): the `metta` command-line interface, file-based `import!`, and a `SharedArrayBuffer` worker-thread parallel matcher. Re-exports everything from [`@metta-ts/core`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/core).

## Install

```bash
npm install @metta-ts/node
# for the CLI on your PATH:
npm install -g @metta-ts/node
```

## CLI

`metta` is a single command with subcommands:

```bash
metta run program.metta       # run a program (metta program.metta is shorthand)
metta check program.metta     # static analysis (--json, --undefined-symbols)
metta debug --file program.metta why '(main)'   # engine debugger (why/eval/run)
metta graph program.metta -o out.gif            # render the reduction as an animated GIF
metta --version
```

Without a global install: `npx -p @metta-ts/node metta run program.metta`.

Host runtimes are explicit and lazy:

```bash
metta run --py program.metta       # Python through pythonia
metta run --prolog program.metta   # Prolog through a local swipl executable
```

Without those flags the CLI never loads Python, Prolog, or their optional
dependencies. `metta graph` similarly loads [`@metta-ts/grapher`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/grapher)
and its renderers only when invoked; install them with `npm install @metta-ts/grapher gifenc sharp`.

The earlier `metta-ts` (run) and `metta-debug` (debug) commands remain as aliases,
so existing scripts keep working.

## Usage

```ts
import { runFile, ParallelFlatMatcher } from "@metta-ts/node";

// Run a .metta file (resolves import! against the file system).
for (const { query, results } of runFile("program.metta")) {
  console.log(query, results);
}
```

`ParallelFlatMatcher` scans a large flat knowledge base across `worker_threads` over a shared token buffer. It pays off only for a large KB scanned by a non-selective query whose result set is small; a keyed query is already near-constant-time via the in-memory argument index.

## License

[MIT](https://github.com/MesTTo/MeTTa-TS/blob/main/LICENSE).
