import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadWorkerConfiguration } from "./config.js";

const hookToken = "hook_token_0123456789abcdefghijklmnopqrstuvwxyz";
const mcpToken = "mcp_token_0123456789abcdefghijklmnopqrstuvwxyz0";

describe("loadWorkerConfiguration", () => {
  it("validates a local policy file and control-plane settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-config-"));
    const policyPath = join(directory, "policy.json");
    await writeFile(
      policyPath,
      JSON.stringify({
        constraint: {
          policyId: "policy-1",
          policyVersionId: "policy-version-1",
          requiredCapabilities: [],
          skillCandidates: [],
          toolPolicy: { kind: "allow" },
        },
        deterministicChecks: [],
        completionGuards: {
          maximumOutputTokens: 500,
          requiredEvidencePatterns: ["tests passed"],
        },
      }),
    );

    const config = await loadWorkerConfiguration({
      environment: {
        SISYPHUS_DATA_DIR: directory,
        SISYPHUS_HOOK_TOKEN: hookToken,
        SISYPHUS_MCP_TOKEN: mcpToken,
        SISYPHUS_WORKER_PORT: "7441",
        SISYPHUS_POLICY_FILE: policyPath,
        SISYPHUS_CONTROL_PLANE_URL: "https://sisyphus.example.com",
        SISYPHUS_DEVICE_TOKEN: "device-token",
        SISYPHUS_POLICY_PUBLIC_KEYS: JSON.stringify({ team: "public-key-pem" }),
        SISYPHUS_TENANT_ID: "tenant-acme",
        SISYPHUS_DEVICE_ID: "device-delta",
        SISYPHUS_ADAPTER_INSTALLATION_ID: "installation-codex-local",
        SISYPHUS_ADAPTER_CONFIGURATION_DIGEST: "a".repeat(64),
      },
    });

    expect(config).toMatchObject({
      dataDirectory: directory,
      host: "127.0.0.1",
      port: 7441,
      hookToken,
      mcpToken,
      policy: {
        constraint: { policyVersionId: "policy-version-1" },
        completionGuards: { maximumOutputTokens: 500 },
      },
      controlPlane: {
        endpoint: "https://sisyphus.example.com",
        deviceToken: "device-token",
        trustedPolicyKeys: { team: "public-key-pem" },
      },
    });
  });

  it("rejects partial cloud credentials", async () => {
    await expect(
      loadWorkerConfiguration({
        environment: {
          SISYPHUS_HOOK_TOKEN: hookToken,
          SISYPHUS_MCP_TOKEN: mcpToken,
          SISYPHUS_CONTROL_PLANE_URL: "https://sisyphus.example.com",
        },
      }),
    ).rejects.toThrow("together");
  });

  it("requires distinct high-entropy hook and MCP credentials", async () => {
    await expect(
      loadWorkerConfiguration({ environment: {} }),
    ).rejects.toThrow("SISYPHUS_HOOK_TOKEN");

    await expect(
      loadWorkerConfiguration({
        environment: {
          SISYPHUS_HOOK_TOKEN: "short",
          SISYPHUS_MCP_TOKEN: mcpToken,
        },
      }),
    ).rejects.toThrow();

    await expect(
      loadWorkerConfiguration({
        environment: {
          SISYPHUS_HOOK_TOKEN: hookToken,
          SISYPHUS_MCP_TOKEN: hookToken,
        },
      }),
    ).rejects.toThrow("must differ");
  });
});
