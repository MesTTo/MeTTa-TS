// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT

// A span-tracking, error-recovering concrete syntax tree: the same atoms `parseAll` produces, plus the
// source range of every node, the comments, a syntactic kind per node, and the paren/bang spans an editor
// needs. Off the `runFile` hot path entirely; only the static analyzer and a language server call it. Leaf
// atoms come from parser.ts's own primitives (`leafAtom`, `readStringAt`) so the tree cannot drift from the
// real parser on valid input. Unlike the plain parser it never throws: an unclosed `(`, an unexpected `)`,
// an unterminated string, and nesting past the depth bound each become a diagnostic and a best-effort tree,
// so a language server can keep offering features while the user is mid-edit.
import { type Atom, expr } from "./atom";
import { type Tokenizer } from "./tokenizer";
import { isBangQueryPrefixAt, isWordBodyDelim, leafAtom, MAX_DEPTH, readStringAt } from "./parser";

export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Syntactic classification of a leaf or expression node, for editor tokenization. It is derived from the
 *  atom, so it is consistent with what the node parses to: a `number` node carries a grounded int/float, a
 *  `variable` a Variable, and everything else (including `True`/`False`) a `symbol`. */
export type CstNodeKind = "expr" | "symbol" | "variable" | "string" | "number";

/** One CST node: the atom it parses to, a syntactic kind, its source range, and, for expressions, the
 *  child nodes plus the paren spans. `bang`/`bangSpan` mark a top-level `!`-query and the `!` itself. An
 *  expression parsed by end-of-input recovery has no `close`. Comments are not atoms and live in
 *  `Cst.comments`, not in the tree. */
export interface SpannedNode {
  readonly atom: Atom;
  readonly kind: CstNodeKind;
  readonly span: Span;
  readonly children?: readonly SpannedNode[];
  readonly bang?: boolean;
  readonly bangSpan?: Span;
  readonly open?: Span;
  readonly close?: Span;
}

/** A `;` line comment's source range (its text is `src.slice(span.start, span.end)`). */
export interface CstComment {
  readonly span: Span;
}

/** LSP DiagnosticSeverity values, so a server can forward these without a mapping table. */
export type CstSeverity = 1 | 2;

/** A recovery diagnostic: a source range, a stable code, a message, and a severity. */
export interface CstDiagnostic {
  readonly span: Span;
  readonly code: string;
  readonly message: string;
  readonly severity: CstSeverity;
}

/** The whole parse: top-level nodes (atom-bearing, `!`-marked), the comments, and any recovery diagnostics
 *  (empty for well-formed source). */
export interface Cst {
  readonly nodes: readonly SpannedNode[];
  readonly comments: readonly CstComment[];
  readonly diagnostics: readonly CstDiagnostic[];
}

interface Frame {
  readonly openSpan: Span;
  readonly nodes: SpannedNode[];
  readonly atoms: Atom[];
}

function leafKind(atom: Atom, word: string): CstNodeKind {
  if (word.startsWith("$")) return "variable";
  if (atom.kind === "gnd" && (atom.value.g === "int" || atom.value.g === "float")) return "number";
  return "symbol";
}

