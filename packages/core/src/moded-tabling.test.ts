// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

// Moded (variant) tabling memoizes a PURE call that carries free variables — a backward-chaining search's
// own output/existential variables, e.g. the subgoal `(obc n (: $f (→ $a $b)))` — keyed by the call's
// alpha-canonical form, replaying cached answers with fresh auxiliary variables (see `ModedTableEntry` and
// `freshenModedResult`). It is metta-ts's analogue of SLG/variant tabling and cuts the obc search's
// repeated subgoals (measured 51% hit rate on the jarr goal).
//
// This is a DIFFERENTIAL test: it runs each program with tabling on and with tabling off and asserts the
// two agree byte-for-byte. tabling-off is the plain, unmemoized interpreter (the ground-truth semantics), so
// agreement proves the memoization changes nothing about WHICH answers are produced or their ORDER. The obc
// goals are the motivating case; the free-enumeration queries `(obc n (: $x $a))` are adversarial — they
// enumerate every proof up to a size, so they stress many distinct tabled subgoals, the auxiliary
// metavariables introduced by the axiom schemes (a non-ground cached answer replayed with fresh variables),
// and deep replay under outer bindings.
import { describe, it, expect } from "vitest";
import { type Atom } from "./atom";
import { runProgram } from "./runner";
import { format } from "./parser";
import { canonicalize } from "./alpha";
import { OBC } from "./obc-fixture";

const atoms = (src: string, tabling: boolean): Atom[] =>
  runProgram(src, 100_000_000, new Map(), { tabling })[0]!.results;
const fmt = (as: Atom[]): string[] => as.map(format);
// Rename every variable to a positional placeholder, so two results equal up to which fresh names the
// gensym counter happened to assign compare equal (alpha-equivalence, per result, in order).
const fmtCanon = (as: Atom[]): string[] => as.map((a) => format(canonicalize(a, new Map())));

describe("moded tabling agrees with no tabling (differential oracle)", () => {
  // A ground result has no free variables, so tabling must reproduce it BYTE for byte.
  const agreeGround = (name: string, query: string): void =>
    it(`${name}: tabling on == off, byte-identical`, () => {
      const src = OBC + "\n" + query;
      expect(fmt(atoms(src, true))).toEqual(fmt(atoms(src, false)));
    });
  // A non-ground result (a proof scheme with free type variables) is only defined up to renaming: the
  // gensym counter names those variables, and tabling legitimately renames a replayed answer with fresh
  // ones, exactly as SLG/Prolog variant tabling does. So the guarantee here is alpha-equivalence per
  // answer, in order — same proofs, same count, same order, up to variable names.
  const agreeAlpha = (name: string, query: string): void =>
    it(`${name}: tabling on == off, up to variable renaming`, () => {
      const src = OBC + "\n" + query;
      const on = atoms(src, true);
      const off = atoms(src, false);
      expect(on.length).toBe(off.length);
      expect(fmtCanon(on)).toEqual(fmtCanon(off));
    });

  agreeGround("id (obc 5)", "!(obc 5 (: $x (→ 𝜑 𝜑)))");
  agreeGround("pm2.43 (obc 7)", "!(obc 7 (: $x (→ (→ 𝜑 (→ 𝜑 𝜓)) (→ 𝜑 𝜓))))");
  agreeGround("jarr (obc 13)", "!(obc 13 (: $x (→ (→ (→ 𝜑 𝜓) 𝜒) (→ 𝜓 𝜒))))");
  agreeGround("no proof below the needed size (obc 3)", "!(obc 3 (: $x (→ 𝜑 𝜑)))");
  // Two independent obc queries in one program (ground goals): the second must not see the first's
  // in-progress state or alias its auxiliary variables.
  agreeGround(
    "two ground queries share one table",
    "!(obc 5 (: $x (→ 𝜑 𝜑)))\n!(obc 5 (: $y (→ 𝜓 𝜓)))",
  );
  // Free enumeration: every proof up to a size, in one query. Many distinct subgoals, the axiom schemes'
  // auxiliary metavariables, and non-ground answers replayed with fresh variables — the hardest parity case.
  agreeAlpha("free enumeration (obc 5)", "!(obc 5 (: $x $a))");
  agreeAlpha("free enumeration (obc 7)", "!(obc 7 (: $x $a))");
});

describe("moded tabling still returns the correct proofs (pins the tabled path)", () => {
  it("id: the textbook Łukasiewicz proof of 𝜑 → 𝜑", () => {
    expect(fmt(atoms(OBC + "\n!(obc 5 (: $x (→ 𝜑 𝜑)))", true))).toEqual([
      "(MkSized 5 (: (mp (mp ax₂ ax₁) ax₁) (→ 𝜑 𝜑)))",
    ]);
  });

  it("jarr: both size-13 proofs, in order", () => {
    expect(fmt(atoms(OBC + "\n!(obc 13 (: $x (→ (→ (→ 𝜑 𝜓) 𝜒) (→ 𝜓 𝜒))))", true))).toEqual([
      "(MkSized 13 (: (mp (mp ax₂ (mp ax₁ (mp (mp ax₂ ax₂) (mp ax₁ ax₁)))) ax₁) (→ (→ (→ 𝜑 𝜓) 𝜒) (→ 𝜓 𝜒))))",
      "(MkSized 13 (: (mp (mp ax₂ (mp (mp ax₂ (mp ax₁ ax₂)) ax₁)) (mp ax₁ ax₁)) (→ (→ (→ 𝜑 𝜓) 𝜒) (→ 𝜓 𝜒))))",
    ]);
  });
});
