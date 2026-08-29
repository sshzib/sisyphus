import { z } from "zod";

import {
  AdapterVersionSchema,
  ActivationLeaseIdSchema,
  EnforcementSchema,
  EvaluationFindingSchema,
  HookObservationSchema,
  RuntimeEventIdSchema,
  RuntimeIdentitySchema,
  SkillActivationEvidenceSchema,
  SkillMatchCandidateSchema,
  SkillVersionIdSchema,
  TimestampSchema,
  type HookObservation,
} from "@sisyphus/domain";

import {
  renderCodexDecision,
  type CodexActivationLease,
  type CodexHookResponse,
} from "./responses.js";
import { CodexHookEventSchema } from "./codex-wire.js";

const resolvedCandidateSchema = z.object({
  candidate: SkillMatchCandidateSchema,
  outcome: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("selected") }),
    z.object({
      kind: z.literal("rejected"),
      reason: z.enum([
        "quarantined",
        "revoked",
        "lower-priority",
        "lower-specificity",
        "lexical-tiebreak",
      ]),
    }),
  ]),
});

const skillResolutionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none"), candidates: z.array(resolvedCandidateSchema) }),
  z.object({
    kind: z.literal("selected"),
    selected: SkillMatchCandidateSchema,
    candidates: z.array(resolvedCandidateSchema),
  }),
]);

const decisionBase = {
  eventId: RuntimeEventIdSchema,
  enforcement: EnforcementSchema,
};

const PromptDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal("prompt-decision"),
  action: z.literal("continue"),
  resolution: skillResolutionSchema,
});

const ToolRequestDecisionSchema = z.discriminatedUnion("action", [
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

const ToolResultDecisionSchema = z.object({
  ...decisionBase,
  kind: z.literal("tool-result-decision"),
  action: z.literal("recorded"),
});

const retryEvaluationSchema = z.object({
  kind: z.literal("retryable-failure"),
  retryOrdinal: z.union([z.literal(1), z.literal(2)]),
  findings: z.array(EvaluationFindingSchema),
});

const allowEvaluationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pass") }),
  z.object({
    kind: z.literal("terminal-failure"),
    reason: z.enum(["retries-exhausted", "continuation-unsupported"]),
    findings: z.array(EvaluationFindingSchema),
  }),
  z.object({ kind: z.literal("inconclusive"), reason: z.string().trim().min(1) }),
]);

const sanctionSchema = z.discriminatedUnion("kind", [
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

const StopDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    ...decisionBase,
    kind: z.literal("stop-decision"),
    action: z.literal("allow"),
    evaluation: allowEvaluationSchema,
    sanction: sanctionSchema,
  }),
  z.object({
    eventId: RuntimeEventIdSchema,
    enforcement: z.object({ kind: z.literal("enforced") }),
    kind: z.literal("stop-decision"),
    action: z.literal("retry"),
    evaluation: retryEvaluationSchema,
    feedback: z.object({
      summary: z.string().trim().min(1),
      findings: z.array(EvaluationFindingSchema),
    }),
    sanction: z.object({ kind: z.literal("not-applicable") }),
  }),
]);

export const CodexSupervisionEnvelopeSchema = z.object({
  runtime: z.literal("codex"),
  adapterVersion: AdapterVersionSchema,
  eventId: RuntimeEventIdSchema,
  event: HookObservationSchema,
  identity: RuntimeIdentitySchema,
  activation: SkillActivationEvidenceSchema,
  nativeEvent: CodexHookEventSchema,
}).strict();

export type CodexSupervisionEnvelope = z.infer<typeof CodexSupervisionEnvelopeSchema>;

const WorkerIssuedActivationLeaseSchema = z
  .object({
    activationLeaseId: ActivationLeaseIdSchema,
    skillVersionId: SkillVersionIdSchema,
    expiresAt: TimestampSchema,
  })
  .strict();

const WorkerResponseSchema = z
  .object({
    decision: z.unknown(),
    activationLease: WorkerIssuedActivationLeaseSchema.optional(),
  })
  .strict();

function matchingEventId(event: HookObservation, decisionEventId: string): void {
  if (event.eventId !== decisionEventId) {
    throw new Error("worker decision event id does not match the hook event");
  }
}

export function renderWorkerDecision(
  event: HookObservation,
  input: unknown,
  activationLease?: CodexActivationLease,
): CodexHookResponse {
  switch (event.kind) {
    case "prompt": {
      const decision = PromptDecisionSchema.parse(input);
      matchingEventId(event, decision.eventId);
      if (decision.resolution.kind === "selected") {
        if (activationLease === undefined) {
          throw new Error("selected skill response requires a worker-issued activation lease");
        }
        if (
          activationLease.skillVersionId !==
          decision.resolution.selected.skillVersionId
        ) {
          throw new Error("worker-issued activation lease belongs to another skill version");
        }
      } else if (activationLease !== undefined) {
        throw new Error("worker returned an activation lease without a selected skill");
      }
      return renderCodexDecision(decision, activationLease);
    }
    case "tool-request": {
      const decision = ToolRequestDecisionSchema.parse(input);
      matchingEventId(event, decision.eventId);
      if (activationLease !== undefined) {
        throw new Error("worker returned an activation lease for a tool request");
      }
      return renderCodexDecision(decision);
    }
    case "tool-result": {
      const decision = ToolResultDecisionSchema.parse(input);
      matchingEventId(event, decision.eventId);
      if (activationLease !== undefined) {
        throw new Error("worker returned an activation lease for a tool result");
      }
      return renderCodexDecision(decision);
    }
    case "root-stop":
    case "subagent-stop": {
      const decision = StopDecisionSchema.parse(input);
      matchingEventId(event, decision.eventId);
      if (activationLease !== undefined) {
        throw new Error("worker returned an activation lease for a stop event");
      }
      return renderCodexDecision(decision);
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function parseAndRenderWorkerResponse(
  event: HookObservation,
  input: unknown,
): CodexHookResponse {
  const response = WorkerResponseSchema.parse(input);
  return renderWorkerDecision(event, response.decision, response.activationLease);
}
