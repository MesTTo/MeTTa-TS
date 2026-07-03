// @vitest-environment happy-dom
// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// The editor is the single source of truth for the view state (which view is showing, whether a
// playthrough is running). These tests pin the transitions a host relies on, so the toggle and the canvas
// can never disagree and a stale playthrough can never survive a load.

import { describe, it, expect } from "vitest";
import { MeTTaGrapher } from "./editor";

const RECURSION = "(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))\n(fact 5)";

function mount(source = RECURSION): MeTTaGrapher {
  return new MeTTaGrapher(document.createElement("div"), { source });
}

describe("editor view-state machine", () => {
  it("starts in graph mode with no playthrough", () => {
    expect(mount().uiState()).toEqual({ viewMode: "graph", tracing: null, blockCanBack: false });
  });

  it("a playthrough sets tracing; loading a new program clears it", () => {
    const g = mount();
    g.playTrace();
    expect(g.uiState().tracing).not.toBeNull();
    expect(g.uiState().tracing!.total).toBeGreaterThan(1);
    // Regression: a load used to leave the old trace running against the new program.
    g.loadSource("(+ 1 2)");
    expect(g.uiState().tracing).toBeNull();
    expect(g.traceInfo()).toBeNull();
  });

  it("reflects the current view in uiState", () => {
    const g = mount();
    g.setViewMode("block");
    expect(g.uiState().viewMode).toBe("block");
    g.setViewMode("graph");
    expect(g.uiState().viewMode).toBe("graph");
  });

  it("drops the playthrough when switching views, so the two never disagree", () => {
    const g = mount();
    g.playTrace();
    expect(g.uiState().tracing).not.toBeNull();
    g.setViewMode("block");
    expect(g.uiState()).toMatchObject({ viewMode: "block", tracing: null });
  });

  it("notifies subscribers on each transition, and stops after unsubscribe", () => {
    const g = mount();
    let n = 0;
    const off = g.onViewChange(() => {
      n++;
    });
    g.setViewMode("block"); // 1: switch
    g.setViewMode("graph"); // 2: switch back
    g.playTrace(); // 3: begin playthrough
    g.traceForward(); // 4: step
    g.stopTrace(); // 5: leave
    expect(n).toBe(5);
    off();
    g.setViewMode("block");
    expect(n).toBe(5);
  });
});
