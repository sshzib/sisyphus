import { once } from "node:events";
import { readFileSync } from "node:fs";

import {
  CODEX_PLUGIN_COMMAND_TIMEOUT_MILLISECONDS,
  CODEX_RUNTIME_VERSION_PROBE_TIMEOUT_MILLISECONDS,
  CODEX_SUPERVISION_FETCH_TIMEOUT_MILLISECONDS,
  CODEX_WORKER_CHALLENGE_TIMEOUT_MILLISECONDS,
  CodexSupervisionEnvelopeSchema,
  createCodexAdapter,
  runCodexHook,
} from "@sisyphus/adapter-codex";
import {
  createRuntimeInstallationIdentity,
  parseEvaluationConstraint,
  type SupervisionDecision,
} from "@sisyphus/domain";
import {
  DEFAULT_JUDGE_TIMEOUT_MILLISECONDS,
  createInMemoryKernel,
} from "@sisyphus/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseLocalBearerToken } from "./local-auth.js";
import { createWorkerHttpServer } from "./server.js";

const hookToken = parseLocalBearerToken(
  "hook_token_0123456789abcdefghijklmnopqrstuvwxyz",
);
const installationIdentity = createRuntimeInstallationIdentity({
  adapterInstallationId: "timeout-budget-installation",
  profile: "local",
});
const stopFixture: unknown = JSON.parse(
  readFileSync(
    new URL("../../../adapters/codex/test/fixtures/stop.json", import.meta.url),
    "utf8",
  ),
);
const HookConfigurationSchema = z.object({
  hooks: z.record(
    z.string(),
    z.array(
      z.object({
        hooks: z.array(z.object({ timeout: z.number() }).passthrough()),
      }).passthrough(),
    ),
  ),
}).passthrough();
const rawHookConfiguration: unknown = JSON.parse(
  readFileSync(
    new URL("../../../plugins/sisyphus-codex/hooks/hooks.json", import.meta.url),
    "utf8",
  ),
);
const hookConfiguration = HookConfigurationSchema.parse(rawHookConfiguration);

describe("Codex supervision timeout budget", () => {
  const servers: ReturnType<typeof createWorkerHttpServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(async (server) => {
        server.close();
        await once(server, "close");
      }),
    );
  });

  it("nests the judge, HTTP, and plugin deadlines with startup margin", () => {
    expect(DEFAULT_JUDGE_TIMEOUT_MILLISECONDS).toBeLessThan(
      CODEX_SUPERVISION_FETCH_TIMEOUT_MILLISECONDS,
    );
    expect(CODEX_SUPERVISION_FETCH_TIMEOUT_MILLISECONDS).toBeLessThan(
      CODEX_PLUGIN_COMMAND_TIMEOUT_MILLISECONDS,
    );
    expect(
      CODEX_RUNTIME_VERSION_PROBE_TIMEOUT_MILLISECONDS +
        CODEX_WORKER_CHALLENGE_TIMEOUT_MILLISECONDS +
        CODEX_SUPERVISION_FETCH_TIMEOUT_MILLISECONDS,
    ).toBeLessThan(CODEX_PLUGIN_COMMAND_TIMEOUT_MILLISECONDS);

    for (const registrations of Object.values(hookConfiguration.hooks)) {
      for (const registration of registrations) {
        for (const hook of registration.hooks) {
          expect(hook.timeout).toBe(
            CODEX_PLUGIN_COMMAND_TIMEOUT_MILLISECONDS / 1_000,
          );
        }
      }
    }
  });

  it("returns the kernel judge-timeout decision through the hook boundary", async () => {
    const judge = {
      evaluate: vi.fn(
        () =>
          new Promise<{ readonly kind: "pass"; readonly score: number }>((resolve) => {
            setTimeout(() => resolve({ kind: "pass", score: 1 }), 150);
          }),
      ),
    };
    const kernel = createInMemoryKernel({ judge, judgeTimeoutMs: 25 });
    const constraint = parseEvaluationConstraint({
      policyId: "timeout-policy",
      policyVersionId: "timeout-policy-v1",
      requiredCapabilities: [],
      skillCandidates: [],
      toolPolicy: { kind: "allow" },
    });
    let returnedDecision: SupervisionDecision | undefined;
    const server = createWorkerHttpServer({
      hookToken,
      mcpToken: parseLocalBearerToken(
        "mcp_token_0123456789abcdefghijklmnopqrstuvwxyz0",
      ),
      supervisor: {
        async supervise(input) {
          const envelope = CodexSupervisionEnvelopeSchema.parse(input);
          returnedDecision = await kernel.supervise(envelope.event, constraint);
          return { decision: returnedDecision };
        },
      },
      mcpHandler: (_request, response) => response.writeHead(204).end(),
    });
    server.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Missing worker port.");
    }

    await expect(
      runCodexHook({
        rawEvent: stopFixture,
        workerToken: hookToken,
        workerEndpoint: `http://127.0.0.1:${address.port}`,
        adapter: createCodexAdapter({
          runtimeVersion: "0.99.0",
          installationIdentity,
        }),
      }),
    ).resolves.toEqual({ continue: true });
    expect(judge.evaluate).toHaveBeenCalledOnce();
    expect(returnedDecision).toMatchObject({
      kind: "stop-decision",
      action: "allow",
      evaluation: {
        kind: "inconclusive",
        reason: "judge exceeded 25ms deadline",
      },
    });
  });
});
