// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// GIF pacing follows the live view: one step's frames span the same morph duration the screen plays
// (morphMs / stepMs frames), so an export glides like the editor instead of a fixed six-frame hop.
// Checked over the pure SVG-frame builders, which share framesPerStepFor with the rasterizing exporters.

import { describe, it, expect } from "vitest";
import { DEFAULT_TRACE_MS } from "./anim";
import { framesPerStepFor } from "./block/gif";
import { graphReductionSvgs, blockReductionSvgs } from "./sidebyside-gif";
import { parseProgram } from "./parse";

const STATES = [parseProgram("(fact 3)"), parseProgram("(* 3 (fact 2))"), parseProgram("6")];

describe("framesPerStepFor", () => {
  it("spans the default morph over default 40ms frames", () => {
    expect(framesPerStepFor({}, 2)).toBe(Math.round(DEFAULT_TRACE_MS / 40));
  });

  it("follows a retimed morph and per-frame delay", () => {
    expect(framesPerStepFor({ morphMs: 900 }, 2)).toBe(23);
    expect(framesPerStepFor({ morphMs: 550, stepMs: 25 }, 2)).toBe(22);
  });

  it("lets an explicit framesPerStep win", () => {
    expect(framesPerStepFor({ framesPerStep: 6, morphMs: 900 }, 2)).toBe(6);
  });

  it("cuts down to the maxFrames budget on long reductions", () => {
    expect(framesPerStepFor({}, 30)).toBe(6);
    expect(framesPerStepFor({ maxFrames: 20 }, 40)).toBe(1);
  });
});

describe("reduction SVG frames", () => {
  it("emits one leading hold plus a full morph per step, holding each settled state", () => {
    const perStep = Math.round(DEFAULT_TRACE_MS / 40);
    for (const build of [graphReductionSvgs, blockReductionSvgs]) {
      const { frames } = build(STATES);
      expect(frames.length).toBe(1 + perStep * (STATES.length - 1));
      expect(frames[0]!.delay).toBe(260);
      expect(frames[perStep]!.delay).toBe(260);
      expect(frames[1]!.delay).toBe(40);
    }
  });

  it("keeps the exported step span at the live morph duration", () => {
    const { frames } = graphReductionSvgs(STATES, { morphMs: 400 });
    const perStep = 10;
    expect(frames.length).toBe(1 + perStep * 2);
    // A step's mid-morph frames plus the settled frame's slot add up to the live span.
    const stepSpan = frames.slice(1, perStep).reduce((ms, f) => ms + f.delay, 0) + 40;
    expect(stepSpan).toBe(400);
  });
});
