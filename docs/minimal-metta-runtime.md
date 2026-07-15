# Minimal MeTTa runtime contract

The `beta` runtime separates logical answers from control and host failures. Existing APIs still return `Atom[]` or `[Atom, Bindings]` pairs. The new types are available from `@metta-ts/core/runtime` until the cursor-based evaluator is ready to drive the existing APIs through an adapter. Keeping them in a subpath leaves the main `@metta-ts/core` bundle unchanged during the migration.

## Outcomes

`EvaluationOutcome` has eight cases:

| Kind                   | Meaning                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `answer`               | One atom and its binding frame                               |
| `exhausted`            | The search has no further answer                             |
| `stuck`                | A finite term has no applicable transition                   |
| `language-fault`       | A MeTTa-visible error atom                                   |
| `resource-fault`       | A declared evaluation limit was reached                      |
| `infrastructure-fault` | A grounded operation, worker, codec, or host boundary failed |
| `suspended`            | The branch may resume after an external event                |
| `cancelled`            | Structured cancellation stopped the branch                   |

The split follows the same fault boundary used by Effect's [`Cause`](https://github.com/Effect-TS/effect/blob/80b539f8aba68f478c75c35c2b4140c4ffc4fada/packages/effect/src/Cause.ts): expected typed failure, unexpected defect, and interruption stay distinguishable. Minimal MeTTa also needs `exhausted` and `stuck` because neither is an exception.

The following values remain distinct:

- `Empty` is ordinary answer data in MeTTa TS.
- `()` is one unit answer.
- Zero alternatives become `exhausted`.
- `NotReducible` is the minimal boundary view of `stuck`.
- `(Error ...)` remains a matchable atom when a language fault is materialized for a legacy caller.
- Resource faults, infrastructure faults, and cancellation do not become zero alternatives.

`projectLegacyOutcome` performs the boundary conversion. Answers, exhaustion, stuck terms, and language faults have default Minimal MeTTa mappings. Other faults stay typed unless the caller supplies an explicit atom materializer. A suspended branch never looks complete.

## Resources

`ResourceLedger` holds one aggregate account for:

- steps;
- stack depth;
- branches;
- results;
- atom cells;
- bytes;
- table cells;
- worker tasks;
- wall time.

Nested `ResourceLease` values share the account. They do not copy or replenish spent fuel. A multi-resource debit either updates every requested counter or updates none. A failed debit reports the exact resource, configured limit, prior consumption, attempted debit, and operation.

Worker execution will use grants derived from the same account. Unused grant capacity can return after acknowledged closure. Spent capacity cannot return. A crashed worker conservatively consumes its outstanding grant.

Cancellation uses `AbortSignal` for notification and a serializable `CancellationReason` for the interpreter protocol. Cancellation still needs a task scope that joins child work and runs finalizers. An abort flag alone does not prove cleanup has finished.

## Trace identity

Runtime IDs use the serializable form `<kind>:<namespace>:<sequence>`. Each kind has its own counter, so variable scopes, states, spaces, branches, effects, suspensions, spans, and events do not consume one shared sequence. Worker lanes append a disjoint namespace.

`TraceContext` carries a trace ID, span ID, branch ID, and state ID. Child branches retain the trace ID and record their parent span. The shape follows OpenTelemetry's rule that trace context is immutable and serializable after a span ends. See the OpenTelemetry JS [`SpanContext`](https://github.com/open-telemetry/opentelemetry-js/blob/d8894cf99074d487203e1b814d9c3679019b63d3/api/src/trace/span_context.ts).

`TraceRecorder` is bounded by event count and estimated bytes. It does not format or execute atoms. Timestamps appear only when the caller provides a clock. `NO_TRACE_SINK` reports that tracing is ignored, which differs from a recorder that dropped an event because its buffer was full.

## Compatibility rule

The following public signatures remain unchanged during the migration:

- `mettaEval` returns `[Array<[Atom, Bindings]>, St]`.
- `mettaEvalAsync` returns a promise of the same tuple.
- `evalAtom` returns `[Atom[], St]`.
- `QueryResult` has only `query` and `results`.
- `ReduceResult`, `GroundFn`, `Frame`, `Item`, `World`, `St`, and string-based `Bindings` remain exported.

New evaluator entry points will expose typed outcomes and cursors beside these APIs. The legacy functions will drain the cursor through `projectLegacyOutcome` once the cursor owns the complete transition loop.
