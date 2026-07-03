// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Monotonic node ids, no crypto dependency. Ids are unique within a session, which is all the graph and
// serialization need (saved graphs carry their own ids; loading does not mint new ones).

let counter = 0;

/** The next unique node id: `n1`, `n2`, ... */
export function nextId(): string {
  return `n${++counter}`;
}
