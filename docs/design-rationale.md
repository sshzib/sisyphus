# Design rationale

## Problem

Agent runtimes expose different control points. Sisyphus must apply one retry and sanction policy without claiming control over events a runtime cannot intercept. Raw code and transcripts also need to remain on the developer's machine by default.

## Usage from the caller's view

Runtime adapters submit one normalized observation and receive one typed decision:

```ts
const event = adapter.parseEvent(runtimePayload);
const decision = await kernel.supervise(event, effectivePolicy);
return adapter.renderDecision(event, decision);
```

An adapter does not call evaluators, increment retry counters, or update skill standing itself.

## Shape

The local worker owns the synchronous decision path. It stores private evidence, deduplicates runtime events, and calls the supervision kernel. The hosted service owns team policy, redacted reporting, signed dispositions, and optional judge brokerage. A capability snapshot travels with every event so historical enforcement claims remain accurate after a runtime upgrade.

The `SupervisionKernel` is intentionally deep. Its one operation hides conflict resolution, attribution, deterministic evaluation, judge handling, retry limits, sanction eligibility, and replay behavior. Runtime JSON stops at adapters. HTTP, SQLite, PostgreSQL, and model-provider data stop at their own boundaries.

## Synthesis decision

The chosen design combines a local governor with one hosted modular monolith. It keeps live enforcement available during cloud outages, uses verified activation rather than selection as sanction evidence, and separates device holds from team-wide standing. We rejected a cloud-gated hook path, service-per-stage backend, and a lowest-common-denominator adapter API.

## Tradeoffs accepted

- We accept partial enforcement reporting in exchange for supporting runtimes with different hook systems honestly.
- We accept eventual consistency for team quarantine in exchange for offline device protection.
- We accept reduced judge context in exchange for keeping raw evidence local.
- We accept a single hosted deployable in v1 in exchange for atomic policy and audit changes.

## Alternatives considered

A synchronous cloud evaluator would make every stop depend on network latency and availability. Separate resolver, evaluator, retry, and sanction services would split one decision across a distributed pipeline. Runtime-specific supervision engines would duplicate policy and make cross-runtime history impossible to compare safely.

## Remaining deployment risks

- Can the OpenCode adapter prove a supported stop-continuation mechanism without driving the client through an undocumented API?
- Which operating-system credential provider should a headless worker use when Electron is not present?
- What evidence-retention defaults will hosted tenants receive before public beta?
- Production deployments must separate the PostgreSQL migration owner from the row-level-policy application role.
- Stable policy-signing, evidence, and secret-encryption keys must replace generated development keys.
