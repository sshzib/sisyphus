import { createHash } from "node:crypto";
import { basename, win32 } from "node:path";

import {
  CloudSupervisionRecordSchema,
  createEvaluationId,
  type CloudSupervisionRecord,
  type EvaluationConstraint,
  type EvaluationFinding,
  type HookObservation,
  type StopDecision,
  type SupervisionDecision,
} from "@sisyphus/domain";
import { z } from "zod";

import type { EvidenceRecord } from "./evidence-vault.js";
import { REDACTION_RULESET_VERSION, redactEvidence } from "./redaction.js";

const NativeProjectSchema = z.object({ cwd: z.string().trim().min(1) }).passthrough();

interface ProjectCloudRecordInput {
  readonly event: HookObservation;
  readonly decision: SupervisionDecision;
  readonly constraint: EvaluationConstraint;
  readonly evidence: EvidenceRecord;
  readonly nativeEvent: unknown;
  readonly attempts: number;
  readonly latencyMs: number;
  readonly evaluatorVersion: string;
  readonly localDispositionRevision?: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function redactText(value: string, maximumCharacters: number): string {
  return redactEvidence({ source: value, maximumCharacters }).text;
}

function projectName(nativeEvent: unknown): string {
  const parsed = NativeProjectSchema.safeParse(nativeEvent);
  if (!parsed.success) return "unknown-project";
  const leaf = basename(win32.basename(parsed.data.cwd)).trim();
  return redactText(leaf === "" ? "unknown-project" : leaf, 240);
}

function excerptSource(event: HookObservation): "prompt" | "output" | "tool" {
  switch (event.kind) {
    case "prompt":
      return "prompt";
    case "root-stop":
    case "subagent-stop":
      return "output";
    case "tool-request":
    case "tool-result":
      return "tool";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function cloudFinding(finding: EvaluationFinding) {
  return {
    criterion: redactText(finding.criterion, 160),
    message: redactText(finding.message, 4_000),
    correction: redactText(finding.correction, 4_000),
  };
}

function evaluationMetadata(input: {
  readonly event: HookObservation;
  readonly decision: StopDecision;
  readonly constraint: EvaluationConstraint;
  readonly attempts: number;
  readonly latencyMs: number;
  readonly evaluatorVersion: string;
}) {
  const evaluation = input.decision.evaluation;
  const common = {
    evaluationId: createEvaluationId(
      `evaluation:${sha256(
        JSON.stringify({
          eventId: input.event.eventId,
          policyVersionId: input.constraint.policyVersionId,
          evaluation,
        }),
      )}`,
    ),
    policyId: input.constraint.policyId,
    policyVersionId: input.constraint.policyVersionId,
    evaluatorVersion: input.evaluatorVersion,
    attempts: input.attempts,
    latencyMs: input.latencyMs,
    cost: { kind: "unavailable" as const },
  };
  switch (evaluation.kind) {
    case "pass":
      return { ...common, kind: "pass" as const, score: evaluation.score ?? 1 };
    case "retryable-failure":
      return {
        ...common,
        kind: "retryable-failure" as const,
        score: evaluation.score ?? 0,
        retryOrdinal: evaluation.retryOrdinal,
        findings: evaluation.findings.map(cloudFinding),
      };
    case "terminal-failure":
      return {
        ...common,
        kind: "terminal-failure" as const,
        score: evaluation.score ?? 0,
        reason: evaluation.reason,
        findings: evaluation.findings.map(cloudFinding),
      };
    case "inconclusive":
      if (evaluation.advisory === undefined) {
        return {
          ...common,
          kind: "inconclusive" as const,
          reason: redactText(evaluation.reason, 1_000),
        };
      }
      return {
        ...common,
        kind: "late" as const,
        receivedAt: evaluation.advisory.receivedAt,
        advisory:
          evaluation.advisory.result.kind === "pass"
            ? {
                kind: "pass" as const,
                score: evaluation.advisory.result.score,
              }
            : {
                kind: "fail" as const,
                score: evaluation.advisory.result.score,
                findings: evaluation.advisory.result.findings.map(cloudFinding),
              },
      };
    default: {
      const exhaustive: never = evaluation;
      return exhaustive;
    }
  }
}

function resolutionProof(
  decision: Extract<SupervisionDecision, { kind: "prompt-decision" }>,
) {
  const candidates = decision.resolution.candidates.map((entry) => ({
    skillVersionId: entry.candidate.skillVersionId,
    administratorPriority: entry.candidate.administratorPriority,
    specificity: entry.candidate.specificity,
    outcome:
      entry.outcome.kind === "selected"
        ? { kind: "selected" as const }
        : { kind: "rejected" as const, reason: entry.outcome.reason },
  }));
  return decision.resolution.kind === "selected"
    ? {
        kind: "selected" as const,
        selectedSkillVersionId: decision.resolution.selected.skillVersionId,
        candidates,
      }
    : { kind: "no-match" as const, candidates };
}

export function projectCloudSupervisionRecord(
  input: ProjectCloudRecordInput,
): CloudSupervisionRecord {
  if (input.event.eventId !== input.decision.eventId) {
    throw new Error("Cannot project a decision for a different event.");
  }
  if (!Number.isSafeInteger(input.attempts) || input.attempts < 1 || input.attempts > 3) {
    throw new Error("Cloud evaluation attempts must be between one and three.");
  }
  if (!Number.isSafeInteger(input.latencyMs) || input.latencyMs < 0) {
    throw new Error("Cloud evaluation latency must be a nonnegative integer.");
  }
  const common = {
    schemaVersion: 1 as const,
    occurredAt: input.event.occurredAt,
    runId: input.event.runId,
    workItemId: input.event.workItemId,
    project: projectName(input.nativeEvent),
    runtime: input.event.capabilities.runtime,
    runtimeVersion: input.event.capabilities.runtimeVersion,
    adapterVersion: input.event.adapterVersion,
    capabilities: input.event.capabilities,
    identity: input.event.identity,
    enforcement: input.decision.enforcement,
    evidenceDigest: input.evidence.digest,
    redactedExcerpts: [
      {
        source: excerptSource(input.event),
        text: redactText(input.evidence.redactedExcerpt, 4_000),
        redaction: {
          kind: "applied" as const,
          rulesetVersion: REDACTION_RULESET_VERSION,
        },
      },
    ],
  };

  switch (input.event.kind) {
    case "prompt": {
      if (input.decision.kind !== "prompt-decision") {
        throw new Error("Prompt event has a non-prompt decision.");
      }
      return CloudSupervisionRecordSchema.parse({
        ...common,
        kind: "prompt-resolution",
        promptDigest: sha256(input.event.prompt),
        resolution: resolutionProof(input.decision),
      });
    }
    case "tool-request": {
      if (input.decision.kind !== "tool-request-decision") {
        throw new Error("Tool request has a non-tool decision.");
      }
      const outcome =
        input.decision.action === "allow"
          ? "allowed"
          : input.decision.action === "deny"
            ? "denied"
            : "observed";
      return CloudSupervisionRecordSchema.parse({
        ...common,
        kind: "tool-observation",
        toolCallId: input.event.toolCallId,
        toolName: redactText(input.event.toolName, 240),
        observation: { phase: "request", outcome },
      });
    }
    case "tool-result": {
      if (input.decision.kind !== "tool-result-decision") {
        throw new Error("Tool result has a non-tool-result decision.");
      }
      return CloudSupervisionRecordSchema.parse({
        ...common,
        kind: "tool-observation",
        toolCallId: input.event.toolCallId,
        toolName: redactText(input.event.toolName, 240),
        observation: { phase: "result", outcome: input.event.outcome.kind },
      });
    }
    case "root-stop":
    case "subagent-stop": {
      if (input.decision.kind !== "stop-decision") {
        throw new Error("Completion has a non-stop decision.");
      }
      const provisionalDisposition =
        input.decision.sanction.kind === "quarantined"
          ? {
              kind: "quarantine" as const,
              skillVersionId: input.decision.sanction.skillVersionId,
              reason: "Verified skill reached the local quarantine threshold.",
              localRevision:
                input.localDispositionRevision ??
                (() => {
                  throw new Error("A local quarantine requires a disposition revision.");
                })(),
            }
          : { kind: "none" as const };
      return CloudSupervisionRecordSchema.parse({
        ...common,
        kind: "completion",
        completionKind: input.event.kind === "root-stop" ? "root" : "subagent",
        attribution: input.event.attribution,
        tokenUsage: input.event.tokenUsage,
        evaluation: evaluationMetadata({
          event: input.event,
          decision: input.decision,
          constraint: input.constraint,
          attempts: input.attempts,
          latencyMs: input.latencyMs,
          evaluatorVersion: input.evaluatorVersion,
        }),
        provisionalDisposition,
      });
    }
    default: {
      const exhaustive: never = input.event;
      return exhaustive;
    }
  }
}
