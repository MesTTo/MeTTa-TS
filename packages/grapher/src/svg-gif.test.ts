// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import type { GifEncoderLib } from "./block/gif";
import { encodeSvgAnimation, type SvgAnimation } from "./svg-gif";

function fakeEncoder(bytes = new Uint8Array([71, 73, 70])): {
  lib: GifEncoderLib;
  writeFrame: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
} {
  const writeFrame = vi.fn();
  const finish = vi.fn();
  return {
    writeFrame,
    finish,
    lib: {
      GIFEncoder: () => ({ writeFrame, finish, bytes: () => bytes }),
      quantize: vi.fn(() => [[0, 0, 0]]),
      applyPalette: vi.fn(() => new Uint8Array([0, 0])),
    },
  };
}

const ANIMATION: SvgAnimation = {
  width: 2,
  height: 1,
  background: "#000000",
  frames: [
    { svg: "<svg>first</svg>", delay: 40 },
    { svg: "<svg>second</svg>", delay: 260 },
  ],
};

describe("encodeSvgAnimation", () => {
  it("rasterizes and encodes each frame in order", async () => {
    const rasterize = vi.fn(async () => new Uint8Array(8));
    const { lib, writeFrame, finish } = fakeEncoder();

    const bytes = await encodeSvgAnimation(ANIMATION, rasterize, lib, 16);

    expect(bytes).toEqual(new Uint8Array([71, 73, 70]));
    expect(rasterize.mock.calls).toEqual([
      ["<svg>first</svg>", 2, 1, "#000000"],
      ["<svg>second</svg>", 2, 1, "#000000"],
    ]);
    expect(writeFrame.mock.calls.map((call) => call.slice(1))).toEqual([
      [2, 1, { palette: [[0, 0, 0]], delay: 40 }],
      [2, 1, { palette: [[0, 0, 0]], delay: 260 }],
    ]);
    expect(finish).toHaveBeenCalledOnce();
  });

  it("rejects malformed animation and rasterizer output", async () => {
    const { lib } = fakeEncoder();
    await expect(
      encodeSvgAnimation({ ...ANIMATION, frames: [] }, async () => new Uint8Array(8), lib),
    ).rejects.toThrow("no SVG frames");
    await expect(encodeSvgAnimation(ANIMATION, async () => new Uint8Array(7), lib)).rejects.toThrow(
      "expected 8",
    );
  });
});
