import { z } from "zod";

export const AgentRuntimeSchema = z.enum([
  "codex",
  "claude-code",
  "cursor",
  "opencode",
]);
export type AgentRuntime = z.infer<typeof AgentRuntimeSchema>;

export const RuntimeProfileSchema = z.enum(["local", "cloud-agent"]);
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;

export const ComparisonCohortIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export type ComparisonCohortId = z.infer<typeof ComparisonCohortIdSchema>;

export const CapabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("supported") }).strict(),
  z.object({ kind: z.literal("partial"), limitation: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("unsupported"), reason: z.string().min(1) }).strict(),
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const RuntimeCapabilitySnapshotSchema = z
  .object({
    runtime: AgentRuntimeSchema,
    runtimeVersion: z.string().min(1),
    promptInterception: CapabilitySchema,
    skillSelectionControl: CapabilitySchema,
    rootStopContinuation: CapabilitySchema,
    subagentStopContinuation: CapabilitySchema,
    toolPrevention: CapabilitySchema,
    toolObservation: CapabilitySchema,
    stableTokenUsage: CapabilitySchema,
    localEvidenceAccess: CapabilitySchema,
  })
  .strict();
export type RuntimeCapabilitySnapshot = z.infer<
  typeof RuntimeCapabilitySnapshotSchema
>;

export const EnforcementCoverageSchema = z.enum([
  "enforced",
  "partial",
  "observed-only",
]);
export type EnforcementCoverage = z.infer<typeof EnforcementCoverageSchema>;

export const AttributionSchema = z.enum(["verified", "inferred", "absent"]);
export type Attribution = z.infer<typeof AttributionSchema>;

export const EvaluationResultSchema = z.enum([
  "pass",
  "retryable-failure",
  "terminal-failure",
  "inconclusive",
]);
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const SkillDispositionSchema = z.enum([
  "active",
  "probation",
  "quarantined",
  "revoked",
]);
export type SkillDisposition = z.infer<typeof SkillDispositionSchema>;

export const OverviewSchema = z
  .object({
    totalRuns: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(100),
    retryRecoveryRate: z.number().min(0).max(100),
    terminalFailures: z.number().int().nonnegative(),
    tokensSpent: z.number().int().nonnegative(),
    tokensAvoidedEstimate: z.number().int().nonnegative(),
    averageLatencyMs: z.number().int().nonnegative(),
    enforcedShare: z.number().min(0).max(100),
  })
  .strict();
export type Overview = z.infer<typeof OverviewSchema>;

export const RunSummarySchema = z
  .object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    occurredAt: z.string().datetime(),
    runtime: AgentRuntimeSchema,
    profile: RuntimeProfileSchema,
    runtimeVersion: z.string().min(1),
    adapterVersion: z.string().min(1),
    adapterInstallationId: z.string().trim().min(1),
    comparisonCohortId: ComparisonCohortIdSchema,
    agentName: z.string().min(1),
    project: z.string().min(1),
    skillVersionId: z.string().min(1).nullable(),
    skillName: z.string().min(1).nullable(),
    attribution: AttributionSchema,
    enforcement: EnforcementCoverageSchema,
    result: EvaluationResultSchema,
    score: z.number().min(0).max(100).nullable(),
    attempts: z.number().int().min(1).max(3),
    tokens: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    findings: z.array(z.string().min(1)),
  })
  .strict();
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const AgentSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    runtime: AgentRuntimeSchema,
    profile: RuntimeProfileSchema,
    runtimeVersion: z.string().min(1),
    adapterVersion: z.string().min(1),
    adapterInstallationId: z.string().trim().min(1),
    comparisonCohortId: ComparisonCohortIdSchema,
    attributionCohort: AttributionSchema,
    enforcementCohort: EnforcementCoverageSchema,
    runs: z.number().int().nonnegative(),
    conclusiveRuns: z.number().int().nonnegative(),
    scoredRuns: z.number().int().nonnegative(),
    retryRuns: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(100),
    retryRecoveryRate: z.number().min(0).max(100),
    terminalFailures: z.number().int().nonnegative(),
    averageScore: z.number().min(0).max(100),
    tokens: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((agent, context) => {
    for (const field of ["conclusiveRuns", "scoredRuns", "retryRuns"] as const) {
      if (agent[field] > agent.runs) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} cannot exceed total runs.`,
        });
      }
    }
  });
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const SkillSummarySchema = z
  .object({
    skillVersionId: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    runtime: AgentRuntimeSchema,
    disposition: SkillDispositionSchema,
    verifiedAttributionRate: z.number().min(0).max(100),
    runs: z.number().int().nonnegative(),
    verifiedRuns: z.number().int().nonnegative(),
    conclusiveRuns: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(100),
    terminalFailures: z.number().int().nonnegative(),
    lastChangedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((skill, context) => {
    for (const field of ["verifiedRuns", "conclusiveRuns"] as const) {
      if (skill[field] > skill.runs) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} cannot exceed total runs.`,
        });
      }
    }
  });
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

