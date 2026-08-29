import { createHash, randomUUID } from "node:crypto";
import {
  CloudSupervisionEnvelopeSchema,
  JudgeResultSchema,
  SignedPolicyBundleSchema,
  SkillDispositionTransitionSchema,
  type AdapterConfigurationDigest,
  type CloudEvaluationMetadata,
  type CloudSupervisionEnvelope,
  type JudgeResult,
  type SignedPolicyBundle,
  type SkillDispositionTransition,
} from "@sisyphus/domain";
import {
  AuditEventSchema,
  DashboardSnapshotSchema,
  RestoreSkillResponseSchema,
  type AuditEvent,
  type DashboardSnapshot,
  type RestoreSkillResponse,
} from "@sisyphus/ui/contracts";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { canonicalJson } from "../canonical-json.js";
import {
  applyDispositionTransition,
  projectAcceptedCloudRecords,
} from "../projection.js";
import type { JudgeRequestClaim } from "../judge.js";
import {
  EncryptedSecretSchema,
  type EncryptedSecret,
} from "../secret-cipher.js";
import * as schema from "./schema.js";
import { latestMigrationTimestamp } from "./migrate.js";

type Database = PostgresJsDatabase<typeof schema>;
type TransactionCallback = Parameters<Database["transaction"]>[0];
export type TenantTransaction = Parameters<TransactionCallback>[0];

export type StoredAuthCredential =
  | {
      kind: "user";
      tenantId: string;
      subjectId: string;
      role: "admin" | "member" | "viewer";
    }
  | {
      kind: "device";
      tenantId: string;
      subjectId: string;
      role: "device";
      adapterInstallationId: string;
    };

export interface StoredJudgeProviderConfiguration {
  model: string;
  encryptedApiKey: EncryptedSecret;
}

export interface StoredPolicyBundleIssuance {
  tenantId: string;
  deviceId: string;
  adapterInstallationId: string;
  revision: number;
  adapterConfigurationDigest: AdapterConfigurationDigest;
  dispositionTransitions: SkillDispositionTransition[];
  snapshot: DashboardSnapshot;
}

export class PostgresIngestCollisionError extends Error {
  public constructor(public readonly eventId: string) {
    super(`Event ${eventId} was already ingested with a different payload.`);
    this.name = "PostgresIngestCollisionError";
  }
}

export class PostgresStateTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PostgresStateTransitionError";
  }
}

const tenantRlsTables = [
  "tenants",
  "devices",
  "runs",
  "evaluations",
  "skill_dispositions",
  "policy_bundles",
  "judge_provider_configs",
  "judge_requests",
  "ingest_events",
  "ingest_outbox",
  "disposition_transitions",
  "dashboard_projections",
  "tenant_policy_states",
] as const;

const tenantPolicyNames = new Map<string, string>([
  ["tenants", "tenant_self"],
  ["devices", "tenant_devices"],
  ["runs", "tenant_runs"],
  ["evaluations", "tenant_evaluations"],
  ["skill_dispositions", "tenant_skill_dispositions"],
  ["policy_bundles", "tenant_policy_bundles"],
  ["judge_provider_configs", "tenant_judge_provider_configs"],
  ["judge_requests", "tenant_judge_requests"],
  ["ingest_events", "tenant_ingest_events"],
  ["ingest_outbox", "tenant_ingest_outbox"],
  ["disposition_transitions", "tenant_disposition_transitions"],
  ["dashboard_projections", "tenant_dashboard_projections"],
  ["tenant_policy_states", "tenant_policy_states"],
]);

function evaluationResult(
  evaluation: CloudEvaluationMetadata,
): "pass" | "retryable-failure" | "terminal-failure" | "inconclusive" {
  return evaluation.kind === "late" ? "inconclusive" : evaluation.kind;
}

function evaluationScore(evaluation: CloudEvaluationMetadata): string | null {
  switch (evaluation.kind) {
    case "pass":
    case "retryable-failure":
    case "terminal-failure":
      return evaluation.score.toString();
    case "late":
      return evaluation.advisory.score.toString();
    case "inconclusive":
      return null;
    default: {
      const exhaustive: never = evaluation;
      return exhaustive;
    }
  }
}

function evaluationFindings(evaluation: CloudEvaluationMetadata) {
  switch (evaluation.kind) {
    case "retryable-failure":
    case "terminal-failure":
      return evaluation.findings;
    case "late":
      return evaluation.advisory.kind === "fail"
        ? evaluation.advisory.findings
        : [];
    case "pass":
    case "inconclusive":
      return [];
    default: {
      const exhaustive: never = evaluation;
      return exhaustive;
    }
  }
}

