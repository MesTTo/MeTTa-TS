<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->
<script setup lang="ts">
// A live visual MeTTa editor. Like the sandbox, the whole engine is pure TypeScript, so it runs entirely
// in the reader's browser. The package is imported lazily on the client. A row of example programs shows
// different MeTTa semantics (arithmetic, recursion, pattern matching, nondeterminism); each loads into the
// same editor. The grapher instance is exposed (defineExpose and on the canvas element) so a program can
// be loaded from code: `document.querySelector('.mg-canvas').grapher.loadSource('(+ 1 2)')`.
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";

const props = defineProps<{
  code?: string;
  height?: string;
  hideExamples?: boolean;
  run?: boolean;
}>();
const slot = ref<HTMLElement | null>(null);
const canvas = ref<HTMLElement | null>(null);
const source = ref("");
const active = ref(-1);
const exporting = ref(false);

// The editor is the single source of truth for the view state. This mirror is only ever refreshed from
// grapher.uiState() when the editor notifies (onViewChange), never written piecemeal, and the derived
// refs below feed the template. Keeping our own copy of "which view" and "is a playthrough running" was
// what let the toggle button and the canvas disagree (the Visualize desync), so we lift that state into
// one owner and read it here.
type UiState = {
  viewMode: "graph" | "block";
  tracing: { index: number; total: number } | null;
  blockCanBack: boolean;
};
const ui = ref<UiState>({ viewMode: "graph", tracing: null, blockCanBack: false });
const viewMode = computed(() => ui.value.viewMode);
const trace = computed(() => ui.value.tracing);
const blockCanBack = computed(() => ui.value.blockCanBack);
function refreshUi(): void {
  if (!grapher) return;
  ui.value = grapher.uiState();
  if (ui.value.tracing === null) pausePlay(); // the editor left the playthrough: stop auto-advancing
}
// Vue defaults an absent boolean prop to false, so opt OUT of the switcher rather than in.
const showExamples = !props.hideExamples;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let grapher: any;

const EXAMPLES: { label: string; code: string; run?: boolean }[] = [
  { label: "Arithmetic", code: "(+ 10 (* 25 2))" },
  {
    label: "Recursion",
    code: "(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))\n(fact 5)",
  },
  {
    label: "Pattern matching",
    code:
      "(parent Tom Bob)\n(parent Bob Ann)\n" +
      "(= (grandparent $x $z) (match &self (parent $x $y) (match &self (parent $y $z) $z)))\n" +
      "(grandparent Tom $who)",
  },
  {
    label: "Nondeterminism",
    code: "(= (coin) Heads)\n(= (coin) Tails)\n(coin)",
  },
  {
    label: "Types",
    code: "(: Z Nat)\n(: S (-> Nat Nat))\n(= (plus Z $n) $n)\n(= (plus (S $m) $n) (S (plus $m $n)))\n(plus (S (S Z)) (S Z))",
  },
  {
    label: "Visualize",
    code:
      "(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))\n(fact 5)\n" +
      "(style\n" +
      "  (color (fact 5) red)\n" +
      "  (highlight if)\n" +
      '  (label (fact 5) "answer"))',
    run: true,
  },
  {
    label: "Heat map",
    code:
      "(= (val $x) $x)\n" +
      "(nums 12 45 7 88 33 60)\n" +
      "(style\n" +
      "  (shade-by val)\n" +
      "  (size-by val))",
  },
];

function seedCode(): string {
  if (props.code) return props.code;
  if (slot.value) {
    const codeEl = slot.value.querySelector("pre code") ?? slot.value;
    const text = codeEl.textContent ?? "";
    if (text.trim()) return text.replace(/\n+$/, "");
  }
  return EXAMPLES[1]!.code;
}

function loadExample(i: number): void {
  if (!grapher) return;
  pausePlay(); // a load ends any running playthrough
  active.value = i;
  grapher.loadSource(EXAMPLES[i]!.code);
  grapher.tidy();
  // Some examples (the &grapher directives) only make sense once run, so evaluate them on load.
  if (EXAMPLES[i]!.run) {
    setView("graph");
    grapher.evaluateAll();
  }
  source.value = grapher.toSource();
}

