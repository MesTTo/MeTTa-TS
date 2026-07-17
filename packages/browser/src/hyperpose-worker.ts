// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import {
  encodeWorkerBranchPayload,
  runProgramWithState,
  setHostEffectsEnabled,
  tryFormatTransportAtom,
} from "@metta-ts/core";
import type { BranchWorkerRequest, BranchWorkerResponse } from "./hyperpose-protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<BranchWorkerRequest>) => void) | null;
  postMessage(message: BranchWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.hostEffects === false) setHostEffectsEnabled(false);
    const query = request.firstOnly ? `!(once ${request.branchSrc})` : `!${request.branchSrc}`;
    const execution = runProgramWithState(
      `${request.rulesSrc}\n${query}`,
      request.fuel,
      new Map(),
      {},
      request.initialCounter,
    );
    const result = execution.results.at(-1);
    const results: string[] = [];
    for (const atom of result?.results ?? []) {
      const source = tryFormatTransportAtom(atom, "value");
      if (source === undefined) throw new Error("worker result is not transportable");
      results.push(source);
    }
    const payload = encodeWorkerBranchPayload({
      results,
      counterDelta: execution.state.counter - request.initialCounter,
    });
    if (payload.byteLength > request.maxResultBytes) {
      workerScope.postMessage({ id: request.id, status: "overflow" });
      return;
    }
    const buffer = new ArrayBuffer(payload.byteLength);
    new Uint8Array(buffer).set(payload);
    workerScope.postMessage(
      {
        id: request.id,
        status: "result",
        payload: buffer,
      },
      [buffer],
    );
  } catch {
    workerScope.postMessage({
      id: request.id,
      status: "failure",
    });
  }
};
