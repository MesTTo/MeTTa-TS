// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// MeTTa source to atoms, using the engine's own parser and tokenizer (the same path the eDSL uses). The
// bridge leans on `parseLeaf` to reconstruct a leaf from its source token, so `42` becomes a grounded
// number, `$x` a variable, and `foo` a symbol, exactly as the reader would produce them.

import { SExprParser, standardTokenizer, type Atom, type Tokenizer } from "@mettascript/hyperon";

let sharedTokenizer: Tokenizer | undefined;
const tokenizer = (): Tokenizer => (sharedTokenizer ??= standardTokenizer());

/** Parse MeTTa source into its top-level atoms. */
export function parseProgram(src: string): Atom[] {
  return new SExprParser(src).parseAll(tokenizer());
}

/** Parse a single-token source string into one atom, or `undefined` if it is not exactly one atom. */
export function parseLeaf(token: string): Atom | undefined {
  const atoms = parseProgram(token);
  return atoms.length === 1 ? atoms[0] : undefined;
}
