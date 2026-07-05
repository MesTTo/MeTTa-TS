// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT

// One fuzzy-suggestion engine over a fixed dictionary, for "did you mean" on unknown heads and
// special-form typos. Levenshtein distance, two-row DP. Instantiate one per concern (known symbols,
// special forms); each carries its own dictionary, shared logic.

/** Levenshtein edit distance between two strings (two-row dynamic programming). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[n]!;
}

export class FuzzyMatcher {
  private readonly terms: readonly string[];
  constructor(terms: Iterable<string>) {
    this.terms = [...terms];
  }

  /** Known names within edit distance of `query`, closest first. Returns [] for queries shorter than
   *  3 characters (too noisy) or with no term inside the distance bound. The bound scales with query
   *  length: 1 edit for short names, 2 for longer, matching the tolerance rustc/compilers use. */
  suggest(query: string, maxDistance?: number): string[] {
    if (query.length < 3) return [];
    const bound = maxDistance ?? (query.length <= 4 ? 1 : 2);
    const scored: Array<{ term: string; d: number }> = [];
    for (const term of this.terms) {
      if (term === query) continue;
      const d = levenshtein(query, term);
      if (d <= bound) scored.push({ term, d });
    }
    scored.sort((x, y) => x.d - y.d || (x.term < y.term ? -1 : 1));
    return scored.map((s) => s.term);
  }
}
