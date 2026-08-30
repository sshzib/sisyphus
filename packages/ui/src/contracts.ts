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

const TokenBurnSampleSchema = z
  .object({
    runId: z.string().trim().min(1),
    tokens: z.number().int().nonnegative(),
  })
  .strict();

export const TokenBurnComparisonSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("unavailable"),
      reason: z.enum([
        "no-paired-runs",
        "token-usage-unavailable",
        "incompatible-runs",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("measured"),
      pairId: z.string().trim().min(1),
      source: z.literal("provider-reported"),
      before: TokenBurnSampleSchema,
      withSisyphus: TokenBurnSampleSchema,
    })
    .strict(),
]);
export type TokenBurnComparison = z.infer<typeof TokenBurnComparisonSchema>;

export const OverviewSchema = z
  .object({
    totalRuns: z.number().int().nonnegative(),
    passRate: z.number().min(0).max(100),
    retryRecoveryRate: z.number().min(0).max(100),
    terminalFailures: z.number().int().nonnegative(),
    tokensSpent: z.number().int().nonnegative(),
    tokenBurnComparison: TokenBurnComparisonSchema,
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

export const SkillRegistryMetricsSchema = z.object({
  executions: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(100).nullable(),
  averageRetries: z.number().nonnegative().nullable(),
  averageExecutionMs: z.number().nonnegative().nullable(),
  lastEvaluatedAt: z.string().datetime().nullable(),
  averageScore: z.number().min(0).max(100).nullable(),
}).strict();

export const SkillRegistryEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
  triggers: z.array(z.string()),
  category: z.string().min(1),
  phase: z.string().min(1),
  tags: z.array(z.string()),
  source: z.enum(["upstream", "enhanced", "custom"]),
  baseSkillId: z.string().regex(/^[a-z0-9-]+$/u).nullable(),
  status: z.enum(["active", "needs-improvement", "draft"]),
  version: z.string().min(1),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceUrl: z.string().url(),
  license: z.string().min(1),
  lastSyncedAt: z.string().datetime(),
  metrics: SkillRegistryMetricsSchema,
}).strict();
export type SkillRegistryEntry = z.infer<typeof SkillRegistryEntrySchema>;

export const SkillRegistryListResponseSchema = z.object({
  items: z.array(SkillRegistryEntrySchema),
}).strict();
export type SkillRegistryListResponse = z.infer<typeof SkillRegistryListResponseSchema>;

export const SkillExecutionScoreSchema = z.object({
  total: z.number().min(0).max(100),
  functional: z.number().min(0).max(100),
  contractTests: z.number().min(0).max(100),
  security: z.number().min(0).max(100),
  requirementCompliance: z.number().min(0).max(100),
  codeQuality: z.number().min(0).max(100),
}).strict();

export const SkillImprovementProposalSchema = z.object({
  id: z.string().regex(/^proposal-[a-f0-9]{16}$/u),
  skillId: z.string().regex(/^[a-z0-9-]+$/u),
  status: z.enum(["proposed", "applied", "rejected"]),
  observedIssue: z.string().min(1),
  evidence: z.object({
    executionCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    failureExamples: z.array(z.string().min(1)).max(3),
  }).strict(),
  suggestedImprovement: z.string().min(1),
  expectedImpact: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
}).strict();
export type SkillImprovementProposal = z.infer<typeof SkillImprovementProposalSchema>;

export const SkillPerformanceSchema = z.object({
  trend: z.array(z.number().min(0).max(100)).max(10),
  compatibility: z.array(z.object({
    model: z.string().min(1),
    executions: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(100),
  }).strict()),
  recentFailures: z.array(z.object({
    executionId: z.string().min(1),
    requirementId: z.string().min(1),
    model: z.string().min(1),
    evidence: z.string().min(1),
    recordedAt: z.string().datetime(),
  }).strict()).max(5),
}).strict();
export type SkillPerformance = z.infer<typeof SkillPerformanceSchema>;

export const SkillRegistryDetailSchema = SkillRegistryEntrySchema.extend({
  instructions: z.string().min(1).max(300_000),
  performance: SkillPerformanceSchema,
  proposals: z.array(SkillImprovementProposalSchema),
}).strict();
export type SkillRegistryDetail = z.infer<typeof SkillRegistryDetailSchema>;

export const SkillRegistryDetailResponseSchema = z.object({
  skill: SkillRegistryDetailSchema,
}).strict();
export type SkillRegistryDetailResponse = z.infer<typeof SkillRegistryDetailResponseSchema>;

export const SkillRegistrySyncResponseSchema = z.object({
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  syncedAt: z.string().datetime(),
}).strict();
export type SkillRegistrySyncResponse = z.infer<typeof SkillRegistrySyncResponseSchema>;

