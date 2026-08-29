# Sisyphus

Sisyphus supervises coding agents. It selects one managed skill for each prompt, grades root-agent and subagent completions, issues at most two corrective retries, and quarantines skill versions that repeatedly fail verified work.

The Codex integration is the v1 enforcement path. Claude Code, Cursor, and OpenCode adapters are included as capability-gated parser prototypes: they use the same domain contract and conformance kit, but never claim an enforcement feature that their runtime cannot prove. See [runtime adapter status](adapters/README.md).

## Repository layout

| Path | Purpose |
|---|---|
| `packages/domain` | Runtime-neutral observations, decisions, capabilities, and identifiers |
| `packages/kernel` | Skill resolution, evaluation, retries, quarantine, and replay |
| `packages/catalog` | Immutable canonical skills and runtime-specific wrappers |
| `packages/adapter-kit` | Adapter contract and conformance suite |
| `adapters/*` | Codex, Claude Code, Cursor, and OpenCode translations |
| `apps/worker` | Loopback worker, encrypted evidence, SQLite state, and cloud outbox |
| `apps/api` | Fastify control plane, judge broker, signed policy bundles, and PostgreSQL schema |
| `packages/ui` | Shared dashboard and typed client contract |
| `apps/web` | Hosted Next.js dashboard |
| `apps/desktop` | Electron shell for the shared dashboard |
| `plugins/sisyphus-codex` | Installable Codex lifecycle-hook bundle |

For the decision path and trust boundaries, see [Architecture](docs/architecture.md). For the design tradeoffs, see [Design rationale](docs/design-rationale.md).

## Prerequisites

- Node.js 22 or newer
- pnpm 10 through Corepack
- PostgreSQL 17 for control-plane persistence work

## Verify the repository

```sh
corepack enable
pnpm install
pnpm verify
```

`pnpm verify` checks runtime boundaries, strict TypeScript compilation, tests,
production builds, an unpacked Electron release, and the authenticated worker bundled
inside that release. The live PostgreSQL isolation suite runs when
`SISYPHUS_TEST_DATABASE_URL` points to a disposable test database; otherwise that one
test is reported as skipped. A skipped live suite does not verify a deployment's
migration head, grants, role separation, or row-level security policies. Run the live
suite against each deployment environment before release.

## Run the local stack

Copy `.env.example` into your shell environment. The worker requires four distinct local credentials: an evidence key plus hook, MCP, and desktop bearer tokens. Generate development values with Node.js:

```sh
node -e "const c=require('node:crypto'); console.log('SISYPHUS_EVIDENCE_KEY='+c.randomBytes(32).toString('base64')); for (const n of ['SISYPHUS_HOOK_TOKEN','SISYPHUS_MCP_TOKEN','SISYPHUS_DESKTOP_TOKEN']) console.log(n+'='+c.randomBytes(32).toString('base64url'))"
```

Set the printed values in the shell that launches the worker. Launch Codex from a shell containing the same hook and MCP values. The Electron app labels Codex as `setup required` until both shared values are present; it never exposes OS-stored secrets to the renderer.

Then start the services in separate terminals:

```sh
pnpm --filter @sisyphus/worker dev
pnpm --filter @sisyphus/api dev
pnpm --filter @sisyphus/web dev
```

The hosted dashboard uses clearly labeled sample data when all three hosted settings
are absent. To connect the real control plane, set the server-only
`SISYPHUS_WEB_API_URL`, `SISYPHUS_WEB_ORIGIN`, and
`SISYPHUS_WEB_SESSION_KEY` values, then enter an access token in the connection form.
The Next.js server validates the token and keeps it in an encrypted, `HttpOnly`
session; no bearer credential is compiled into browser JavaScript. Partial hosted
configuration fails closed. See [the hosted dashboard guide](apps/web/README.md).

Electron provisions its bundled worker in one of three strict modes:

- `offline-default` applies when no policy file or cloud identity is present. The
  worker uses its built-in policy and does not connect to the control plane.
- `local-policy` applies when only `SISYPHUS_POLICY_FILE` is present. The worker loads
  that file and stays offline.
- `cloud-managed` requires the policy file, control-plane origin, tenant and device
  identity, adapter installation, local runtime profile, configuration digest, and at
  least one trusted policy key. Partial cloud configuration fails closed.

