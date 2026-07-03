// Generate a node-graph reduction GIF from the command line, no browser.
//
//   node scripts/gen-graph-gif.mjs <program.metta> "<query>" <out.gif> [width]
//
// The frame math (@metta-ts/grapher's graphReductionSvgs) is pure and runs in Node; the SVG frames are
// rasterized and assembled into a GIF by ImageMagick (`convert`). The reduction endpoint matches Run, so
// this is the same picture the in-browser editor plays.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { MeTTa } from "@metta-ts/hyperon";
import { parseProgram, reduceTrace, graphReductionSvgs } from "../dist/index.js";

const [, , programPath, query, outGif, widthArg] = process.argv;
if (!programPath || !query || !outGif) {
  console.error('usage: node gen-graph-gif.mjs <program.metta> "<query>" <out.gif> [width]');
  process.exit(1);
}

const metta = new MeTTa();
for (const atom of parseProgram(readFileSync(programPath, "utf8"))) metta.space().addAtom(atom);
const states = reduceTrace(parseProgram(query)[0], metta);

// Smoothness is tunable via env: more frames per step + a shorter per-frame delay reads smoother.
const { frames, width, height } = graphReductionSvgs(states, {
  width: widthArg ? Number(widthArg) : 1100,
  framesPerStep: Number(process.env.FPS ?? 8),
  holdMs: Number(process.env.HOLD ?? 460),
  stepMs: Number(process.env.STEP ?? 33),
  maxFrames: Number(process.env.MAXFRAMES ?? 320),
});
console.log(`states=${states.length} frames=${frames.length} size=${width}x${height}`);

// Write each frame's SVG, then let ImageMagick rasterize and assemble them in one call, applying each
// frame's delay (GIF delays are centiseconds, so milliseconds / 10).
const dir = "/tmp/mg-frames";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const assemble = ["-loop", "0"];
frames.forEach((f, i) => {
  const path = `${dir}/f${String(i).padStart(4, "0")}.svg`;
  writeFileSync(path, f.svg);
  assemble.push("-delay", String(Math.max(2, Math.round(f.delay / 10))), path);
});
assemble.push("-layers", "optimize", outGif);
execFileSync("convert", assemble);
console.log("wrote", outGif);
