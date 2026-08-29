import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Server } from "node:http";

import { createSupervisionKernel, type DeterministicEvaluator } from "@sisyphus/kernel";

import type { WorkerConfiguration } from "./config.js";
import { ActivationLeaseAuthority } from "./activation-lease.js";
import { EncryptedEvidenceVault } from "./evidence-vault.js";
import { LocalEvidenceBroker } from "./evidence-broker.js";
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
import {
  StaticRuntimeInstallationRegistry,
  builtInCodexV1Installation,
} from "./runtime-installation-registry.js";
import { createWorkerHttpServer } from "./server.js";
import { SQLiteSupervisionStore } from "./sqlite-store.js";
import { WorkerSupervisor } from "./supervisor.js";

interface CreateWorkerApplicationInput {
  readonly configuration: WorkerConfiguration;
  readonly evidenceKey: Uint8Array;
  readonly onError?: ((error: unknown) => void) | undefined;
}

export interface WorkerApplication {
  readonly server: Server;
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
  await mkdir(input.configuration.dataDirectory, { recursive: true });
  const databasePath = join(input.configuration.dataDirectory, "metadata.sqlite");
  const journal = new LocalJournal({ path: databasePath });
  const kernelStore = new SQLiteSupervisionStore({ path: databasePath });
  const evidenceVault = new EncryptedEvidenceVault({
    directory: join(input.configuration.dataDirectory, "evidence"),
    key: input.evidenceKey,
  });
  const mutablePolicyProvider = new MutablePolicyProvider(
    input.configuration.policy.constraint,
    {
      profile: input.configuration.controlPlane?.policyIdentity?.profile ?? "local",
    },
  );
  const deterministicEvaluators: DeterministicEvaluator[] = [
    new CompletionGuardEvaluator(input.configuration.policy.completionGuards),
    ...input.configuration.policy.deterministicChecks.map(
      (check) => new CommandEvaluator(check),
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
  const supervisor = new WorkerSupervisor({
    journal,
    kernel,
    evidenceVault,
    policyProvider,
    leaseAuthority,
    runtimeInstallations: new StaticRuntimeInstallationRegistry([
      builtInCodexV1Installation(),
    ]),
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

  return {
    server,
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
