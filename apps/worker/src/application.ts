import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Server } from "node:http";

import {
  codexCapabilities,
  probeCodexRuntimeVersion,
} from "@sisyphus/adapter-codex";
import { createAdapterVersion } from "@sisyphus/domain";
import {
  DEFAULT_JUDGE_TIMEOUT_MILLISECONDS,
  createSupervisionKernel,
  type DeterministicEvaluator,
} from "@sisyphus/kernel";

import type { WorkerConfiguration } from "./config.js";
import { ActivationLeaseAuthority } from "./activation-lease.js";
import { EncryptedEvidenceVault } from "./evidence-vault.js";
import { LocalEvidenceBroker } from "./evidence-broker.js";
import { EvaluationEvidenceCollector } from "./evaluation-evidence.js";
import { CommandEvaluator, CompletionGuardEvaluator } from "./evaluators.js";
import { HostedJudge } from "./hosted-judge.js";
import { LocalJournal } from "./journal.js";
import {
  ManagedCatalogPolicyProvider,
  createManagedSkillCatalog,
} from "./managed-catalog.js";
import { createMcpRequestHandler } from "./mcp.js";
import { OutboxSynchronizer } from "./outbox-sync.js";
import { MutablePolicyProvider, PolicyBundleSynchronizer } from "./policy.js";
import { StaticRuntimeInstallationRegistry } from "./runtime-installation-registry.js";
import { createWorkerHttpServer } from "./server.js";
import { SQLiteSupervisionStore } from "./sqlite-store.js";
import { WorkerSupervisor } from "./supervisor.js";

interface CreateWorkerApplicationInput {
  readonly configuration: WorkerConfiguration;
  readonly evidenceKey: Uint8Array;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly codexRuntimeVersionProbe?: (() => Promise<string>) | undefined;
}

