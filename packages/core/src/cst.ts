// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT

// A span-tracking parse: the same atoms `parseAll` produces, plus the source range of every node.
// Off the `runFile` hot path entirely; only the static analyzer calls it. It reuses parser.ts's
// char-level primitives so it cannot drift from the real parser.
import { type Atom, expr } from "./atom";
import { type Tokenizer } from "./tokenizer";
import { isDelim, skipTrivia, readStringAt, leafAtom, MAX_DEPTH } from "./parser";

export interface Span {
  readonly start: number;
  readonly end: number;
}

/** One CST node: the atom it parses to, its source range, and (for expressions) its children. The
 *  top-level marker `bang` is set on a node parsed from a `!`-query. */
export interface SpannedNode {
  readonly atom: Atom;
  readonly span: Span;
  readonly children?: readonly SpannedNode[];
  readonly bang?: boolean;
}

function readSpanned(
  s: string,
  pos: number,
  tk: Tokenizer,
  depth: number,
): { node: SpannedNode; end: number } {
  pos = skipTrivia(s, pos);
  const start = pos;
  const ch = s[pos];
  if (ch === "(") {
    if (depth >= MAX_DEPTH) throw new Error("MeTTa expression nesting too deep");
    pos++;
    const children: SpannedNode[] = [];
    for (;;) {
      pos = skipTrivia(s, pos);
      if (pos >= s.length) throw new Error("unbalanced '(' in MeTTa source");
      if (s[pos] === ")") {
        pos++;
        break;
      }
      const r = readSpanned(s, pos, tk, depth + 1);
      children.push(r.node);
      pos = r.end;
    }
    const atom = expr(children.map((c) => c.atom));
    return { node: { atom, span: { start, end: pos }, children }, end: pos };
  }
  if (ch === '"') {
    const { atom, end } = readStringAt(s, pos);
    return { node: { atom, span: { start, end } }, end };
  }
  let end = pos;
  while (end < s.length && !isDelim(s[end]!)) end++;
  const word = s.slice(pos, end);
  return { node: { atom: leafAtom(word, tk), span: { start, end } }, end };
}

/** Parse a whole program into spanned top-level nodes. Mirrors `parseAll`, adding spans and the
 *  `bang` marker for `!`-queries. */
export function parseAllSpanned(src: string, tk: Tokenizer): SpannedNode[] {
  const out: SpannedNode[] = [];
  let pos = skipTrivia(src, 0);
  while (pos < src.length) {
    let bang = false;
    if (src[pos] === "!") {
      bang = true;
      pos = skipTrivia(src, pos + 1);
    }
    const r = readSpanned(src, pos, tk, 0);
    out.push({ ...r.node, bang });
    pos = skipTrivia(src, r.end);
  }
  return out;
}
