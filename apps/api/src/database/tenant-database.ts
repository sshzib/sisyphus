import { createHash } from "node:crypto";
import {
  SkillDispositionTransitionSchema,
  type AdapterConfigurationDigest,
  type CloudEvaluationMetadata,
  type CloudSupervisionEnvelope,
  type SignedPolicyBundle,
  type SkillDispositionTransition,
} from "@sisyphus/domain";
import {
  DashboardSnapshotSchema,
  type DashboardSnapshot,
} from "@sisyphus/ui/contracts";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { canonicalJson } from "../canonical-json.js";
import {
  applyDispositionTransition,
  projectAcceptedCloudRecords,
} from "../projection.js";
import * as schema from "./schema.js";

type Database = PostgresJsDatabase<typeof schema>;
type TransactionCallback = Parameters<Database["transaction"]>[0];
export type TenantTransaction = Parameters<TransactionCallback>[0];

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

async function appendDispositionTransition(input: {
  transaction: TenantTransaction;
  tenantId: string;
  kind: SkillDispositionTransition["kind"];
  skillVersionId: string;
  reason: string;
  actor: string;
  occurredAt: string;
}): Promise<SkillDispositionTransition> {
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

  public async ingestBatch(input: {
    tenantId: string;
    deviceId: string;
    records: CloudSupervisionEnvelope[];
  }): Promise<string[]> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const acceptedRecords: CloudSupervisionEnvelope[] = [];
        for (const record of input.records) {
          const digest = createHash("sha256")
            .update(canonicalJson(record.payload))
            .digest("hex");
          const existing = await transaction
            .select({ digest: schema.ingestEvents.payloadDigest })
            .from(schema.ingestEvents)
            .where(
              sql`${schema.ingestEvents.tenantId} = ${input.tenantId} and ${schema.ingestEvents.eventId} = ${record.eventId}`,
            )
            .limit(1);
          const stored = existing[0];
          if (stored !== undefined && stored.digest !== digest) {
            throw new Error(
              `Event ${record.eventId} was already ingested with a different payload.`,
            );
          }
          if (stored === undefined) {
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
              .returning({ id: schema.ingestEvents.id });
            const ingestEvent = inserted[0];
            if (ingestEvent !== undefined) {
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
                const existingRuns = await transaction
                  .select({ id: schema.runs.id })
                  .from(schema.runs)
                  .where(
                    and(
                      eq(schema.runs.tenantId, input.tenantId),
                      eq(schema.runs.workItemId, record.payload.workItemId),
                    ),
                  )
                  .limit(1);
                const existingRun = existingRuns[0];
                const insertedRuns =
                  existingRun === undefined
                    ? await transaction
                        .insert(schema.runs)
                        .values(runValues)
                        .returning({ id: schema.runs.id })
                    : [];
                if (existingRun !== undefined) {
                  await transaction
                    .update(schema.runs)
                    .set(runValues)
                    .where(eq(schema.runs.id, existingRun.id));
                }
                const run = existingRun ?? insertedRuns[0];
                if (run !== undefined) {
                  await transaction.insert(schema.evaluations).values({
                    tenantId: input.tenantId,
                    runId: run.id,
                    policyVersion: record.payload.evaluation.policyVersionId,
                    evaluatorVersion: record.payload.evaluation.evaluatorVersion,
                    externalEvaluationId: record.payload.evaluation.evaluationId,
                    result: evaluationResult(record.payload.evaluation),
                    score: evaluationScore(record.payload.evaluation),
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
        }
        if (acceptedRecords.length > 0) {
          const projections = await transaction
            .select({ snapshot: schema.dashboardProjections.snapshot })
            .from(schema.dashboardProjections)
            .where(eq(schema.dashboardProjections.tenantId, input.tenantId))
            .limit(1);
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
        return input.records.map((record) => record.id);
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

  public async recordDispositionTransition(input: {
    tenantId: string;
    kind: SkillDispositionTransition["kind"];
    skillVersionId: string;
    reason: string;
    actor: string;
    occurredAt: string;
  }): Promise<SkillDispositionTransition> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const transition = await appendDispositionTransition({
          transaction,
          ...input,
        });
        const projections = await transaction
          .select({ snapshot: schema.dashboardProjections.snapshot })
          .from(schema.dashboardProjections)
          .where(eq(schema.dashboardProjections.tenantId, input.tenantId))
          .limit(1);
        const stored = projections[0];
        if (stored !== undefined) {
          const snapshot = applyDispositionTransition({
            snapshot: DashboardSnapshotSchema.parse(stored.snapshot),
            transition,
          });
          await transaction
            .update(schema.dashboardProjections)
            .set({ snapshot, updatedAt: new Date() })
            .where(eq(schema.dashboardProjections.tenantId, input.tenantId));
        }
        return transition;
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

  public async nextPolicyBundleRevision(input: {
    tenantId: string;
    adapterConfigurationDigest: AdapterConfigurationDigest;
  }): Promise<number> {
    return this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        const rows = await transaction
          .insert(schema.tenantPolicyStates)
          .values({
            tenantId: input.tenantId,
            revision: 1,
            adapterConfigurationDigest: input.adapterConfigurationDigest,
          })
          .onConflictDoUpdate({
            target: schema.tenantPolicyStates.tenantId,
            set: {
              revision: sql`${schema.tenantPolicyStates.revision} + 1`,
              adapterConfigurationDigest: input.adapterConfigurationDigest,
              updatedAt: new Date(),
            },
          })
          .returning({ revision: schema.tenantPolicyStates.revision });
        const state = rows[0];
        if (state === undefined) {
          throw new Error("The policy bundle revision could not be allocated.");
        }
        return state.revision;
      },
    });
  }

  public async recordSignedPolicyBundle(input: {
    tenantId: string;
    bundle: SignedPolicyBundle;
  }): Promise<void> {
    await this.withTenant({
      tenantId: input.tenantId,
      operation: async (transaction) => {
        await transaction.insert(schema.policyBundles).values({
          tenantId: input.tenantId,
          revision: input.bundle.payload.revision,
          keyId: input.bundle.keyId,
          payload: input.bundle.payload,
          signature: input.bundle.signature,
          active: true,
          issuedAt: new Date(input.bundle.payload.issuedAt),
          expiresAt: new Date(input.bundle.payload.expiresAt),
        });
      },
    });
  }

  public async close(): Promise<void> {
    await this.#client.end({ timeout: 5 });
  }
}