For the first `cloud-managed` launch, `SISYPHUS_DEVICE_TOKEN` can supply the enrolled
device credential. Electron encrypts it with `safeStorage`; later launches can load it
from the device secret store. Electron also stores the evidence key and the hook, MCP,
and desktop credentials through the same operating-system boundary. If secure storage
is unavailable, managed-worker startup fails. None of these secrets enters the
renderer process.

Set `SISYPHUS_API_URL` and `SISYPHUS_DESKTOP_API_TOKEN` together to connect the
renderer dashboard to a real control plane. The dashboard token remains in the
Electron main process and reaches the renderer only through validated IPC responses.
With both settings absent, Electron labels the dashboard as demo data.

The sample [worker policy](examples/worker-policy.json) imports an immutable canonical
skill and matches it by prompt trigger. It disables cloud evidence excerpts. A local
or signed policy can instead enable `redacted-excerpts`, choose the permitted sources,
and set a maximum of 4,000 characters.

Runtime wrapper files are optional. When present, the worker verifies their declared
SHA-256 hash before startup and returns the matching wrapper from the activation tool.
Without a wrapper, it returns the canonical snapshot. `plugin-resource` references
fail closed until the worker has a trusted resource loader; the worker never falls
back to canonical content for a configured but unreadable wrapper.

To prepare PostgreSQL, start `compose.yaml` and run the API migration with the schema
owner URL. Serve requests with the separate restricted application URL shown in
`.env.example`:

```sh
docker compose up -d postgres
pnpm --filter @sisyphus/api migrate
```

The Compose initialization script creates `sisyphus_app` only for a fresh development
volume. PostgreSQL does not rerun initialization scripts for an existing volume; add
the role manually or recreate only a disposable development volume before migrating.

## Codex plugin

The v1 plugin bundle is in `plugins/sisyphus-codex`. Its lifecycle hooks send vendor events only to the loopback worker. If the worker is unavailable, the hooks return valid fail-open responses without printing prompt or tool content.

Both local transports authenticate the worker before releasing private data. Hooks perform an HMAC challenge before posting a vendor event. Codex talks to a bundled stdio MCP proxy, which performs the same challenge before reading tool arguments or sending its bearer token to the loopback port.

The Codex hook uses nested deadlines. The plugin command has a 15-second budget, the
supervision request has 10 seconds, and the judge decision has 8 seconds. Runtime
version probing and each worker challenge have a 1-second budget. A timeout returns a
valid fail-open or `inconclusive` result at the boundary that owns that deadline.

Validate the bundle before installing or publishing it:

```sh
python ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/sisyphus-codex
```

## Security and enforcement guarantees

- Full prompts, outputs, transcripts, tool evidence, and deterministic evaluator
  stdout and stderr remain in the encrypted local vault.
- Cloud evidence excerpts are disabled when `cloudEvidence` is absent or set to
  `disabled`. Only a local or signed policy can enable bounded, locally redacted
  excerpts for named sources.
- The worker projection structurally excludes native vendor payloads and screens credential-shaped values. The hosted service cannot independently prove that a generic excerpt came from the current device redactor; redaction lineage remains a deployment limitation until device attestation is added.
- Failed local redaction blocks upload and judge requests.
- Authenticated user or device credentials determine tenant scope; request bodies cannot select a tenant.
- Every run stores its runtime and adapter versions plus its capability snapshot.
- Every run also stores the adapter installation and runtime profile that produced it;
  capability changes affect only later runs.
- Unsupported policy actions degrade to visibly labeled observation.
- Only verified skill activation contributes to quarantine.
- Before the hosted service checks quarantine eligibility, it keeps only the latest
  completion for each run and logical work item. The latest record must also have
  verified attribution, enforced coverage, and supported managed routing or tool
  prevention.
- A skill version is the team-wide sanction cohort across all eligible runtimes. This
  catches failures in a canonical skill even when different runtimes produced them.
  Dashboard rankings remain separate comparison cohorts.
- A comparison cohort includes the runtime, runtime profile, adapter installation,
  runtime version, adapter version, full capability snapshot, attribution class, and
  enforcement class.
- Duplicate vendor events replay the stored decision without consuming another retry or failure sample.
- Signed policy bundles are restored and reverified before the worker listens. Repeated
  unchanged policy reads return the same signed revision, while changed policy state
  reserves a new append-only revision.

Development credentials, generated signing keys, the example policy, and the in-memory API seed are not production identity or key management. Production startup stays fail-closed unless the PostgreSQL repository, migrations, and tenant policies initialize successfully.
