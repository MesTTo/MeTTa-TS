// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

declare module "gifenc" {
  type Encoder = import("./block/gif").GifEncoderLib;

  export const GIFEncoder: Encoder["GIFEncoder"];
  export const quantize: Encoder["quantize"];
  export const applyPalette: Encoder["applyPalette"];

  const gifenc: Encoder;
  export default gifenc;
}
