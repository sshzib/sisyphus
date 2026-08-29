import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const runtimeEnum = pgEnum("agent_runtime", [
  "codex",
  "claude-code",
  "cursor",
  "opencode",
]);
export const evaluationResultEnum = pgEnum("evaluation_result", [
  "pass",
  "retryable-failure",
  "terminal-failure",
  "inconclusive",
]);
export const dispositionEnum = pgEnum("skill_disposition", [
  "active",
  "probation",
  "quarantined",
  "revoked",
]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tenants_slug_unique").on(table.slug)],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    credentialHash: text("credential_hash").notNull(),
    publicKey: text("public_key").notNull(),
    adapterInstallationId: text("adapter_installation_id"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("devices_tenant_idx").on(table.tenantId),
    uniqueIndex("devices_credential_hash_unique").on(table.credentialHash),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    deviceId: uuid("device_id").references(() => devices.id),
    eventId: text("event_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    runtime: runtimeEnum("runtime").notNull(),
    runtimeVersion: text("runtime_version").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    capabilitySnapshot: jsonb("capability_snapshot").notNull(),
    agentId: text("agent_id").notNull(),
    project: text("project").notNull(),
    enforcement: text("enforcement").notNull(),
    attribution: text("attribution").notNull(),
    tokens: integer("tokens").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("runs_tenant_event_unique").on(table.tenantId, table.eventId),
    uniqueIndex("runs_tenant_work_item_unique").on(
      table.tenantId,
      table.workItemId,
    ),
    index("runs_tenant_completed_idx").on(table.tenantId, table.completedAt),
  ],
);

export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull().references(() => runs.id),
    policyVersion: text("policy_version").notNull(),
    evaluatorVersion: text("evaluator_version").notNull(),
    externalEvaluationId: text("external_evaluation_id").notNull(),
    result: evaluationResultEnum("result").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }),
    findings: jsonb("findings").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    redactedEvidence: jsonb("redacted_evidence").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costUsdMicros: integer("cost_usd_micros"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evaluations_tenant_run_idx").on(table.tenantId, table.runId),
    uniqueIndex("evaluations_tenant_external_unique").on(
      table.tenantId,
      table.externalEvaluationId,
    ),
  ],
);

export const dispositionTransitions = pgTable(
  "disposition_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    skillVersionId: text("skill_version_id").notNull(),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    revision: integer("revision").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("disposition_transitions_tenant_revision_unique").on(
      table.tenantId,
      table.revision,
    ),
    index("disposition_transitions_skill_idx").on(
      table.tenantId,
      table.skillVersionId,
    ),
  ],
);

export const dashboardProjections = pgTable("dashboard_projections", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  snapshot: jsonb("snapshot").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantPolicyStates = pgTable("tenant_policy_states", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  revision: integer("revision").notNull().default(0),
  adapterConfigurationDigest: text("adapter_configuration_digest").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skillDispositions = pgTable(
  "skill_dispositions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    skillVersionId: text("skill_version_id").notNull(),
    disposition: dispositionEnum("disposition").notNull(),
    reason: text("reason").notNull(),
    changedBy: text("changed_by").notNull(),
    revision: integer("revision").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("skill_dispositions_revision_unique").on(
      table.tenantId,
      table.skillVersionId,
      table.revision,
    ),
    index("skill_dispositions_current_idx").on(
      table.tenantId,
      table.skillVersionId,
      table.changedAt,
    ),
  ],
);

export const policyBundles = pgTable(
  "policy_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    revision: integer("revision").notNull(),
    keyId: text("key_id").notNull(),
    payload: jsonb("payload").notNull(),
    signature: text("signature").notNull(),
    active: boolean("active").notNull().default(false),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("policy_bundles_tenant_revision_unique").on(
      table.tenantId,
      table.revision,
    ),
  ],
);

export const judgeProviderConfigs = pgTable(
  "judge_provider_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    provider: text("provider").notNull().default("openai"),
    model: text("model").notNull(),
    encryptedApiKey: jsonb("encrypted_api_key").notNull(),
    keyEncryptionVersion: integer("key_encryption_version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("judge_provider_configs_tenant_unique").on(table.tenantId)],
);

export const ingestEvents = pgTable(
  "ingest_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    deviceId: uuid("device_id").notNull().references(() => devices.id),
    sourceRecordId: text("source_record_id").notNull(),
    eventId: text("event_id").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    payload: jsonb("payload").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ingest_events_tenant_event_unique").on(table.tenantId, table.eventId),
    index("ingest_events_device_idx").on(table.tenantId, table.deviceId),
  ],
);

export const ingestOutbox = pgTable(
  "ingest_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    ingestEventId: uuid("ingest_event_id").notNull().references(() => ingestEvents.id),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    index("ingest_outbox_pending_idx").on(table.tenantId, table.deliveredAt, table.availableAt),
  ],
);

export const tenantRlsStatements = [
  sql`ALTER TABLE devices ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE runs ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE skill_dispositions ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE policy_bundles ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE judge_provider_configs ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE ingest_events ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE ingest_outbox ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE disposition_transitions ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE dashboard_projections ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE tenant_policy_states ENABLE ROW LEVEL SECURITY`,
  sql`ALTER TABLE devices FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE runs FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE evaluations FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE skill_dispositions FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE policy_bundles FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE judge_provider_configs FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE ingest_events FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE ingest_outbox FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE disposition_transitions FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE dashboard_projections FORCE ROW LEVEL SECURITY`,
  sql`ALTER TABLE tenant_policy_states FORCE ROW LEVEL SECURITY`,
  sql`CREATE POLICY tenant_devices ON devices USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_runs ON runs USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_evaluations ON evaluations USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_skill_dispositions ON skill_dispositions USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_policy_bundles ON policy_bundles USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_judge_provider_configs ON judge_provider_configs USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_ingest_events ON ingest_events USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_ingest_outbox ON ingest_outbox USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_disposition_transitions ON disposition_transitions USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_dashboard_projections ON dashboard_projections USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
  sql`CREATE POLICY tenant_policy_states ON tenant_policy_states USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`,
];
