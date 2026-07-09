// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { DEFAULT_FUEL, type QueryResult, type RunOptions } from "@metta-ts/core";
import { composeHostInterops, type HostInterop, type HostTextLoader } from "@metta-ts/core/host";
import { runSourceAsync, vfsImports, type BrowserParEvalOptions } from "./source";

export interface BrowserRunnerOptions {
  readonly files?: ReadonlyMap<string, string>;
  readonly loadText?: HostTextLoader;
  readonly interops?: readonly HostInterop[];
  readonly fuel?: number;
  readonly par?: BrowserParEvalOptions;
}

export interface BrowserRunner {
  run(src: string): Promise<QueryResult[]>;
  dispose(): Promise<void>;
}

function globalBaseUrl(): string | undefined {
  const location = (globalThis as { readonly location?: { readonly href?: string } }).location;
  return typeof location?.href === "string" ? location.href : undefined;
}

function fileCandidates(path: string): string[] {
  if (path.endsWith(".metta")) return [path, path.slice(0, -".metta".length)];
  return [path, `${path}.metta`];
}

export function createBrowserTextLoader(options: {
  readonly files?: ReadonlyMap<string, string>;
  readonly baseUrl?: string | URL;
}): HostTextLoader {
  const files = options.files ?? new Map<string, string>();
  return async (path, from) => {
    for (const candidate of fileCandidates(path)) {
      const text = files.get(candidate);
      if (text !== undefined) return text;
    }
    const base = from ?? options.baseUrl ?? globalBaseUrl();
    if (base === undefined) throw new Error(`browser loader: ${path}: no base URL`);
    const url = new URL(path, base);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`browser loader: ${path}: ${response.status} ${url.href}`);
    return response.text();
  };
}

export function createBrowserRunner(options: BrowserRunnerOptions = {}): BrowserRunner {
  const files = options.files ?? new Map<string, string>();
  const composed = composeHostInterops(options.interops ?? []);
  const fuel = options.fuel ?? DEFAULT_FUEL;
  return {
    async run(src) {
      const program = composed.prelude === undefined ? src : `${composed.prelude}\n${src}`;
      return runSourceAsync(
        program,
        new Map(composed.asyncOps ?? []),
        fuel,
        vfsImports(program, files),
        {
          ...(composed.hostImport !== undefined ? { hostImport: composed.hostImport } : {}),
        } satisfies RunOptions,
        options.par,
      );
    },
    async dispose() {
      await composed.dispose?.();
    },
  };
}
