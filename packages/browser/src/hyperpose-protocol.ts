// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

export interface BranchWorkerRequest {
  readonly id: number;
  readonly rulesSrc: string;
  readonly branchSrc: string;
  readonly fuel: number;
  readonly hostEffects?: boolean;
}

export interface BranchWorkerResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly results?: readonly string[];
  readonly error?: string;
}
