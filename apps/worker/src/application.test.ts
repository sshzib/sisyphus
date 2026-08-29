import { once } from "node:events";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomBytes } from "node:crypto";
import { codexCapabilities } from "@sisyphus/adapter-codex";
import { describe, expect, it, vi } from "vitest";

import { createWorkerApplication } from "./application.js";
import { loadWorkerConfiguration } from "./config.js";

const hookToken = "hook_token_0123456789abcdefghijklmnopqrstuvwxyz";
const mcpToken = "mcp_token_0123456789abcdefghijklmnopqrstuvwxyz0";
const desktopToken = "desktop_token_0123456789abcdefghijklmnopqrstuvwxyz";

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

  it("keeps deterministic command output only in encrypted local evidence", async () => {
    const sentinel = "COMMAND_EVIDENCE_SENTINEL_7f2b56";
    const sentinelCharacterCodes = Array.from(sentinel)
      .map((character) => character.charCodeAt(0))
      .join(",");
    const dataDirectory = await mkdtemp(join(tmpdir(), "sisyphus-application-"));
    const policyPath = join(dataDirectory, "policy.json");
    await writeFile(
      policyPath,
      JSON.stringify({
        deterministicChecks: [
          {
            id: "sentinel-check",
            executable: process.execPath,
            arguments: [
              "-e",
              `process.stderr.write(String.fromCharCode(${sentinelCharacterCodes})); process.exit(2)`,
            ],
            workingDirectory: process.cwd(),
            timeoutMilliseconds: 2_000,
          },
        ],
      }),
    );
    const configuration = await loadWorkerConfiguration({
      environment: {
        SISYPHUS_DATA_DIR: dataDirectory,
        SISYPHUS_HOOK_TOKEN: hookToken,
        SISYPHUS_MCP_TOKEN: mcpToken,
        SISYPHUS_DESKTOP_TOKEN: desktopToken,
        SISYPHUS_POLICY_FILE: policyPath,
      },
    });
    const application = await createWorkerApplication({
      configuration,
      evidenceKey: randomBytes(32),
      codexRuntimeVersionProbe: async () => "0.99.0",
    });
    try {
      application.server.listen(0, "127.0.0.1");
      await once(application.server, "listening");
      const address = application.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Missing port.");
      }
      const endpoint = `http://127.0.0.1:${address.port}`;
      const supervisionEnvelope = {
        runtime: "codex",
        adapterVersion: "0.1.0",
        runtimeInstallation: configuration.runtimeInstallation,
        eventId: "command-evidence-stop",
        identity: {
          sessionId: "command-evidence-session",
          agent: { kind: "root", agentId: "command-evidence-agent" },
        },
        activation: { kind: "none" },
        nativeEvent: {
          hook_event_name: "Stop",
          cwd: process.cwd(),
          last_assistant_message: "Completed the requested change.",
        },
        event: {
          kind: "root-stop",
          eventId: "command-evidence-stop",
          workItemId: "command-evidence-work",
          retryBudgetId: "command-evidence-work",
          runId: "command-evidence-run",
          occurredAt: "2026-08-29T10:00:00.000Z",
          adapterVersion: "0.1.0",
          runtimeInstallation: configuration.runtimeInstallation,
          capabilities: codexCapabilities("0.99.0"),
          identity: {
            sessionId: "command-evidence-session",
            agent: { kind: "root", agentId: "command-evidence-agent" },
          },
          output: "Completed the requested change.",
          attribution: { kind: "none" },
          tokenUsage: {
            kind: "reported",
            inputTokens: 120,
            outputTokens: 40,
          },
        },
      };
      const response = await fetch(`${endpoint}/v1/supervise`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${hookToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(supervisionEnvelope),
      });
      expect(response.status).toBe(200);
      const supervision: unknown = await response.json();
      expect(supervision).toMatchObject({
        decision: {
          kind: "stop-decision",
          action: "retry",
          evaluation: { kind: "retryable-failure" },
        },
      });
      const serializedSupervision = JSON.stringify(supervision);
      expect(serializedSupervision).not.toContain(sentinel);
      expect(serializedSupervision).toContain("exitCode=2");
      expect(serializedSupervision).toContain(
        "encryptedLocalEvidenceEvent=command-evidence-stop",
      );
      const replayResponse = await fetch(`${endpoint}/v1/supervise`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${hookToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(supervisionEnvelope),
      });
      expect(replayResponse.status).toBe(200);
      expect(await replayResponse.json()).toEqual(supervision);

      const evidenceResponse = await fetch(`${endpoint}/v1/evidence`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${desktopToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ eventId: "command-evidence-stop" }),
      });
      expect(evidenceResponse.status).toBe(200);
      expect(JSON.stringify(await evidenceResponse.json())).toContain(sentinel);

      const metadataFiles = (await readdir(dataDirectory)).filter((name) =>
        name.startsWith("metadata.sqlite"),
      );
      expect(metadataFiles).toEqual(
        expect.arrayContaining([
          "metadata.sqlite",
          "metadata.sqlite-wal",
          "metadata.sqlite-shm",
        ]),
      );
      for (const name of metadataFiles) {
        const bytes = await readFile(join(dataDirectory, name));
        expect(bytes.includes(Buffer.from(sentinel, "utf8"))).toBe(false);
      }
      const evidenceFiles = await readdir(join(dataDirectory, "evidence"));
      expect(evidenceFiles.length).toBeGreaterThan(0);
      for (const name of evidenceFiles) {
        const bytes = await readFile(join(dataDirectory, "evidence", name));
        expect(bytes.includes(Buffer.from(sentinel, "utf8"))).toBe(false);
      }
    } finally {
      await application.close();
    }
  });
});
