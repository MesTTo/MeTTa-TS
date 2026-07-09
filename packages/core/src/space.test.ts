// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { InMemorySpace } from "./space";
import { sym, variable, expr, atomEq } from "./atom";
import { instantiate } from "./instantiate";

describe("InMemorySpace", () => {
  it("adds atoms and queries by pattern, returning binding sets", () => {
    const s = new InMemorySpace();
    s.add(expr([sym("Parent"), sym("Tom"), sym("Bob")]));
    s.add(expr([sym("Parent"), sym("Bob"), sym("Ann")]));
    const res = s.query(expr([sym("Parent"), sym("Tom"), variable("c")]));
    expect(res.length).toBe(1);
    expect(atomEq(instantiate(res[0]!, variable("c")), sym("Bob"))).toBe(true);
  });

  it("returns one binding set per matching atom", () => {
    const s = new InMemorySpace();
    s.add(expr([sym("p"), sym("a")]));
    s.add(expr([sym("p"), sym("b")]));
    expect(s.query(expr([sym("p"), variable("x")])).length).toBe(2);
  });

  it("keeps variable-headed atoms visible to concrete-headed queries", () => {
    const s = new InMemorySpace();
    s.add(expr([variable("h"), sym("a")]));
    s.add(expr([sym("q"), sym("a")]));
    s.add(expr([sym("p"), sym("a")]));

    const res = s.query(expr([sym("p"), sym("a")]));

    expect(res.length).toBe(2);
    expect(atomEq(instantiate(res[0]!, variable("h")), sym("p"))).toBe(true);
    expect(res[1]!.length).toBe(0);
  });

  it("removes indexed atoms from head buckets", () => {
    const s = new InMemorySpace();
    const a = expr([sym("p"), sym("a")]);
    const b = expr([sym("p"), sym("b")]);
    s.add(a);
    s.add(b);
    expect(s.remove(a)).toBe(true);

    const res = s.query(expr([sym("p"), variable("x")]));

    expect(res.length).toBe(1);
    expect(atomEq(instantiate(res[0]!, variable("x")), sym("b"))).toBe(true);
  });

  it("freshens indexed candidates before matching", () => {
    const s = new InMemorySpace();
    const stored = expr([sym("p"), sym("old")]);
    s.add(stored);

    const res = s.query(expr([sym("p"), variable("x")]), (atom) =>
      atom === stored ? expr([sym("p"), sym("fresh")]) : atom,
    );

    expect(res.length).toBe(1);
    expect(atomEq(instantiate(res[0]!, variable("x")), sym("fresh"))).toBe(true);
  });

  it("remove deletes a matching atom; atoms() enumerates", () => {
    const s = new InMemorySpace();
    const a = expr([sym("A")]);
    s.add(a);
    expect(s.remove(a)).toBe(true);
    expect(s.remove(a)).toBe(false);
    expect(s.atoms().length).toBe(0);
  });
});
