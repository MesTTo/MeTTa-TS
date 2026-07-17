// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { type Atom } from "./atom";
import { isWorkerReplaySafeGroundedOp } from "./builtins";
import { type MinEnv } from "./eval";
import { IMPURE_OPS } from "./operation-classification";
import { scanReductionDependencies } from "./reduction-dependency";

const WORKER_REPLAY_UNSAFE_HEADS: ReadonlySet<string> = new Set([
  ...IMPURE_OPS,
  "eval",
  "evalc",
  "chain",
  "unify",
  "cons-atom",
  "decons-atom",
  "function",
  "return",
  "collapse-bind",
  "superpose-bind",
  "collapse-extract",
  "metta",
  "metta-thread",
  "capture",
  "context-space",
  "match",
  "get-type",
  "get-type-space",
  "check-types",
  "get-doc",
  "new-state",
  "get-state",
  "change-state!",
  "new-space",
  "new-mork-space",
  "fork-space",
  "get-atoms",
  "add-atom",
  "remove-atom",
  "bind!",
  "import!",
  "pragma!",
  "transaction",
  "par",
  "race",
  "once",
  "with-mutex",
  "with_mutex",
  "superpose",
  "hyperpose",
]);

interface WorkerRuleSummary {
  locallySafe: boolean;
  readonly dependencies: Set<string>;
}

function scanWorkerApplications(
  env: MinEnv,
  roots: readonly Atom[],
  replaySafeFunctors: ReadonlySet<string> | undefined,
): WorkerRuleSummary {
  const summary: WorkerRuleSummary = { locallySafe: true, dependencies: new Set() };
  if (env.varRulesVar.length > 0) {
    summary.locallySafe = false;
    return summary;
  }
  const scan = scanReductionDependencies(roots, (name) => env.ruleIndex.has(name));
  if (scan.hasDynamicApplication) {
    summary.locallySafe = false;
    return summary;
  }
  for (const name of scan.names) {
    if (WORKER_REPLAY_UNSAFE_HEADS.has(name) || env.agt.has(name)) {
      summary.locallySafe = false;
      return summary;
    }
    const grounded = env.gt.get(name);
    if (grounded !== undefined && !isWorkerReplaySafeGroundedOp(name, grounded)) {
      summary.locallySafe = false;
      return summary;
    }
    if (env.ruleIndex.has(name)) {
      summary.dependencies.add(name);
      if (replaySafeFunctors !== undefined && !replaySafeFunctors.has(name)) {
        summary.locallySafe = false;
        return summary;
      }
    }
  }
  return summary;
}

/** Compute the greatest fixed point of static functors safe to replay in an isolated worker program. */
export function analyzeWorkerReplaySafety(env: MinEnv): Set<string> {
  if (env.varRulesVar.length > 0) return new Set();
  const summaries = new Map<string, WorkerRuleSummary>();
  for (const [name, equations] of env.ruleIndex) {
    const summary = scanWorkerApplications(
      env,
      equations.map(([, rhs]) => rhs),
      undefined,
    );
    summaries.set(name, summary);
  }
  const safe = new Set<string>();
  for (const [name, summary] of summaries) if (summary.locallySafe) safe.add(name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...safe]) {
      const dependencies = summaries.get(name)!.dependencies;
      for (const dependency of dependencies)
        if (!safe.has(dependency)) {
          safe.delete(name);
          changed = true;
          break;
        }
    }
  }
  return safe;
}

/** Validate the concrete branch tree against an already computed worker-replay fixed point. */
export function isWorkerReplaySafeAtom(
  env: MinEnv,
  atom: Atom,
  replaySafeFunctors: ReadonlySet<string>,
): boolean {
  return scanWorkerApplications(env, [atom], replaySafeFunctors).locallySafe;
}

/** Prove a concrete atom safe without computing the transitive static-rule fixed point. */
export function isWorkerReplaySafeWithoutRuleCalls(env: MinEnv, atom: Atom): boolean {
  const summary = scanWorkerApplications(env, [atom], undefined);
  return summary.locallySafe && summary.dependencies.size === 0;
}
