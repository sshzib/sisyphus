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

The hooks send only `SISYPHUS_HOOK_TOKEN` to `/v1/supervise`. Codex reads
`SISYPHUS_MCP_TOKEN` through `bearer_token_env_var` for `/mcp` requests.

The worker exposes `activate_skill` through the `sisyphus` MCP server. The
worker issues a short-lived activation lease only after it selects a managed
skill. The tool consumes that exact lease once. Sisyphus verifies attribution
only from the consumed worker record, not from the hook payload.

If the worker is unavailable, every hook returns valid fail-open Codex JSON.
The hook process does not write prompts, tool arguments, or model output to
stdout or stderr.
