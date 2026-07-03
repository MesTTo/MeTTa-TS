// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The pure-SVG renderer. It owns an <svg> inside the container and redraws the whole graph from the model
// on each call: one <g> per node (a rounded rect, a label, a connector port, a selection outline, an
// optional result label) under a single viewport <g> that carries the pan and zoom transform. Wires are
// straight, center to center, and two-tone: a faint full-length line plus the parent's color over its near
// half, drawn behind the nodes so only the segment between two boxes shows. Nodes carry data-id (and the
// port carries data-port) so the controller reads the target straight off a pointer event, no manual
// hit-testing. Drawing only, it never mutates the model.

import type { Graph, GraphNode } from "./model";
import type { Viewport } from "./viewport";
import { colorFor, roleOf, lerpColor } from "./color";
import { NODE_H, displayText, nodeWidth } from "./measure";
import { variableLinks } from "./variables";
import { ease, arcPoint, lerp } from "./anim";
import { shapePoints, pointsAttr } from "./shapes";

const SVG_NS = "http://www.w3.org/2000/svg";
const PORT_R = 4;
const TRACE_DURATION = 380; // ms, a step-through morph
const SHAPE_N = 40; // boundary points per node for the shape morph (divisible by 4 to keep diamond corners)

/** A per-node evaluation label to show beneath it. */
export interface NodeLabel {
  text: string;
  error: boolean;
}

/** A per-node overlay from a MeTTa `&grapher` directive: a fill color, a highlight ring, and a label. */
export interface NodeViz {
  color?: string;
  highlight?: boolean;
  label?: string;
}

/** Everything the renderer needs for one frame. */
export interface RenderState {
  graph: Graph;
  viewport: Viewport;
  selection: ReadonlySet<string>;
  labels: ReadonlyMap<string, NodeLabel>;
  primaryId: string | null;
  viz: ReadonlyMap<string, NodeViz>;
}

/** The canvas background. One source, so the CSS and the redex-glow contrast test agree, and a theme need
 *  only change this (or the runtime {@link Renderer.setBackground}). */
export const CANVAS_BG = "#1b1d23";

const CSS = `
.mg-svg { width: 100%; height: 100%; display: block; overflow: clip; background: ${CANVAS_BG}; user-select: none; font-family: ui-monospace, monospace; }
.mg-edge { stroke-width: 1.6; }
.mg-var-link { stroke: #ffa657; stroke-width: 1; stroke-dasharray: 3 4; opacity: 0.45; }
.mg-node text { font-size: 12px; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.mg-node .box { stroke: #00000055; stroke-width: 1; cursor: grab; }
.mg-node .var { fill: none; stroke-width: 1.8; cursor: grab; }
.mg-sel { fill: none; stroke: #38bdf8; stroke-width: 1.5; }
.mg-sel.primary { stroke: #f59e0b; }
.mg-port { fill: #cbd5e1; stroke: #1b1d23; stroke-width: 1; cursor: crosshair; }
.mg-result { font-size: 11px; fill: #9ca3af; }
.mg-result.error { fill: #f87171; }
.mg-viz-hi { fill: none; stroke: #f2cc60; stroke-width: 2.5; }
.mg-viz-label { font-size: 11px; fill: #f2cc60; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.mg-overlay { pointer-events: none; }
`;

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** A wire between two points that blends from the parent's color to the child's. It is drawn as a short
 *  chain of segments, each set to the OKLab blend at its position, so the edge reads as one color flowing
 *  into the next rather than an abrupt two-tone split. */
function blendEdge(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cFrom: string,
  cTo: string,
  opacity = 1,
): SVGElement[] {
  const n = 8;
  const out: SVGElement[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    out.push(
      svgEl("line", {
        class: "mg-edge",
        x1: lerp(x1, x2, t0),
        y1: lerp(y1, y2, t0),
        x2: lerp(x1, x2, t1),
        y2: lerp(y1, y2, t1),
        stroke: lerpColor(cFrom, cTo, (i + 0.5) / n),
        opacity,
      }),
    );
  }
  return out;
}

/** The box shape for a node, chosen by its role so shape carries meaning like a flowchart: a diamond for
 *  the structural operators (`= : ->`), a slanted "hole" for a variable binding, a pill for a grounded
 *  value, a hexagon for a headless expression, and a rounded rectangle for a function or plain symbol. */
