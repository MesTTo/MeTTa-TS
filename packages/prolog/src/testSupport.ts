// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import type { MeTTa } from "@mettascript/hyperon";

export const runLast = async (m: MeTTa, src: string): Promise<string[]> =>
  (await m.runAsync(src)).at(-1)!.map((atom) => atom.toString());