export interface WorkerApplication {
  readonly server: Server;
  prepare(): Promise<
    | { readonly kind: "not-configured" }
    | { readonly kind: "refreshed" }
    | { readonly kind: "restored"; readonly reason: string }
  >;
  synchronize(): Promise<{ readonly outboxRecords: number; readonly policyUpdated: boolean }>;
  close(): Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function createWorkerApplication(
  input: CreateWorkerApplicationInput,
): Promise<WorkerApplication> {
  if (input.configuration.runtimeInstallation.profile !== "local") {
    throw new Error("The bundled Codex adapter supports only the local runtime profile.");
  }
  let codexRuntimeVersion: string | undefined;
  try {
    codexRuntimeVersion = await (
      input.codexRuntimeVersionProbe ?? probeCodexRuntimeVersion
    )();
  } catch (error: unknown) {
    input.onError?.(
      new Error(
        "Codex adapter setup is required; no concrete Codex runtime version was detected.",
        { cause: error },
      ),
    );
  }
  await mkdir(input.configuration.dataDirectory, { recursive: true });
  const databasePath = join(input.configuration.dataDirectory, "metadata.sqlite");
  const journal = new LocalJournal({ path: databasePath });
  const kernelStore = new SQLiteSupervisionStore({ path: databasePath });
  const evidenceVault = new EncryptedEvidenceVault({
    directory: join(input.configuration.dataDirectory, "evidence"),
    key: input.evidenceKey,
  });
  const evaluationEvidence = new EvaluationEvidenceCollector();
  const mutablePolicyProvider = new MutablePolicyProvider(
    input.configuration.policy.constraint,
  );
  const deterministicEvaluators: DeterministicEvaluator[] = [
    new CompletionGuardEvaluator(input.configuration.policy.completionGuards),
    ...input.configuration.policy.deterministicChecks.map(
      (check) =>
        new CommandEvaluator({
          configuration: check,
          evidenceCollector: evaluationEvidence,
        }),
    ),
  ];
  const controlPlane = input.configuration.controlPlane;
  const judge =
    controlPlane === undefined
      ? undefined
      : new HostedJudge({
          endpoint: controlPlane.endpoint,
          deviceToken: controlPlane.deviceToken,
          timeoutMilliseconds: 15_000,
        });
  const kernel = createSupervisionKernel({
    store: kernelStore,
    deterministicEvaluators,
    judge,
    judgeTimeoutMs: DEFAULT_JUDGE_TIMEOUT_MILLISECONDS,
    advisoryResults: {
      async record(advisory) {
        journal.recordLateAdvisory(advisory);
      },
    },
  });
  const managedCatalog = await createManagedSkillCatalog(
    input.configuration.policy.managedCatalog,
  );
  const policyProvider = new ManagedCatalogPolicyProvider({
    base: mutablePolicyProvider,
    catalog: managedCatalog,
    standing: {
      async dispositionFor(skillVersionId) {
        return (await kernel.getSkillStanding(skillVersionId)).disposition;
      },
    },
  });
  const leaseAuthority = new ActivationLeaseAuthority({ key: input.evidenceKey });
  const runtimeInstallations =
    codexRuntimeVersion === undefined
      ? []
      : [
          {
            installationIdentity: input.configuration.runtimeInstallation,
            adapterVersion: createAdapterVersion("0.1.0"),
            capabilities: codexCapabilities(codexRuntimeVersion),
          },
        ];
  const supervisor = new WorkerSupervisor({
    journal,
    kernel,
    evidenceVault,
    evaluationEvidence,
    policyProvider,
    leaseAuthority,
    runtimeInstallations: new StaticRuntimeInstallationRegistry(runtimeInstallations),
  });
  const server = createWorkerHttpServer({
    hookToken: input.configuration.hookToken,
    mcpToken: input.configuration.mcpToken,
    supervisor,
    mcpHandler: createMcpRequestHandler({
      journal,
      mcpToken: input.configuration.mcpToken,
      instructionForSkill: ({ runtime, skillVersionId }) =>
        managedCatalog.instructionFor(runtime, skillVersionId),
    }),
    ...(input.configuration.desktopToken === undefined
      ? {}
      : {
          desktopToken: input.configuration.desktopToken,
          evidenceBroker: new LocalEvidenceBroker({
            journal,
            vault: evidenceVault,
          }),
        }),
    onError: input.onError,
  });
  const outbox =
    controlPlane === undefined
      ? undefined
      : new OutboxSynchronizer({
          endpoint: controlPlane.endpoint,
          deviceToken: controlPlane.deviceToken,
          journal,
        });
  const policy =
    controlPlane === undefined ||
    controlPlane.policyIdentity === undefined ||
    Object.keys(controlPlane.trustedPolicyKeys).length === 0
      ? undefined
      : new PolicyBundleSynchronizer({
          endpoint: controlPlane.endpoint,
          deviceToken: controlPlane.deviceToken,
          provider: mutablePolicyProvider,
          publicKeys: controlPlane.trustedPolicyKeys,
          identity: controlPlane.policyIdentity,
          stateStore: journal,
          transitionApplier: kernel,
        });
  let preparation:
    | Promise<
        | { readonly kind: "not-configured" }
        | { readonly kind: "refreshed" }
        | { readonly kind: "restored"; readonly reason: string }
      >
    | undefined;

  return {
    server,
    prepare() {
      preparation ??= (async () => {
        if (policy === undefined) return { kind: "not-configured" } as const;
        let restored = false;
        let restoreError: unknown;
        try {
          restored = (await policy.restore()) !== undefined;
        } catch (error: unknown) {
          restoreError = error;
        }
        try {
          await policy.refresh();
          return { kind: "refreshed" } as const;
        } catch (refreshError: unknown) {
          if (restored) {
            return {
              kind: "restored",
              reason:
                refreshError instanceof Error
                  ? refreshError.message
                  : "policy refresh failed",
            } as const;
          }
          throw new AggregateError(
            [restoreError, refreshError].filter((error) => error !== undefined),
            "No valid signed policy bundle is available; worker startup is blocked.",
          );
        }
      })();
      return preparation;
    },
    async synchronize() {
      const outboxRecords = await outbox?.flush();
      const updatedPolicy = await policy?.refresh();
      return {
        outboxRecords: outboxRecords ?? 0,
        policyUpdated: updatedPolicy !== undefined,
      };
    },
    async close() {
      await closeServer(server);
      journal.close();
      kernelStore.close();
    },
  };
}
