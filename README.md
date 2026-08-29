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

`pnpm verify` checks runtime boundaries, strict TypeScript compilation, tests, and production builds.

## Run the local stack

Copy `.env.example` into your shell environment. The worker refuses to start without a 32-byte evidence key. Generate a development key in PowerShell:

```powershell
$env:SISYPHUS_EVIDENCE_KEY = [Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

Then start the services in separate terminals:

```sh
pnpm --filter @sisyphus/worker dev
pnpm --filter @sisyphus/api dev
pnpm --filter @sisyphus/web dev
```

The dashboard uses built-in sample data unless both `NEXT_PUBLIC_SISYPHUS_API_URL` and `NEXT_PUBLIC_SISYPHUS_DEMO_TOKEN` are set. Use `http://127.0.0.1:7330` and `demo-admin` to connect it to the development control plane.

To prepare PostgreSQL, start `compose.yaml` and run the API migration:

```sh
docker compose up -d postgres
pnpm --filter @sisyphus/api migrate
```

## Codex plugin

The v1 plugin bundle is in `plugins/sisyphus-codex`. Its lifecycle hooks send vendor events only to the loopback worker. If the worker is unavailable, the hooks return valid fail-open responses without printing prompt or tool content.

Validate the bundle before installing or publishing it:

```sh
python ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/sisyphus-codex
```

## Security and enforcement guarantees

- Raw prompts, outputs, transcripts, and tool evidence remain in the encrypted local vault.
- Cloud records contain metrics, hashes, capability snapshots, and locally redacted excerpts.
- Failed local redaction blocks upload and judge requests.
- Authenticated user or device credentials determine tenant scope; request bodies cannot select a tenant.
- Every run stores its runtime and adapter versions plus its capability snapshot.
- Unsupported policy actions degrade to visibly labeled observation.
- Only verified skill activation contributes to quarantine.
- Duplicate vendor events replay the stored decision without consuming another retry or failure sample.

Development credentials, generated signing keys, and the in-memory API seed are not production identity or key management. Provision stable keys and PostgreSQL-backed credentials before deployment.
