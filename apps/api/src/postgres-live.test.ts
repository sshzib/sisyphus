import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  CloudSupervisionRecordSchema,
  SignedPolicyBundleSchema,
  type CloudSupervisionRecord,
} from "@sisyphus/domain";
import { DashboardSnapshotSchema } from "@sisyphus/ui/contracts";
import { createDemoSnapshot } from "@sisyphus/ui/demo";
import postgres, { type Sql } from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "./app.js";
import { createPostgresControlPlaneRepository } from "./database/postgres-repository.js";
import { migratePostgres } from "./database/migrate.js";
import { Ed25519PolicyBundleSigner } from "./policy-bundle.js";
import { AesGcmSecretCipher } from "./secret-cipher.js";

const liveDatabaseUrl =
  process.env.SISYPHUS_TEST_DATABASE_URL ??
  process.env.SISYPHUS_DATABASE_URL;
const IdentifierSchema = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/u);

function temporaryConnectionUrl(input: {
  baseUrl: string;
  database: string;
  role: string;
  password: string;
}): string {
  const url = new URL(input.baseUrl);
  url.pathname = `/${input.database}`;
  url.username = input.role;
  url.password = input.password;
  return url.toString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function snapshot(input: {
  tenantId: string;
  tenantName: string;
  deviceId: string;
}) {
  const demo = createDemoSnapshot();
  return DashboardSnapshotSchema.parse({
    ...demo,
    workspace: {
      id: input.tenantId,
      name: input.tenantName,
      environment: "PostgreSQL integration test",
    },
    devices: [
      {
        id: input.deviceId,
        name: `${input.tenantName} device`,
        platform: "linux",
        status: "online",
        runtimes: ["codex"],
        lastSeenAt: "2026-08-29T10:30:00.000Z",
        pluginTrust: "verified",
        syncLagSeconds: 0,
      },
    ],
  });
}

async function seedTenant(input: {
  client: Sql;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  deviceId: string;
  installationId: string;
  deviceToken: string;
}): Promise<void> {
  const projected = snapshot(input);
  await input.client.begin(async (transaction) => {
    await transaction`select set_config('app.tenant_id', ${input.tenantId}, true)`;
    await transaction`
      insert into tenants (id, slug, name)
      values (${input.tenantId}, ${input.tenantSlug}, ${input.tenantName})
    `;
    await transaction`
      insert into devices (
        id,
        tenant_id,
        name,
        platform,
        public_key,
        adapter_installation_id,
        last_seen_at
      ) values (
        ${input.deviceId},
        ${input.tenantId},
        ${`${input.tenantName} device`},
        'linux',
        'test-public-key',
        ${input.installationId},
        now()
      )
    `;
    await transaction`
      insert into dashboard_projections (tenant_id, snapshot)
      values (${input.tenantId}, ${transaction.json(projected)})
    `;
    await transaction`
      insert into api_credentials (
        tenant_id,
        token_hash,
        kind,
        subject_id,
        device_id,
        role,
        adapter_installation_id
      ) values (
        ${input.tenantId},
        ${sha256(input.deviceToken)},
        'device',
        null,
        ${input.deviceId},
        'device',
        ${input.installationId}
      )
    `;
  });
}

function cloudRecord(input: {
  runId: string;
  workItemId: string;
  evaluationId: string;
  score: number;
}): CloudSupervisionRecord {
  const supported = { kind: "supported" } as const;
  return CloudSupervisionRecordSchema.parse({
    schemaVersion: 1,
    kind: "completion",
    occurredAt: "2026-08-29T10:30:00.000Z",
    runId: input.runId,
    workItemId: input.workItemId,
    project: "postgres-live",
    runtime: "codex",
    runtimeVersion: "0.42.0",
    adapterVersion: "0.1.0",
    capabilities: {
      runtime: "codex",
      runtimeVersion: "0.42.0",
      promptInterception: supported,
      skillSelectionControl: supported,
      rootStopContinuation: supported,
      subagentStopContinuation: supported,
      toolPrevention: supported,
      toolObservation: supported,
      stableTokenUsage: supported,
      localEvidenceAccess: supported,
    },
    identity: {
      sessionId: `session-${input.runId}`,
      agent: { kind: "root", agentId: "postgres-agent" },
    },
    enforcement: { kind: "enforced" },
    evidenceDigest: sha256(`evidence-${input.evaluationId}`),
    redactedExcerpts: [
      {
        source: "output",
        text: "The integration checks passed. [REDACTED]",
        redaction: { kind: "applied", rulesetVersion: "test-redactor-1" },
      },
    ],
    completionKind: "root",
    attribution: {
      kind: "verified",
      skillVersionId: "skill-ts-review@4.2.1",
      activationLeaseId: `lease-${input.evaluationId}`,
      method: "activation-marker",
    },
    tokenUsage: { kind: "reported", inputTokens: 100, outputTokens: 50 },
    evaluation: {
      kind: "pass",
      evaluationId: input.evaluationId,
      policyId: "policy-live",
      policyVersionId: "policy-live@1",
      evaluatorVersion: "live-test-1",
      attempts: 1,
      latencyMs: 12,
      cost: { kind: "reported", usdMicros: 17 },
      score: input.score,
    },
    provisionalDisposition: { kind: "none" },
  });
}

function envelope(input: {
  id: string;
  eventId: string;
  runId: string;
  workItemId: string;
  score?: number;
}) {
  return {
    id: input.id,
    eventId: input.eventId,
    payload: cloudRecord({
      runId: input.runId,
      workItemId: input.workItemId,
      evaluationId: `evaluation-${input.id}`,
      score: input.score ?? 0.92,
    }),
  };
}

async function expectSqlState(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL SQLSTATE ${expectedCode}.`);
  } catch (error: unknown) {
    const parsed = z
      .object({ code: z.string() })
      .passthrough()
      .safeParse(error);
    expect(parsed.success ? parsed.data.code : "missing").toBe(expectedCode);
  }
}

afterEach(() => vi.unstubAllEnvs());

describe.skipIf(liveDatabaseUrl === undefined)(
  "PostgreSQL production repository",
  () => {
    it(
      "migrates, enforces tenant RLS, and projects idempotent concurrent API events",
      async () => {
        if (liveDatabaseUrl === undefined) {
          throw new Error("SISYPHUS_TEST_DATABASE_URL is required.");
        }
        const suffix = randomBytes(6).toString("hex");
        const databaseName = IdentifierSchema.parse(`sisyphus_test_${suffix}`);
        const migrationRole = IdentifierSchema.parse(`sisyphus_migrator_${suffix}`);
        const applicationRole = IdentifierSchema.parse(`sisyphus_app_${suffix}`);
        const migrationPassword = randomBytes(18).toString("hex");
        const applicationPassword = randomBytes(18).toString("hex");
        const admin = postgres(liveDatabaseUrl, { max: 1, prepare: false });
        let databaseCreated = false;
        let migrationRoleCreated = false;
        let applicationRoleCreated = false;
        let migrationClient: Sql | undefined;
        let applicationClient: Sql | undefined;
        let app: Awaited<ReturnType<typeof createApp>> | undefined;
        let repository: Awaited<
          ReturnType<typeof createPostgresControlPlaneRepository>
        > | undefined;
        try {
          await admin.unsafe(
            `CREATE ROLE "${migrationRole}" LOGIN NOSUPERUSER BYPASSRLS PASSWORD '${migrationPassword}'`,
          );
          migrationRoleCreated = true;
          await admin.unsafe(
            `CREATE ROLE "${applicationRole}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${applicationPassword}'`,
          );
          applicationRoleCreated = true;
          await admin.unsafe(
            `CREATE DATABASE "${databaseName}" OWNER "${migrationRole}"`,
          );
          databaseCreated = true;

          const migrationDatabaseUrl = temporaryConnectionUrl({
            baseUrl: liveDatabaseUrl,
            database: databaseName,
            role: migrationRole,
            password: migrationPassword,
          });
          const applicationDatabaseUrl = temporaryConnectionUrl({
            baseUrl: liveDatabaseUrl,
            database: databaseName,
            role: applicationRole,
            password: applicationPassword,
          });
          repository = await createPostgresControlPlaneRepository({
            applicationDatabaseUrl,
            migrationDatabaseUrl,
            secretCipher: new AesGcmSecretCipher(Buffer.alloc(32, 9)),
          });
          await migratePostgres(migrationDatabaseUrl);
          migrationClient = postgres(migrationDatabaseUrl, {
            max: 1,
            prepare: false,
          });
          applicationClient = postgres(applicationDatabaseUrl, {
            max: 2,
            prepare: false,
          });

          const tenantA = randomUUID();
          const tenantB = randomUUID();
          const deviceA = randomUUID();
          const deviceB = randomUUID();
          const tokenA = `deviceA-${suffix}`;
          const tokenB = `deviceB-${suffix}`;
          await seedTenant({
            client: migrationClient,
            tenantId: tenantA,
            tenantSlug: `tenant-a-${suffix}`,
            tenantName: "Tenant A",
            deviceId: deviceA,
            installationId: `installation-a-${suffix}`,
            deviceToken: tokenA,
          });
          await seedTenant({
            client: migrationClient,
            tenantId: tenantB,
            tenantSlug: `tenant-b-${suffix}`,
            tenantName: "Tenant B",
            deviceId: deviceB,
            installationId: `installation-b-${suffix}`,
            deviceToken: tokenB,
          });

          const rlsRows = await migrationClient<
            { relname: string; enabled: boolean; forced: boolean }[]
          >`
            select
              relname,
              relrowsecurity as enabled,
              relforcerowsecurity as forced
            from pg_class
            where relname in (
              'tenants',
              'api_credentials',
              'devices',
              'runs',
              'evaluations',
              'judge_requests',
              'dashboard_projections',
              'ingest_events',
              'policy_bundle_issuances'
            )
          `;
          expect(rlsRows).toHaveLength(9);
          expect(rlsRows.every((row) => row.enabled && row.forced)).toBe(true);

          const visibleToA = await applicationClient.begin(
            async (transaction) => {
              await transaction`select set_config('app.tenant_id', ${tenantA}, true)`;
              return transaction<{ id: string }[]>`select id from tenants`;
            },
          );
          expect(visibleToA.map((row) => row.id)).toEqual([tenantA]);
          const visibleWithoutContext = await applicationClient<
            { id: string }[]
          >`select id from tenants`;
          expect(visibleWithoutContext).toEqual([]);

          await expectSqlState(
            applicationClient.begin(async (transaction) => {
              await transaction`select set_config('app.tenant_id', ${tenantA}, true)`;
              await transaction`
                insert into tenant_policy_states (
                  tenant_id,
                  revision,
                  adapter_configuration_digest
                ) values (${tenantB}, 1, ${"a".repeat(64)})
              `;
            }),
            "42501",
          );
          await expectSqlState(
            applicationClient.begin(async (transaction) => {
              await transaction`select set_config('app.tenant_id', ${tenantA}, true)`;
              await transaction`
                update devices
                set adapter_installation_id = 'forged-installation'
                where id = ${deviceA}
              `;
            }),
            "42501",
          );
          await expectSqlState(
            applicationClient.begin(async (transaction) => {
              await transaction`select set_config('app.tenant_id', ${tenantA}, true)`;
              await transaction`
                insert into ingest_events (
                  tenant_id,
                  device_id,
                  source_record_id,
                  event_id,
                  payload_digest,
                  payload
                ) values (
                  ${tenantA},
                  ${deviceB},
                  'cross-tenant-record',
                  'cross-tenant-event',
                  ${"b".repeat(64)},
                  '{}'::jsonb
                )
              `;
            }),
            "23503",
          );
          await expectSqlState(
            applicationClient.begin(async (transaction) => {
              await transaction`select set_config('app.credential_hash', ${sha256(tokenA)}, true)`;
              await transaction`
                insert into api_credentials (
                  tenant_id,
                  token_hash,
                  kind,
                  subject_id,
                  role
                ) values (
                  ${tenantA},
                  ${"c".repeat(64)},
                  'user',
                  'forged-admin',
                  'admin'
                )
              `;
            }),
            "42501",
          );

          vi.stubEnv("NODE_ENV", "production");
          app = await createApp({
            repository,
            policyBundleSigner:
              Ed25519PolicyBundleSigner.generate("postgres-live-key"),
          });
          const auth = (token: string) => ({
            authorization: `Bearer ${token}`,
          });
          const firstPolicyResponse = await app.inject({
            method: "GET",
            url: "/v1/policy-bundle",
            headers: auth(tokenA),
          });
          const repeatedPolicyResponse = await app.inject({
            method: "GET",
            url: "/v1/policy-bundle",
            headers: auth(tokenA),
          });
          const firstPolicy = SignedPolicyBundleSchema.parse(
            firstPolicyResponse.json(),
          );
          expect(
            SignedPolicyBundleSchema.parse(repeatedPolicyResponse.json()),
          ).toEqual(firstPolicy);
          const sharedA = envelope({
            id: "shared-a",
            eventId: "shared-event",
            runId: "run-shared",
            workItemId: "work-shared",
          });
          const sharedB = envelope({
            id: "shared-b",
            eventId: "shared-event",
            runId: "run-shared",
            workItemId: "work-shared",
          });
          const acceptedA = await app.inject({
            method: "POST",
            url: "/v1/events/batch",
            headers: auth(tokenA),
            payload: { records: [sharedA] },
          });
          const acceptedB = await app.inject({
            method: "POST",
            url: "/v1/events/batch",
            headers: auth(tokenB),
            payload: { records: [sharedB] },
          });
          expect(acceptedA.statusCode).toBe(202);
          expect(acceptedB.statusCode).toBe(202);

          const replay = await app.inject({
            method: "POST",
            url: "/v1/events/batch",
            headers: auth(tokenA),
            payload: {
              records: [{ ...sharedA, id: "shared-a-replay" }],
            },
          });
          expect(replay.statusCode).toBe(202);
          const collision = await app.inject({
            method: "POST",
            url: "/v1/events/batch",
            headers: auth(tokenA),
            payload: {
              records: [
                {
                  ...sharedA,
                  id: "shared-a-collision",
                  payload: cloudRecord({
                    runId: "run-shared",
                    workItemId: "work-shared",
                    evaluationId: "evaluation-collision",
                    score: 0.11,
                  }),
                },
              ],
            },
          });
          expect(collision.statusCode).toBe(409);

          const concurrent = [
            envelope({
              id: "concurrent-1",
              eventId: "concurrent-event-1",
              runId: "run-concurrent-1",
              workItemId: "work-concurrent-1",
            }),
            envelope({
              id: "concurrent-2",
              eventId: "concurrent-event-2",
              runId: "run-concurrent-2",
              workItemId: "work-concurrent-2",
            }),
          ];
          const concurrentResponses = await Promise.all(
            concurrent.map(async (record) =>
              app?.inject({
                method: "POST",
                url: "/v1/events/batch",
                headers: auth(tokenA),
                payload: { records: [record] },
              }),
            ),
          );
          expect(
            concurrentResponses.every((response) => response?.statusCode === 202),
          ).toBe(true);

          const retry = envelope({
            id: "retry-latest",
            eventId: "retry-latest-event",
            runId: "run-shared",
            workItemId: "work-shared",
            score: 0.99,
          });
          const otherRun = envelope({
            id: "same-work-other-run",
            eventId: "same-work-other-run-event",
            runId: "run-other",
            workItemId: "work-shared",
          });
          await app.inject({
            method: "POST",
            url: "/v1/events/batch",
            headers: auth(tokenA),
            payload: { records: [retry, otherRun] },
          });
          const dashboardResponse = await app.inject({
            method: "GET",
            url: "/v1/dashboard",
            headers: auth(tokenA),
          });
          const dashboard = DashboardSnapshotSchema.parse(
            dashboardResponse.json(),
          );
          expect(
            dashboard.runs.filter(
              (run) => run.id === "run-shared:work-shared",
            ),
          ).toMatchObject([
            { eventId: "retry-latest-event", score: 99 },
          ]);
          expect(
            dashboard.runs.some(
              (run) => run.id === "run-other:work-shared",
            ),
          ).toBe(true);
          expect(
            dashboard.runs.filter((run) =>
              run.id.startsWith("run-concurrent-"),
            ),
          ).toHaveLength(2);

          const beforeContentChange = await app.inject({
            method: "GET",
            url: "/v1/policy-bundle",
            headers: auth(tokenA),
          });
          expect(
            SignedPolicyBundleSchema.parse(beforeContentChange.json()),
          ).toEqual(firstPolicy);
          const quarantineBase = cloudRecord({
            runId: "run-policy-change",
            workItemId: "work-policy-change",
            evaluationId: "evaluation-policy-change",
            score: 0.1,
          });
          if (quarantineBase.kind !== "completion") {
            throw new Error("The policy-change fixture must be a completion.");
          }
          const quarantineRecord = {
            id: "policy-change-record",
            eventId: "policy-change-event",
            payload: CloudSupervisionRecordSchema.parse({
              ...quarantineBase,
              provisionalDisposition: {
                kind: "quarantine",
                skillVersionId: "skill-ts-review@4.2.1",
                reason:
                  "Five terminal failures reached the verified rolling threshold.",
                localRevision: 1,
              },
            }),
          };
          const changedIngest = await app.inject({
            method: "POST",
            url: "/v1/events/batch",
            headers: auth(tokenA),
            payload: { records: [quarantineRecord] },
          });
          expect(changedIngest.statusCode).toBe(202);
          const changedPolicyResponse = await app.inject({
            method: "GET",
            url: "/v1/policy-bundle",
            headers: auth(tokenA),
          });
          const repeatedChangedPolicyResponse = await app.inject({
            method: "GET",
            url: "/v1/policy-bundle",
            headers: auth(tokenA),
          });
          const changedPolicy = SignedPolicyBundleSchema.parse(
            changedPolicyResponse.json(),
          );
          expect(changedPolicy.payload.revision).toBe(
            firstPolicy.payload.revision + 1,
          );
          expect(
            SignedPolicyBundleSchema.parse(
              repeatedChangedPolicyResponse.json(),
            ),
          ).toEqual(changedPolicy);

          await migrationClient`
            update devices
            set revoked_at = now()
            where tenant_id = ${tenantA} and id = ${deviceA}
          `;
          const revokedDevice = await app.inject({
            method: "GET",
            url: "/v1/dashboard",
            headers: auth(tokenA),
          });
          expect(revokedDevice.statusCode).toBe(401);
        } finally {
          if (app !== undefined) {
            await app.close();
            repository = undefined;
          } else if (repository !== undefined) {
            await repository.close();
          }
          await applicationClient?.end({ timeout: 5 });
          await migrationClient?.end({ timeout: 5 });
          if (databaseCreated) {
            await admin`
              select pg_terminate_backend(pid)
              from pg_stat_activity
              where datname = ${databaseName} and pid <> pg_backend_pid()
            `;
            await admin.unsafe(`DROP DATABASE "${databaseName}"`);
          }
          if (applicationRoleCreated) {
            await admin.unsafe(`DROP ROLE "${applicationRole}"`);
          }
          if (migrationRoleCreated) {
            await admin.unsafe(`DROP ROLE "${migrationRole}"`);
          }
          await admin.end({ timeout: 5 });
        }
      },
      90_000,
    );
  },
);
