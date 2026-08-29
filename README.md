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

The dashboard uses built-in sample data unless both `NEXT_PUBLIC_SISYPHUS_API_URL` and `NEXT_PUBLIC_SISYPHUS_DEMO_TOKEN` are set. Use `http://127.0.0.1:7330` and `demo-admin` to connect it to the development control plane.

The sample [worker policy](examples/worker-policy.json) imports an immutable canonical skill and matches it by prompt trigger. Runtime wrapper files are optional. When present, the worker verifies their declared SHA-256 hash before startup and returns the matching wrapper from the activation tool; otherwise it returns the canonical snapshot.

To prepare PostgreSQL, start `compose.yaml` and run the API migration:

```sh
docker compose up -d postgres
pnpm --filter @sisyphus/api migrate
```

## Codex plugin

The v1 plugin bundle is in `plugins/sisyphus-codex`. Its lifecycle hooks send vendor events only to the loopback worker. If the worker is unavailable, the hooks return valid fail-open responses without printing prompt or tool content.

Both local transports authenticate the worker before releasing private data. Hooks perform an HMAC challenge before posting a vendor event. Codex talks to a bundled stdio MCP proxy, which performs the same challenge before reading tool arguments or sending its bearer token to the loopback port.

Validate the bundle before installing or publishing it:

```sh
python ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/sisyphus-codex
```

## Security and enforcement guarantees

- Full prompts, outputs, transcripts, and tool evidence remain in the encrypted local vault. Cloud records may contain bounded, locally redacted excerpts as configured by policy.
- The worker projection structurally excludes native vendor payloads and screens credential-shaped values. The hosted service cannot independently prove that a generic excerpt came from the current device redactor; redaction lineage remains a deployment limitation until device attestation is added.
- Failed local redaction blocks upload and judge requests.
- Authenticated user or device credentials determine tenant scope; request bodies cannot select a tenant.
- Every run stores its runtime and adapter versions plus its capability snapshot.
- Unsupported policy actions degrade to visibly labeled observation.
- Only verified skill activation contributes to quarantine.
- Duplicate vendor events replay the stored decision without consuming another retry or failure sample.

Development credentials, generated signing keys, the example policy, and the in-memory API seed are not production identity or key management. Production startup stays fail-closed unless the PostgreSQL repository, migrations, and tenant policies initialize successfully.