function nodeShape(node: GraphNode, w: number, fill: string): SVGElement {
  const hw = w / 2;
  const hh = NODE_H / 2;
  const poly = (points: string): SVGElement => svgEl("polygon", { class: "box", points, fill });
  const rect = (rx: number): SVGElement =>
    svgEl("rect", { class: "box", x: -hw, y: -hh, width: w, height: NODE_H, rx, fill });
  const role = node.kind === "symbol" ? roleOf(node.name) : node.kind;
  switch (role) {
    case "operator":
    case "control":
      return poly(`0,${-hh} ${hw},0 0,${hh} ${-hw},0`); // diamond (a flowchart decision)
    case "variable":
      // a hollow circle: transparent fill, the role color as the outline
      return svgEl("ellipse", { class: "var", cx: 0, cy: 0, rx: hw, ry: hh, stroke: fill });
    case "number":
    case "string":
      return rect(hh); // pill
    case "boolean":
      return rect(3); // a square constant box
    case "list":
      return poly(
        `${-hw + 7},${-hh} ${hw - 7},${-hh} ${hw},0 ${hw - 7},${hh} ${-hw + 7},${hh} ${-hw},0`,
      ); // hexagon
    default:
      return rect(5); // rounded rectangle
  }
}

/** Renders a graph into an <svg> and keeps a handle to the viewport group for pan and zoom. */
export class Renderer {
  readonly svg: SVGSVGElement;
  private readonly viewportG: SVGGElement;
  private readonly haloG: SVGGElement;
  private readonly edgesG: SVGGElement;
  private readonly mergeG: SVGGElement;
  private readonly nodesG: SVGGElement;
  // The last shown playthrough frame, so the next step can glide from it.
  private tracePrev: TraceFrame | null = null;
  private traceRaf = 0;
  // How long one step's morph takes, so a slower playback slows the animation itself, not just the pauses.
  private traceDuration = TRACE_DURATION;
  // The canvas background, so the redex glow can keep enough contrast against whatever theme is set.
  private bg = CANVAS_BG;

