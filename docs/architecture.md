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
2. The worker resolves the exact adapter installation and runtime profile, then checks
   the vendor event ID. A duplicate returns the committed decision immediately.
3. The worker correlates any activation lease, matches the prompt against the managed
   catalog, and calls `SupervisionKernel.supervise`. It captures normalized event data
   and deterministic evaluator stdout and stderr in the encrypted local evidence
   record.
4. The kernel resolves one skill, evaluates a completion or tool request, applies the
   shared retry budget, and derives any eligible quarantine transition. Root and
   subagent completions remain separate work items even when they draw from the same
   retry budget.
5. The kernel and journal apply idempotent state transitions. The journal commits the decision and cloud outbox record in one SQLite transaction, so replay converges after a crash.
6. The adapter converts the typed decision into the runtime's response format.

The hosted service is not on the deterministic enforcement path. A remote judge
timeout becomes `inconclusive`, allows completion, and cannot affect automatic
quarantine. Late results are advisory and are persisted locally without changing the
authoritative decision.

The Codex path assigns each nested operation a smaller deadline than its caller. The
plugin command has 15 seconds, the worker supervision request has 10 seconds, and the
judge decision has 8 seconds. Runtime probing and worker challenges have 1 second
each. The hosted judge transport has its own 15-second cleanup deadline, but the
kernel stops waiting after 8 seconds and treats any later result as advisory.

## Skill resolution and attribution

The catalog keeps canonical skill content immutable and stores runtime wrappers
separately. It verifies file-wrapper hashes before worker startup. A configured
`plugin-resource` wrapper fails startup until a trusted loader can resolve and verify
that resource. Resolution orders candidates by administrator priority, trigger
specificity, and then lexicographic skill-version ID. The proof records every
candidate and rejection reason. A selected prompt receives a five-minute, one-use
activation lease; the activation tool returns the exact canonical or runtime-wrapper
instruction bound to that skill version.

Selection alone is not attribution. A run affects skill standing only when the adapter observes a managed activation marker or invocation bound to that run and work item. Quarantined versions are excluded only on runtimes that can prove managed routing or tool enforcement.

## Capability snapshots

Each adapter installation publishes a versioned capability snapshot and a concrete
runtime version. The worker copies the installation identity, profile, and snapshot
onto every run, so a later runtime upgrade cannot rewrite historical enforcement
claims. Policies declare the capabilities they require. Missing or partial
capabilities downgrade the action to observation with a concrete reason. If Codex is
not installed, the worker reports setup-required and registers no fictional runtime.

Cursor local sessions and cloud agents use separate profiles. OpenCode advertises grading, telemetry, and tool controls but keeps stop continuation unsupported until its continuation conformance fixture passes.

Hosted comparisons use a hash of the runtime, runtime profile, adapter installation,
runtime version, adapter version, full capability snapshot, attribution class, and
enforcement class. Agent ranks restart for each hash. Runtime upgrades and capability
changes therefore start new comparison cohorts instead of rewriting or mixing prior
results.

Team sanctions use a different cohort on purpose. The canonical skill-version ID is
the team-wide sanction key across all eligible verified runtimes. Before the service
checks the latest ten eligible outcomes, it collapses completion records by run and
logical work item. Only the latest completion remains. The service then requires
verified attribution, enforced coverage, supported managed routing or tool
prevention, and either a pass or a retry-exhausted terminal failure.

## Data boundaries

SQLite in WAL mode stores normalized observations, encrypted evidence handles, retry
and quarantine state, activation leases, persisted decisions, and the idempotent cloud
outbox. The evidence vault uses AES-256-GCM with a device key supplied by the
operating-system credential boundary. Deterministic evaluator stdout and stderr enter
that encrypted record and never enter cloud findings. Hook, MCP, and desktop channels
use distinct bearer tokens plus challenge-first HMAC authentication; the MCP bearer
and tool arguments remain inside the stdio proxy until the worker proves possession
of the channel secret.

The PostgreSQL schema stores tenant-scoped devices, runs, evaluations, skill
dispositions, policy bundles, encrypted judge configuration, ingest events, and an
ingest outbox. A privileged migration role owns the schema; the serving role receives
only the grants it needs. Startup verifies migration head, exact forced row-level
policies, role isolation, and grants before listening. Tenant transactions set
`app.tenant_id`, and unchanged policy reads reuse the same signed issuance record.
These checks run against a live deployment only when the migration and RLS verification
suite receives `SISYPHUS_TEST_DATABASE_URL`. A skipped live suite leaves that
deployment unverified.

Before a cloud or judge payload exists, the worker redacts its input. A redaction
failure stops the transfer. Cloud supervision records contain typed metadata and no
evidence excerpts by default. A local or signed policy must select
`redacted-excerpts`, list the permitted sources, and set the maximum character count.
The projection still excludes native payload objects. The hosted service cannot prove
the lineage of arbitrary excerpt text without a future device-attestation protocol.

Electron starts its bundled worker in `offline-default`, `local-policy`, or
`cloud-managed` mode. Cloud-managed startup rejects partial identity or trust
configuration. Electron encrypts the enrolled device token and generated worker
secrets with `safeStorage`; it rejects operating-system backends that do not provide
secret encryption. The main process keeps these values out of renderer IPC payloads.

## Package boundaries

`packages/domain` and `packages/kernel` cannot import vendor modules.
`packages/adapter-kit` owns the translation contract and reusable conformance checks.
Adapters own vendor schemas. The worker owns filesystem, SQLite, encryption, IPC,
HTTP, and model-provider boundaries. The API owns authentication, tenant transactions,
signed policy distribution, and hosted projections. Both web and Electron consume
`packages/ui` contracts. The hosted browser reaches the API through a same-origin,
encrypted-session BFF; Electron keeps its control-plane bearer in the main process and
exposes only schema-validated IPC operations.