export const SkillRegistrySyncPreviewSchema = z.object({
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  localEnhancements: z.number().int().nonnegative(),
  sourceRevision: z.string().min(1),
}).strict();
export type SkillRegistrySyncPreview = z.infer<typeof SkillRegistrySyncPreviewSchema>;

export const ResolveSkillImprovementProposalSchema = z.object({
  action: z.enum(["apply", "reject"]),
}).strict();
export type ResolveSkillImprovementProposal = z.infer<typeof ResolveSkillImprovementProposalSchema>;

export const CreateCustomSkillSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9-]+$/u),
  description: z.string().trim().min(20).max(2_000),
  role: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(100),
  phase: z.string().trim().min(2).max(100),
  triggerConditions: z.array(z.string().trim().min(3).max(300)).min(1).max(20),
  executionWorkflow: z.string().trim().min(20).max(12_000),
  outputTemplate: z.string().trim().min(10).max(8_000),
  definitionOfDone: z.string().trim().min(10).max(8_000),
}).strict();
export type CreateCustomSkill = z.infer<typeof CreateCustomSkillSchema>;

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

export const LiveAgentStatusSchema = z.enum([
  "active",
  "retrying",
  "passed",
  "failed",
  "inconclusive",
]);
export type LiveAgentStatus = z.infer<typeof LiveAgentStatusSchema>;

export const AgentActivitySchema = z.enum([
  "prompt-received",
  "tool-requested",
  "tool-completed",
  "evaluation-completed",
]);
export type AgentActivity = z.infer<typeof AgentActivitySchema>;

export const LiveAgentSummarySchema = z
  .object({
    id: z.string().min(1),
    agentId: z.string().min(1),
    parentAgentId: z.string().min(1).nullable(),
    kind: z.enum(["root", "subagent"]),
    role: z.string().trim().min(1).max(160).nullable(),
    runtime: AgentRuntimeSchema,
    profile: RuntimeProfileSchema,
    project: z.string().min(1),
    workItemId: z.string().min(1),
    status: LiveAgentStatusSchema,
    activity: AgentActivitySchema,
    activityDetail: z.string().trim().min(1).max(280),
    selectedSkillVersionId: z.string().min(1).nullable(),
    attempts: z.number().int().min(1).max(3),
    startedAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();
export type LiveAgentSummary = z.infer<typeof LiveAgentSummarySchema>;

export const OperationStatusSchema = LiveAgentStatusSchema;
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const OperationSummarySchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    taskSummary: z.string().trim().min(1).max(280),
    project: z.string().min(1),
    runtime: AgentRuntimeSchema,
    profile: RuntimeProfileSchema,
    status: OperationStatusSchema,
    selectedSkillVersionId: z.string().min(1).nullable(),
    startedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    agents: z.array(LiveAgentSummarySchema),
  })
  .strict();
export type OperationSummary = z.infer<typeof OperationSummarySchema>;

export const EngineeringTaskSubmissionSchema = z
  .object({ request: z.string().trim().min(20).max(4_000) })
  .strict();
export type EngineeringTaskSubmission = z.infer<
  typeof EngineeringTaskSubmissionSchema
>;

export const EngineeringOperationStatusSchema = z.enum([
  "queued",
  "planning",
  "working",
  "integrating",
  "safety-review",
  "sandbox-running",
  "retrying",
  "blocked",
  "approved",
  "rejected",
]);
export type EngineeringOperationStatus = z.infer<
  typeof EngineeringOperationStatusSchema
>;

export const EngineeringAgentStatusSchema = z.enum([
  "planned",
  "working",
  "waiting",
  "completed",
  "failed",
  "retrying",
  "reassigned",
  "blocked",
]);
export type EngineeringAgentStatus = z.infer<typeof EngineeringAgentStatusSchema>;

export const EngineeringActivitySchema = z.enum([
  "analyzing-requirements",
  "planning-work",
  "editing-files",
  "writing-tests",
  "reviewing-security",
  "waiting-for-integration",
  "resolving-conflict",
  "awaiting-sandbox",
  "reviewing-failure",
  "preparing-retry",
  "blocked-by-configuration",
]);
export type EngineeringActivity = z.infer<typeof EngineeringActivitySchema>;

export const EngineeringScoreSchema = z
  .object({
    total: z.number().min(0).max(100),
    functional: z.number().min(0).max(100),
    contractTests: z.number().min(0).max(100),
    security: z.number().min(0).max(100),
    requirementCompliance: z.number().min(0).max(100),
    codeQuality: z.number().min(0).max(100),
  })
  .strict();
export type EngineeringScore = z.infer<typeof EngineeringScoreSchema>;

export const EngineeringSelectedSkillEvidenceSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9-]+$/u),
    name: z.string().trim().min(1).max(240),
    skillVersionId: z.string().trim().min(1).max(240),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
export type EngineeringSelectedSkillEvidence = z.infer<
  typeof EngineeringSelectedSkillEvidenceSchema
>;

