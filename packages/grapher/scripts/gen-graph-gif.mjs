// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Generate a node-graph reduction GIF from the command line, no browser.
//
//   node scripts/gen-graph-gif.mjs <program.metta> "<query>" <out.gif> [width]
//
// Uses the package's Node adapter, so the reduction and animation are the same ones the browser editor plays.

import { readFileSync, writeFileSync } from "node:fs";
import { renderReductionGif } from "../dist/node.js";

const [, , programPath, query, outGif, widthArg] = process.argv;
if (!programPath || !query || !outGif) {
  console.error('usage: node gen-graph-gif.mjs <program.metta> "<query>" <out.gif> [width]');
  process.exit(1);
}

const source = `${readFileSync(programPath, "utf8")}\n${query}`;
const width = widthArg ? Number(widthArg) : 1100;
const bytes = await renderReductionGif(source, {
  view: "graph",
  width,
  framesPerStep: Number(process.env.FPS ?? 8),
  holdMs: Number(process.env.HOLD ?? 460),
  stepMs: Number(process.env.STEP ?? 33),
  maxFrames: Number(process.env.MAXFRAMES ?? 320),
  maxSteps: Number(process.env.MAXSTEPS ?? 300),
});
writeFileSync(outGif, bytes);
console.log(`wrote ${outGif} (${bytes.byteLength} bytes, width ${width})`);