/** Parse a whole program into a recovering CST. Never throws. */
export function parseCst(src: string, tk: Tokenizer): Cst {
  const nodes: SpannedNode[] = [];
  const comments: CstComment[] = [];
  const diagnostics: CstDiagnostic[] = [];
  const stack: Frame[] = [];
  let bang: Span | null = null; // a pending top-level `!` awaiting its form
  let pos = 0;

  const emit = (node: SpannedNode): void => {
    const top = stack[stack.length - 1];
    if (top !== undefined) {
      top.nodes.push(node);
      top.atoms.push(node.atom);
      return;
    }
    if (bang !== null) {
      nodes.push({ ...node, bang: true, bangSpan: bang });
      bang = null;
    } else {
      nodes.push(node);
    }
  };

  while (pos < src.length) {
    const ch = src[pos]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      pos++;
      continue;
    }
    if (ch === ";") {
      const start = pos;
      while (pos < src.length && src[pos] !== "\n") pos++;
      comments.push({ span: { start, end: pos } });
      continue;
    }
    if (ch === "(") {
      if (stack.length >= MAX_DEPTH) {
        diagnostics.push({
          span: { start: pos, end: pos + 1 },
          code: "syntax.nestingTooDeep",
          message: "MeTTa expression nesting too deep.",
          severity: 1,
        });
        pos++;
        continue;
      }
      stack.push({ openSpan: { start: pos, end: pos + 1 }, nodes: [], atoms: [] });
      pos++;
      continue;
    }
    if (ch === ")") {
      const frame = stack.pop();
      if (frame === undefined) {
        diagnostics.push({
          span: { start: pos, end: pos + 1 },
          code: "syntax.unexpectedClose",
          message: "Unexpected closing delimiter ')'.",
          severity: 1,
        });
        pos++;
        continue;
      }
      const close = { start: pos, end: pos + 1 };
      pos++;
      emit({
        atom: expr(frame.atoms),
        kind: "expr",
        span: { start: frame.openSpan.start, end: close.end },
        children: frame.nodes,
        open: frame.openSpan,
        close,
      });
      continue;
    }
    if (ch === '"') {
      const start = pos;
      const { atom, end, terminated } = readStringAt(src, pos);
      pos = end;
      if (!terminated) {
        diagnostics.push({
          span: { start, end },
          code: "syntax.unterminatedString",
          message: "Unterminated string literal.",
          severity: 1,
        });
      }
      emit({ atom, kind: "string", span: { start, end } });
      continue;
    }
    // A top-level `!` prefixes the next form as a query (parser.ts's readTop), so mark it pending. Inside an
    // expression `!` is an ordinary word character, matching the plain reader.
    if (ch === "!" && stack.length === 0 && bang === null && isBangQueryPrefixAt(src, pos)) {
      bang = { start: pos, end: pos + 1 };
      pos++;
      continue;
    }
    const start = pos;
    let word = "";
    while (pos < src.length && !isWordBodyDelim(src[pos]!, word)) {
      word += src[pos]!;
      pos++;
    }
    if (word.length === 0) {
      // `)` is the only non-whitespace delimiter reachable here and it is handled above; guard anyway so a
      // future delimiter cannot spin the loop.
      pos++;
      continue;
    }
    const atom = leafAtom(word, tk);
    emit({ atom, kind: leafKind(atom, word), span: { start, end: pos } });
  }

  // Recover: close every still-open expression at end-of-input, innermost first. Each emit lands in its
  // parent frame (now the stack top), so the nesting is preserved.
  while (stack.length > 0) {
    const frame = stack.pop()!;
    diagnostics.push({
      span: frame.openSpan,
      code: "syntax.unclosedDelimiter",
      message: "Unclosed delimiter '('.",
      severity: 1,
    });
    emit({
      atom: expr(frame.atoms),
      kind: "expr",
      span: { start: frame.openSpan.start, end: src.length },
      children: frame.nodes,
      open: frame.openSpan,
    });
  }
  // A dangling top-level `!` with no following form: the plain reader's readTop reads an empty word here, so
  // mirror that atom to stay a superset of parseAll.
  if (bang !== null) {
    nodes.push({
      atom: leafAtom("", tk),
      kind: "symbol",
      span: { start: bang.start, end: bang.end },
      bang: true,
      bangSpan: bang,
    });
    bang = null;
  }

  return { nodes, comments, diagnostics };
}

/** Parse a whole program into spanned top-level nodes, dropping comments and recovery diagnostics. Kept for
 *  callers that only need the atom tree (the static analyzer); prefer `parseCst` for editor use. Recovers
 *  rather than throwing, so a partial tree is returned for malformed input. */
export function parseAllSpanned(src: string, tk: Tokenizer): SpannedNode[] {
  return parseCst(src, tk).nodes as SpannedNode[];
}
