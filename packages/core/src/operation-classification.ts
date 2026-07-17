// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

/** Operations that observe effects, mutable state, nondeterminism, or evaluator context. */
export const IMPURE_OPS: ReadonlySet<string> = new Set([
  "add-atom",
  "remove-atom",
  "add-reduct",
  "add-reducts",
  "add-atoms",
  "new-state",
  "get-state",
  "change-state!",
  "new-space",
  "new-mork-space",
  "fork-space",
  "get-atoms",
  "bind!",
  "import!",
  "transaction",
  "context-space",
  "par",
  "race",
  "once",
  "with-mutex",
  "with_mutex",
  "superpose",
  "hyperpose",
  "collapse",
  "collapse-bind",
  "superpose-bind",
  "collapse-extract",
  "match",
  "metta",
  "metta-thread",
  "capture",
  "println!",
  "print!",
  "trace!",
  "pragma!",
  "register-module!",
  "get-type",
  "get-type-space",
  "check-types",
  "get-doc",
  "empty",
]);

/** Moded tabling treats the pure zero-argument `empty` failure marker separately. */
export const MODED_IMPURE_OPS: ReadonlySet<string> = new Set(
  [...IMPURE_OPS].filter((operation) => operation !== "empty"),
);
