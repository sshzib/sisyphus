import { z } from "zod";

export const EngineeringEventTypeSchema = z.enum([
  "TASK_CREATED",
  "SPECIFICATION_CREATED",
  "SKILLS_SELECTED",
  "AGENTS_HIRED",
  "AGENT_STARTED",
  "FILE_CHANGED",
  "AGENT_COMPLETED",
  "INTEGRATION_STARTED",
  "INTEGRATION_CONFLICT",
  "SAFETY_SCAN_STARTED",
  "SAFETY_SCAN_PASSED",
  "SAFETY_SCAN_FAILED",
  "LOCAL_EXECUTION_STARTED",
  "AWS_SANDBOX_STARTED",
  "BUILD_STARTED",
  "BUILD_PASSED",
  "BUILD_FAILED",
  "DEV_SERVER_STARTED",
  "HEALTH_CHECK_PASSED",
  "HEALTH_CHECK_FAILED",
  "TEST_STARTED",
  "TEST_FAILED",
  "SECURITY_FAILED",
  "FAILURE_ATTRIBUTED",
  "SCORE_UPDATED",
  "FEEDBACK_GENERATED",
  "REVIEW_WARNING_RECORDED",
  "AGENT_RETRYING",
  "AGENT_REASSIGNED",
  "PROJECT_APPROVED",
  "PROJECT_REJECTED",
  "WORKFLOW_BLOCKED",
]);
export type EngineeringEventType = z.infer<typeof EngineeringEventTypeSchema>;

export const EngineeringTaskStatusSchema = z.enum([
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
export type EngineeringTaskStatus = z.infer<typeof EngineeringTaskStatusSchema>;

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

export const SpecialistRoleSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*(?:\s+[a-z0-9-]+)*$/u);
export type SpecialistRole = z.infer<typeof SpecialistRoleSchema>;

export const EngineeringModelTierSchema = z.enum(["low", "medium", "high", "max"]);
export type EngineeringModelTier = z.infer<typeof EngineeringModelTierSchema>;

export const CreateEngineeringTaskSchema = z
  .object({
    request: z.string().trim().min(20).max(4_000),
    modelTier: EngineeringModelTierSchema.default("low"),
  })
  .strict();
export type CreateEngineeringTask = z.infer<typeof CreateEngineeringTaskSchema>;

export const EngineeringRequirementSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(240),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    ownerAgentId: z.string().trim().min(1).max(160).nullable(),
    status: z.enum(["planned", "in-progress", "passed", "failed", "blocked"]),
  })
  .strict();
export type EngineeringRequirement = z.infer<typeof EngineeringRequirementSchema>;

export const EngineeringAgentAssignmentSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    taskId: z.string().trim().min(1).max(160),
    role: SpecialistRoleSchema,
    model: z.string().trim().min(1).max(200),
    requirementIds: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
    workspaceId: z.string().trim().min(1).max(200),
    branchName: z.string().trim().min(1).max(240),
    iteration: z.number().int().min(1).max(3),
    status: EngineeringAgentStatusSchema,
    activity: EngineeringActivitySchema,
    activityDetail: z.string().trim().min(1).max(280),
    score: z.number().min(0).max(100).nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();
export type EngineeringAgentAssignment = z.infer<
  typeof EngineeringAgentAssignmentSchema
>;

export const EngineeringChangeSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    taskId: z.string().trim().min(1).max(160),
    requirementId: z.string().trim().min(1).max(160),
    assignmentId: z.string().trim().min(1).max(160),
    filesChanged: z.array(z.string().trim().min(1).max(500)).min(1).max(200),
    diffDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    commitId: z.string().trim().min(7).max(80),
    iteration: z.number().int().min(1).max(3),
    createdAt: z.string().datetime(),
  })
  .strict();
export type EngineeringChange = z.infer<typeof EngineeringChangeSchema>;

export const EngineeringEventSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    taskId: z.string().trim().min(1).max(160),
    type: EngineeringEventTypeSchema,
    occurredAt: z.string().datetime(),
    actor: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type EngineeringEvent = z.infer<typeof EngineeringEventSchema>;

export const ProposedFileSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._@/\\-]+$/u),
    content: z.string().max(1_000_000),
  })
  .strict();

export const AgentReviewFindingSchema = z
  .object({
    requirementId: z.string().trim().min(1).max(160),
    criterion: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(1).max(1_000),
    correction: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type AgentReviewFinding = z.infer<typeof AgentReviewFindingSchema>;

export const AgentReviewVerificationSchema = z.discriminatedUnion("verdict", [
  z
    .object({
      verdict: z.literal("passed"),
      findings: z.array(AgentReviewFindingSchema).max(0),
    })
    .strict(),
  z
    .object({
      verdict: z.literal("failed"),
      findings: z.array(AgentReviewFindingSchema).min(1).max(12),
    })
    .strict(),
]);
export type AgentReviewVerification = z.infer<typeof AgentReviewVerificationSchema>;

export const AgentPatchProposalSchema = z
  .object({
    safeActivity: EngineeringActivitySchema,
    safeActivityDetail: z.string().trim().min(1).max(280),
    summary: z.string().trim().min(1).max(2_000),
    files: z.array(ProposedFileSchema).min(1).max(100),
    verification: AgentReviewVerificationSchema.optional(),
  })
  .strict();
export type AgentPatchProposal = z.infer<typeof AgentPatchProposalSchema>;
