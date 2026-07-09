// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { gint } from "./atom";
import { Interner } from "./flat-kb";
import { parseAll } from "./parser";
import { standardTokenizer } from "./runner";
import { encodeVariantKey, TableSpace } from "./table-space";

const atom = (src: string) => parseAll(src, standardTokenizer())[0]!.atom;

describe("table-space structural keys", () => {
  it("keys variant calls without formatting or preserving concrete variable names", () => {
    const interner = new Interner();
    const a = encodeVariantKey(atom("(obc 5 (: $x T))"), interner);
    const b = encodeVariantKey(atom("(obc 5 (: $proof T))"), interner);
    expect(a.tokens).toEqual(b.tokens);
    expect(a.varNames).toEqual(["x"]);
    expect(b.varNames).toEqual(["proof"]);
    expect(a.canonicalMap.get("x")).toBe("%0");
    expect(b.canonicalMap.get("proof")).toBe("%0");
  });

  it("distinguishes repeated variables from distinct variables", () => {
    const interner = new Interner();
    const repeated = encodeVariantKey(atom("(same $x $x)"), interner);
    const distinct = encodeVariantKey(atom("(same $x $y)"), interner);
    expect(repeated.tokens).not.toEqual(distinct.tokens);
  });

  it("keeps ordered-bag and distinct-answer tables in separate domains", () => {
    const tables = new TableSpace();
    const call = atom("(fib 7)");
    const bag = tables.key("ground", call, 0);
    const distinct = tables.key("ground-distinct", call, 0);

    tables.rememberCompleted(bag, 0, [gint(1), gint(1)]);
    tables.rememberCompleted(distinct, 0, [gint(1)]);
    expect(tables.getCompleted(bag)?.results).toHaveLength(2);
    expect(tables.getCompleted(distinct)?.results).toHaveLength(1);
  });
});