  constructor(container: HTMLElement) {
    this.svg = svgEl("svg", { class: "mg-svg" });
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = CSS;
    this.svg.appendChild(style);
    // The gooey-merge filter, the standard SVG gooey effect (Lucas Bebber): blur, then threshold the alpha,
    // so shapes that come close meld into one fluid surface with an organic neck. Applied only to the small
    // group of shapes currently collapsing together, so it stays a cheap, scoped effect, not a whole-canvas
    // filter. A true field threshold, so it never spikes the way a hand-rolled geometric blob can.
    const goo = svgEl("filter", {
      id: "mg-goo",
      x: "-50%",
      y: "-50%",
      width: "200%",
      height: "200%",
    });
    goo.append(
      svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: "6", result: "b" }),
      svgEl("feColorMatrix", {
        in: "b",
        type: "matrix",
        values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8",
        result: "goo",
      }),
      // A liquid warble on top of the meld: a noise field (feTurbulence) displaces the blob's edge, so it
      // ripples like a fluid and a wide label like `fact` or `True` loses its rigid box edge instead of
      // staying a stiff rounded rectangle.
      svgEl("feTurbulence", {
        type: "fractalNoise",
        baseFrequency: "0.018",
        numOctaves: "2",
        seed: "7",
        result: "noise",
      }),
      svgEl("feDisplacementMap", {
        in: "goo",
        in2: "noise",
        scale: "14",
        xChannelSelector: "R",
        yChannelSelector: "G",
      }),
    );
    const defs = svgEl("defs", {});
    defs.appendChild(goo);
    this.svg.appendChild(defs);
    this.viewportG = svgEl("g", { class: "mg-viewport" });
    this.haloG = svgEl("g", { class: "mg-halo" });
    this.edgesG = svgEl("g", { class: "mg-edges" });
    this.mergeG = svgEl("g", { class: "mg-merge", filter: "url(#mg-goo)" });
    this.nodesG = svgEl("g", { class: "mg-nodes" });
    this.viewportG.appendChild(this.haloG); // below everything
    this.viewportG.appendChild(this.edgesG);
    this.viewportG.appendChild(this.mergeG); // the merge blob is the liquid shape of the collapsing nodes
    this.viewportG.appendChild(this.nodesG); // crisp text and the surviving shapes ride on top
    this.svg.appendChild(this.viewportG);
    container.appendChild(this.svg);
  }

  /** Set the canvas background. The redex glow re-reads it, so its contrast stays right under any theme. */
  setBackground(bg: string): void {
    this.bg = bg;
    this.svg.style.background = bg;
  }

  /** Set how long a step's morph takes (ms), so playback speed slows the animation, not just the pauses. */
  setTraceDuration(ms: number): void {
    this.traceDuration = Math.max(1, ms);
  }

  /** Redraw the whole frame. */
  render(state: RenderState): void {
    const { viewport: v } = state;
    this.viewportG.setAttribute("transform", `translate(${v.panX} ${v.panY}) scale(${v.scale})`);
    this.haloG.replaceChildren();
    this.mergeG.replaceChildren();
    this.edgesG.replaceChildren(...this.edges(state.graph), ...this.varNet(state.graph));
    this.nodesG.replaceChildren(...this.nodeGroups(state));
  }

  /** Forget the last playthrough frame, so the next one starts without gliding from a stale step. */
  clearTrace(): void {
    if (this.traceRaf !== 0) {
      cancelAnimationFrame(this.traceRaf);
      this.traceRaf = 0;
    }
    this.tracePrev = null;
    this.haloG.replaceChildren();
    this.mergeG.replaceChildren();
  }

  /** Show one reduction step. With `animate` and a previous step, shared subterms arc from their old place
   *  to their new one, the parts that appear or vanish fade, and the viewport eases, the way a math
   *  animation morphs one expression into the next. Otherwise it paints at once. */
  showTrace(state: RenderState, animate: boolean): void {
    const next = traceFrame(state.graph, state.viewport);
    const prev = this.tracePrev;
    this.tracePrev = next;
    if (this.traceRaf !== 0) {
      cancelAnimationFrame(this.traceRaf);
      this.traceRaf = 0;
    }
    if (!animate || prev === null || typeof requestAnimationFrame === "undefined") {
      this.paintTrace(prev ?? next, next, 1);
      return;
    }
    const start = performance.now();
    const dur = this.traceDuration;
    const step = (now: number): void => {
      const p = Math.min(1, (now - start) / dur);
      this.paintTrace(prev, next, ease(p));
      if (p < 1) {
        this.traceRaf = requestAnimationFrame(step);
      } else {
        this.traceRaf = 0;
        this.paintTrace(next, next, 1);
      }
    };
    this.traceRaf = requestAnimationFrame(step);
  }

  /** Paint an interpolated frame between two steps. The interpolation itself is pure ({@link
   *  interpolateTrace}); this just draws the result. */
  private paintTrace(from: TraceFrame, to: TraceFrame, t: number): void {
    const frame = interpolateTrace(from, to, t);
    const { panX, panY, scale } = frame.viewport;
    this.viewportG.setAttribute("transform", `translate(${panX} ${panY}) scale(${scale})`);

    this.haloG.replaceChildren(
      ...(frame.redex !== undefined && frame.redex.op > 0.01 ? haloEls(frame.redex, this.bg) : []),
    );

    // The merge: each subterm collapsing into a result contributes its shape to the gooey-filtered layer.
    // As they travel to the same spot the filter melds them into one fluid mass and they coalesce, the
    // reverse of a droplet splitting apart. The shapes are the liquid form of those nodes; their text rides
    // on top in the node layer, and the result emerges crisp from where they gather.
    const mergeEls: SVGElement[] = [];
    for (const p of frame.nodes) {
      if (!p.merging || p.op <= 0.02) continue;
      mergeEls.push(
        svgEl("polygon", {
          points: pointsAttr(p.points),
          transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
          fill: p.fill,
          opacity: p.op.toFixed(3),
        }),
      );
    }
    this.mergeG.replaceChildren(...mergeEls);

    const edgeEls: SVGElement[] = [];
    for (const e of frame.edges) {
      if (e.colorA === "")
        edgeEls.push(
          svgEl("line", {
            class: "mg-var-link",
            x1: e.x1,
            y1: e.y1,
            x2: e.x2,
            y2: e.y2,
            opacity: e.op,
          }),
        );
      else edgeEls.push(...blendEdge(e.x1, e.y1, e.x2, e.y2, e.colorA, e.colorB, e.op));
    }
    this.edgesG.replaceChildren(...edgeEls);

    const nodeEls = frame.nodes.map((p) => {
      const g = svgEl("g", {
        class: "mg-node",
        transform: `translate(${p.x} ${p.y})`,
        opacity: p.op,
      });
      // A merging node's shape is drawn as part of the fluid blob below, so here it contributes only its
      // text (the label riding on the liquid). Everything else draws its shape as fill + outline: a solid
      // node a filled shape, a variable a hollow outline, a variable filling in ramps the fill up.
      if (!p.merging)
        g.appendChild(
          svgEl("polygon", {
            points: pointsAttr(p.points),
            fill: p.fill,
            "fill-opacity": p.fillOp.toFixed(3),
            stroke: p.fill,
            "stroke-opacity": (1 - p.fillOp * 0.7).toFixed(3),
            "stroke-width": 1.6,
          }),
        );
      for (const tx of p.texts) {
        const text = svgEl("text", { x: 0, y: 0, fill: tx.color, opacity: tx.op });
        text.textContent = tx.text;
        g.appendChild(text);
      }
      return g;
    });
    this.nodesG.replaceChildren(...nodeEls);
  }

  /** Faint dashed links between the occurrences of each variable within a rule. */
  private varNet(graph: Graph): SVGElement[] {
    const out: SVGElement[] = [];
    for (const [aId, bId] of variableLinks(graph)) {
      const a = graph.nodes.get(aId);
      const b = graph.nodes.get(bId);
      if (a === undefined || b === undefined) continue;
      out.push(svgEl("line", { class: "mg-var-link", x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    }
    return out;
  }

  private edges(graph: Graph): SVGElement[] {
    const out: SVGElement[] = [];
    for (const parent of graph.nodes.values()) {
      const kids = graph.childrenOf(parent.id);
      if (kids.length === 0) continue;
      const pColor = colorFor(parent).fill;
      for (const childId of kids) {
        const child = graph.nodes.get(childId);
        if (child === undefined) continue;
        out.push(...blendEdge(parent.x, parent.y, child.x, child.y, pColor, colorFor(child).fill));
      }
    }
    return out;
  }

  private nodeGroups(state: RenderState): SVGElement[] {
    const { graph, selection, labels, primaryId, viz } = state;
    const groups: SVGElement[] = [];
    for (const node of graph.nodes.values()) {
      const w = nodeWidth(node);
      const color = colorFor(node);
      const vz = viz.get(node.id);
      const g = svgEl("g", {
        class: "mg-node",
        "data-id": node.id,
        transform: `translate(${node.x} ${node.y})`,
      });

      if (selection.has(node.id)) {
        g.appendChild(
          svgEl("rect", {
            class: node.id === primaryId ? "mg-sel primary" : "mg-sel",
            x: -w / 2 - 3,
            y: -NODE_H / 2 - 3,
            width: w + 6,
            height: NODE_H + 6,
            rx: 7,
          }),
        );
      }

      // A MeTTa `(highlight ...)` directive frames the node with a ring.
      if (vz?.highlight === true) {
        g.appendChild(
          svgEl("rect", {
            class: "mg-viz-hi",
            x: -w / 2 - 5,
            y: -NODE_H / 2 - 5,
            width: w + 10,
            height: NODE_H + 10,
            rx: 9,
          }),
        );
      }

      g.appendChild(nodeShape(node, w, vz?.color ?? color.fill));

      const text = svgEl("text", { x: 0, y: 0 });
      text.textContent = displayText(node);
      text.setAttribute("fill", color.text);
      g.appendChild(text);

      if (vz?.label !== undefined && vz.label.length > 0) {
        const vl = svgEl("text", { class: "mg-viz-label", x: 0, y: -NODE_H / 2 - 10 });
        vl.textContent = vz.label;
        g.appendChild(vl);
      }

      g.appendChild(
        svgEl("circle", { class: "mg-port", "data-port": "1", cx: 0, cy: -NODE_H / 2, r: PORT_R }),
      );

      const label = labels.get(node.id);
      if (label !== undefined && label.text.length > 0) {
        const result = svgEl("text", {
          class: label.error ? "mg-result error" : "mg-result",
          x: 0,
          y: NODE_H / 2 + 13,
        });
        result.textContent = label.text;
        g.appendChild(result);
      }
      groups.push(g);
    }
    return groups;
  }
}

/** A node placed for one playthrough step, keyed by its position in the reduction tree, with its shape and
 *  color precomputed so the per-frame morph only lerps. */
interface Slot {
  key: string;
  leaf: boolean; // no children: a leaf morphs only to another leaf, never into an expression, and vice versa
  x: number;
  y: number;
  points: Array<[number, number]>; // shape boundary, centered on (x, y)
  radius: number; // the shape's bounding radius, precomputed here so the morph does not recompute it per frame
  fill: string;
  text: string;
  textColor: string;
  hollow: boolean; // a variable: drawn as an outline with no fill
}

/** The bounding radius of a centered shape: the farthest boundary point from its center. */
function pointsRadius(points: ReadonlyArray<readonly [number, number]>): number {
  let r = 0;
  for (const [x, y] of points) r = Math.max(r, Math.hypot(x, y));
  return r;
}

/** An edge between two nodes, named by their keys, carrying both endpoint colors so it can blend from one
 *  to the other. `colorA` is empty for a variable link (drawn as a faint dashed line instead). */
interface EdgeSlot {
  key: string;
  a: string;
  b: string;
  colorA: string;
  colorB: string;
}

/** One reduction step, flattened for interpolation. */
export interface TraceFrame {
  slots: Slot[];
  edges: EdgeSlot[];
  viewport: Viewport;
}

/** A node drawn for one interpolated frame: a morphed shape (boundary points relative to its center), a
 *  blended fill, and one or two texts (two while a matched node cross-fades its old text into its new). */
export interface TracePlacement {
  x: number;
  y: number;
  op: number;
  points: Array<[number, number]>;
  fill: string;
  fillOp: number; // 0 = a hollow outline (a variable), 1 = solid; a variable filling in ramps 0 -> 1
  texts: Array<{ text: string; color: string; op: number }>;
  // Set while a subterm is merging into the result, so it is drawn into the gooey merge layer instead of the
  // crisp node layer. Absent (or false) on nodes that are not merging.
  merging?: boolean | undefined;
}

/** A drawn edge for one interpolated frame; blends from `colorA` to `colorB` (`colorA` empty is a variable
 *  link, drawn dashed). */
export interface TraceEdge {
  colorA: string;
  colorB: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  op: number;
}

/** A whole frame between two steps, ready to draw. */
export interface InterpolatedTrace {
  nodes: TracePlacement[];
  edges: TraceEdge[];
  viewport: Viewport;
  // A soft glow over the subterm being reduced this step, so the eye tracks what is changing. An ellipse
  // hugging the redex's box, tinted its own role color. Absent when nothing is reducing (the morph's ends).
  redex?: { x: number; y: number; rx: number; ry: number; op: number; color: string } | undefined;
}

/** A stable key per node: its path in the reduction tree. The same subterm keeps its key across steps, so
 *  it glides; the reduced part changes at its slot rather than being matched to something unrelated. */
function traceKeyMap(graph: Graph): Map<string, string> {
  const keys = new Map<string, string>();
  const walk = (id: string, path: string): void => {
    keys.set(id, path);
    graph.sortedChildren(id).forEach((c, i) => walk(c.id, `${path}.${i}`));
  };
  graph.heads().forEach((h, i) => walk(h.id, `h${i}`));
  return keys;
}

/** Flatten a step's graph into keyed node and edge slots for the morph. */
export function traceFrame(graph: Graph, viewport: Viewport): TraceFrame {
  const keys = traceKeyMap(graph);
  const slots: Slot[] = [];
  for (const n of graph.nodes.values()) {
    const key = keys.get(n.id);
    if (key === undefined) continue;
    const color = colorFor(n);
    const points = shapePoints(n, SHAPE_N);
    slots.push({
      key,
      leaf: graph.childrenOf(n.id).length === 0,
      x: n.x,
      y: n.y,
      points,
      radius: pointsRadius(points),
      fill: color.fill,
      text: displayText(n),
      textColor: color.text,
      hollow: (n.kind === "symbol" ? roleOf(n.name) : n.kind) === "variable",
    });
  }
  const edges: EdgeSlot[] = [];
  for (const parent of graph.nodes.values()) {
    const pk = keys.get(parent.id);
    if (pk === undefined) continue;
    const pColor = colorFor(parent).fill;
    for (const cid of graph.childrenOf(parent.id)) {
      const child = graph.nodes.get(cid);
      const ck = keys.get(cid);
      if (child !== undefined && ck !== undefined)
        edges.push({
          key: `${pk}>${ck}`,
          a: pk,
          b: ck,
          colorA: pColor,
          colorB: colorFor(child).fill,
        });
    }
  }
  for (const [aId, bId] of variableLinks(graph)) {
    const ak = keys.get(aId);
    const bk = keys.get(bId);
    if (ak !== undefined && bk !== undefined)
      edges.push({ key: `v:${ak}:${bk}`, a: ak, b: bk, colorA: "", colorB: "" });
  }
  return { slots, edges, viewport };
}

/** Interpolate between two reduction steps at `t` in [0,1]: a node present in both arcs from its old place
 *  to its new one at full opacity; one only in the next step fades in; one only in the previous fades out;
 *  edges follow their endpoints and fade with them; the viewport eases between the two fits. Pure, so the
 *  morph is unit-tested without a frame clock. Placements below 2% opacity are dropped. */
export function interpolateTrace(from: TraceFrame, to: TraceFrame, t: number): InterpolatedTrace {
  const fromByKey = new Map(from.slots.map((s) => [s.key, s]));
  const toNodes = new Map(to.slots.map((s) => [s.key, s]));

  // Correspondence to -> from by tree position, the way a reduction is a local rewrite (Anagopos, interaction
  // nets): the redex at some position is replaced by the reduct in place while the surrounding context keeps
  // its identity and glides to its new spot. A node pairs with the one at its path and morphs into it, except
  // when a leaf would have to become an expression (a value turning into a compound, like `3` in `(fact 3)`
  // reappearing as `(> $n 0)` in the rule body) which is not a morph but a fresh subtree; there the old node
  // collapses and the new one appears. An expression reducing to a value (`(* a b)` -> a number) does morph,
  // so the operation is seen turning into its result. No matching by value: a fresh result is not pretended
  // to be an operand that slid over.
  const used = new Set<Slot>();
  const matchOf = new Map<string, Slot>();
  for (const s of to.slots) {
    const f = fromByKey.get(s.key);
    if (f !== undefined && !(f.leaf && !s.leaf)) {
      matchOf.set(s.key, f);
      used.add(f);
    }
  }

  // A rendered node is looked up two ways so edges from either step find their endpoints: by its next-step
  // key (surviving and new nodes) and by its previous-step key (matched inputs and collapsing nodes).
  const byTo = new Map<string, TracePlacement>();
  const byFrom = new Map<string, TracePlacement>();
  const rendered: TracePlacement[] = [];
  for (const s of to.slots) {
    const f = matchOf.get(s.key);
    const p = f !== undefined ? morphPlacement(f, s, t) : singlePlacement(s, t);
    byTo.set(s.key, p);
    if (f !== undefined) byFrom.set(f.key, p);
    rendered.push(p);
  }
  for (const s of from.slots) {
    if (used.has(s)) continue;
    // A subterm the reduction consumes does not fade in place: it shrinks into whatever takes its spot, the
    // reduct at the same position if one appears there, otherwise the surviving parent it collapses up into.
    const target = toNodes.get(s.key) ?? ancestorTarget(s.key, toNodes);
    const p = target !== undefined ? collapsePlacement(s, target, t) : singlePlacement(s, 1 - t);
    byFrom.set(s.key, p);
    rendered.push(p);
  }

  const edges: TraceEdge[] = [];
  const pushEdge = (e: EdgeSlot, a?: TracePlacement, b?: TracePlacement, pres = 1): void => {
    if (a === undefined || b === undefined) return;
    const op = Math.min(a.op, b.op, pres);
    if (op > 0.02)
      edges.push({ colorA: e.colorA, colorB: e.colorB, x1: a.x, y1: a.y, x2: b.x, y2: b.y, op });
  };
  const toEdgeKeys = new Set(to.edges.map((e) => e.key));
  const fromEdgeKeys = new Set(from.edges.map((e) => e.key));
  for (const e of to.edges)
    pushEdge(e, byTo.get(e.a), byTo.get(e.b), fromEdgeKeys.has(e.key) ? 1 : t);
  for (const e of from.edges)
    if (!toEdgeKeys.has(e.key)) pushEdge(e, byFrom.get(e.a), byFrom.get(e.b), 1 - t);

  const viewport = {
    panX: lerp(from.viewport.panX, to.viewport.panX, t),
    panY: lerp(from.viewport.panY, to.viewport.panY, t),
    scale: lerp(from.viewport.scale, to.viewport.scale, t),
  };
  return {
    nodes: rendered.filter((p) => p.op > 0.02),
    edges,
    viewport,
    redex: findRedex(from, used, toNodes, t),
  };
}

/** A soft glow over the redex: the shallowest subterm that changes this step (consumed, or matched but
 *  relabeled), sized to cover its whole subtree and pulsed over the first part of the morph. This is the
 *  redex box that reduction-graph tools draw (Anagopos, PLT Redex), so the eye sees what is reducing. */
function findRedex(
  from: TraceFrame,
  used: Set<Slot>,
  toNodes: Map<string, Slot>,
  t: number,
): InterpolatedTrace["redex"] {
  const op = Math.max(0, 1 - t * 1.7); // a pulse: bright at the start, gone by the time the morph settles
  if (op <= 0.01) return undefined;
  let root: Slot | undefined;
  let depth = Infinity;
  for (const f of from.slots) {
    const toAt = toNodes.get(f.key);
    const changed = !used.has(f) || (toAt !== undefined && toAt.text !== f.text);
    const d = f.key.split(".").length;
    if (changed && d < depth) {
      depth = d;
      root = f;
    }
  }
  if (root === undefined) return undefined;
  // The redex box: tight to its subtree, so the glow hugs what reduces instead of ballooning over context.
  const prefix = root.key + ".";
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of from.slots)
    if (f.key === root.key || f.key.startsWith(prefix)) {
      const ext = f.radius;
      minX = Math.min(minX, f.x - ext);
      maxX = Math.max(maxX, f.x + ext);
      minY = Math.min(minY, f.y - ext);
      maxY = Math.max(maxY, f.y + ext);
    }
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    rx: (maxX - minX) / 2 + 8,
    ry: (maxY - minY) / 2 + 8,
    op,
    color: root.fill, // the raw role color; the glow tints it against the live background at paint time
  };
}