export const EngineeringAgentSummarySchema = z
  .object({
    id: z.string().trim().min(1),
    role: z.string().trim().min(2).max(80),
    model: z.string().trim().min(1).max(200),
    requirementIds: z.array(z.string().trim().min(1)).min(1).max(30),
    branch: z.string().trim().min(1).max(240),
    iteration: z.number().int().min(1).max(3),
    status: EngineeringAgentStatusSchema,
    activity: EngineeringActivitySchema,
    activityDetail: z.string().trim().min(1).max(280),
    selectedSkills: z.array(EngineeringSelectedSkillEvidenceSchema).max(4).default([]),
    score: EngineeringScoreSchema.nullable(),
    filesChanged: z.array(z.string().trim().min(1).max(500)).max(200),
    commitId: z.string().trim().min(7).max(80).nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type EngineeringAgentSummary = z.infer<
  typeof EngineeringAgentSummarySchema
>;

export const EngineeringRequirementSummarySchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1).max(240),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1),
    status: z.enum(["planned", "in-progress", "passed", "failed", "blocked"]),
    ownerAgentId: z.string().trim().min(1).nullable(),
  })
  .strict();
export type EngineeringRequirementSummary = z.infer<
  typeof EngineeringRequirementSummarySchema
>;

export const EngineeringEvidenceSchema = z
  .object({
    requirementId: z.string().trim().min(1).nullable(),
    check: z.string().trim().min(1).max(200),
    outcome: z.enum(["passed", "failed", "blocked"]),
    detail: z.string().trim().min(1).max(500),
    primaryAgentId: z.string().trim().min(1).nullable(),
    attributionConfidence: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type EngineeringEvidence = z.infer<typeof EngineeringEvidenceSchema>;

export const EngineeringEventSummarySchema = z
  .object({
    id: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    type: z.string().trim().min(1).max(80),
    occurredAt: z.string().datetime(),
    summary: z.string().trim().min(1).max(500),
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type EngineeringEventSummary = z.infer<
  typeof EngineeringEventSummarySchema
>;

export const EngineeringOperationSummarySchema = z
  .object({
    id: z.string().trim().min(1),
    requestSummary: z.string().trim().min(1).max(280),
    status: EngineeringOperationStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    requirements: z.array(EngineeringRequirementSummarySchema),
    agents: z.array(EngineeringAgentSummarySchema),
    safety: z
      .object({
        status: z.enum(["not-started", "running", "passed", "failed", "blocked"]),
        findings: z.number().int().nonnegative(),
      })
      .strict(),
    sandbox: z
      .object({
        status: z.enum(["not-started", "queued", "running", "passed", "failed", "blocked"]),
        buildId: z.string().trim().min(1).nullable(),
        detectedPort: z.number().int().min(1).max(65_535).nullable(),
      })
      .strict(),
    evidence: z.array(EngineeringEvidenceSchema).max(50),
  })
  .strict();
export type EngineeringOperationSummary = z.infer<
  typeof EngineeringOperationSummarySchema
>;

export const CreateEngineeringTaskResponseSchema = z
  .object({ operation: EngineeringOperationSummarySchema })
  .strict();
export type CreateEngineeringTaskResponse = z.infer<
  typeof CreateEngineeringTaskResponseSchema
>;

export const ClearEngineeringHistoryResponseSchema = z
  .object({
    removedTaskCount: z.number().int().nonnegative(),
    removedEventCount: z.number().int().nonnegative(),
  })
  .strict();
export type ClearEngineeringHistoryResponse = z.infer<
  typeof ClearEngineeringHistoryResponseSchema
>;

export const EngineeringExecutionStateSchema = z
  .object({
    status: z.enum(["running", "stopped"]),
    generation: z.number().int().nonnegative(),
    changedAt: z.string().datetime(),
    changedBy: z.string().trim().min(1).max(160),
  })
  .strict();
export type EngineeringExecutionState = z.infer<
  typeof EngineeringExecutionStateSchema
>;

export const EngineeringExecutionControlResponseSchema = z
  .object({ execution: EngineeringExecutionStateSchema })
  .strict();
export type EngineeringExecutionControlResponse = z.infer<
  typeof EngineeringExecutionControlResponseSchema
>;

export const EngineeringDashboardSchema = z
  .object({
    execution: EngineeringExecutionStateSchema,
    canManageExecution: z.boolean(),
    operations: z.array(EngineeringOperationSummarySchema).max(20),
    events: z.array(EngineeringEventSummarySchema).max(100),
  })
  .strict();
export type EngineeringDashboard = z.infer<typeof EngineeringDashboardSchema>;

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
    operations: z.array(OperationSummarySchema).default([]),
    engineering: EngineeringDashboardSchema.default({
      execution: {
        status: "stopped",
        generation: 0,
        changedAt: "1970-01-01T00:00:00.000Z",
        changedBy: "system",
      },
      canManageExecution: false,
      operations: [],
      events: [],
    }),
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
