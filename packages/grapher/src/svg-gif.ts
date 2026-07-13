// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import type { GifEncoderLib } from "./block/gif";

/** One self-contained SVG animation frame and its display time. */
export interface SvgFrame {
  svg: string;
  delay: number;
}

/** SVG frames with one fixed output size and background. */
export interface SvgAnimation {
  frames: SvgFrame[];
  width: number;
  height: number;
  background: string;
}

/** Convert one SVG frame to width * height * 4 RGBA bytes. */
export type SvgRasterizer = (
  svg: string,
  width: number,
  height: number,
  background: string,
) => Promise<Uint8Array | Uint8ClampedArray>;

/** Encode SVG frames with a caller-supplied rasterizer and gifenc-compatible encoder. */
export async function encodeSvgAnimation(
  animation: SvgAnimation,
  rasterize: SvgRasterizer,
  lib: GifEncoderLib,
  maxColors = 128,
): Promise<Uint8Array> {
  const { frames, width, height, background } = animation;
  if (frames.length === 0) throw new Error("no SVG frames to encode");
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1)
    throw new Error(`invalid GIF dimensions: ${width}x${height}`);
  if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 256)
    throw new Error(`maxColors must be an integer from 2 to 256, got ${maxColors}`);

  const expectedBytes = width * height * 4;
  const gif = lib.GIFEncoder();
  for (const frame of frames) {
    const rgba = await rasterize(frame.svg, width, height, background);
    if (rgba.byteLength !== expectedBytes)
      throw new Error(
        `SVG rasterizer returned ${rgba.byteLength} bytes for ${width}x${height}; expected ${expectedBytes}`,
      );
    const palette = lib.quantize(rgba, maxColors);
    gif.writeFrame(lib.applyPalette(rgba, palette), width, height, {
      palette,
      delay: frame.delay,
    });
  }
  gif.finish();
  return gif.bytes();
}

/** Make a browser Canvas rasterizer for one animation. */
export function browserSvgRasterizer(): SvgRasterizer {
  let canvas: HTMLCanvasElement | undefined;
  let context: CanvasRenderingContext2D | null = null;
  return async (svg, width, height, background) => {
    if (canvas === undefined) {
      canvas = document.createElement("canvas");
      context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d canvas context for GIF export");
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const image = new Image();
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await image.decode();
    context!.fillStyle = background;
    context!.fillRect(0, 0, width, height);
    context!.drawImage(image, 0, 0, width, height);
    return context!.getImageData(0, 0, width, height).data;
  };
}

/** Encode SVG frames in a browser and return an image/gif Blob. */
export async function encodeBrowserSvgAnimation(
  animation: SvgAnimation,
  lib: GifEncoderLib,
  maxColors = 128,
): Promise<Blob> {
  const bytes = await encodeSvgAnimation(animation, browserSvgRasterizer(), lib, maxColors);
  return new Blob([bytes as BlobPart], { type: "image/gif" });
}
