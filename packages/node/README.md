# @metta-ts/node

Node.js entry for [MeTTa TS](https://github.com/MesTTo/MeTTa-TS): the `metta-ts` command-line runner, file-based `import!`, and a `SharedArrayBuffer` worker-thread parallel matcher. Re-exports everything from [`@metta-ts/core`](https://github.com/MesTTo/MeTTa-TS/tree/main/packages/core).

## Install

```bash
npm install @metta-ts/node
# for the CLI on your PATH:
npm install -g @metta-ts/node
```

## CLI

```bash
metta-ts path/to/program.metta
# or without a global install:
npx -p @metta-ts/node metta-ts path/to/program.metta
```

Host runtimes are explicit:

```bash
metta-ts --py program.metta       # Python through pythonia
metta-ts --prolog program.metta   # Prolog through a local swipl executable
```

Without those flags, the CLI never loads Python, Prolog, or their optional
dependencies. With the flags, `.py` and `.pl` imports are handled by the
matching host adapter.

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