/** The glow elements for the redex: a soft radial gradient in the redex's color and an ellipse hugging its
 *  box. The gradient is inlined and rebuilt each frame so it can take the redex's own color. */
function haloEls(redex: NonNullable<InterpolatedTrace["redex"]>, bg: string): SVGElement[] {
  const color = haloTint(redex.color, bg);
  const grad = svgEl("radialGradient", { id: "mg-halo" });
  const stop = (offset: string, op: string): SVGElement =>
    svgEl("stop", { offset, "stop-color": color, "stop-opacity": op });
  grad.append(stop("0%", "0.5"), stop("55%", "0.2"), stop("100%", "0"));
  return [
    grad,
    svgEl("ellipse", {
      cx: redex.x.toFixed(2),
      cy: redex.y.toFixed(2),
      rx: redex.rx.toFixed(2),
      ry: redex.ry.toFixed(2),
      fill: "url(#mg-halo)",
      opacity: redex.op.toFixed(3),
    }),
  ];
}

/** Perceived luminance (0..255) of a `#rrggbb` color, or null. */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) return null;
  const v = parseInt(m[1]!, 16);
  return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
}

/** The redex's role color for its glow, nudged toward the light or dark end only when it is too close to the
 *  background `bg` to read (a plain gray symbol on a dark canvas). Judged against the live background, so it
 *  adapts to the theme: on a light theme a pale color would be darkened instead. */
