// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom, type ExprAtom, expr } from "./atom";

/** Rebuild an expression only when `mapChild` changes at least one child. */
export function mapExpressionChildren(
  atom: ExprAtom,
  memo: Map<ExprAtom, Atom>,
  mapChild: (child: Atom) => Atom,
): Atom {
  const cached = memo.get(atom);
  if (cached !== undefined) return cached;
  let items: Atom[] | undefined;
  for (let index = 0; index < atom.items.length; index++) {
    const item = atom.items[index]!;
    const mapped = mapChild(item);
    if (items !== undefined) items.push(mapped);
    else if (mapped !== item) {
      items = atom.items.slice(0, index);
      items.push(mapped);
    }
  }
  const result = items === undefined ? atom : expr(items);
  memo.set(atom, result);
  return result;
}
