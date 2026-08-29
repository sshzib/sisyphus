import { z } from "zod";

const identifier = z.string().trim().min(1);

export const AdapterInstallationIdSchema = identifier.brand<"AdapterInstallationId">();
export type AdapterInstallationId = z.infer<typeof AdapterInstallationIdSchema>;
export const createAdapterInstallationId = AdapterInstallationIdSchema.parse;

export const AdapterVersionSchema = identifier.brand<"AdapterVersion">();
export type AdapterVersion = z.infer<typeof AdapterVersionSchema>;
export const createAdapterVersion = AdapterVersionSchema.parse;

export const ActivationLeaseIdSchema = identifier.brand<"ActivationLeaseId">();
export type ActivationLeaseId = z.infer<typeof ActivationLeaseIdSchema>;
export const createActivationLeaseId = ActivationLeaseIdSchema.parse;

export const AgentIdSchema = identifier.brand<"AgentId">();
export type AgentId = z.infer<typeof AgentIdSchema>;
export const createAgentId = AgentIdSchema.parse;

export const DeviceIdSchema = identifier.brand<"DeviceId">();
export type DeviceId = z.infer<typeof DeviceIdSchema>;
export const createDeviceId = DeviceIdSchema.parse;

export const EvaluationIdSchema = identifier.brand<"EvaluationId">();
export type EvaluationId = z.infer<typeof EvaluationIdSchema>;
export const createEvaluationId = EvaluationIdSchema.parse;

export const RuntimeEventIdSchema = identifier.brand<"RuntimeEventId">();
export type RuntimeEventId = z.infer<typeof RuntimeEventIdSchema>;
export const createEventId = RuntimeEventIdSchema.parse;

export const PolicyIdSchema = identifier.brand<"PolicyId">();
export type PolicyId = z.infer<typeof PolicyIdSchema>;
export const createPolicyId = PolicyIdSchema.parse;

export const PolicyVersionIdSchema = identifier.brand<"PolicyVersionId">();
export type PolicyVersionId = z.infer<typeof PolicyVersionIdSchema>;
export const createPolicyVersionId = PolicyVersionIdSchema.parse;

export const RunIdSchema = identifier.brand<"RunId">();
export type RunId = z.infer<typeof RunIdSchema>;
export const createRunId = RunIdSchema.parse;

export const RetryBudgetIdSchema = identifier.brand<"RetryBudgetId">();
export type RetryBudgetId = z.infer<typeof RetryBudgetIdSchema>;
export const createRetryBudgetId = RetryBudgetIdSchema.parse;

export const SessionIdSchema = identifier.brand<"SessionId">();
export type SessionId = z.infer<typeof SessionIdSchema>;
export const createSessionId = SessionIdSchema.parse;

export const SkillIdSchema = identifier.brand<"SkillId">();
export type SkillId = z.infer<typeof SkillIdSchema>;
export const createSkillId = SkillIdSchema.parse;

export const SkillVersionIdSchema = identifier.brand<"SkillVersionId">();
export type SkillVersionId = z.infer<typeof SkillVersionIdSchema>;
export const createSkillVersionId = SkillVersionIdSchema.parse;

export const SkillVersionKeySchema = identifier.brand<"SkillVersionKey">();
export type SkillVersionKey = z.infer<typeof SkillVersionKeySchema>;
export const createSkillVersionKey = SkillVersionKeySchema.parse;

export const TenantIdSchema = identifier.brand<"TenantId">();
export type TenantId = z.infer<typeof TenantIdSchema>;
export const createTenantId = TenantIdSchema.parse;

export const ToolCallIdSchema = identifier.brand<"ToolCallId">();
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export const createToolCallId = ToolCallIdSchema.parse;

export const TriggerIdSchema = identifier.brand<"TriggerId">();
export type TriggerId = z.infer<typeof TriggerIdSchema>;
export const createTriggerId = TriggerIdSchema.parse;

export const WorkItemIdSchema = identifier.brand<"WorkItemId">();
export type WorkItemId = z.infer<typeof WorkItemIdSchema>;
export const createWorkItemId = WorkItemIdSchema.parse;

export const TimestampSchema = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;
export const createTimestamp = TimestampSchema.parse;