function tokenCount(record: CloudSupervisionEnvelope["payload"]): number {
  if (record.kind !== "completion" || record.tokenUsage.kind === "unavailable") {
    return 0;
  }
  return record.tokenUsage.inputTokens + record.tokenUsage.outputTokens;
}

function adapterConfigurationDigest(
  snapshot: DashboardSnapshot,
): AdapterConfigurationDigest {
  const configuration = snapshot.integrations
    .map((integration) => ({
      id: integration.id,
      runtime: integration.runtime,
      scope: integration.scope,
      adapterVersion: integration.adapterVersion,
      runtimeVersion: integration.runtimeVersion,
      capabilities: integration.capabilities,
    }))
    .sort((left, right) => {
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });
  return createHash("sha256")
    .update(canonicalJson(configuration))
    .digest("hex");
}

async function appendDispositionTransition(input: {
  transaction: TenantTransaction;
  tenantId: string;
  kind: SkillDispositionTransition["kind"];
  skillVersionId: string;
  reason: string;
  actor: string;
  occurredAt: string;
}): Promise<SkillDispositionTransition> {
  await input.transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.tenantId}, 0))`,
  );
  const latest = await input.transaction
    .select({ revision: schema.dispositionTransitions.revision })
    .from(schema.dispositionTransitions)
    .where(eq(schema.dispositionTransitions.tenantId, input.tenantId))
    .orderBy(desc(schema.dispositionTransitions.revision))
    .limit(1);
  const latestForSkill = await input.transaction
    .select({ kind: schema.dispositionTransitions.kind })
    .from(schema.dispositionTransitions)
    .where(
      and(
        eq(schema.dispositionTransitions.tenantId, input.tenantId),
        eq(
          schema.dispositionTransitions.skillVersionId,
          input.skillVersionId,
        ),
      ),
    )
    .orderBy(desc(schema.dispositionTransitions.revision))
    .limit(1);
  if (
    latestForSkill[0]?.kind === "revocation" &&
    input.kind !== "revocation"
  ) {
    throw new Error("A revoked skill version cannot transition back to service.");
  }
  const transition = SkillDispositionTransitionSchema.parse({
    kind: input.kind,
    skillVersionId: input.skillVersionId,
    reason: input.reason,
    actor: input.actor,
    occurredAt: input.occurredAt,
    revision: (latest[0]?.revision ?? 0) + 1,
  });
  await input.transaction.insert(schema.dispositionTransitions).values({
    tenantId: input.tenantId,
    skillVersionId: transition.skillVersionId,
    kind: transition.kind,
    reason: transition.reason,
    actor: transition.actor,
    revision: transition.revision,
    occurredAt: new Date(transition.occurredAt),
  });
  const disposition = (() => {
    switch (transition.kind) {
      case "quarantine":
        return "quarantined" as const;
      case "probation":
      case "restoration":
        return "probation" as const;
      case "revocation":
        return "revoked" as const;
      default: {
        const exhaustive: never = transition;
        return exhaustive;
      }
    }
  })();
  await input.transaction.insert(schema.skillDispositions).values({
    tenantId: input.tenantId,
    skillVersionId: transition.skillVersionId,
    disposition,
    reason: transition.reason,
    changedBy: transition.actor,
    revision: transition.revision,
    changedAt: new Date(transition.occurredAt),
  });
  return transition;
}

export class PostgresTenantDatabase {
  readonly #client: Sql;
  readonly #database: Database;

  public constructor(connectionUrl: string) {
    this.#client = postgres(connectionUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    this.#database = drizzle(this.#client, { schema });
  }

  public async assertProductionReady(): Promise<void> {
    const migrationRows = await this.#client<{ latest: string | null }[]>`
      select max(created_at)::text as latest
      from drizzle.__drizzle_migrations
    `;
    const latestMigration = Number(migrationRows[0]?.latest ?? Number.NaN);
    if (latestMigration < latestMigrationTimestamp) {
      throw new Error(
        "PostgreSQL readiness failed: the control-plane migration head is not applied.",
      );
    }
    const roles = await this.#client<
      { roleName: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`
      select rolname as "roleName", rolsuper, rolbypassrls
      from pg_roles
      where rolname = current_user
    `;
    const role = roles[0];
    if (role === undefined || role.rolsuper || role.rolbypassrls) {
      throw new Error(
        "The PostgreSQL application role must exist and must not be SUPERUSER or BYPASSRLS.",
      );
    }

    const rows = await this.#client<
      {
        relname: string;
        ownerName: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }[]
    >`
      select
        c.relname,
        pg_get_userbyid(c.relowner) as "ownerName",
        c.relrowsecurity,
        c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema()
        and c.relname in ${this.#client(tenantRlsTables)}
    `;
    const byName = new Map(rows.map((row) => [row.relname, row]));
    const unsafeTable = tenantRlsTables.find((table) => {
      const row = byName.get(table);
      return (
        row === undefined ||
        !row.relrowsecurity ||
        !row.relforcerowsecurity ||
        row.ownerName === role.roleName
      );
    });
    if (unsafeTable !== undefined) {
      throw new Error(
        `PostgreSQL readiness failed: ${unsafeTable} must have enabled and forced row-level security and must be owned by the migration role.`,
      );
    }

    const credentialRows = await this.#client<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      select relrowsecurity, relforcerowsecurity
      from pg_class
      where oid = 'api_credentials'::regclass
    `;
    const credentialTable = credentialRows[0];
    if (
      credentialTable === undefined ||
      !credentialTable.relrowsecurity ||
      !credentialTable.relforcerowsecurity
    ) {
      throw new Error(
        "PostgreSQL readiness failed: api_credentials must have enabled and forced row-level security.",
      );
    }

    const policies = await this.#client<
      { tablename: string; policyname: string; command: string }[]
    >`
      select tablename, policyname, cmd as command
      from pg_policies
      where schemaname = current_schema()
    `;
    const policiesByTable = new Map(
      policies.map((policy) => [policy.tablename, policy.policyname]),
    );
    const missingPolicy = [...tenantPolicyNames].find(
      ([table, policy]) => policiesByTable.get(table) !== policy,
    );
    if (
      missingPolicy !== undefined ||
      policiesByTable.get("api_credentials") !== "credential_self" ||
      policies.find(
        (policy) => policy.tablename === "api_credentials",
      )?.command !== "SELECT"
    ) {
      throw new Error(
        "PostgreSQL readiness failed: one or more tenant or credential RLS policies are missing.",
      );
    }

    const credentialPrivileges = await this.#client<
      {
        canSelect: boolean;
        canInsert: boolean;
        canUpdate: boolean;
        canDelete: boolean;
      }[]
    >`
      select
        has_table_privilege(current_user, 'api_credentials', 'SELECT') as "canSelect",
        has_table_privilege(current_user, 'api_credentials', 'INSERT') as "canInsert",
        has_table_privilege(current_user, 'api_credentials', 'UPDATE') as "canUpdate",
        has_table_privilege(current_user, 'api_credentials', 'DELETE') as "canDelete"
    `;
    const credentialPrivilege = credentialPrivileges[0];
    if (
      credentialPrivilege === undefined ||
      !credentialPrivilege.canSelect ||
      credentialPrivilege.canInsert ||
      credentialPrivilege.canUpdate ||
      credentialPrivilege.canDelete
    ) {
      throw new Error(
        "PostgreSQL readiness failed: the application role must have read-only api_credentials access.",
      );
    }
  }

  public async ping(): Promise<void> {
    await this.#client`select 1`;
  }

  public async resolveCredentialHash(
    tokenHash: string,
  ): Promise<StoredAuthCredential | undefined> {
    return this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.credential_hash', ${tokenHash}, true)`,
      );
      const rows = await transaction
        .select({
          kind: schema.apiCredentials.kind,
          tenantId: schema.apiCredentials.tenantId,
          subjectId: schema.apiCredentials.subjectId,
          deviceId: schema.apiCredentials.deviceId,
          role: schema.apiCredentials.role,
          adapterInstallationId: schema.apiCredentials.adapterInstallationId,
        })
        .from(schema.apiCredentials)
        .where(
          and(
            eq(schema.apiCredentials.tokenHash, tokenHash),
            isNull(schema.apiCredentials.revokedAt),
          ),
        )
        .limit(1);
      const stored = rows[0];
      if (stored === undefined) {
        return undefined;
      }
      if (stored.kind === "user") {
        if (
          stored.subjectId === null ||
          stored.deviceId !== null ||
          stored.role === "device" ||
          stored.adapterInstallationId !== null
        ) {
          throw new Error("The stored user credential has an invalid shape.");
        }
        return {
          kind: "user",
          tenantId: stored.tenantId,
          subjectId: stored.subjectId,
          role: stored.role,
        };
      }
      if (
        stored.subjectId !== null ||
        stored.deviceId === null ||
        stored.role !== "device" ||
        stored.adapterInstallationId === null
      ) {
        throw new Error("The stored device credential has an invalid shape.");
      }
      return {
        kind: "device",
        tenantId: stored.tenantId,
        subjectId: stored.deviceId,
        role: "device",
        adapterInstallationId: stored.adapterInstallationId,
      };
    });
  }

  public async withTenant<T>(input: {
    tenantId: string;
    operation: (transaction: TenantTransaction) => Promise<T>;
  }): Promise<T> {
    return this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.tenant_id', ${input.tenantId}, true)`,
      );
      return input.operation(transaction);
    });
  }

  public async dashboard(
    tenantId: string,
  ): Promise<DashboardSnapshot | undefined> {
    return this.withTenant({
      tenantId,
      operation: async (transaction) => {
        const rows = await transaction
          .select({ snapshot: schema.dashboardProjections.snapshot })
          .from(schema.dashboardProjections)
          .where(eq(schema.dashboardProjections.tenantId, tenantId))
          .limit(1);
        const stored = rows[0];
        return stored === undefined
          ? undefined
          : DashboardSnapshotSchema.parse(stored.snapshot);
      },
    });
  }

  public async restoreSkill(input: {
    tenantId: string;
    actor: string;
    skillVersionId: string;
    reason: string;
  }): Promise<RestoreSkillResponse | undefined> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const rows = await transaction
          .select({ snapshot: schema.dashboardProjections.snapshot })
          .from(schema.dashboardProjections)
          .where(eq(schema.dashboardProjections.tenantId, input.tenantId))
          .limit(1)
          .for("update");
        const stored = rows[0];
        if (stored === undefined) {
          return undefined;
        }
        const snapshot = DashboardSnapshotSchema.parse(stored.snapshot);
        const skill = snapshot.skills.find(
          (candidate) => candidate.skillVersionId === input.skillVersionId,
        );
        if (skill === undefined) {
          return undefined;
        }
        if (skill.disposition !== "quarantined") {
          throw new PostgresStateTransitionError(
            `${skill.name} is ${skill.disposition} and cannot be restored.`,
          );
        }
        const occurredAt = new Date().toISOString();
        const transition = await appendDispositionTransition({
          transaction,
          tenantId: input.tenantId,
          kind: "restoration",
          skillVersionId: skill.skillVersionId,
          reason: input.reason,
          actor: input.actor,
          occurredAt,
        });
        const transitioned = applyDispositionTransition({ snapshot, transition });
        const restoredSkill = transitioned.skills.find(
          (candidate) => candidate.skillVersionId === skill.skillVersionId,
        );
        if (restoredSkill === undefined) {
          throw new Error("The restored skill disappeared from the projection.");
        }
        const auditEvent: AuditEvent = AuditEventSchema.parse({
          id: randomUUID(),
          occurredAt,
          actor: input.actor,
          action: "skill.restored",
          summary: `${skill.name} restored to probation. ${input.reason}`,
          runtime: skill.runtime,
        });
        const nextSnapshot = DashboardSnapshotSchema.parse({
          ...transitioned,
          generatedAt: occurredAt,
          audit: [auditEvent, ...transitioned.audit],
        });
        await transaction
          .update(schema.dashboardProjections)
          .set({ snapshot: nextSnapshot, updatedAt: new Date() })
          .where(eq(schema.dashboardProjections.tenantId, input.tenantId));
        return RestoreSkillResponseSchema.parse({
          skill: restoredSkill,
          auditEvent,
        });
      },
    });
  }

  public async configureJudgeProvider(input: {
    tenantId: string;
    model: string;
    encryptedApiKey: EncryptedSecret;
  }): Promise<boolean> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const tenantRows = await transaction
          .select({ id: schema.tenants.id })
          .from(schema.tenants)
          .where(eq(schema.tenants.id, input.tenantId))
          .limit(1);
        if (tenantRows[0] === undefined) {
          return false;
        }
        const encryptedApiKey = EncryptedSecretSchema.parse(
          input.encryptedApiKey,
        );
        await transaction
          .insert(schema.judgeProviderConfigs)
          .values({
            tenantId: input.tenantId,
            model: input.model,
            encryptedApiKey,
          })
          .onConflictDoUpdate({
            target: schema.judgeProviderConfigs.tenantId,
            set: {
              model: input.model,
              encryptedApiKey,
              keyEncryptionVersion: encryptedApiKey.version,
              updatedAt: new Date(),
            },
          });
        return true;
      },
    });
  }

  public async judgeProviderConfiguration(
    tenantId: string,
  ): Promise<StoredJudgeProviderConfiguration | undefined> {
    return this.withTenant({
      tenantId,
      operation: async (transaction) => {
        const rows = await transaction
          .select({
            model: schema.judgeProviderConfigs.model,
            encryptedApiKey: schema.judgeProviderConfigs.encryptedApiKey,
          })
          .from(schema.judgeProviderConfigs)
          .where(eq(schema.judgeProviderConfigs.tenantId, tenantId))
          .limit(1);
        const stored = rows[0];
        return stored === undefined
          ? undefined
          : {
              model: stored.model,
              encryptedApiKey: EncryptedSecretSchema.parse(
                stored.encryptedApiKey,
              ),
            };
      },
    });
  }

  public async claimJudgeRequest(input: {
    tenantId: string;
    eventId: string;
    policyVersionId: string;
    inputDigest: string;
    leaseId: string;
    leaseExpiresAt: string;
  }): Promise<JudgeRequestClaim> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const inserted = await transaction
          .insert(schema.judgeRequests)
          .values({
            tenantId: input.tenantId,
            eventId: input.eventId,
            policyVersionId: input.policyVersionId,
            inputDigest: input.inputDigest,
            status: "pending",
            leaseId: input.leaseId,
            leaseExpiresAt: new Date(input.leaseExpiresAt),
            result: null,
          })
          .onConflictDoNothing({
            target: [
              schema.judgeRequests.tenantId,
              schema.judgeRequests.eventId,
              schema.judgeRequests.policyVersionId,
            ],
          })
          .returning({ id: schema.judgeRequests.id });
        if (inserted[0] !== undefined) {
          return { kind: "owner" };
        }
        const rows = await transaction
          .select({
            inputDigest: schema.judgeRequests.inputDigest,
            status: schema.judgeRequests.status,
            leaseExpiresAt: schema.judgeRequests.leaseExpiresAt,
            result: schema.judgeRequests.result,
          })
          .from(schema.judgeRequests)
          .where(
            and(
              eq(schema.judgeRequests.tenantId, input.tenantId),
              eq(schema.judgeRequests.eventId, input.eventId),
              eq(
                schema.judgeRequests.policyVersionId,
                input.policyVersionId,
              ),
            ),
          )
          .limit(1)
          .for("update");
        const stored = rows[0];
        if (stored === undefined) {
          throw new Error("The judge request vanished during claim.");
        }
        if (stored.inputDigest !== input.inputDigest) {
          return { kind: "collision" };
        }
        if (stored.status === "completed") {
          return {
            kind: "completed",
            result: JudgeResultSchema.parse(stored.result),
          };
        }
        if (
          stored.leaseExpiresAt !== null &&
          stored.leaseExpiresAt.getTime() > Date.now()
        ) {
          return { kind: "pending" };
        }
        await transaction
          .update(schema.judgeRequests)
          .set({
            leaseId: input.leaseId,
            leaseExpiresAt: new Date(input.leaseExpiresAt),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.judgeRequests.tenantId, input.tenantId),
              eq(schema.judgeRequests.eventId, input.eventId),
              eq(
                schema.judgeRequests.policyVersionId,
                input.policyVersionId,
              ),
            ),
          );
        return { kind: "owner" };
      },
    });
  }

  public async completeJudgeRequest(input: {
    tenantId: string;
    eventId: string;
    policyVersionId: string;
    inputDigest: string;
    leaseId: string;
    result: JudgeResult;
  }): Promise<JudgeResult> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const rows = await transaction
          .select({
            inputDigest: schema.judgeRequests.inputDigest,
            status: schema.judgeRequests.status,
            leaseId: schema.judgeRequests.leaseId,
            result: schema.judgeRequests.result,
          })
          .from(schema.judgeRequests)
          .where(
            and(
              eq(schema.judgeRequests.tenantId, input.tenantId),
              eq(schema.judgeRequests.eventId, input.eventId),
              eq(
                schema.judgeRequests.policyVersionId,
                input.policyVersionId,
              ),
            ),
          )
          .limit(1)
          .for("update");
        const stored = rows[0];
        if (stored === undefined || stored.inputDigest !== input.inputDigest) {
          throw new Error("The judge request completion does not match its claim.");
        }
        if (stored.status === "completed") {
          return JudgeResultSchema.parse(stored.result);
        }
        if (stored.leaseId !== input.leaseId) {
          throw new Error("The judge request lease is no longer owned by this caller.");
        }
        const result = JudgeResultSchema.parse(input.result);
        await transaction
          .update(schema.judgeRequests)
          .set({
            status: "completed",
            leaseId: null,
            leaseExpiresAt: null,
            result,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.judgeRequests.tenantId, input.tenantId),
              eq(schema.judgeRequests.eventId, input.eventId),
              eq(
                schema.judgeRequests.policyVersionId,
                input.policyVersionId,
              ),
            ),
          );
        return result;
      },
    });
  }

  public async judgeRequestResult(input: {
    tenantId: string;
    eventId: string;
    policyVersionId: string;
    inputDigest: string;
  }): Promise<JudgeResult | "pending" | "collision" | undefined> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const rows = await transaction
          .select({
            inputDigest: schema.judgeRequests.inputDigest,
            status: schema.judgeRequests.status,
            result: schema.judgeRequests.result,
          })
          .from(schema.judgeRequests)
          .where(
            and(
              eq(schema.judgeRequests.tenantId, input.tenantId),
              eq(schema.judgeRequests.eventId, input.eventId),
              eq(
                schema.judgeRequests.policyVersionId,
                input.policyVersionId,
              ),
            ),
          )
          .limit(1);
        const stored = rows[0];
        if (stored === undefined) {
          return undefined;
        }
        if (stored.inputDigest !== input.inputDigest) {
          return "collision";
        }
        return stored.status === "completed"
          ? JudgeResultSchema.parse(stored.result)
          : "pending";
      },
    });
  }

  public async issuePolicyBundle(input: {
    tenantId: string;
    deviceId: string;
    adapterInstallationId: string;
  }): Promise<StoredPolicyBundleIssuance | undefined> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const devices = await transaction
          .select({
            adapterInstallationId: schema.devices.adapterInstallationId,
          })
          .from(schema.devices)
          .where(
            and(
              eq(schema.devices.tenantId, input.tenantId),
              eq(schema.devices.id, input.deviceId),
              isNull(schema.devices.revokedAt),
            ),
          )
          .limit(1);
        if (
          devices[0]?.adapterInstallationId !== input.adapterInstallationId
        ) {
          throw new Error(
            "The policy bundle audience is not an active enrolled installation.",
          );
        }
        const projections = await transaction
          .select({ snapshot: schema.dashboardProjections.snapshot })
          .from(schema.dashboardProjections)
          .where(eq(schema.dashboardProjections.tenantId, input.tenantId))
          .limit(1)
          .for("update");
        const storedProjection = projections[0];
        if (storedProjection === undefined) {
          return undefined;
        }
        const snapshot = DashboardSnapshotSchema.parse(storedProjection.snapshot);
        const digest = adapterConfigurationDigest(snapshot);
        const policyRows = await transaction
          .insert(schema.tenantPolicyStates)
          .values({
            tenantId: input.tenantId,
            revision: 1,
            adapterConfigurationDigest: digest,
          })
          .onConflictDoUpdate({
            target: schema.tenantPolicyStates.tenantId,
            set: {
              revision: sql`${schema.tenantPolicyStates.revision} + 1`,
              adapterConfigurationDigest: digest,
              updatedAt: new Date(),
            },
          })
          .returning({ revision: schema.tenantPolicyStates.revision });
        const policyState = policyRows[0];
        if (policyState === undefined) {
          throw new Error("The policy bundle revision could not be allocated.");
        }
        const transitionRows = await transaction
          .select()
          .from(schema.dispositionTransitions)
          .where(eq(schema.dispositionTransitions.tenantId, input.tenantId))
          .orderBy(asc(schema.dispositionTransitions.revision));
        const dispositionTransitions = transitionRows.map((row) =>
          SkillDispositionTransitionSchema.parse({
            kind: row.kind,
            skillVersionId: row.skillVersionId,
            reason: row.reason,
            actor: row.actor,
            occurredAt: row.occurredAt.toISOString(),
            revision: row.revision,
          }),
        );
        return {
          tenantId: input.tenantId,
          deviceId: input.deviceId,
          adapterInstallationId: input.adapterInstallationId,
          revision: policyState.revision,
          adapterConfigurationDigest: digest,
          dispositionTransitions,
          snapshot,
        };
      },
    });
  }

  public async ingestBatch(input: {
    tenantId: string;
    deviceId: string;
    records: CloudSupervisionEnvelope[];
  }): Promise<string[]> {
    const records = CloudSupervisionEnvelopeSchema.array()
      .min(1)
      .max(100)
      .parse(input.records);
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const acceptedRecords: CloudSupervisionEnvelope[] = [];
        for (const record of records) {
          const digest = createHash("sha256")
            .update(canonicalJson(record.payload))
            .digest("hex");
          const inserted = await transaction
            .insert(schema.ingestEvents)
            .values({
              tenantId: input.tenantId,
              deviceId: input.deviceId,
              sourceRecordId: record.id,
              eventId: record.eventId,
              payloadDigest: digest,
              payload: record.payload,
            })
            .onConflictDoNothing({
              target: [
                schema.ingestEvents.tenantId,
                schema.ingestEvents.eventId,
              ],
            })
            .returning({ id: schema.ingestEvents.id });
          const ingestEvent = inserted[0];
          if (ingestEvent === undefined) {
            const existing = await transaction
              .select({ digest: schema.ingestEvents.payloadDigest })
              .from(schema.ingestEvents)
              .where(
                and(
                  eq(schema.ingestEvents.tenantId, input.tenantId),
                  eq(schema.ingestEvents.eventId, record.eventId),
                ),
              )
              .limit(1);
            if (existing[0]?.digest !== digest) {
              throw new PostgresIngestCollisionError(record.eventId);
            }
          } else {
              await transaction.insert(schema.ingestOutbox).values({
                tenantId: input.tenantId,
                ingestEventId: ingestEvent.id,
                topic: "worker-event.accepted",
                payload: {
                  eventId: record.eventId,
                  sourceRecordId: record.id,
                },
              });
              acceptedRecords.push(record);
              if (record.payload.kind === "completion") {
                const runValues = {
                  tenantId: input.tenantId,
                  deviceId: input.deviceId,
                  eventId: record.eventId,
                  runtimeRunId: record.payload.runId,
                  workItemId: record.payload.workItemId,
                  runtime: record.payload.runtime,
                  runtimeVersion: record.payload.runtimeVersion,
                  adapterVersion: record.payload.adapterVersion,
                  capabilitySnapshot: record.payload.capabilities,
                  agentId: record.payload.identity.agent.agentId,
                  project: record.payload.project,
                  enforcement: record.payload.enforcement.kind,
                  attribution: record.payload.attribution.kind,
                  tokens: tokenCount(record.payload),
                  startedAt: new Date(record.payload.occurredAt),
                  completedAt: new Date(record.payload.occurredAt),
                };
                const storedRuns = await transaction
                  .insert(schema.runs)
                  .values(runValues)
                  .onConflictDoUpdate({
                    target: [
                      schema.runs.tenantId,
                      schema.runs.runtimeRunId,
                      schema.runs.workItemId,
                    ],
                    set: runValues,
                  })
                  .returning({ id: schema.runs.id });
                const run = storedRuns[0];
                if (run !== undefined) {
                  await transaction.insert(schema.evaluations).values({
                    tenantId: input.tenantId,
                    runId: run.id,
                    policyId: record.payload.evaluation.policyId,
                    policyVersion: record.payload.evaluation.policyVersionId,
                    evaluatorVersion: record.payload.evaluation.evaluatorVersion,
                    externalEvaluationId: record.payload.evaluation.evaluationId,
                    evaluationKind: record.payload.evaluation.kind,
                    result: evaluationResult(record.payload.evaluation),
                    score: evaluationScore(record.payload.evaluation),
                    attemptCount: record.payload.evaluation.attempts,
                    advisoryReceivedAt:
                      record.payload.evaluation.kind === "late"
                        ? new Date(record.payload.evaluation.receivedAt)
                        : null,
                    findings: evaluationFindings(record.payload.evaluation),
                    evidenceDigest: record.payload.evidenceDigest,
                    redactedEvidence: record.payload.redactedExcerpts,
                    latencyMs: record.payload.evaluation.latencyMs,
                    costUsdMicros:
                      record.payload.evaluation.cost.kind === "reported"
                        ? record.payload.evaluation.cost.usdMicros
                        : null,
                  });
                }
              }
          }
        }
        if (acceptedRecords.length > 0) {
          const projections = await transaction
            .select({ snapshot: schema.dashboardProjections.snapshot })
            .from(schema.dashboardProjections)
            .where(eq(schema.dashboardProjections.tenantId, input.tenantId))
            .limit(1)
            .for("update");
          const storedProjection = projections[0];
          if (storedProjection === undefined) {
            throw new Error(
              "The tenant dashboard projection must be initialized before ingest.",
            );
          }
          let projected = projectAcceptedCloudRecords({
            snapshot: DashboardSnapshotSchema.parse(storedProjection.snapshot),
            deviceId: input.deviceId,
            records: acceptedRecords,
          });
          for (const record of acceptedRecords) {
            if (
              record.payload.kind !== "completion" ||
              record.payload.provisionalDisposition.kind !== "quarantine"
            ) {
              continue;
            }
            const provisional = record.payload.provisionalDisposition;
            const skill = projected.skills.find(
              (candidate) =>
                candidate.skillVersionId === provisional.skillVersionId,
            );
            if (
              skill === undefined ||
              skill.disposition === "revoked" ||
              skill.disposition === "quarantined"
            ) {
              continue;
            }
            const transition = await appendDispositionTransition({
              transaction,
              tenantId: input.tenantId,
              kind: "quarantine",
              skillVersionId: provisional.skillVersionId,
              reason: provisional.reason,
              actor: `device:${input.deviceId}`,
              occurredAt: record.payload.occurredAt,
            });
            projected = applyDispositionTransition({
              snapshot: projected,
              transition,
            });
          }
          await transaction
            .update(schema.dashboardProjections)
            .set({ snapshot: projected, updatedAt: new Date() })
            .where(eq(schema.dashboardProjections.tenantId, input.tenantId));
          await transaction
            .update(schema.devices)
            .set({ lastSeenAt: new Date() })
            .where(
              and(
                eq(schema.devices.tenantId, input.tenantId),
                eq(schema.devices.id, input.deviceId),
              ),
            );
        }
        return records.map((record) => record.id);
      },
    });
  }

  public async initializeDashboardProjection(input: {
    tenantId: string;
    snapshot: DashboardSnapshot;
  }): Promise<void> {
    await this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const snapshot = DashboardSnapshotSchema.parse(input.snapshot);
        await transaction
          .insert(schema.dashboardProjections)
          .values({ tenantId: input.tenantId, snapshot })
          .onConflictDoUpdate({
            target: schema.dashboardProjections.tenantId,
            set: { snapshot, updatedAt: new Date() },
          });
      },
    });
  }

  public async dispositionTransitions(
    tenantId: string,
  ): Promise<SkillDispositionTransition[]> {
    return this.withTenant({
      tenantId,
      operation: async (transaction) => {
        const rows = await transaction
          .select()
          .from(schema.dispositionTransitions)
          .where(eq(schema.dispositionTransitions.tenantId, tenantId))
          .orderBy(asc(schema.dispositionTransitions.revision));
        return rows.map((row) =>
          SkillDispositionTransitionSchema.parse({
            kind: row.kind,
            skillVersionId: row.skillVersionId,
            reason: row.reason,
            actor: row.actor,
            occurredAt: row.occurredAt.toISOString(),
            revision: row.revision,
          }),
        );
      },
    });
  }

  public async recordSignedPolicyBundle(input: {
    tenantId: string;
    bundle: SignedPolicyBundle;
  }): Promise<void> {
    const bundle = SignedPolicyBundleSchema.parse(input.bundle);
    if (bundle.payload.tenantId !== input.tenantId) {
      throw new Error("The signed policy bundle tenant does not match repository state.");
    }
    await this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const devices = await transaction
          .select({
            adapterInstallationId: schema.devices.adapterInstallationId,
          })
          .from(schema.devices)
          .where(
            and(
              eq(schema.devices.tenantId, input.tenantId),
              eq(schema.devices.id, bundle.payload.audience.deviceId),
              isNull(schema.devices.revokedAt),
            ),
          )
          .limit(1);
        if (
          devices[0]?.adapterInstallationId !==
          bundle.payload.audience.adapterInstallationId
        ) {
          throw new Error(
            "The signed policy bundle audience is not an active enrolled installation.",
          );
        }
        const policyStates = await transaction
          .select({ revision: schema.tenantPolicyStates.revision })
          .from(schema.tenantPolicyStates)
          .where(eq(schema.tenantPolicyStates.tenantId, input.tenantId))
          .limit(1);
        if (
          policyStates[0] === undefined ||
          policyStates[0].revision < bundle.payload.revision
        ) {
          throw new Error("The policy bundle revision was not allocated by this tenant.");
        }
        const existingRows = await transaction
          .select({
            keyId: schema.policyBundles.keyId,
            payload: schema.policyBundles.payload,
            signature: schema.policyBundles.signature,
          })
          .from(schema.policyBundles)
          .where(
            and(
              eq(schema.policyBundles.tenantId, input.tenantId),
              eq(schema.policyBundles.revision, bundle.payload.revision),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing !== undefined) {
          if (
            canonicalJson(existing) !==
            canonicalJson({
              keyId: bundle.keyId,
              payload: bundle.payload,
              signature: bundle.signature,
            })
          ) {
            throw new Error(
              "The policy bundle revision already contains different signed content.",
            );
          }
          return;
        }
        const newerActive = await transaction
          .select({ revision: schema.policyBundles.revision })
          .from(schema.policyBundles)
          .where(
            and(
              eq(schema.policyBundles.tenantId, input.tenantId),
              eq(schema.policyBundles.active, true),
              gt(schema.policyBundles.revision, bundle.payload.revision),
            ),
          )
          .limit(1);
        const active = newerActive[0] === undefined;
        if (active) {
          await transaction
            .update(schema.policyBundles)
            .set({ active: false })
            .where(
              and(
                eq(schema.policyBundles.tenantId, input.tenantId),
                eq(schema.policyBundles.active, true),
                lt(schema.policyBundles.revision, bundle.payload.revision),
              ),
            );
        }
        await transaction.insert(schema.policyBundles).values({
          tenantId: input.tenantId,
          revision: bundle.payload.revision,
          keyId: bundle.keyId,
          payload: bundle.payload,
          signature: bundle.signature,
          active,
          issuedAt: new Date(bundle.payload.issuedAt),
          expiresAt: new Date(bundle.payload.expiresAt),
        });
      },
    });
  }

  public async close(): Promise<void> {
    await this.#client.end({ timeout: 5 });
  }
}
