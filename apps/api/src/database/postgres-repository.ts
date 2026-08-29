import { createHash } from "node:crypto";
import {
  CloudSupervisionEnvelopeSchema,
  SignedPolicyBundleSchema,
} from "@sisyphus/domain";
import type {
  DashboardQuery,
  DashboardSnapshot,
  RestoreSkillResponse,
} from "@sisyphus/ui/contracts";
import { filterDashboardSnapshot } from "@sisyphus/ui/demo";
import type { AuthContext } from "../auth.js";
import {
  InactiveDeviceError,
  IngestCollisionError,
  InvalidStateTransitionError,
  assertRuntimeInstallationMatches,
  type ControlPlaneRepository,
  type PolicyBundleIssuance,
} from "../repository.js";
import type { SecretCipher } from "../secret-cipher.js";
import {
  assertPostgresMigrationRole,
  grantPostgresApplicationRole,
} from "./grants.js";
import { migratePostgres } from "./migrate.js";
import {
  PostgresInactiveDeviceError,
  PostgresIngestCollisionError,
  PostgresStateTransitionError,
  PostgresTenantDatabase,
} from "./tenant-database.js";

const readyRepositories = new WeakSet<ControlPlaneRepository>();

class PostgresControlPlaneRepository implements ControlPlaneRepository {
  public readonly persistenceKind = "postgres" as const;

  public constructor(
    private readonly database: PostgresTenantDatabase,
    private readonly secretCipher: SecretCipher,
  ) {}

  public async health(): Promise<void> {
    await this.database.ping();
  }

  public async close(): Promise<void> {
    await this.database.close();
  }

  public async resolveCredential(token: string): Promise<AuthContext | undefined> {
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    return this.database.resolveCredentialHash(tokenHash);
  }

  public async dashboard(
    tenantId: string,
    query: DashboardQuery,
  ): Promise<DashboardSnapshot | undefined> {
    const snapshot = await this.database.dashboard(tenantId);
    return snapshot === undefined
      ? undefined
      : filterDashboardSnapshot(snapshot, query);
  }

  public async restoreSkill(input: {
    tenantId: string;
    actor: string;
    skillVersionId: string;
    reason: string;
  }): Promise<RestoreSkillResponse | undefined> {
    try {
      return await this.database.restoreSkill(input);
    } catch (error: unknown) {
      if (error instanceof PostgresStateTransitionError) {
        throw new InvalidStateTransitionError(error.message);
      }
      throw error;
    }
  }

  public async ingestBatch(input: {
    auth: Extract<AuthContext, { kind: "device" }>;
    records: Parameters<ControlPlaneRepository["ingestBatch"]>[0]["records"];
  }): Promise<string[]> {
    const records = CloudSupervisionEnvelopeSchema.array()
      .min(1)
      .max(100)
      .parse(input.records);
    assertRuntimeInstallationMatches({
      adapterInstallationId: input.auth.adapterInstallationId,
      records,
    });
    try {
      return await this.database.ingestBatch({
        tenantId: input.auth.tenantId,
        deviceId: input.auth.subjectId,
        adapterInstallationId: input.auth.adapterInstallationId,
        records,
      });
    } catch (error: unknown) {
      if (error instanceof PostgresIngestCollisionError) {
        throw new IngestCollisionError(error.eventId);
      }
      if (error instanceof PostgresInactiveDeviceError) {
        throw new InactiveDeviceError(error.message);
      }
      throw error;
    }
  }

  public async configureJudgeProvider(input: {
    tenantId: string;
    apiKey: string;
    model: string;
  }): Promise<boolean> {
    return this.database.configureJudgeProvider({
      tenantId: input.tenantId,
      model: input.model,
      encryptedApiKey: this.secretCipher.encrypt(
        input.apiKey,
        `judge-provider:${input.tenantId}`,
      ),
    });
  }

  public async judgeProviderConfiguration(
    tenantId: string,
  ): Promise<{ apiKey: string; model: string } | undefined> {
    const stored = await this.database.judgeProviderConfiguration(tenantId);
    return stored === undefined
      ? undefined
      : {
          model: stored.model,
          apiKey: this.secretCipher.decrypt(
            stored.encryptedApiKey,
            `judge-provider:${tenantId}`,
          ),
        };
  }

  public async claimJudgeRequest(
    input: Parameters<ControlPlaneRepository["claimJudgeRequest"]>[0],
  ): ReturnType<ControlPlaneRepository["claimJudgeRequest"]> {
    return this.database.claimJudgeRequest(input);
  }

  public async completeJudgeRequest(
    input: Parameters<ControlPlaneRepository["completeJudgeRequest"]>[0],
  ): ReturnType<ControlPlaneRepository["completeJudgeRequest"]> {
    return this.database.completeJudgeRequest(input);
  }

  public async judgeRequestResult(
    input: Parameters<ControlPlaneRepository["judgeRequestResult"]>[0],
  ): ReturnType<ControlPlaneRepository["judgeRequestResult"]> {
    return this.database.judgeRequestResult(input);
  }

  public async issuePolicyBundle(
    input: Parameters<ControlPlaneRepository["issuePolicyBundle"]>[0],
  ): Promise<PolicyBundleIssuance | undefined> {
    return this.database.issuePolicyBundle(input);
  }

  public async recordSignedPolicyBundle(input: {
    tenantId: string;
    bundle: Parameters<ControlPlaneRepository["recordSignedPolicyBundle"]>[0]["bundle"];
  }): Promise<void> {
    const bundle = SignedPolicyBundleSchema.parse(input.bundle);
    if (bundle.payload.tenantId !== input.tenantId) {
      throw new Error("The signed policy bundle tenant does not match repository state.");
    }
    await this.database.recordSignedPolicyBundle({
      tenantId: input.tenantId,
      bundle,
    });
  }
}

export async function createPostgresControlPlaneRepository(input: {
  applicationDatabaseUrl: string;
  migrationDatabaseUrl: string;
  secretCipher: SecretCipher;
}): Promise<ControlPlaneRepository> {
  await assertPostgresMigrationRole(input);
  await migratePostgres(input.migrationDatabaseUrl);
  await grantPostgresApplicationRole({
    migrationDatabaseUrl: input.migrationDatabaseUrl,
    applicationDatabaseUrl: input.applicationDatabaseUrl,
  });
  const database = new PostgresTenantDatabase(input.applicationDatabaseUrl);
  try {
    await database.assertProductionReady();
  } catch (error: unknown) {
    await database.close();
    throw error;
  }
  const repository = new PostgresControlPlaneRepository(
    database,
    input.secretCipher,
  );
  readyRepositories.add(repository);
  return repository;
}

export function isReadyPostgresControlPlaneRepository(
  repository: ControlPlaneRepository,
): boolean {
  return readyRepositories.has(repository);
}
