// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Driving the picture from MeTTa, through an isolated `&grapher` space. A program adds directive atoms to
// it, `(color TARGET COLOR)`, `(highlight TARGET)`, `(focus TARGET)`, `(label TARGET TEXT)`, and the editor
// reads them back and overlays them on the graph. Because the directives live in their own space, they can
// never conflate with the program's own atoms in `&self`, and vice versa.
//
//   !(add-atom &grapher (color (fact 5) red))
//   !(add-atom &grapher (highlight if))
//
// The directives are read back with `(get-atoms &grapher)`, which returns every stored atom verbatim, so a
// target like `(fact 5)` stays exactly what the program wrote rather than being reduced to its result.

import { ExpressionAtom, atomIsError, type Atom, type MeTTa } from "@metta-ts/hyperon";

/** The space the editor watches for directives. */
export const VIZ_SPACE = "&grapher";

/** A parsed directive read from the grapher space. */
export interface VizDirective {
  kind: "color" | "highlight" | "focus" | "label";
  /** The term (or symbol) the directive points at. */
  target: Atom;
  /** A color for `color`, or the text for `label`. */
  arg?: Atom;
}

/** Everything the editor reads from `&grapher`: the per-node directives, and the global settings that target
 *  nothing (the canvas background). */
export interface VizResult {
  directives: VizDirective[];
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
  let background: string | null = null;
  for (const r of results) {
    if (atomIsError(r)) continue;
    const bg = parseBackground(r);
    if (bg !== null) {
      background = bg;
      continue;
    }
    const directive = parseDirective(r);
    if (directive !== null) directives.push(directive);
  }
  return { directives, background };
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
  return null;
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
