# Sisyphus Codex plugin

This plugin forwards Codex lifecycle events to the local Sisyphus worker at
`http://127.0.0.1:7331`. Set `SISYPHUS_WORKER_URL` to use another loopback
worker address.

Set `SISYPHUS_HOOK_TOKEN` and `SISYPHUS_MCP_TOKEN` to different 32-byte
base64url secrets before you start Codex or the worker. Generate each secret
with this command:

```console
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The hooks send only `SISYPHUS_HOOK_TOKEN` to `/v1/supervise`. Codex starts the
bundled MCP proxy over stdio. Before the proxy reads a tool call or sends the
MCP bearer token, it verifies the worker's `mcp` challenge with
`SISYPHUS_MCP_TOKEN`. It then forwards MCP requests to the authenticated
loopback worker.

The worker exposes `activate_skill` through the `sisyphus` MCP server. The
worker issues a short-lived activation lease only after it selects a managed
skill. The tool consumes that exact lease once and returns the hash-verified
canonical or Codex-wrapper instruction snapshot. Sisyphus verifies attribution
only from the consumed worker record, not from the hook payload.

If the worker is unavailable, every hook returns valid fail-open Codex JSON.
The hook and proxy processes do not write prompts, tool arguments, credentials,
or model output to logs.