function haloTint(hex: string, bg: string): string {
  const lc = luminance(hex);
  const lb = luminance(bg);
  if (lc === null || lb === null || Math.abs(lc - lb) >= 80) return hex;
  return lerpColor(hex, lb < 128 ? "#ffffff" : "#000000", 0.55);
}

/** A node present in both steps: arc its position, morph its shape (point-for-point) and blend its fill in
 *  OKLab, and cross-fade its text when it changed (a `fact` box becoming an `if` diamond). */
function morphPlacement(f: Slot, s: Slot, t: number): TracePlacement {
  const p = arcPoint(f.x, f.y, s.x, s.y, t);
  const points = s.points.map((pt, i): [number, number] => {
    const q = f.points[i] ?? pt;
    return [lerp(q[0], pt[0], t), lerp(q[1], pt[1], t)];
  });
  const texts =
    f.text === s.text
      ? [{ text: s.text, color: lerpColor(f.textColor, s.textColor, t), op: 1 }]
      : [
          { text: f.text, color: f.textColor, op: 1 - t },
          { text: s.text, color: s.textColor, op: t },
        ];
  const fillOp = lerp(f.hollow ? 0 : 1, s.hollow ? 0 : 1, t); // a variable fills in as it becomes its value
  return { x: p.x, y: p.y, op: 1, points, fill: lerpColor(f.fill, s.fill, t), fillOp, texts };
}

