// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

export {
  PROLOG_METTA_SRC,
  atomToPrologTerm,
  prologTermToAtom,
  prologOps,
  prologCoreAsyncOps,
  registerPrologInterop,
  type PrologBridge,
  type PrologEffect,
  type PrologInteropOptions,
  type PrologOperationResult,
  type PrologOperationReturn,
  type PrologTermJson,
} from "./prolog";
export { MockPrologBridge } from "./mock";
