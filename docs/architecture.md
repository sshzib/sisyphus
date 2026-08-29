# Architecture

Sisyphus has one runtime-neutral supervision kernel and multiple runtime adapters. An adapter translates lifecycle events and renders decisions. It never scores work, advances retry counters, or changes skill standing.

```text
Agent runtime -> adapter -> loopback worker -> supervision kernel
                                      |       |-> resolver
                                      |       |-> evaluators and judge port
                                      |       |-> retry and quarantine state
                                      |-> encrypted local evidence
                                      |-> transactional cloud outbox

Hosted API <- redacted records <- worker
     |-> team policy and signed bundles
     |-> optional judge brokerage
     |-> PostgreSQL control-plane records
     |-> web and Electron dashboard contract
```

## Live decision path

1. The adapter validates an unknown vendor payload at its boundary and produces a `HookObservation`.
2. The worker checks the vendor event ID. A duplicate returns the committed decision immediately.
3. The worker stores raw evidence locally, correlates any activation lease, matches the prompt against the managed catalog, and calls `SupervisionKernel.supervise`.
4. The kernel resolves one skill, evaluates a completion or tool request, applies the shared retry limit, and derives any eligible quarantine transition.
5. The kernel and journal apply idempotent state transitions. The journal commits the decision and cloud outbox record in one SQLite transaction, so replay converges after a crash.
6. The adapter converts the typed decision into the runtime's response format.

The hosted service is not on the deterministic enforcement path. A remote judge timeout becomes `inconclusive`, allows completion, and cannot affect automatic quarantine. Late results are advisory.

## Skill resolution and attribution

The catalog keeps canonical skill content immutable and stores runtime wrappers separately. It verifies file-wrapper hashes before worker startup. Resolution orders candidates by administrator priority, trigger specificity, and then lexicographic skill-version ID. The proof records every candidate and rejection reason. A selected prompt receives a five-minute, one-use activation lease; the activation tool returns the exact canonical or runtime-wrapper instruction bound to that skill version.

Selection alone is not attribution. A run affects skill standing only when the adapter observes a managed activation marker or invocation bound to that run and work item. Quarantined versions are excluded only on runtimes that can prove managed routing or tool enforcement.

## Capability snapshots

Each adapter installation publishes a versioned capability snapshot. The worker copies that snapshot onto every run, so a later runtime upgrade cannot rewrite historical enforcement claims. Policies declare the capabilities they require. Missing or partial capabilities downgrade the action to observation with a concrete reason.

Cursor local sessions and cloud agents use separate profiles. OpenCode advertises grading, telemetry, and tool controls but keeps stop continuation unsupported until its continuation conformance fixture passes.

## Data boundaries

SQLite in WAL mode stores normalized observations, encrypted evidence handles, retry and quarantine state, activation leases, persisted decisions, and the idempotent cloud outbox. The evidence vault uses AES-256-GCM with a device key supplied by the operating-system credential boundary. Hook, MCP, and desktop channels use distinct bearer tokens plus challenge-first HMAC authentication; the MCP bearer and tool arguments remain inside the stdio proxy until the worker proves possession of the channel secret.

The PostgreSQL schema stores tenant-scoped devices, runs, evaluations, skill dispositions, policy bundles, encrypted judge configuration, ingest events, and an ingest outbox. Tenant transactions set `app.tenant_id`; row-level policies constrain reads and writes.

Before a cloud or judge payload exists, the worker redacts its input. A redaction failure stops the transfer. The projection excludes native payload objects and permits only typed metadata plus bounded redacted excerpts. The hosted service still cannot prove the lineage of arbitrary excerpt text without a future device-attestation protocol.

## Package boundaries

`packages/domain` and `packages/kernel` cannot import vendor modules. `packages/adapter-kit` owns the translation contract and reusable conformance checks. Adapters own vendor schemas. The worker owns filesystem, SQLite, encryption, IPC, HTTP, and model-provider boundaries. The API owns authentication, tenant transactions, signed policy distribution, and hosted projections. Both web and Electron consume `packages/ui` contracts.