/** A node in only one step (a node appearing): it holds its place and shape while fading at `op`. */
function singlePlacement(s: Slot, op: number): TracePlacement {
  return {
    x: s.x,
    y: s.y,
    op,
    points: s.points,
    fill: s.fill,
    fillOp: s.hollow ? 0 : 1,
    texts: [{ text: s.text, color: s.textColor, op: 1 }],
  };
}

/** The nearest ancestor of `key` that survives into the next step, or undefined. Keys are tree paths like
 *  `h0.1.0`, so an ancestor is a prefix with a path segment dropped. */
function ancestorTarget(key: string, toNodes: Map<string, Slot>): Slot | undefined {
  let k = key;
  for (;;) {
    const dot = k.lastIndexOf(".");
    if (dot < 0) return undefined;
    k = k.slice(0, dot);
    const s = toNodes.get(k);
    if (s !== undefined) return s;
  }
}

/** A consumed subterm merging into its surviving parent (the result of the step). The head, already on the
 *  result's spot, dissolves in place; an operand travels straight up its edge staying crisp and its own
 *  shape, then, once its border meets the result, joins the gooey layer and morphs to fit the result's
 *  silhouette as it is absorbed. */
function collapsePlacement(s: Slot, target: Slot, t: number): TracePlacement {
  const startDist = Math.hypot(s.x - target.x, s.y - target.y);
  const sR = s.radius;
  const tR = target.radius;
  const text = [{ text: s.text, color: s.textColor, op: 1 }];
  // The head sits on the result's own spot: there is nothing to travel to or meld with, so it just dissolves
  // in place, crisp, as the result takes over.
  if (startDist < sR + tR)
    return {
      x: s.x,
      y: s.y,
      op: 1 - t,
      points: s.points,
      fill: s.fill,
      fillOp: s.hollow ? 0 : 1,
      texts: text,
    };

  // An operand travels straight in, staying crisp and its own shape, and only begins to meld and morph to
  // fit the result once their borders actually meet: `m` is 0 until then, ramping to 1 as it is absorbed. So
  // the fluid part happens at the intersection, not the whole way in.
  const x = lerp(s.x, target.x, t);
  const y = lerp(s.y, target.y, t);
  const m = Math.max(0, Math.min(1, 1 - ((1 - t) * startDist) / (sR + tR)));
  const points =
    m <= 0
      ? s.points
      : target.points.map((pt, i): [number, number] => {
          const q = s.points[i] ?? pt;
          return [lerp(q[0], pt[0], m), lerp(q[1], pt[1], m)];
        });
  const op = m < 0.7 ? 1 : (1 - m) / 0.3; // solid through the travel and most of the meld; fade as absorbed
  return {
    x,
    y,
    op,
    points,
    fill: lerpColor(s.fill, target.fill, m),
    fillOp: s.hollow ? 0 : 1,
    texts: text,
    merging: m > 0.001, // in the gooey layer only once it has reached the result and begun to meld
  };
}
