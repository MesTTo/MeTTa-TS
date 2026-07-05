// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: MIT

// Terminal rendering of diagnostics in rustc / codespan style: a file:line:col header, a source-line
// frame with a caret under the primary span, then help/note lines. Pure string building, no color and
// no dependency; a `--json` path serializes the Diagnostic[] directly instead of calling this.
import { type Diagnostic, DiagnosticSeverity } from "./diagnostic";

function severityName(s: DiagnosticSeverity): string {
  switch (s) {
    case DiagnosticSeverity.Error:
      return "error";
    case DiagnosticSeverity.Warning:
      return "warning";
    case DiagnosticSeverity.Information:
      return "note";
    case DiagnosticSeverity.Hint:
      return "help";
  }
}

/** Render one diagnostic as a multi-line rustc-style frame. */
export function renderDiagnostic(src: string, filename: string, d: Diagnostic): string {
  const lines = src.split("\n");
  const { line, character } = d.range.start;
  const srcLine = lines[line] ?? "";
  const lineNo = String(line + 1);
  const col = character + 1;
  const pad = " ".repeat(lineNo.length);
  // Caret length: within one line it is the span width; a multi-line span underlines to end of the
  // first line. At least one caret always.
  const spanLen =
    d.range.end.line === d.range.start.line
      ? Math.max(1, d.range.end.character - character)
      : Math.max(1, srcLine.length - character);
  const caret = " ".repeat(character) + "^".repeat(spanLen);
  const out: string[] = [];
  out.push(`${severityName(d.severity)}[${d.code}]: ${filename}:${lineNo}:${col}`);
  out.push(`${pad} |`);
  out.push(`${lineNo} | ${srcLine}`);
  out.push(`${pad} | ${caret} ${d.message}`);
  for (const s of d.suggestions ?? []) out.push(`${pad} = help: ${s.message}`);
  for (const r of d.relatedInformation ?? []) {
    if (r.range === undefined) out.push(`${pad} = note: ${r.message}`);
  }
  return out.join("\n");
}

/** Render every diagnostic, separated by a blank line. */
export function renderAll(src: string, filename: string, ds: readonly Diagnostic[]): string {
  return ds.map((d) => renderDiagnostic(src, filename, d)).join("\n\n");
}