let observer: ResizeObserver | undefined;

onMounted(async () => {
  if (!canvas.value) return;
  const { MeTTaGrapher } = await import("@metta-ts/grapher");
  grapher = new MeTTaGrapher(canvas.value, { source: seedCode() });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (canvas.value as any).grapher = grapher;
  // Mirror the editor's view state whenever it transitions (view switch, playthrough step, load).
  grapher.onViewChange(refreshUi);
  grapher.setTraceDuration(morphMs());
  refreshUi();
  grapher.onChange(() => {
    if (viewMode.value !== "block") source.value = grapher.toSource();
  });
  // In the block view, edits and reductions happen there; mirror them into the source panel and refresh
  // the view state (a reduction changes whether Back is available).
  grapher.onBlockChange(() => {
    refreshUi();
    if (viewMode.value === "block") source.value = grapher.blockSource();
  });
  // Fill the view once the container actually has a size. A lazy import or an off-screen mount can leave
  // it zero for a frame or two, which would misframe the program, so retry until it is measured. The
  // program is not evaluated on load: results appear on Evaluate or a double-click.
  const fitWhenReady = (tries = 30): void => {
    if (!grapher) return;
    const el = canvas.value;
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      grapher.tidy();
      if (props.run) grapher.evaluateAll();
      source.value = grapher.toSource();
    } else if (tries > 0) {
      requestAnimationFrame(() => fitWhenReady(tries - 1));
    }
  };
  requestAnimationFrame(() => fitWhenReady());
  // Refit if the container resizes (sidebar toggle, window resize).
  observer = new ResizeObserver(() => grapher?.fitView());
  observer.observe(canvas.value);
});

// Track a changing `code` prop (e.g. an example editor hosting this grapher with `:code`): reload the program
// so the picture follows the source you type, rather than freezing at the code it was opened with.
watch(
  () => props.code,
  (code) => {
    if (code === undefined || !grapher) return;
    grapher.loadSource(code);
    grapher.tidy();
    source.value = grapher.toSource();
  },
);

onBeforeUnmount(() => {
  pausePlay();
  observer?.disconnect();
  if (grapher) grapher.destroy();
});

defineExpose({ instance: () => grapher });

function evaluateAll(): void {
  grapher?.evaluateAll();
}
function tidy(): void {
  grapher?.tidy();
}
function zoom(factor: number): void {
  grapher?.zoomBy(factor);
}
function fit(): void {
  grapher?.fitView();
}
function panBy(dx: number, dy: number): void {
  grapher?.panBy(dx, dy);
}

// Step-by-step reduction playthrough. `playing` (the auto-advance interval) is the only piece of view
// state the host owns, because it is a timer, not editor state. Which step and how many come from the
// editor through refreshUi, so the controls can never drift from what the canvas shows.
const playing = ref(false);
const speed = ref(5); // 1 (slow) .. 10 (fast)
let timer: ReturnType<typeof setInterval> | undefined;

function atEnd(): boolean {
  const info = grapher?.traceInfo();
  return !info || info.index >= info.total - 1;
}
function startStepping(): void {
  grapher?.playTrace();
  startPlay(); // begin animating the reduction right away
}
function stepNext(): void {
  pausePlay();
  grapher?.traceForward();
}
function stepPrev(): void {
  pausePlay();
  grapher?.traceBack();
}
function stepStop(): void {
  pausePlay();
  grapher?.stopTrace();
  source.value = grapher?.toSource() ?? "";
}

