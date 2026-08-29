import { z } from "zod";

import { SkillAttributionSchema } from "./attribution.js";
import {
  AgentRuntimeSchema,
  EnforcementSchema,
  RuntimeCapabilitySnapshotSchema,
} from "./capabilities.js";
import {
  AdapterVersionSchema,
  EvaluationIdSchema,
  PolicyIdSchema,
  PolicyVersionIdSchema,
  RunIdSchema,
  RuntimeEventIdSchema,
  SkillVersionIdSchema,
  TimestampSchema,
  ToolCallIdSchema,
  WorkItemIdSchema,
} from "./identifiers.js";
import { RuntimeIdentitySchema, TokenUsageSchema } from "./observations.js";

const CloudFindingSchema = z
  .object({
    criterion: z.string().trim().min(1).max(160),
    message: z.string().trim().min(1).max(4_000),
    correction: z.string().trim().min(1).max(4_000),
  })
  .strict();

const EvaluationCostSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unavailable") }).strict(),
  z
    .object({
      kind: z.literal("reported"),
      usdMicros: z.number().int().nonnegative(),
    })
    .strict(),
]);

const cloudEvaluationBase = {
  evaluationId: EvaluationIdSchema,
  policyId: PolicyIdSchema,
  policyVersionId: PolicyVersionIdSchema,
  evaluatorVersion: z.string().trim().min(1).max(160),
  attempts: z.number().int().min(1).max(3),
  latencyMs: z.number().int().nonnegative(),
  cost: EvaluationCostSchema,
};

const CloudAdvisoryEvaluationSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("pass"), score: z.number().min(0).max(1) })
    .strict(),
  z
    .object({
      kind: z.literal("fail"),
      score: z.number().min(0).max(1),
      findings: z.array(CloudFindingSchema).min(1).max(50),
    })
    .strict(),
]);

export const CloudEvaluationMetadataSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...cloudEvaluationBase,
      kind: z.literal("pass"),
      score: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      ...cloudEvaluationBase,
      kind: z.literal("retryable-failure"),
      score: z.number().min(0).max(1),
      retryOrdinal: z.union([z.literal(1), z.literal(2)]),
      findings: z.array(CloudFindingSchema).min(1).max(50),
    })
    .strict(),
  z
    .object({
      ...cloudEvaluationBase,
      kind: z.literal("terminal-failure"),
      score: z.number().min(0).max(1),
      reason: z.enum(["retries-exhausted", "continuation-unsupported"]),
      findings: z.array(CloudFindingSchema).min(1).max(50),
    })
    .strict(),
  z
    .object({
      ...cloudEvaluationBase,
      kind: z.literal("inconclusive"),
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      ...cloudEvaluationBase,
      kind: z.literal("late"),
      receivedAt: TimestampSchema,
      advisory: CloudAdvisoryEvaluationSchema,
    })
    .strict(),
]);
export type CloudEvaluationMetadata = z.infer<
  typeof CloudEvaluationMetadataSchema
>;

export const RedactedEvidenceExcerptSchema = z
  .object({
    source: z.enum(["prompt", "output", "tool", "code", "test"]),
    text: z.string().trim().min(1).max(4_000),
    redaction: z
      .object({
        kind: z.literal("applied"),
        rulesetVersion: z.string().trim().min(1).max(160),
      })
      .strict(),
  })
  .strict();
export type RedactedEvidenceExcerpt = z.infer<
  typeof RedactedEvidenceExcerptSchema
>;

const cloudRecordBase = {
  schemaVersion: z.literal(1),
  occurredAt: TimestampSchema,
  runId: RunIdSchema,
  workItemId: WorkItemIdSchema,
  project: z.string().trim().min(1).max(240),
  runtime: AgentRuntimeSchema,
  runtimeVersion: z.string().trim().min(1).max(160),
  adapterVersion: AdapterVersionSchema,
  capabilities: RuntimeCapabilitySnapshotSchema,
  identity: RuntimeIdentitySchema,
  enforcement: EnforcementSchema,
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  redactedExcerpts: z.array(RedactedEvidenceExcerptSchema).max(20),
};

const CloudResolutionCandidateSchema = z
  .object({
    skillVersionId: SkillVersionIdSchema,
    administratorPriority: z.number().int(),
    specificity: z.number().int().nonnegative(),
    outcome: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("selected") }).strict(),
      z
        .object({
          kind: z.literal("rejected"),
          reason: z.enum([
            "lower-priority",
            "lower-specificity",
            "lexical-tiebreak",
            "quarantined",
            "revoked",
            "wrapper-unavailable",
          ]),
        })
        .strict(),
    ]),
  })
  .strict();

const CloudSkillResolutionProofSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("selected"),
      selectedSkillVersionId: SkillVersionIdSchema,
      candidates: z.array(CloudResolutionCandidateSchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("no-match"),
      candidates: z.array(CloudResolutionCandidateSchema).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("no-available-wrapper"),
      candidates: z.array(CloudResolutionCandidateSchema).min(1).max(100),
    })
    .strict(),
]);

const PromptResolutionCloudRecordSchema = z
  .object({
    ...cloudRecordBase,
    kind: z.literal("prompt-resolution"),
    promptDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    resolution: CloudSkillResolutionProofSchema,
  })
  .strict();

const ToolObservationCloudRecordSchema = z
  .object({
    ...cloudRecordBase,
    kind: z.literal("tool-observation"),
    toolCallId: ToolCallIdSchema,
    toolName: z.string().trim().min(1).max(240),
    observation: z.discriminatedUnion("phase", [
      z
        .object({
          phase: z.literal("request"),
          outcome: z.enum(["allowed", "denied", "observed"]),
        })
        .strict(),
      z
        .object({
          phase: z.literal("result"),
          outcome: z.enum(["succeeded", "failed", "observed"]),
        })
        .strict(),
    ]),
  })
  .strict();

const ProvisionalDispositionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("quarantine"),
      skillVersionId: SkillVersionIdSchema,
      reason: z.string().trim().min(8).max(500),
      localRevision: z.number().int().positive(),
    })
    .strict(),
]);

const CompletionCloudRecordSchema = z
  .object({
    ...cloudRecordBase,
    kind: z.literal("completion"),
    completionKind: z.enum(["root", "subagent"]),
    attribution: SkillAttributionSchema,
    tokenUsage: TokenUsageSchema,
    evaluation: CloudEvaluationMetadataSchema,
    provisionalDisposition: ProvisionalDispositionSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.provisionalDisposition.kind !== "quarantine") {
      return;
    }
    if (
      record.attribution.kind !== "verified" ||
      record.attribution.skillVersionId !==
        record.provisionalDisposition.skillVersionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A provisional quarantine requires verified attribution to the same skill version.",
        path: ["provisionalDisposition"],
      });
    }
  });

const cloudRecordUnion = z.discriminatedUnion("kind", [
  PromptResolutionCloudRecordSchema,
  ToolObservationCloudRecordSchema,
  CompletionCloudRecordSchema,
]);

export const CloudSupervisionRecordSchema = cloudRecordUnion.superRefine(
  (record, context) => {
    if (record.capabilities.runtime !== record.runtime) {
      context.addIssue({
        code: "custom",
        message: "Capability runtime must match the supervision runtime.",
        path: ["capabilities", "runtime"],
      });
    }
    if (record.capabilities.runtimeVersion !== record.runtimeVersion) {
      context.addIssue({
        code: "custom",
        message: "Capability runtime version must match the supervision runtime version.",
        path: ["capabilities", "runtimeVersion"],
      });
    }
    if (record.kind === "prompt-resolution") {
      const selectedCandidates = record.resolution.candidates.filter(
        (candidate) => candidate.outcome.kind === "selected",
      );
      if (
        record.resolution.kind === "selected" &&
        (selectedCandidates.length !== 1 ||
          selectedCandidates[0]?.skillVersionId !==
            record.resolution.selectedSkillVersionId)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A selected resolution must identify exactly one matching selected candidate.",
          path: ["resolution", "candidates"],
        });
      }
      if (
        record.resolution.kind !== "selected" &&
        selectedCandidates.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "An unresolved prompt cannot contain a selected candidate.",
          path: ["resolution", "candidates"],
        });
      }
    }
  },
);
export type CloudSupervisionRecord = z.infer<
  typeof CloudSupervisionRecordSchema
>;
export type CompletionCloudRecord = Extract<
  CloudSupervisionRecord,
  { kind: "completion" }
>;

export const CloudSupervisionEnvelopeSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    eventId: RuntimeEventIdSchema,
    payload: CloudSupervisionRecordSchema,
  })
  .strict();
export type CloudSupervisionEnvelope = z.infer<
  typeof CloudSupervisionEnvelopeSchema
>;

export const CloudSupervisionBatchSchema = z
  .object({
    records: z.array(CloudSupervisionEnvelopeSchema).min(1).max(100),
  })
  .strict();
export type CloudSupervisionBatch = z.infer<
  typeof CloudSupervisionBatchSchema
>;
