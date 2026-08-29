# Runtime adapter status

The adapter packages share one normalization and conformance contract, but they do not all have the same release status.

| Adapter | Status | Operational path |
|---|---|---|
| Codex | v1 | Bundled lifecycle hooks and MCP configuration in `plugins/sisyphus-codex` |
| Claude Code | Parser prototype | Hook schemas, capability profile, turn correlation, decision rendering, and conformance fixtures |
| Cursor | Parser prototype | Separate local and cloud profiles, hook schemas, decision rendering, and conformance fixtures |
| OpenCode | Parser prototype | Plugin-event schemas, grading and telemetry responses, and unsupported continuation reporting |

For prototype adapters, `install()` records an idempotent in-process installation receipt for conformance testing. It does not edit vendor configuration or claim durable enrollment. Promote an adapter only after its executable installer, rollback path, persistent installation record, and runtime continuation tests pass.
