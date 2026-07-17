// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchWorkerRequest, BranchWorkerResponse } from "./hyperpose-protocol";

interface TestWorkerScope {
  onmessage: ((event: MessageEvent<BranchWorkerRequest>) => void) | null;
  postMessage(message: BranchWorkerResponse, transfer?: Transferable[]): void;
}

afterEach(() => {
  vi.doUnmock("@metta-ts/core");
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("browser hyperpose worker entry", () => {
  it("does not copy an unbounded thrown message into the failure protocol", async () => {
    vi.resetModules();
    vi.stubGlobal("onmessage", null);
    const postMessage = vi.fn<TestWorkerScope["postMessage"]>();
    vi.stubGlobal("postMessage", postMessage);
    vi.doMock("@metta-ts/core", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@metta-ts/core")>();
      return {
        ...actual,
        runProgramWithState: (): never => {
          throw new Error("x".repeat(2 * 1024 * 1024));
        },
      };
    });

    await import("./hyperpose-worker");
    const scope = globalThis as unknown as TestWorkerScope;
    expect(scope.onmessage).not.toBeNull();
    scope.onmessage!({
      data: {
        id: 41,
        rulesSrc: "",
        branchSrc: "ready",
        firstOnly: false,
        initialCounter: 0,
        fuel: 100,
        maxResultBytes: 64,
      },
    } as MessageEvent<BranchWorkerRequest>);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const response = postMessage.mock.calls[0]![0];
    expect(response).toEqual({ id: 41, status: "failure" });
    expect(Object.keys(response).sort()).toEqual(["id", "status"]);
  });
});
