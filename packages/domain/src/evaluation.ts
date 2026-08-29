import { z } from "zod";

import {
  AdapterVersionSchema,
  PolicyIdSchema,
  PolicyVersionIdSchema,
  RunIdSchema,
  RuntimeEventIdSchema,
  SkillVersionIdSchema,
  TimestampSchema,
  WorkItemIdSchema,
  type Timestamp,
} from "./identifiers.js";
import { CapabilityNameSchema, EnforcementSchema, RuntimeCapabilitySnapshotSchema } from "./capabilities.js";
import { RuntimeIdentitySchema } from "./observations.js";
import { SkillMatchCandidateSchema, SkillResolutionSchema } from "./skills.js";

export const EvaluationFindingSchema = z.object({
  criterion: z.string().trim().min(1),
  message: z.string().trim().min(1),
  correction: z.string().trim().min(1),
  evidence: z.array(z.string()),
});
export type EvaluationFinding = z.infer<typeof EvaluationFindingSchema>;

export const DeterministicCheckResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pass"),
    checkId: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("fail"),
    checkId: z.string().trim().min(1),
    findings: z.array(EvaluationFindingSchema).min(1),
  }),
]);
export type DeterministicCheckResult = z.infer<typeof DeterministicCheckResultSchema>;

export const AdvisoryEvaluationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pass"), score: z.number().min(0).max(1) }),
  z.object({
    kind: z.literal("fail"),
    score: z.number().min(0).max(1),
    findings: z.array(EvaluationFindingSchema).min(1),
  }),
]);
export type AdvisoryEvaluation = z.infer<typeof AdvisoryEvaluationSchema>;

export const JudgeResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pass"), score: z.number().min(0).max(1) }),
  z.object({
    kind: z.literal("fail"),
    score: z.number().min(0).max(1),
    findings: z.array(EvaluationFindingSchema).min(1),
  }),
  z.object({ kind: z.literal("inconclusive"), reason: z.string().trim().min(1) }),
  z.object({
    kind: z.literal("late"),
    receivedAt: TimestampSchema,
    advisory: AdvisoryEvaluationSchema,
  }),
]);
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export const CloudEvidencePolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }).strict(),
  z
    .object({
      kind: z.literal("redacted-excerpts"),
      sources: z
        .array(z.enum(["prompt", "output", "tool", "code", "test"]))
        .min(1)
        .max(5)
        .refine((sources) => new Set(sources).size === sources.length, {
          message: "Cloud evidence sources must be unique.",
        }),
      maximumCharacters: z.number().int().positive().max(4_000),
    })
    .strict(),
]);
export type CloudEvidencePolicy = z.infer<typeof CloudEvidencePolicySchema>;

export const EvaluationConstraintSchema = z.object({
  policyId: PolicyIdSchema,
  policyVersionId: PolicyVersionIdSchema,
  passThreshold: z.number().min(0).max(1).optional(),
  retryLimit: z.number().int().min(0).max(2).optional(),
  requiredCapabilities: z.array(CapabilityNameSchema),
  skillCandidates: z.array(SkillMatchCandidateSchema),
  cloudEvidence: CloudEvidencePolicySchema.optional(),
  toolPolicy: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("allow") }),
    z.object({ kind: z.literal("deny"), reason: z.string().trim().min(1) }),
  ]),
});
export type EvaluationConstraint = z.infer<typeof EvaluationConstraintSchema>;

export function parseEvaluationConstraint(input: unknown): EvaluationConstraint {
  return EvaluationConstraintSchema.parse(input);
}

export const createEvaluationConstraint = parseEvaluationConstraint;

export type EvaluationAssessment =
  | { readonly kind: "pass"; readonly score?: number }
  | {
      readonly kind: "fail";
      readonly findings: EvaluationFinding[];
      readonly score?: number;
    }
  | {
      readonly kind: "inconclusive";
      readonly reason: string;
      readonly advisory?: {
        readonly receivedAt: Timestamp;
        readonly result: AdvisoryEvaluation;
      };
    };

const PassEvaluationResultSchema = z.object({
  kind: z.literal("pass"),
  score: z.number().min(0).max(1).optional(),
});
const RetryableFailureResultSchema = z.object({
  kind: z.literal("retryable-failure"),
  score: z.number().min(0).max(1).optional(),
  retryOrdinal: z.union([z.literal(1), z.literal(2)]),
  findings: z.array(EvaluationFindingSchema).min(1),
});
const TerminalFailureResultSchema = z.object({
  kind: z.literal("terminal-failure"),
  score: z.number().min(0).max(1).optional(),
  reason: z.enum(["retries-exhausted", "continuation-unsupported"]),
  findings: z.array(EvaluationFindingSchema).min(1),
});
const InconclusiveEvaluationResultSchema = z.object({
  kind: z.literal("inconclusive"),
  reason: z.string().trim().min(1),
  advisory: z
    .object({
      receivedAt: TimestampSchema,
      result: AdvisoryEvaluationSchema,
    })
    .optional(),
});

