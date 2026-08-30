# Engineering workforce architecture

## Assessment

Sisyphus already has a secure Electron shell, a tenant-scoped Fastify control
plane, encrypted local worker evidence, durable runtime-event ingestion, and a
single Overview read model. Those components are retained. They monitor an
already-running coding runtime; they do not hire agents, manage source
workspaces, or run generated projects.

The engineering workforce is therefore a separate bounded context. It must not
reuse the loopback worker's local command evaluator, because generated project
code must never run on the desktop host.

## Decision

Add a dedicated `apps/orchestrator` process beside the API.

```text
Overview -> API task command -> engineering event/outbox -> orchestrator
     -> plan/spec -> OpenRouter assignments -> isolated Git branches
     -> integration branch -> safety gate -> private source bundle
     -> trusted AWS CodeBuild runner -> evidence/attribution/scoring
     -> API projection -> Overview
```

Fastify owns authenticated task creation and dashboard queries. The
orchestrator owns leases, model calls, trusted Git operations, safety decisions,
AWS submission, polling, retries, and reassignment. This prevents model or
cloud latency from occupying HTTP handlers and makes restart recovery explicit.

## Boundaries

- The renderer submits typed task requests and reads projections only. It never
  receives OpenRouter or AWS credentials.
- The desktop has no AWS identity. The orchestrator uses an environment or
  secret-provider identity with only the scoped S3 and CodeBuild permissions it
  needs.
- The CodeBuild project uses a distinct service role and an immutable,
  server-authored runner/buildspec. Generated source never supplies shell
  commands or a buildspec override.
- The orchestrator uses only a server-derived S3 source location under its
  configured input prefix. It does not pass a generated buildspec or commands;
  `infra/codebuild/README.md` documents the two-role IAM boundary.
- Agents return a validated file-patch manifest, not commands. Only trusted Git
  commands create branches, commit accepted patches, and create the integration
  workspace.
- A static safety gate rejects unsafe dependencies, lifecycle scripts, secrets,
  path traversal, symlinks, unsupported package managers, and suspicious
  command text before a source bundle is uploaded. It flags network-dependent
  source for policy review; egress isolation is enforced by AWS configuration.
- The existing worker continues local runtime supervision and encrypted evidence
  capture. It is not an AI task runner or a generated-code sandbox.

## Evidence model

The new event stream is independent of runtime-hook telemetry and carries safe
activity only, never prompts, model reasoning, or hidden chain-of-thought.

```text
Task -> Requirement -> Assignment -> Workspace/branch -> file manifest
-> commit -> integration commit -> CodeBuild run -> test/check failure
-> attribution -> agent score history
```

The base scoring weights are functional correctness 40%, contract/hidden tests
25%, security 20%, requirement compliance 10%, and quality 5%. A critical
security finding or broken core flow rejects the artifact regardless of its
numeric score. QA earns credit when its test reveals a real defect; the source
assignment is attributed from requirement ownership, file/commit provenance,
and check evidence.

## MVP vertical slice

The implemented local vertical slice accepts a managed authentication-web-app
task through Overview, keeps it in the control-plane projection, and blocks it
honestly until a separately configured orchestrator can use OpenRouter. With
the provider and AWS configuration in place, the orchestrator creates
structured requirements, dynamically assigns specialist roles, records branch
and commit provenance, safety-scans the integrated source, and submits a
private artifact to CodeBuild. The trusted runner installs dependencies,
performs an available build, supervises an available development server,
discovers a healthy port, requires an automated test script, runs available
integration/E2E/static/security checks, collects stdout/stderr/exit codes and
timings, and tears the server down.

## Current prototype boundaries

The design reserves persistent task history, atomic leases with heartbeats,
test-to-requirement attribution, post-sandbox targeted retry/reassignment,
independent hidden tests, and infrastructure-as-code verification of the
CodeBuild project for the next implementation wave. The current engineering
task store is intentionally in memory and therefore suitable only for a local
single-process demo; it cannot make production durability or multi-instance
claims. Those gaps are visible work, not simulated behavior.

No task is marked approved until the actual sandbox result passes. If required
fresh provider or AWS configuration is absent, the task is visibly blocked;
Sisyphus does not invent agents, scores, sandbox results, or approval.
