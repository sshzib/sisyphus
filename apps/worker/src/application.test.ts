import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createWorkerApplication } from "./application.js";
import { loadWorkerConfiguration } from "./config.js";

const hookToken = "hook_token_0123456789abcdefghijklmnopqrstuvwxyz";
const mcpToken = "mcp_token_0123456789abcdefghijklmnopqrstuvwxyz0";

describe("worker application", () => {
  it("composes the persistent kernel, evidence vault, MCP, and HTTP server", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "sisyphus-application-"));
    const configuration = await loadWorkerConfiguration({
      environment: {
        SISYPHUS_DATA_DIR: dataDirectory,
        SISYPHUS_HOOK_TOKEN: hookToken,
        SISYPHUS_MCP_TOKEN: mcpToken,
      },
    });
    const application = await createWorkerApplication({
      configuration,
      evidenceKey: randomBytes(32),
      codexRuntimeVersionProbe: async () => "0.99.0",
    });
    application.server.listen(0, "127.0.0.1");
    await once(application.server, "listening");
    const address = application.server.address();
    if (address === null || typeof address === "string") throw new Error("Missing port.");

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
    await application.close();
  });

  it("starts without Codex and reports setup-required instead of registering unknown", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "sisyphus-application-"));
    const configuration = await loadWorkerConfiguration({
      environment: {
        SISYPHUS_DATA_DIR: dataDirectory,
        SISYPHUS_HOOK_TOKEN: hookToken,
        SISYPHUS_MCP_TOKEN: mcpToken,
      },
    });
    const onError = vi.fn();
    const application = await createWorkerApplication({
      configuration,
      evidenceKey: randomBytes(32),
      codexRuntimeVersionProbe: async () => {
        throw new Error("codex executable was not found");
      },
      onError,
    });
    application.server.listen(0, "127.0.0.1");
    await once(application.server, "listening");
    const address = application.server.address();
    if (address === null || typeof address === "string") throw new Error("Missing port.");

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(response.status).toBe(200);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      message:
        "Codex adapter setup is required; no concrete Codex runtime version was detected.",
    });
    await application.close();
  });
});