export const ConflictCandidateSchema = z
  .object({
    skillVersionId: z.string().min(1),
    skillName: z.string().min(1),
    priority: z.number().int(),
    specificity: z.number().int().nonnegative(),
    selected: z.boolean(),
    reason: z.string().min(1),
  })
  .strict();

export const ConflictResolutionSchema = z
  .object({
    id: z.string().min(1),
    occurredAt: z.string().datetime(),
    runtime: AgentRuntimeSchema,
    promptSummary: z.string().min(1),
    selectedSkill: z.string().min(1),
    candidates: z.array(ConflictCandidateSchema).min(1),
  })
  .strict();
export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

export const IntegrationSummarySchema = z
  .object({
    id: z.string().min(1),
    runtime: AgentRuntimeSchema,
    adapterInstallationId: z.string().trim().min(1),
    profile: RuntimeProfileSchema,
    scope: z.enum(["local", "cloud"]),
    status: z.enum(["healthy", "degraded", "offline"]),
    adapterVersion: z.string().min(1),
    runtimeVersion: z.string().min(1),
    capabilities: RuntimeCapabilitySnapshotSchema,
    lastSeenAt: z.string().datetime(),
  })
  .strict();
export type IntegrationSummary = z.infer<typeof IntegrationSummarySchema>;

export const PolicySummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    runtime: AgentRuntimeSchema.nullable(),
    passThreshold: z.number().min(0).max(100),
    retryLimit: z.number().int().min(0).max(2),
    requiredCapabilities: z.array(
      z.enum([
        "promptInterception",
        "skillSelectionControl",
        "rootStopContinuation",
        "subagentStopContinuation",
        "toolPrevention",
        "toolObservation",
        "stableTokenUsage",
        "localEvidenceAccess",
      ]),
    ),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PolicySummary = z.infer<typeof PolicySummarySchema>;

export const AuditEventSchema = z
  .object({
    id: z.string().min(1),
    occurredAt: z.string().datetime(),
    actor: z.string().min(1),
    action: z.enum([
      "evaluation.completed",
      "retry.issued",
      "skill.quarantined",
      "skill.restored",
      "adapter.changed",
      "policy.updated",
      "integration.degraded",
      "device.enrolled",
      "event.ingested",
    ]),
    summary: z.string().min(1),
    runtime: AgentRuntimeSchema.nullable(),
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const DeviceSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    platform: z.enum(["windows", "macos", "linux"]),
    status: z.enum(["online", "stale", "offline"]),
    runtimes: z.array(AgentRuntimeSchema),
    lastSeenAt: z.string().datetime(),
    pluginTrust: z.enum(["verified", "warning", "unknown"]),
    syncLagSeconds: z.number().int().nonnegative(),
  })
  .strict();
export type DeviceSummary = z.infer<typeof DeviceSummarySchema>;

export const DashboardSnapshotSchema = z
  .object({
    generatedAt: z.string().datetime(),
    workspace: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        environment: z.string().min(1),
      })
      .strict(),
    overview: OverviewSchema,
    runs: z.array(RunSummarySchema),
    agents: z.array(AgentSummarySchema),
    skills: z.array(SkillSummarySchema),
    conflicts: z.array(ConflictResolutionSchema),
    integrations: z.array(IntegrationSummarySchema),
    policies: z.array(PolicySummarySchema),
    audit: z.array(AuditEventSchema),
    devices: z.array(DeviceSummarySchema),
  })
  .strict();
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;

export const DashboardQuerySchema = z
  .object({ runtime: AgentRuntimeSchema.optional() })
  .strict();
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

export const RestoreSkillRequestSchema = z
  .object({ reason: z.string().trim().min(8).max(500) })
  .strict();
export type RestoreSkillRequest = z.infer<typeof RestoreSkillRequestSchema>;

export const RestoreSkillParamsSchema = z
  .object({ skillVersionId: z.string().min(1).max(240) })
  .strict();

