// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

export interface BranchWorkerRequest {
  readonly id: number;
  readonly rulesSrc: string;
  readonly branchSrc: string;
  readonly firstOnly: boolean;
  readonly initialCounter: number;
  readonly fuel: number;
  readonly maxResultBytes: number;
  readonly hostEffects?: boolean;
}

export type BranchWorkerResponse =
  | BranchWorkerResultResponse
  | BranchWorkerOverflowResponse
  | BranchWorkerFailureResponse;

export interface BranchWorkerResultResponse {
  readonly id: number;
  readonly status: "result";
  readonly payload: ArrayBuffer;
}

export interface BranchWorkerOverflowResponse {
  readonly id: number;
  readonly status: "overflow";
}

export interface BranchWorkerFailureResponse {
  readonly id: number;
  readonly status: "failure";
}
