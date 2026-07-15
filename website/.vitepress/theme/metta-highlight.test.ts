// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { highlightMetta } from "./metta-highlight";

describe("MeTTa syntax highlighting", () => {
  it("distinguishes != from the query marker", () => {
    expect(highlightMetta("!(!= 1 2)")).toBe(
      '<span class="mh-control">!</span><span class="mh-paren">(</span><span class="mh-operator">!=</span> <span class="mh-number">1</span> <span class="mh-number">2</span><span class="mh-paren">)</span>',
    );
  });
});
