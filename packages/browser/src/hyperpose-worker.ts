// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { format, runProgram, setHostEffectsEnabled } from "@metta-ts/core";
import type { BranchWorkerRequest, BranchWorkerResponse } from "./hyperpose-protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<BranchWorkerRequest>) => void) | null;
  postMessage(message: BranchWorkerResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.hostEffects === false) setHostEffectsEnabled(false);
    const result = runProgram(`${request.rulesSrc}\n!${request.branchSrc}`, request.fuel).at(-1);
    workerScope.postMessage({
      id: request.id,
      ok: true,
      results: result?.results.map(format) ?? [],
    });
  } catch (error: unknown) {
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