// Auto-play: advance one reduction per tick until the end. The slider sets the delay.
function delayMs(): number {
  return 1150 - speed.value * 100; // speed 1 -> 1050ms, 10 -> 150ms
}
// The slider also slows the morph itself, not just the pauses, so a slow speed is watchable. The morph fills
// most of a step and leaves a short hold before the next one.
function morphMs(): number {
  return Math.round(delayMs() * 0.85); // speed 1 -> ~893ms, 10 -> ~128ms
}
function tick(): void {
  if (atEnd()) {
    pausePlay();
    return;
  }
  grapher?.traceForward();
}
function startPlay(): void {
  if (atEnd()) return;
  playing.value = true;
  timer = setInterval(tick, delayMs());
}
function pausePlay(): void {
  playing.value = false;
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}
function togglePlay(): void {
  if (playing.value) {
    pausePlay();
    return;
  }
  // Clicking Play at the end replays the reduction from the start.
  if (atEnd()) {
    grapher?.traceRestart();
  }
  startPlay();
}
// Apply a new speed immediately: retime the morph, and restart the tick interval if playing.
watch(speed, () => {
  grapher?.setTraceDuration(morphMs());
  if (playing.value) {
    pausePlay();
    startPlay();
  }
});

// Switch between the node-graph view and the nested-block view. Both share the program and the engine.
// setViewMode notifies onViewChange, so refreshUi mirrors the new mode; we never set it here ourselves.
function setView(mode: "graph" | "block"): void {
  if (!grapher) return;
  pausePlay();
  grapher.setViewMode(mode);
  source.value = mode === "block" ? grapher.blockSource() : grapher.toSource();
}

// Block view: step back to before the last reduction or edit.
function blockBack(): void {
  grapher?.blockBack();
}

