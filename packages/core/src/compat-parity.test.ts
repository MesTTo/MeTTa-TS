// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Each @metta-ts/* compat shim re-exports its @mettascript/* canonical, so bundling-relevant package.json
// fields must match the canonical. sideEffects is the one that regressed: compat/browser shipped `false`
// while the canonical lists the hyperpose worker, so a bundler tree-shook the worker's side-effect import
// to an empty file. This asserts every shim mirrors its canonical's sideEffects, so a shim can never again
// drift into dropping a worker entry.
const ROOT = process.cwd();
const COMPAT = resolve(ROOT, "compat");
const PACKAGES = resolve(ROOT, "packages");

const readSideEffects = (dir: string): unknown =>
  (JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")) as { sideEffects?: unknown })
    .sideEffects;

const shimNames = readdirSync(COMPAT).filter((name) =>
  existsSync(resolve(COMPAT, name, "package.json")),
);

describe("compat shim / canonical sideEffects parity", () => {
  it.each(shimNames)("compat/%s mirrors packages/%s sideEffects", (name) => {
    expect(existsSync(resolve(PACKAGES, name, "package.json")), `packages/${name} exists`).toBe(
      true,
    );
    expect(readSideEffects(resolve(COMPAT, name))).toEqual(
      readSideEffects(resolve(PACKAGES, name)),
    );
  });
});
