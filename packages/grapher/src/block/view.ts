// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The block view as an interactive projectional editor. A cursor selects a term, and the arrow keys walk
// it: right and left step through the tree in preorder, down enters the first child, up returns to the
// parent. Typing on a selected leaf edits its text and re-parses it back into an
// atom, so what you type is reflected in the program's source. Because the whole view is atoms, anything
// that yields atoms feeds it: source, the eDSL, or grounded values. Double-click (or Enter on a form)
// reduces a term one step in place, with a history so you can step back. In read-only mode it just frames
// the atoms it is given, which is how the facade drives a step-through playthrough through this view.

import { S, type Atom, type MeTTa } from "@metta-ts/hyperon";
import { parseLeaf } from "../parse";
import { makeSettings, SITE_PALETTE, type BlockSettings, type BlockPalette } from "./settings";
import { placeProgram, type BlockBox } from "./layout";
import { BlockRenderer, measureUnitWidth, findByPath } from "./render";
import { reduceAtPath, replaceAtPath } from "./path";
import { reductionGif, type GifEncoderLib, type GifOptions } from "./gif";
import { sideBySideReductionGif } from "../sidebyside-gif";

const FONT_SIZE = 17;
const CARET = "▏"; // a thin vertical bar shown at the edit point

/** An in-progress text edit of the leaf at `path`. */
interface Edit {
  path: number[];
  buffer: string;
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** A block view mounted in a container, sharing the engine with the rest of the editor. */
export class BlockView {
  private readonly renderer: BlockRenderer;
  private readonly getSpace: () => MeTTa;
  private palette: BlockPalette = SITE_PALETTE;
  private settings: BlockSettings | null = null;
  private atoms: Atom[] = [];
  private boxes: BlockBox[] = [];
  private selectedPath: number[] | null = null;
  private editing: Edit | null = null;
  private readonlyMode = false;
  private readonly history: Atom[][] = [];
  private readonly onChange: () => void;

  constructor(container: HTMLElement, getSpace: () => MeTTa, onChange: () => void = () => {}) {
    this.renderer = new BlockRenderer(container);
    this.getSpace = getSpace;
    this.onChange = onChange;
    this.renderer.svg.setAttribute("tabindex", "0");
    this.renderer.svg.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.svg.addEventListener("keydown", this.onKeyDown);
    this.hide();
  }

  private ensureSettings(): BlockSettings {
    if (this.settings === null)
      this.settings = makeSettings(FONT_SIZE, measureUnitWidth(FONT_SIZE), this.palette);
    return this.settings;
  }

  /** Recolor the view with a different palette. */
  setPalette(palette: BlockPalette): void {
    this.palette = palette;
    this.settings = null;
    this.render();
  }

  /** Load a program to edit and reduce interactively. */
  setAtoms(atoms: readonly Atom[]): void {
    this.atoms = [...atoms];
    this.history.length = 0;
    this.selectedPath = null;
    this.editing = null;
    this.readonlyMode = false;
    this.renderer.resetViewport(); // a new program starts framed
    this.render();
  }

  /** Zoom the view in (factor > 1) or out (factor < 1). */
  zoomBy(factor: number): void {
    this.renderer.zoomBy(factor);
  }

  /** Pan the view by a screen-space delta. */
  panBy(dx: number, dy: number): void {
    this.renderer.panBy(dx, dy);
  }

  /** Reset zoom/pan so the whole program is framed again. */
  fitView(): void {
    this.renderer.resetViewport();
  }

  /** Frame the given atoms without interaction (used for a step-through playthrough). */
  showReadonly(atoms: readonly Atom[]): void {
    this.atoms = [...atoms];
    this.selectedPath = null;
    this.editing = null;
    this.readonlyMode = true;
    this.render(true);
  }

  render(animate = false): void {
    const s = this.ensureSettings();
    // While editing, show the buffer (plus a caret) in place of the term being edited.
    let atoms = this.atoms;
    if (this.editing !== null) {
      const { path, buffer } = this.editing;
      const head = path[0];
      if (head !== undefined && this.atoms[head] !== undefined)
        atoms = this.atoms.map((a, i) =>
          i === head ? replaceAtPath(a, path.slice(1), S(buffer + CARET)) : a,
        );
    }
    this.boxes = placeProgram(atoms, s);
    this.renderer.render(this.boxes, s, this.editing?.path ?? this.selectedPath, animate);
  }

  /** The current program as source, reflecting any edits and reductions. */
  sourceText(): string {
    return this.atoms.map((a) => a.toString()).join("\n");
  }

  /** Encode a sequence of reduction states as an animated GIF, using a caller-supplied encoder (gifenc),
   *  so the package needs no GIF dependency of its own. */
  async exportGif(states: readonly Atom[][], lib: GifEncoderLib, opts?: GifOptions): Promise<Blob> {
    return reductionGif(states, this.ensureSettings(), lib, opts);
  }

  /** Encode a reduction as one GIF that plays it in both the graph and the block views side by side. Shares
   *  the block layout settings so the two panels agree on the canvas color and fonts. */
  async exportSideBySideGif(
    states: readonly Atom[][],
    lib: GifEncoderLib,
    opts?: GifOptions,
  ): Promise<Blob> {
    return sideBySideReductionGif(states, this.ensureSettings(), lib, opts);
  }

  show(): void {
    this.renderer.svg.style.display = "block";
    this.render();
  }

  hide(): void {
    this.renderer.svg.style.display = "none";
  }

  destroy(): void {
    this.renderer.svg.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.svg.removeEventListener("keydown", this.onKeyDown);
    this.renderer.destroy();
  }