// Export the current reduction as an animated GIF of whichever view is showing: the node graph in the graph
// view, the nested blocks in the block view. The encoder is loaded on demand, so it costs nothing until used
// and can be dropped by removing this button and the gifenc dependency.
async function exportGif(): Promise<void> {
  if (!grapher || exporting.value) return;
  exporting.value = true;
  try {
    const enc = await import("gifenc");
    // The editor paces the export off the same trace duration the screen plays (setTraceDuration keeps
    // it current), so holding each settled state for the rest of the playback beat makes the GIF match
    // the slider exactly: morph + hold = one step delay.
    const opts = { holdMs: Math.max(60, delayMs() - morphMs()) };
    const graph = viewMode.value === "graph";
    const blob = graph
      ? await grapher.exportGraphReductionGif(enc, opts)
      : await grapher.exportReductionGif(enc, opts);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = graph ? "reduction-graph.gif" : "reduction-blocks.gif";
      link.click();
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.error("GIF export failed", e);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="mg-runner">
    <div ref="slot" style="display: none"><slot /></div>
    <div v-if="showExamples" class="mg-examples">
      <span class="mg-examples-label">Examples:</span>
      <button
        v-for="(ex, i) in EXAMPLES"
        :key="ex.label"
        class="mg-chip"
        :class="{ active: active === i }"
        @click="loadExample(i)"
      >
        {{ ex.label }}
      </button>
    </div>
    <div class="mg-stage" :style="{ height: props.height ?? '440px' }">
      <div ref="canvas" class="mg-canvas"></div>
      <div class="mg-view">
        <button
          class="mg-view-btn"
          :class="{ active: viewMode === 'graph' }"
          @click="setView('graph')"
        >
          Graph
        </button>
        <button
          class="mg-view-btn"
          :class="{ active: viewMode === 'block' }"
          @click="setView('block')"
        >
          Blocks
        </button>
      </div>
      <div class="mg-zoom">
        <button class="mg-zoom-btn" title="Zoom in" @click="zoom(1.25)">+</button>
        <button class="mg-zoom-btn" title="Zoom out" @click="zoom(0.8)">−</button>
        <button class="mg-zoom-btn" title="Fit" @click="fit">⤢</button>
      </div>
      <div class="mg-pan">
        <button class="mg-pan-btn up" title="Pan up" @click="panBy(0, 60)">▲</button>
        <button class="mg-pan-btn left" title="Pan left" @click="panBy(60, 0)">◀</button>
        <button class="mg-pan-btn right" title="Pan right" @click="panBy(-60, 0)">▶</button>
        <button class="mg-pan-btn down" title="Pan down" @click="panBy(0, -60)">▼</button>
      </div>
    </div>
    <div class="mg-bar">
      <template v-if="!trace">
        <button class="mg-btn icon" @click="startStepping">
          <svg class="mg-ico" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 1.5 11 6 2.5 10.5Z" />
          </svg>
          Play
        </button>
        <template v-if="viewMode === 'graph'">
          <button class="mg-btn ghost" @click="evaluateAll">Evaluate</button>
          <span class="mg-hint"
            >double-click empty to add a node, drag a node's top dot onto another to connect, double-click
            a node to evaluate</span
          >
        </template>
        <template v-else>
          <button v-if="blockCanBack" class="mg-btn ghost" @click="blockBack">Back</button>
          <span class="mg-hint"
            >double-click a term (or select it and press Enter) to reduce it; click a term and type to
            edit it; arrow keys move the cursor</span
          >
        </template>
      </template>
      <template v-else>
        <button class="mg-btn ghost icon" :disabled="trace.index === 0" @click="stepPrev">
          <svg class="mg-ico" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M9.5 1.5 1 6 9.5 10.5Z" />
          </svg>
          Prev
        </button>
        <button class="mg-btn ghost icon" :disabled="trace.index >= trace.total - 1" @click="stepNext">
          Next
          <svg class="mg-ico" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 1.5 11 6 2.5 10.5Z" />
          </svg>
        </button>
        <button class="mg-btn icon" :title="playing ? 'Pause' : 'Play'" @click="togglePlay">
          <svg v-if="playing" class="mg-ico" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.5" y="1.5" width="2.6" height="9" />
            <rect x="6.9" y="1.5" width="2.6" height="9" />
          </svg>
          <svg v-else class="mg-ico" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 1.5 11 6 2.5 10.5Z" />
          </svg>
          {{ playing ? "Pause" : "Play" }}
        </button>
        <label class="mg-speed">
          speed
          <input v-model.number="speed" type="range" min="1" max="10" />
        </label>
        <span class="mg-step">step {{ trace.index }} / {{ trace.total - 1 }}</span>
        <button class="mg-btn ghost" @click="stepStop">Reset</button>
        <button class="mg-btn ghost" :disabled="exporting" @click="exportGif">
          {{ exporting ? "Exporting…" : "Export GIF" }}
        </button>
      </template>
    </div>
    <pre v-if="source" class="mg-source">{{ source }}</pre>
  </div>
</template>

<style scoped>
.mg-runner {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: clip;
  margin: 16px 0;
}
.mg-examples {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  flex-wrap: wrap;
}
.mg-examples-label {
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.mg-chip {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
}
.mg-chip.active {
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
.mg-stage {
  position: relative;
  width: 100%;
  overflow: clip;
}
.mg-canvas {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: clip;
}
.mg-view {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  gap: 0;
  z-index: 5;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
  background: var(--vp-c-bg);
  opacity: 0.92;
}
.mg-view-btn {
  font-size: 12px;
  padding: 4px 12px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
}
.mg-view-btn.active {
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
}
.mg-zoom {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 5;
}
.mg-zoom-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  opacity: 0.85;
}
.mg-zoom-btn:hover {
  opacity: 1;
}
.mg-pan {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: grid;
  grid-template-columns: repeat(3, 24px);
  grid-template-rows: repeat(3, 24px);
  gap: 2px;
  z-index: 5;
}
.mg-pan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  opacity: 0.8;
}
.mg-pan-btn:hover {
  opacity: 1;
}
.mg-pan-btn.up {
  grid-area: 1 / 2;
}
.mg-pan-btn.left {
  grid-area: 2 / 1;
}
.mg-pan-btn.right {
  grid-area: 2 / 3;
}
.mg-pan-btn.down {
  grid-area: 3 / 2;
}
.mg-step {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-2);
}
.mg-speed {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.mg-speed input {
  width: 90px;
}
.mg-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  flex-wrap: wrap;
}
.mg-btn {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  border-radius: 6px;
  padding: 4px 16px;
}
.mg-btn.ghost {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}
.mg-btn.icon {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.mg-ico {
  width: 11px;
  height: 11px;
  fill: currentColor;
}
.mg-hint {
  color: var(--vp-c-text-3);
  font-size: 12px;
}
.mg-source {
  margin: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-text-2);
  white-space: pre-wrap;
}
</style>