export const RestoreSkillResponseSchema = z
  .object({ skill: SkillSummarySchema, auditEvent: AuditEventSchema })
  .strict();
export type RestoreSkillResponse = z.infer<typeof RestoreSkillResponseSchema>;

export const RuntimeAdapterAccessSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("paired"),
      runtime: AgentRuntimeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("setup-required"),
      runtime: AgentRuntimeSchema,
      reason: z.string().trim().min(1),
    })
    .strict(),
]);
export type RuntimeAdapterAccess = z.infer<typeof RuntimeAdapterAccessSchema>;

export const WorkerPolicyModeSchema = z.enum([
  "offline-default",
  "local-policy",
  "cloud-managed",
  "external",
]);
export type WorkerPolicyMode = z.infer<typeof WorkerPolicyModeSchema>;

export const HostContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("web") }).strict(),
  z
    .object({
      kind: z.literal("desktop"),
      worker: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("online"),
            version: z.string().min(1),
            pendingUploads: z.number().int().nonnegative(),
            policyMode: WorkerPolicyModeSchema,
          })
          .strict(),
        z.object({ kind: z.literal("offline"), reason: z.string().min(1) }).strict(),
      ]),
      localEvidence: CapabilitySchema,
      adapterAccess: z.array(RuntimeAdapterAccessSchema),
    })
    .strict(),
]);
export type HostContext = z.infer<typeof HostContextSchema>;

export const HostedCsrfTokenSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const HostedBearerCredentialSchema = z
  .object({
    token: z.string().trim().min(1).max(2048).regex(/^[A-Za-z0-9._~-]+$/u),
  })
  .strict();

export const HostedSessionPayloadSchema = z
  .object({
    version: z.literal(1),
    bearerToken: HostedBearerCredentialSchema.shape.token,
    csrfToken: HostedCsrfTokenSchema,
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type HostedSessionPayload = z.infer<typeof HostedSessionPayloadSchema>;

export const HostedWebServerSettingsSchema = z
  .object({
    apiUrl: z.url(),
    publicOrigin: z.url(),
    sessionKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u),
    nodeEnv: z.enum(["development", "production", "test"]),
  })
  .strict()
  .superRefine((settings, context) => {
    const apiUrl = new URL(settings.apiUrl);
    const publicOrigin = new URL(settings.publicOrigin);
    if (!new Set(["http:", "https:"]).has(apiUrl.protocol)) {
      context.addIssue({
        code: "custom",
        path: ["apiUrl"],
        message: "The control-plane URL must use HTTP or HTTPS.",
      });
    }
    if (!new Set(["http:", "https:"]).has(publicOrigin.protocol)) {
      context.addIssue({
        code: "custom",
        path: ["publicOrigin"],
        message: "The public origin must use HTTP or HTTPS.",
      });
    }
    if (
      apiUrl.username.length > 0 ||
      apiUrl.password.length > 0 ||
      apiUrl.search.length > 0 ||
      apiUrl.hash.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["apiUrl"],
        message: "The control-plane URL cannot contain credentials, a query, or a fragment.",
      });
    }
    if (
      publicOrigin.username.length > 0 ||
      publicOrigin.password.length > 0 ||
      publicOrigin.pathname !== "/" ||
      publicOrigin.search.length > 0 ||
      publicOrigin.hash.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicOrigin"],
        message: "The public origin must contain only a scheme and host.",
      });
    }
    if (
      settings.nodeEnv === "production" &&
      (apiUrl.protocol !== "https:" || publicOrigin.protocol !== "https:")
    ) {
      context.addIssue({
        code: "custom",
        message: "Production control-plane and public URLs must use HTTPS.",
      });
    }
  });
export type HostedWebServerSettings = z.infer<typeof HostedWebServerSettingsSchema>;

export const EventIngestRequestSchema = z
  .object({
    deviceId: z.string().min(1),
    eventType: z.enum([
      "run.completed",
      "evaluation.completed",
      "skill.disposition.changed",
      "adapter.capabilities.observed",
    ]),
    occurredAt: z.string().datetime(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type EventIngestRequest = z.infer<typeof EventIngestRequestSchema>;

export const EventIngestResponseSchema = z
  .object({ id: z.string().min(1), duplicate: z.boolean(), acceptedAt: z.string().datetime() })
  .strict();
export type EventIngestResponse = z.infer<typeof EventIngestResponseSchema>;

export const ApiErrorSchema = z
  .object({
    error: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;
