# @metta-ts/grapher

A browser editor for MeTTa programs. It renders the same atoms as a connected
node graph or nested blocks, evaluates them with `@metta-ts/hyperon`, and
exposes the model and rendering pieces for custom hosts.

## Install

```bash
npm install @metta-ts/grapher
```

## Mount the editor

Give the host element an explicit height because the editor's SVG fills its
container.

```html
<div id="metta-graph" style="width: 100%; height: 440px"></div>
```

```ts
import { grapher } from "@metta-ts/grapher";

const view = grapher("#metta-graph")
  .load("(= (double $x) (* $x 2))\n(double 21)")
  .graph()
  .fit()
  .evaluate();

// The query node is labelled 42. Switch views with view.blocks() or view.graph().
// Call view.destroy() when the host component unmounts.
```

`grapher(target, options?)` accepts a CSS selector or `HTMLElement`.
`GrapherOptions` accepts `source?: string` and `metta?: MeTTa`; pass an existing
`MeTTa` when the editor should share its space. The fluent handle provides
`load`, `atoms`, `graph`, `blocks`, `palette`, `fit`, `evaluate`, `play`,
`source`, `gif`, and `destroy`. Its `.grapher` property is the underlying
`MeTTaGrapher` instance.

`play()` initializes a reduction trace at its first state. A host can advance
it with `view.grapher.traceForward()`, step back with `traceBack()`, and leave
the trace with `stopTrace()`.

## Browser requirements

Use the package from an ESM-capable browser build. The mounted editor needs the
DOM, SVG, Pointer Events, keyboard events, and a sized host element. The block
view uses Canvas 2D text measurement, and animated transitions use
`requestAnimationFrame`. Styles are embedded in the generated SVG, so there is
no stylesheet to import.

The parser, graph model, serialization, and evaluation helpers also run
headlessly. Node consumers require Node 20 or newer. `@metta-ts/hyperon` is
installed as a package dependency.

GIF export is optional. Install `gifenc` and pass its module to `gif()` or
`exportReductionGif()`:

```bash
npm install gifenc
```

```ts
const blob = await grapher("#metta-graph")
  .load("(+ 10 (* 25 2))")
  .blocks()
  .gif(await import("gifenc"));
```

## Exports

The code entry point is `@metta-ts/grapher`. Its main public surfaces are:

- `grapher`, `MeTTaGrapher`, and their types for mounting and controlling the
  editor.
- `Graph`, `parseProgram`, `fromSource`, `toSource`, `toJson`, `fromJson`,
  `graphToAtoms`, `atomToGraph`, and `composeAtom` for graph and atom
  conversion.
- `evaluateHead`, `evaluateHeadAsync`, `loadProgram`, `reduceStep`, and
  `reduceTrace` for evaluation and traces.
- `Renderer`, `Controller`, `BlockView`, layout, viewport, palette, and SVG
  frame helpers for custom hosts.
- `bindVizSpace`, `readViz`, `colorOf`, `textOf`, and `VIZ_SPACE` for
  `&grapher` directives.
- `reductionGif`, `graphReductionGif`, and `sideBySideReductionGif` for
  caller-supplied GIF encoding.

The package also exports `@metta-ts/grapher/package.json`. See the
[full API reference](https://mestto.github.io/MeTTa-TS/reference/grapher).

## License

[MIT](https://github.com/MesTTo/MeTTa-TS/blob/main/LICENSE).
