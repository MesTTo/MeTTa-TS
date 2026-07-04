// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Node coloring that mimics the MeTTa syntax highlighting on the docs site (metta-highlight.ts, the GitHub
// dark theme): variables orange, numbers blue, strings light blue, the control/operator symbols
// (= : -> ! ==) red, space-refs orange, @-atoms purple, and headless expressions (parens) green. Every
// other symbol is the neutral default. Coloring the fill this way keeps a graph and its source consistent.

import type { GraphNode } from "./model";

/** A token category, matching the highlighter's classes, plus `control` for the branching forms so the
 *  graph can shape and color them like a flowchart decision, and `boolean` for the constants True/False. */
export type NodeRole =
  | "variable"
  | "number"
  | "string"
  | "boolean"
  | "operator"
  | "control"
  | "spaceref"
  | "at"
  | "paren"
  | "symbol";

/** Math-notation glyphs for the operator heads, following the MeTTa dev pack's pseudocode renderer, so the
 *  graph reads like math: `*` becomes ×, `>=` becomes ≥, `and` becomes ∧, `->` becomes →, `=` becomes ≡. */
const GLYPHS: Record<string, string> = {
  "*": "×", // ×
  "-": "−", // −
  "/": "÷", // ÷
  "%": "mod",
  ">=": "≥", // ≥
  "<=": "≤", // ≤
  "->": "→", // →
  "=": "≡", // ≡
  and: "∧", // ∧
  or: "∨", // ∨
  not: "¬", // ¬
  xor: "⊕", // ⊕
  superpose: "∪", // ∪
};

/** The glyph a symbol is drawn as: a math symbol for the operator heads, otherwise the name unchanged. */
export function displayGlyph(name: string): string {
  return GLYPHS[name] ?? name;
}

/** The fill and text color of a node. */
export interface NodeColor {
  fill: string;
  text: string;
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)$/;
/** The structural, arithmetic, comparison, and logic operator heads: colored red and drawn as diamonds,
 *  and shown as math glyphs by {@link displayGlyph}. */
const OPERATORS = new Set([
  "=",
  ":",
  "->",
  "==",
  "!",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  ">=",
  "<=",
  "and",
  "or",
  "not",
  "xor",
]);
/** The branching forms, drawn as flowchart decisions. */
const CONTROL = new Set(["if", "case", "cond", "match", "switch", "unify"]);
/** The boolean constants, drawn as their own square token. */
const BOOLEANS = new Set(["True", "False"]);

/** Classify a symbol name into a highlighter token category. */
export function roleOf(name: string): NodeRole {
  if (name.startsWith("$")) return "variable";
  if (name.startsWith("&")) return "spaceref";
  if (name.startsWith("@")) return "at";
  if (name.startsWith('"')) return "string";
  if (NUMERIC.test(name)) return "number";
  if (BOOLEANS.has(name)) return "boolean";
  if (OPERATORS.has(name)) return "operator";
  if (CONTROL.has(name)) return "control";
  return "symbol";
}

const DARK = "#0d1117";
const PALETTE: Record<NodeRole, NodeColor> = {
  // a variable is drawn hollow (a transparent circle), so its fill is used as the outline and its text is
  // the same color, visible on the canvas rather than dark-on-fill.
  variable: { fill: "#ffa657", text: "#ffa657" },
  spaceref: { fill: "#ffa657", text: DARK },
  at: { fill: "#d2a8ff", text: DARK },
  number: { fill: "#79c0ff", text: DARK },
  string: { fill: "#a5d6ff", text: DARK },
  boolean: { fill: "#39c5cf", text: DARK },
  operator: { fill: "#ff7b72", text: DARK },
  control: { fill: "#f2cc60", text: DARK },
  paren: { fill: "#7ee787", text: DARK },
  symbol: { fill: "#454c5a", text: "#e6edf3" },
};

/** The color of a node. List nodes are the paren green; dot nodes a neutral; symbol nodes are colored by
 *  {@link roleOf}. */
export function colorFor(node: GraphNode): NodeColor {
  if (node.kind === "list") return PALETTE.paren;
  if (node.kind === "dot") return { fill: "#6e7681", text: "#e6edf3" };
  return PALETTE[roleOf(node.name)];
}

// ---------- perceptual color blending (OKLab) ----------
// A node changing role during a reduction (a gray box becoming a red diamond) should blend its color
// smoothly. A raw RGB lerp passes through a muddy gray midpoint; interpolating in OKLab (Björn Ottosson's
// perceptual space) keeps the blend vivid, the way CSS `linear-gradient(in oklab, …)` does.

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

function hexToOklab(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) return null;
  const v = parseInt(m[1]!, 16);
  const r = srgbToLinear(((v >> 16) & 255) / 255);
  const g = srgbToLinear(((v >> 8) & 255) / 255);
  const b = srgbToLinear((v & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m2 = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m2 - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m2 + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m2 - 0.808675766 * s,
  ];
}

function oklabToHex([L, A, B]: [number, number, number]): string {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  const hx = (c: number): string =>
    Math.max(0, Math.min(255, Math.round(c * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/** Blend two `#rrggbb` colors at `t` in the OKLab space, so the transition stays vivid rather than passing
 *  through a muddy gray. Falls back to a hard switch at the midpoint for non-hex inputs. */
export function lerpColor(a: string, b: string, t: number): string {
  const ca = hexToOklab(a);
  const cb = hexToOklab(b);
  if (ca === null || cb === null) return t < 0.5 ? a : b;
  return oklabToHex([
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  ]);
}

/** A value in [0,1] to a green→yellow→red heat color (0 green, 0.5 yellow, 1 red), blended in OKLab. For
 *  coloring a node by a normalized quantity, an energy, a count, a score, the way a heat map does. */
export function heatColor(t: number): string {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5
    ? lerpColor("#3fb950", "#f2cc60", u * 2)
    : lerpColor("#f2cc60", "#f85149", (u - 0.5) * 2);
}