  private pathFromEvent(e: Event): number[] | null {
    const target = e.target;
    if (!(target instanceof Element)) return null;
    const raw = target.closest("[data-path]")?.getAttribute("data-path");
    if (raw === null || raw === undefined) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }

  /** The leaf text at `path`, or null when the term is a form (not editable as text). */
  private leafText(path: number[]): string | null {
    const box = findByPath(this.boxes, path);
    if (box === null) return null;
    return box.kind === "atom" || box.kind === "hole" ? box.text : null;
  }

  private lastPath: number[] | null = null;
  private lastClickTime = 0;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.readonlyMode) return;
    const path = this.pathFromEvent(e);
    // Detect a double-click from pointerdown timing. The renderer replaces the SVG contents on every
    // click, which detaches the element the browser needs to synthesize a dblclick, so that event is
    // unreliable here.
    const now = performance.now();
    const isDouble =
      path !== null &&
      this.lastPath !== null &&
      samePath(path, this.lastPath) &&
      now - this.lastClickTime < 350;
    this.lastPath = path;
    this.lastClickTime = now;
    if (this.editing !== null) this.commitEdit();
    this.selectedPath = path;
    this.renderer.svg.focus({ preventScroll: true });
    if (isDouble && path !== null) {
      // A second click on the same term edits it (a leaf) or reduces it (a form).
      if (this.leafText(path) !== null) this.startEdit(false);
      else this.reduceSelected();
      return;
    }
    this.render();
  };

  /** Begin editing the selected leaf. When `replace` is set the buffer starts empty (typing replaces the
   *  term); otherwise it starts from the current text (typing extends it). */
  private startEdit(replace: boolean, seed = ""): void {
    if (this.selectedPath === null) return;
    const text = this.leafText(this.selectedPath);
    if (text === null) return;
    this.editing = { path: this.selectedPath, buffer: replace ? seed : text + seed };
    this.render();
  }

  /** Commit the edit: re-parse the buffer into an atom and splice it back into the program. */
  private commitEdit(): void {
    if (this.editing === null) return;
    const { path, buffer } = this.editing;
    this.editing = null;
    const text = buffer.trim();
    const head = path[0];
    if (text.length > 0 && head !== undefined && this.atoms[head] !== undefined) {
      const parsed = parseLeaf(text) ?? S(text);
      this.history.push([...this.atoms]);
      this.atoms = this.atoms.map((a, i) =>
        i === head ? replaceAtPath(a, path.slice(1), parsed) : a,
      );
      this.selectedPath = path;
      this.onChange();
    }
    this.render();
  }

  private cancelEdit(): void {
    this.editing = null;
    this.render();
  }

  /** Reduce the selected term one step in place. Returns whether anything changed. */
  reduceSelected(): boolean {
    if (this.readonlyMode || this.editing !== null || this.selectedPath === null) return false;
    const path = this.selectedPath;
    const head = path[0];
    if (head === undefined) return false;
    const target = this.atoms[head];
    if (target === undefined) return false;
    const reduced = reduceAtPath(target, path.slice(1), this.getSpace());
    if (reduced === null) return false;
    this.history.push([...this.atoms]);
    this.atoms = this.atoms.map((a, i) => (i === head ? reduced : a));
    if (findByPath(placeProgram(this.atoms, this.ensureSettings()), path) === null)
      this.selectedPath = null;
    this.render(true);
    this.onChange();
    return true;
  }

  /** Step back to the program before the last reduction or edit. */
  back(): boolean {
    const prev = this.history.pop();
    if (prev === undefined) return false;
    this.atoms = prev;
    this.editing = null;
    this.render(true);
    this.onChange();
    return true;
  }

  canStepBack(): boolean {
    return this.history.length > 0;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.readonlyMode) return;
    if (this.editing !== null) {
      this.onEditKey(e);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (this.selectedPath !== null && this.leafText(this.selectedPath) !== null)
        this.startEdit(false);
      else this.reduceSelected();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const next = this.navigate(e.key);
      if (next !== null) {
        this.selectedPath = next;
        this.render();
      }
      return;
    }
    // A printable key starts replacing the selected leaf with what you type.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (this.selectedPath !== null && this.leafText(this.selectedPath) !== null) {
        e.preventDefault();
        this.startEdit(true, e.key);
      }
    }
  };

  private onEditKey(e: KeyboardEvent): void {
    if (this.editing === null) return;
    if (e.key === "Enter") {
      e.preventDefault();
      this.commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.cancelEdit();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      this.editing = { path: this.editing.path, buffer: this.editing.buffer.slice(0, -1) };
      this.render();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.editing = { path: this.editing.path, buffer: this.editing.buffer + e.key };
      this.render();
    }
  }

  /** Every box path in preorder (a term before its children). */
  private preorder(): number[][] {
    const out: number[][] = [];
    const walk = (b: BlockBox): void => {
      out.push(b.path);
      if (b.kind === "expr") for (const c of b.children) walk(c);
    };
    for (const b of this.boxes) walk(b);
    return out;
  }

  /** Move the cursor: right and left step through the tree in preorder, down enters the first child, up
   *  returns to the parent. */
  private navigate(key: string): number[] | null {
    if (this.selectedPath === null) return this.boxes[0]?.path ?? null;
    const path = this.selectedPath;
    if (key === "ArrowUp") return path.length > 1 ? path.slice(0, -1) : path;
    if (key === "ArrowDown") {
      const box = findByPath(this.boxes, path);
      return box?.kind === "expr" ? (box.children[0]?.path ?? path) : path;
    }
    const list = this.preorder();
    const i = list.findIndex((p) => samePath(p, path));
    if (i < 0) return path;
    if (key === "ArrowRight") return list[i + 1] ?? path;
    if (key === "ArrowLeft") return list[i - 1] ?? path;
    return path;
  }
}