export const EvaluationResultSchema = z.discriminatedUnion("kind", [
  PassEvaluationResultSchema,
  RetryableFailureResultSchema,
  TerminalFailureResultSchema,
  InconclusiveEvaluationResultSchema,
]);
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const SanctionOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not-applicable") }),
  z.object({ kind: z.literal("not-eligible"), reason: z.string().trim().min(1) }),
  z.object({ kind: z.literal("recorded"), skillVersionId: SkillVersionIdSchema }),
  z.object({
    kind: z.literal("quarantined"),
    skillVersionId: SkillVersionIdSchema,
    terminalFailures: z.number().int().nonnegative(),
    sampleSize: z.number().int().nonnegative(),
  }),
]);
export type SanctionOutcome = z.infer<typeof SanctionOutcomeSchema>;

const decisionBase = {
  eventId: RuntimeEventIdSchema,
  enforcement: EnforcementSchema,
};

export const PromptDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal("prompt-decision"),
  action: z.literal("continue"),
  resolution: SkillResolutionSchema,
});
export type PromptDecision = z.infer<typeof PromptDecisionSchema>;

export const ToolRequestDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    ...decisionBase,
    kind: z.literal("tool-request-decision"),
    action: z.literal("allow"),
  }),
  z.object({
    ...decisionBase,
    kind: z.literal("tool-request-decision"),
    action: z.literal("deny"),
    reason: z.string().trim().min(1),
  }),
  z.object({
    ...decisionBase,
    kind: z.literal("tool-request-decision"),
    action: z.literal("observe-denial"),
    reason: z.string().trim().min(1),
  }),
]);
export type ToolRequestDecision = z.infer<typeof ToolRequestDecisionSchema>;

export const ToolResultDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal("tool-result-decision"),
  action: z.literal("recorded"),
});
export type ToolResultDecision = z.infer<typeof ToolResultDecisionSchema>;

export const StopDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    ...decisionBase,
    kind: z.literal("stop-decision"),
    action: z.literal("allow"),
    evaluation: z.union([
      PassEvaluationResultSchema,
      TerminalFailureResultSchema,
      InconclusiveEvaluationResultSchema,
    ]),
    sanction: SanctionOutcomeSchema,
  }),
  z.object({
    eventId: RuntimeEventIdSchema,
    enforcement: z.object({ kind: z.literal("enforced") }),
    kind: z.literal("stop-decision"),
    action: z.literal("retry"),
    evaluation: RetryableFailureResultSchema,
    feedback: z.object({
      summary: z.string().trim().min(1),
      findings: z.array(EvaluationFindingSchema).min(1),
    }),
    sanction: z.object({ kind: z.literal("not-applicable") }),
  }),
]);
export type StopDecision = z.infer<typeof StopDecisionSchema>;

export const SupervisionDecisionSchema = z.union([
  PromptDecisionSchema,
  ToolRequestDecisionSchema,
  ToolResultDecisionSchema,
  StopDecisionSchema,
]);
export type SupervisionDecision = z.infer<typeof SupervisionDecisionSchema>;

export const parsePromptDecision = PromptDecisionSchema.parse;
export const parseToolRequestDecision = ToolRequestDecisionSchema.parse;
export const parseToolResultDecision = ToolResultDecisionSchema.parse;
export const parseStopDecision = StopDecisionSchema.parse;
export const parseSupervisionDecision = SupervisionDecisionSchema.parse;

export type DecisionFor<E extends { readonly kind: string }> =
  E extends { readonly kind: "prompt" }
    ? PromptDecision
    : E extends { readonly kind: "tool-request" }
      ? ToolRequestDecision
      : E extends { readonly kind: "tool-result" }
        ? ToolResultDecision
        : E extends { readonly kind: "root-stop" | "subagent-stop" }
          ? StopDecision
          : never;

export const SkillCompletionRecordSchema = z.object({
  eventId: RuntimeEventIdSchema,
  runId: RunIdSchema,
  workItemId: WorkItemIdSchema,
  adapterVersion: AdapterVersionSchema,
  policyId: PolicyIdSchema,
  policyVersionId: PolicyVersionIdSchema,
  skillVersionId: SkillVersionIdSchema,
  identity: RuntimeIdentitySchema,
  attempt: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  completedAt: TimestampSchema,
  outcome: z.enum(["pass", "terminal-failure"]),
  capabilities: RuntimeCapabilitySnapshotSchema,
});
export type SkillCompletionRecord = z.infer<typeof SkillCompletionRecordSchema>;
