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

The local worker owns the synchronous decision path. It stores private evidence,
including deterministic evaluator stdout and stderr, deduplicates runtime events, and
calls the supervision kernel. The hosted service owns team policy, redacted reporting,
signed dispositions, and optional judge brokerage. Cloud evidence excerpts are off by
default. A local or signed policy must choose their sources and maximum length. A
capability snapshot travels with every event so historical enforcement claims remain
accurate after a runtime upgrade.

The `SupervisionKernel` is intentionally deep. Its one operation hides conflict resolution, attribution, deterministic evaluation, judge handling, retry limits, sanction eligibility, and replay behavior. Runtime JSON stops at adapters. HTTP, SQLite, PostgreSQL, and model-provider data stop at their own boundaries.

## Synthesis decision

The chosen design combines a local governor with one hosted modular monolith. It keeps live enforcement available during cloud outages, uses verified activation rather than selection as sanction evidence, and separates device holds from team-wide standing. We rejected a cloud-gated hook path, service-per-stage backend, and a lowest-common-denominator adapter API.

Sanctions and rankings answer different questions, so they use different cohorts. A
skill version is the team-wide sanction cohort across eligible verified runtimes. This
lets the service quarantine a faulty canonical version instead of hiding its failures
behind runtime boundaries. Rankings compare agents only when the runtime, profile,
installation, runtime and adapter versions, full capability snapshot, attribution,
and enforcement match.

Retries can produce several completion records for one logical work item. The hosted
quarantine reducer first keeps the latest completion for each run and work item. It
checks attribution and enforcement eligibility after that collapse, so an earlier
retryable record cannot survive beside its final completion.

## Tradeoffs accepted

- We accept partial enforcement reporting in exchange for supporting runtimes with different hook systems honestly.
- We accept eventual consistency for team quarantine in exchange for offline device protection.
- We accept reduced judge context in exchange for keeping raw evidence local.
- We accept a single hosted deployable in v1 in exchange for atomic policy and audit changes.
- We accept a trusted-loader requirement for packaged wrapper resources. Until such a
  loader exists, `plugin-resource` wrappers fail startup instead of silently using
  canonical content.

## Alternatives considered

A synchronous cloud evaluator would make every stop depend on network latency and availability. Separate resolver, evaluator, retry, and sanction services would split one decision across a distributed pipeline. Runtime-specific supervision engines would duplicate policy and make cross-runtime history impossible to compare safely.

The Codex integration uses nested timeout budgets to keep fail-open behavior inside the
plugin's 15-second command deadline. Worker supervision has 10 seconds, and the kernel
waits 8 seconds for a judge decision. Version probes and worker challenges each have
1 second. A late judge result becomes local advisory evidence instead of changing the
committed decision.

## Remaining deployment risks

- Can the OpenCode adapter prove a supported stop-continuation mechanism without driving the client through an undocumented API?
- Which operating-system credential provider should a headless worker use when Electron is not present?
- What evidence-retention defaults will hosted tenants receive before public beta?
- Production startup verifies that the PostgreSQL migration owner and restricted
  application role remain separate. Deployments still need to provision both
  credentials securely.
- Repository verification skips the live PostgreSQL migration and RLS suite when
  `SISYPHUS_TEST_DATABASE_URL` is absent. Each deployment must run that suite before
  its migration, grants, and policies count as verified.
- Stable policy-signing, evidence, and secret-encryption keys must replace generated development keys.
- Electron now provisions the bundled worker in strict `offline-default`,
  `local-policy`, or complete `cloud-managed` mode. It stores the device credential
  and generated worker secrets with `safeStorage` and keeps them out of the renderer.
  Independently launched runtimes still need an explicit secure pairing flow. V1 uses
  shared launch-time hook and MCP credentials and labels an unpaired adapter as
  degraded.
- The hosted service validates typed projections and credential patterns but cannot yet attest that excerpt text was produced by a particular device redactor version.
