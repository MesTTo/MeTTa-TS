// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT

// The static analyzer: a pure function of (source, spanned CST, env, config) that collects every
// diagnostic in one pass. It never evaluates. Checks read the interpreter's own signature map, so a
// call the interpreter would reject for arity is flagged here, before running.
import { type Atom } from "./atom";
import { type MinEnv, buildEnv } from "./eval";
import { type SpannedNode, parseAllSpanned } from "./cst";
import { standardTokenizer, preludeAtoms } from "./runner";
import { stdlibAtoms } from "./stdlib";
import { pettaStdlibAtoms } from "./petta-stdlib";
import { stdTable } from "./builtins";
import { type Diagnostic, DiagnosticSeverity, Applicability, spanToRange } from "./diagnostic";
import { FuzzyMatcher } from "./fuzzy";

export interface DiagnoseConfig {
  /** Enable the undefined-head near-miss check. Off by default: MeTTa's ADD-mode makes an unknown
   *  head legal (added to the space as data), so this heuristic must be opted into. */
  readonly undefinedSymbols: boolean;
}

/** The head symbol name of a call node, or undefined if the node is not `(sym ...)`. */
function headName(node: SpannedNode): string | undefined {
  const h = node.children?.[0]?.atom;
  return h?.kind === "sym" ? h.name : undefined;
}

/** The head symbol name of a type atom, mirroring eval's `opOf` for the tuple-type test. */
function typeHead(t: Atom): string | undefined {
  return t.kind === "expr" && t.items[0]?.kind === "sym" ? t.items[0].name : undefined;
}

/** Does the op also carry a non-arrow (tuple/atom) type? If so, an arity check against its arrow
 *  signature is unsafe, matching eval's `has_tuple_type` fallback. */
function hasTupleType(env: MinEnv, name: string): boolean {
  return (env.types.get(name) ?? []).some((t) => typeHead(t) !== "->");
}

/** Every head name the analyzer considers "known": declared signatures, rule heads, other type
 *  declarations, and grounded builtin ops. Used as the fuzzy dictionary and the defined-set. */
function knownNames(env: MinEnv): Set<string> {
  const names = new Set<string>();
  for (const k of env.sigs.keys()) names.add(k);
  for (const k of env.ruleIndex.keys()) names.add(k);
  for (const k of env.types.keys()) names.add(k);
  for (const k of env.gt.keys()) names.add(k);
  return names;
}

function checkUnknownHead(
  src: string,
  node: SpannedNode,
  known: Set<string>,
  matcher: FuzzyMatcher,
  out: Diagnostic[],
): void {
  const headNode = node.children?.[0];
  const name = headName(node);
  if (name === undefined || headNode === undefined) return;
  if (known.has(name)) return;
  const suggestions = matcher.suggest(name);
  if (suggestions.length === 0) return;
  const best = suggestions[0]!;
  const headRange = spanToRange(src, headNode.span.start, headNode.span.end);
  out.push({
    range: headRange,
    severity: DiagnosticSeverity.Warning,
    code: "unknown-symbol",
    message: `unknown symbol \`${name}\``,
    relatedInformation: [{ message: `a similar name is in scope: \`${best}\`` }],
    suggestions: [
      {
        span: headRange,
        replacement: best,
        applicability: Applicability.MaybeIncorrect,
        message: `did you mean \`${best}\`?`,
      },
    ],
  });
}

function checkArity(src: string, node: SpannedNode, env: MinEnv, out: Diagnostic[]): void {
  const name = headName(node);
  if (name === undefined) return;
  const sig = env.sigs.get(name);
  if (sig === undefined || sig.length < 1 || hasTupleType(env, name)) return;
  const paramCount = sig.length - 1;
  const argCount = (node.children?.length ?? 1) - 1;
  if (argCount === paramCount) return;
  out.push({
    range: spanToRange(src, node.span.start, node.span.end),
    severity: DiagnosticSeverity.Error,
    code: "arity-mismatch",
    message: `${name} expects ${paramCount} argument${paramCount === 1 ? "" : "s"}, got ${argCount}`,
  });
}

function walk(
  src: string,
  node: SpannedNode,
  env: MinEnv,
  config: DiagnoseConfig,
  known: Set<string>,
  matcher: FuzzyMatcher | undefined,
  out: Diagnostic[],
): void {
  if (node.children !== undefined) {
    checkArity(src, node, env, out);
    if (config.undefinedSymbols && matcher !== undefined) {
      checkUnknownHead(src, node, known, matcher, out);
    }
    for (const child of node.children) walk(src, child, env, config, known, matcher, out);
  }
}

/** Analyze a parsed program. Returns diagnostics deduplicated by (position, code) and sorted by position. */
export function analyze(
  src: string,
  cst: readonly SpannedNode[],
  env: MinEnv,
  config: DiagnoseConfig,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const known = config.undefinedSymbols ? knownNames(env) : new Set<string>();
  const matcher = config.undefinedSymbols ? new FuzzyMatcher(known) : undefined;
  for (const node of cst) walk(src, node, env, config, known, matcher, out);
  const seen = new Set<string>();
  const deduped = out.filter((d) => {
    const k = `${d.range.start.line}:${d.range.start.character}:${d.code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort(
    (a, b) =>
      a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character,
  );
  return deduped;
}

/** Parse `src`, build the standard env (prelude + stdlib + petta + the program's own atoms), and analyze. */
export function analyzeSource(src: string, config: DiagnoseConfig): Diagnostic[] {
  const tk = standardTokenizer();
  const cst = parseAllSpanned(src, tk);
  const programAtoms = cst.map((n) => n.atom);
  const env = buildEnv(
    [...preludeAtoms(), ...stdlibAtoms(), ...pettaStdlibAtoms(), ...programAtoms],
    stdTable(),
  );
  return analyze(src, cst, env, config);
}
