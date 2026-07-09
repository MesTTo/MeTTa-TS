# @metta-ts/browser

Browser entry for [MeTTa TS](https://github.com/MesTTo/Meta-TypeScript-Talk). Re-exports everything from [`@metta-ts/core`](https://github.com/MesTTo/Meta-TypeScript-Talk/tree/main/packages/core) and adds an in-memory virtual file system so `import!` works without disk access.

## Install

```bash
npm install @metta-ts/browser
```

## Usage

```ts
import { run, runSourceAsync } from "@metta-ts/browser";

// A virtual file system: module name -> MeTTa source.
const files = new Map([["math", "(= (double $x) (* 2 $x))"]]);

const results = run(
  `
  !(import! &self math)
  !(double 21)
`,
  files,
);
```

`run(src, files?, fuel?)` evaluates a program, resolving `import!` against the in-memory files. The whole interpreter is pure TypeScript, so it runs in any browser with no native addon and no required WASM.

For embedders that already resolved imports, `@metta-ts/browser/source` exposes source runners:

```ts
import { runSourceAsync } from "@metta-ts/browser/source";

const results = await runSourceAsync(`
  !(import! &self concurrency)
  !(par (+ 1 1) (+ 2 2))
`);
```

The async runner supports MeTTa's async forms (`par`, `race`, `with-mutex`) and uses Web Workers for
`(once (hyperpose ...))` when the browser host provides them.

## Host Interop

`@metta-ts/browser/host` composes optional host runtimes such as Pyodide and
SWI-Prolog WASM. The base browser package stays pure TypeScript. Import a host
adapter only when the page needs it.

```ts
import { createBrowserRunner, createBrowserTextLoader } from "@metta-ts/browser/host";
import { createPyodideInterop } from "@metta-ts/py/pyodide";
import { createSwiWasmInterop } from "@metta-ts/prolog/swi-wasm";

const files = new Map([
  ["math.py", "def add(a, b):\n    return a + b\n"],
  ["facts.pl", "edge(alice, bob).\n"],
]);
const loadText = createBrowserTextLoader({ files, baseUrl: import.meta.url });
const py = await createPyodideInterop({ loadText });
const prolog = await createSwiWasmInterop({ loadText });
const runner = createBrowserRunner({ files, interops: [py, prolog] });

const results = await runner.run(`
  !(import! &self "math.py")
  !(py-call (math.add 40 2))
  !(import! &self "facts.pl")
  !(prolog-call (edge alice $x))
`);

await runner.dispose();
```

See `examples/browser-interop` for a runnable smoke check and a bundle isolation
check.

## License

[MIT](https://github.com/MesTTo/Meta-TypeScript-Talk/blob/main/LICENSE).
