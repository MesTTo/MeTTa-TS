// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { format } from "./parser";
import { runProgram } from "./runner";

const decode = (json: string): string => `(json-decode ${JSON.stringify(json)})`;
const printed = (src: string): string[][] => runProgram(src).map((q) => q.results.map(format));

function jsonText(printedString: string): string {
  return JSON.parse(printedString) as string;
}

describe("json built-in module", () => {
  it("decodes JSON scalars and arrays into core atoms", () => {
    const out = printed(`
      !(import! &self json)
      !${decode("null")}
      !${decode("true")}
      !${decode('"hi"')}
      !${decode("42")}
      !${decode("2.5")}
      !${decode("[1, 2, 3]")}
    `);

    expect(out[1]).toEqual(["null"]);
    expect(out[2]).toEqual(["True"]);
    expect(out[3]).toEqual(['"hi"']);
    expect(out[4]).toEqual(["42"]);
    expect(out[5]).toEqual(["2.5"]);
    expect(out[6]).toEqual(["(1 2 3)"]);
  });

  it("encodes scalar and array atoms as JSON strings", () => {
    const out = printed(`
      !(import! &self json)
      !(json-encode 42)
      !(json-encode "hi")
      !(json-encode (1 2 3))
      !(let $xs ${decode("[1, 2, 3]")} (json-encode $xs))
    `);

    expect(jsonText(out[1]![0]!)).toBe("42");
    expect(jsonText(out[2]![0]!)).toBe('"hi"');
    expect(JSON.parse(jsonText(out[3]![0]!))).toEqual([1, 2, 3]);
    expect(JSON.parse(jsonText(out[4]![0]!))).toEqual([1, 2, 3]);
  });

  it("builds queryable dict-spaces from JSON objects", () => {
    const out = printed(`
      !(import! &self json)
      (= (doc) ${decode('{"a": 1, "b": [2, 3], "c": true}')})
      !(get-value (doc) a)
      !(get-value (doc) missing)
      !(get-keys (doc))
      !(let $d (doc) (json-encode $d))
      !(let $d (doc) (unify $d (a $value) $value Empty))
    `);

    expect(out[1]).toEqual(["1"]);
    expect(out[2]).toEqual([]);
    expect(out[3]).toEqual(["a", "b", "c"]);
    expect(JSON.parse(jsonText(out[4]![0]!))).toEqual({ a: 1, b: [2, 3], c: true });
    expect(out[5]).toEqual(["1"]);
  });

  it("builds queryable dict-spaces from MeTTa pair expressions", () => {
    const out = printed(`
      !(import! &self json)
      (= (doc) (dict-space ((a 1) ("b" 2))))
      !(get-value (doc) a)
      !(get-value (doc) "b")
      !(get-keys (doc))
      !(let $d (doc) (json-encode $d))
    `);

    expect(out[1]).toEqual(["1"]);
    expect(out[2]).toEqual(["2"]);
    expect(out[3]).toEqual(["a", '"b"']);
    expect(JSON.parse(jsonText(out[4]![0]!))).toEqual({ a: 1, b: 2 });
  });

  it("imports JSON types and documentation into &self", () => {
    const out = printed(`
      !(import! &self json)
      !(get-type json-encode)
      !(get-type dict-space)
      !(get-doc json-encode)
      !(get-doc dict-space)
    `);

    expect(out[1]).toEqual(["(-> Atom String)"]);
    expect(out[2]).toEqual(["(-> Expression Grounded)"]);
    expect(out[3]![0]).toMatch(/^\(@doc-formal /);
    expect(out[3]![0]).toContain("Function takes atom as an input and encodes it to json-string");
    expect(out[3]![0]).toContain("(@type (-> Atom String))");
    expect(out[4]![0]).toMatch(/^\(@doc-formal /);
    expect(out[4]![0]).toContain("Function takes key-value pairs in form of expression as input");
    expect(out[4]![0]).toContain("(@type (-> Expression Grounded))");
  });
});