describe("table-space completed table budget", () => {
  it("evicts least-recently-used completed entries under the entry budget", () => {
    const tables = new TableSpace({
      maxCompletedEntries: 2,
      maxCompletedAnswers: 100,
      maxApproxCells: 100,
      maxEntryCells: 100,
      maxInternerLeaves: 100,
    });
    const k1 = tables.key("ground", atom("(f 1)"), 0);
    const k2 = tables.key("ground", atom("(f 2)"), 0);
    const k3 = tables.key("ground", atom("(f 3)"), 0);

    tables.rememberCompleted(k1, 0, [gint(1)]);
    tables.rememberCompleted(k2, 0, [gint(2)]);
    expect(tables.getCompleted(k1)?.results).toEqual([gint(1)]);
    tables.rememberCompleted(k3, 0, [gint(3)]);

    expect(tables.getCompleted(k1)?.results).toEqual([gint(1)]);
    expect(tables.getCompleted(k2)).toBeUndefined();
    expect(tables.getCompleted(k3)?.results).toEqual([gint(3)]);
    expect(tables.stats().entries).toBe(2);
  });

  it("rejects a completed entry above the per-entry budget", () => {
    const tables = new TableSpace({
      maxCompletedEntries: 10,
      maxCompletedAnswers: 100,
      maxApproxCells: 100,
      maxEntryCells: 2,
      maxInternerLeaves: 100,
    });
    const key = tables.key("ground", atom("(f 1)"), 0);
    tables.rememberCompleted(key, 0, [atom("(large a b c)")]);
    expect(tables.getCompleted(key)).toBeUndefined();
    expect(tables.stats()).toEqual({ entries: 0, answers: 0, approxCells: 0 });
  });

  it("resets completed tables and re-encodes the current key across the interner budget", () => {
    const tables = new TableSpace({
      maxCompletedEntries: 10,
      maxCompletedAnswers: 100,
      maxApproxCells: 100,
      maxEntryCells: 100,
      maxInternerLeaves: 2,
    });
    const retained = tables.key("ground", atom("(f alpha)"), 0);
    tables.rememberCompleted(retained, 0, [gint(1)]);
    expect(tables.getCompleted(retained)?.results).toEqual([gint(1)]);

    const overBudget = tables.key("ground", atom("(g beta)"), 0);
    tables.rememberCompleted(overBudget, 0, [gint(2)]);

    expect(tables.getCompleted(retained)).toBeUndefined();
    expect(tables.getCompleted(overBudget)?.results).toEqual([gint(2)]);
    expect(tables.stats()).toEqual({ entries: 1, answers: 1, approxCells: 2 });
  });

  it("ignores completed-table writes through stale keys after an interner reset", () => {
    const tables = new TableSpace({
      maxCompletedEntries: 10,
      maxCompletedAnswers: 100,
      maxApproxCells: 100,
      maxEntryCells: 100,
      maxInternerLeaves: 2,
    });
    const stale = tables.key("ground", atom("(f alpha)"), 0);
    tables.rememberCompleted(stale, 0, [gint(1)]);
    expect(tables.getCompleted(stale)?.results).toEqual([gint(1)]);

    const trigger = tables.key("ground", atom("(g beta)"), 0);
    tables.rememberCompleted(trigger, 0, [gint(2)]);
    expect(tables.isCurrentKey(stale)).toBe(false);

    tables.rememberCompleted(stale, 0, [gint(99)]);
    expect(tables.getCompleted(stale)).toBeUndefined();
    expect(tables.getCompleted(trigger)?.results).toEqual([gint(2)]);
    expect(tables.stats()).toEqual({ entries: 1, answers: 1, approxCells: 2 });

    const current = tables.key("ground", atom("(f alpha)"), 0);
    tables.rememberCompleted(current, 0, [gint(3)]);
    expect(tables.getCompleted(current)?.results).toEqual([gint(3)]);
  });

  it("defers interner reset until active tables release their token ids", () => {
    const tables = new TableSpace({
      maxCompletedEntries: 10,
      maxCompletedAnswers: 100,
      maxApproxCells: 100,
      maxEntryCells: 100,
      maxInternerLeaves: 2,
    });
    const active = tables.key("moded", atom("(p $x alpha)"), 0);
    expect(tables.beginActive(active, 1)).toBeDefined();

    const overBudget = tables.key("ground", atom("(g beta)"), 0);
    tables.rememberCompleted(overBudget, 0, [gint(2)]);
    expect(tables.getCompleted(overBudget)?.results).toEqual([gint(2)]);

    tables.endActive(active);
    expect(tables.getCompleted(overBudget)).toBeUndefined();
    expect(tables.stats()).toEqual({ entries: 0, answers: 0, approxCells: 0 });
  });

  it("deduplicates active cyclic answers structurally while preserving call-variable positions", () => {
    const tables = new TableSpace({
      maxCompletedEntries: 10,
      maxCompletedAnswers: 100,
      maxApproxCells: 100,
      maxEntryCells: 100,
      maxInternerLeaves: 100,
    });
    const key = tables.key("moded", atom("(p $x $y)"), 0);
    const active = tables.beginActive(key, 2)!;

    expect(tables.addActiveAnswers(active, [atom("(%0 %1)"), atom("(%0 %1)")])).toBe(1);
    expect(tables.addActiveAnswers(active, [atom("(%1 %0)")])).toBe(1);
    expect(active.results).toHaveLength(2);
  });

  it("shares the global entry budget between completed and active tables", () => {
    const tables = new TableSpace({
      maxCompletedEntries: 1,
      maxCompletedAnswers: 100,
      maxApproxCells: 100,
      maxEntryCells: 100,
      maxInternerLeaves: 100,
    });
    const completed = tables.key("ground", atom("(f 1)"), 0);
    tables.rememberCompleted(completed, 0, [gint(1)]);

    const activeKey = tables.key("moded", atom("(p $x)"), 0);
    expect(tables.beginActive(activeKey, 1)).toBeDefined();
    expect(tables.getCompleted(completed)).toBeUndefined();

    const second = tables.key("moded", atom("(q $x)"), 0);
    expect(tables.beginActive(second, 1)).toBeNull();
  });

  it("shares the global answer budget across active tables", () => {
    const tables = new TableSpace({
      maxCompletedEntries: 2,
      maxCompletedAnswers: 1,
      maxApproxCells: 100,
      maxEntryCells: 100,
      maxInternerLeaves: 100,
    });
    const first = tables.beginActive(tables.key("moded", atom("(p $x)"), 0), 1)!;
    const second = tables.beginActive(tables.key("moded", atom("(q $x)"), 0), 1)!;

    expect(tables.addActiveAnswers(first, [atom("(%0 a)")])).toBe(1);
    expect(tables.addActiveAnswers(second, [atom("(%0 b)")])).toBe(0);
    expect(second.overBudget).toBe(true);
  });
});
