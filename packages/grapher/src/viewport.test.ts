// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { initialViewport, toWorld, toScreen, pan, zoomAt } from "./viewport";

describe("viewport", () => {
  it("round-trips world and screen coordinates", () => {
    const v = { panX: 30, panY: -10, scale: 1.5 };
    const s = toScreen(v, 12, 34);
    const w = toWorld(v, s.x, s.y);
    expect(w.x).toBeCloseTo(12, 6);
    expect(w.y).toBeCloseTo(34, 6);
  });

  it("pans by a screen delta", () => {
    const v = pan(initialViewport(), 5, 7);
    expect([v.panX, v.panY, v.scale]).toEqual([5, 7, 1]);
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    const v = initialViewport();
    const before = toWorld(v, 200, 150);
    const zoomed = zoomAt(v, 200, 150, 1.5);
    const after = toWorld(zoomed, 200, 150);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomed.scale).toBeCloseTo(1.5, 6);
  });

  it("clamps scale to [0.1, 4]", () => {
    let up = initialViewport();
    for (let i = 0; i < 50; i++) up = zoomAt(up, 0, 0, 2);
    expect(up.scale).toBeLessThanOrEqual(4);
    let down = initialViewport();
    for (let i = 0; i < 50; i++) down = zoomAt(down, 0, 0, 0.5);
    expect(down.scale).toBeGreaterThanOrEqual(0.1);
  });
});
