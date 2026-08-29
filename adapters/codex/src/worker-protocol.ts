import { z } from "zod";

import {
  AdapterVersionSchema,
  ActivationLeaseIdSchema,
  HookObservationSchema,
  PromptDecisionSchema,
  RuntimeEventIdSchema,
  RuntimeIdentitySchema,
  RuntimeInstallationIdentitySchema,
  SkillActivationEvidenceSchema,
  SkillVersionIdSchema,
  StopDecisionSchema,
  TimestampSchema,
  ToolRequestDecisionSchema,
  ToolResultDecisionSchema,
  type HookObservation,
} from "@sisyphus/domain";

import {
  renderCodexDecision,
  type CodexActivationLease,
  type CodexHookResponse,
} from "./responses.js";
import { CodexHookEventSchema } from "./codex-wire.js";

export const CodexSupervisionEnvelopeSchema = z.object({
  runtime: z.literal("codex"),
  adapterVersion: AdapterVersionSchema,
  runtimeInstallation: RuntimeInstallationIdentitySchema,
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
