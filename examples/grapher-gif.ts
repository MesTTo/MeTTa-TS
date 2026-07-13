// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Generate a reduction GIF in plain Node.js. Run with:
//   pnpm --filter @metta-ts/examples grapher-gif

import { writeFile } from "node:fs/promises";
import { renderReductionGif } from "@metta-ts/grapher/node";

const source = `
(= (fact $n)
   (if (> $n 0)
       (* $n (fact (- $n 1)))
       1))
(fact 5)
`;

const gif = await renderReductionGif(source, {
  view: "blocks",
  width: 720,
});

await writeFile("factorial-reduction.gif", gif);
console.log(`Wrote factorial-reduction.gif (${gif.byteLength} bytes)`);
