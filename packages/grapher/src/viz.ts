// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Driving the picture from MeTTa, through an isolated `&grapher` space. A program adds directive atoms to
// it, `(color TARGET COLOR)`, `(highlight TARGET)`, `(focus TARGET)`, `(label TARGET TEXT)`, `(size TARGET
// N)`, `(shade TARGET N)`, and the editor reads them back and overlays them on the graph. `size` and `shade`
// take a raw number (an energy, a count, a score) and are normalized across the space, so the smallest maps
// to the low end and the largest to the high end, the way a heat map auto-scales to its data. Because the
// directives live in their own space, they can never conflate with the program's own atoms in `&self`, and
// vice versa.
//
// Colouring and sizing nodes by a data attribute, the heat map and the `shade-by` / `size-by` mappers below,
// is credited to Rob Freeman (robjfr): it grew out of his need to visualize a dynamic-parser atomspace whose
// nodes carry attributes like energy.
//
//   !(add-atom &grapher (color (noeval (fact 5)) red))
//   !(add-atom &grapher (highlight if))
//
// The directives are read back with `(get-atoms &grapher)`. Under LeaTTa semantics `add-atom` evaluates its
// atom argument first, so use `noeval` when a target like `(fact 5)` should be stored as data.

import { ExpressionAtom, atomIsError, type Atom, type MeTTa } from "@metta-ts/hyperon";

/** The space the editor watches for directives. */
export const VIZ_SPACE = "&grapher";

/** A parsed directive read from the grapher space. */
export interface VizDirective {
  kind: "color" | "highlight" | "focus" | "label" | "size" | "shade";
  /** The term (or symbol) the directive points at. */
  target: Atom;
  /** A color for `color`, or the text for `label`. */
  arg?: Atom;
  /** The number for `size` (a relative scale) and `shade` (a value mapped to a heat color). */
  value?: number;
}

/** A data-driven style rule from `(shade-by FUNC)` or `(size-by FUNC)`: colour or size every node by
 *  evaluating `(FUNC node)` and normalizing the results across the graph, the way a Cytoscape stylesheet maps
 *  a data field to a visual property. */
export interface VizMapper {
  property: "shade" | "size";
  /** The function applied to each node, e.g. `energy` in `(shade-by energy)`. */
  func: Atom;
}

/** Everything the editor reads from `&grapher`: the per-node directives, the data-driven mappers, and the
 *  global settings that target nothing (the canvas background). */
export interface VizResult {
  directives: VizDirective[];
  /** Data-driven mappers from `(shade-by FUNC)` / `(size-by FUNC)`, applied to every node. */
  mappers: VizMapper[];
  /** The canvas background from `(background COLOR)`, or null to keep the default. */
  background: string | null;
}

/** Bind the isolated `&grapher` space in `space` (as a fresh, empty space). Call once per space: binding
 *  it again would replace it with a new empty one, dropping any directives already added. */
export function bindVizSpace(space: MeTTa): void {
  space.run(`!(bind! ${VIZ_SPACE} (new-space))`);
}

/** Read what is currently in `&grapher`, each atom verbatim (unevaluated): the per-node directives and the
 *  global background. Empty when the space is unbound or empty. */
export function readViz(space: MeTTa): VizResult {
  const results = space.run(`!(get-atoms ${VIZ_SPACE})`)[0] ?? [];
  const directives: VizDirective[] = [];
  const mappers: VizMapper[] = [];
  let background: string | null = null;
  for (const r of results) {
    if (atomIsError(r)) continue;
    const bg = parseBackground(r);
    if (bg !== null) {
      background = bg;
      continue;
    }
    const mapper = parseMapper(r);
    if (mapper !== null) {
      mappers.push(mapper);
      continue;
    }
    const directive = parseDirective(r);
    if (directive !== null) directives.push(directive);
  }
  return { directives, mappers, background };
}

/** The color from a `(background COLOR)` atom, or null for anything else. */
function parseBackground(atom: Atom): string | null {
  if (!(atom instanceof ExpressionAtom)) return null;
  const items = atom.children();
  return items.length === 2 && items[0]?.toString() === "background" && items[1] !== undefined
    ? colorOf(items[1])
    : null;
}

function parseDirective(atom: Atom): VizDirective | null {
  if (!(atom instanceof ExpressionAtom)) return null;
  const items = atom.children();
  const head = items[0]?.toString();
  const target = items[1];
  if (target === undefined) return null;
  if (head === "highlight" && items.length === 2) return { kind: "highlight", target };
  if (head === "focus" && items.length === 2) return { kind: "focus", target };
  const arg = items[2];
  if (head === "color" && arg !== undefined) return { kind: "color", target, arg };
  if (head === "label" && arg !== undefined) return { kind: "label", target, arg };
  if (head === "size" && arg !== undefined) {
    const value = numberOf(arg);
    if (value !== null) return { kind: "size", target, value };
  }
  if (head === "shade" && arg !== undefined) {
    const value = numberOf(arg);
    if (value !== null) return { kind: "shade", target, value };
  }
  return null;
}

/** A `(shade-by FUNC)` or `(size-by FUNC)` data-driven mapper, or null for anything else. */
function parseMapper(atom: Atom): VizMapper | null {
  if (!(atom instanceof ExpressionAtom)) return null;
  const items = atom.children();
  const func = items[1];
  if (items.length !== 2 || func === undefined) return null;
  const head = items[0]?.toString();
  if (head === "shade-by") return { property: "shade", func };
  if (head === "size-by") return { property: "size", func };
  return null;
}

/** The finite number an atom denotes (a numeric symbol like `42` or `-9.32`), or null. */
export function numberOf(atom: Atom): number | null {
  const n = Number(atom.toString());
  return Number.isFinite(n) ? n : null;
}

const NAMED: Record<string, string> = {
  red: "#f85149",
  green: "#3fb950",
  blue: "#58a6ff",
  yellow: "#f2cc60",
  orange: "#ffa657",
  purple: "#d2a8ff",
  cyan: "#39c5cf",
  pink: "#f778ba",
  white: "#ffffff",
  black: "#0d1117",
  gray: "#8b949e",
  grey: "#8b949e",
};

/** A CSS color from a name (`red`, `blue`, …) or a hex string; falls back to yellow. */
export function colorOf(atom: Atom): string {
  const s = atom.toString().replace(/^"|"$/g, "");
  const named = NAMED[s.toLowerCase()];
  if (named !== undefined) return named;
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
  return NAMED.yellow!;
}

/** The text of a label atom: a string without its quotes, or the atom's rendering. */
export function textOf(atom: Atom): string {
  return atom.toString().replace(/^"|"$/g, "");
}

/** Map raw `(id, value)` pairs to `[lo, hi]` by min-max across the set, so a `size` or `shade` overlay
 *  auto-scales to its data (the largest value gets `hi`, the smallest `lo`). All-equal or single values map
 *  to the midpoint, since they carry no spread. */
export function normalizeRange(
  vals: ReadonlyArray<readonly [string, number]>,
  lo: number,
  hi: number,
): Array<[string, number]> {
  if (vals.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const [, v] of vals) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  return vals.map(([id, v]) => [
    id,
    span === 0 ? (lo + hi) / 2 : lo + ((v - min) / span) * (hi - lo),
  ]);
}
