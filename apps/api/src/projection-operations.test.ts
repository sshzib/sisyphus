import {
  CloudSupervisionEnvelopeSchema,
  type CloudSupervisionEnvelope,
} from "@sisyphus/domain";
import { createEmptyDashboardSnapshot } from "@sisyphus/ui";
import { describe, expect, it } from "vitest";

import { projectAcceptedCloudRecords } from "./projection.js";

const supported = { kind: "supported" } as const;

function common(input: {
  readonly occurredAt: string;
  readonly workItemId: string;
  readonly identity:
    | { readonly kind: "root"; readonly agentId: string }
    | {
        readonly kind: "subagent";
        readonly agentId: string;
        readonly parentAgentId: string;
        readonly role: string | null;
      };
}) {
  return {
    schemaVersion: 1 as const,
    occurredAt: input.occurredAt,
    runId: "codex:session-auth:turn-1",
    workItemId: input.workItemId,
    project: "identity-service",
    runtime: "codex" as const,
    runtimeVersion: "0.42.0",
    adapterVersion: "0.1.0",
    runtimeInstallation: {
      adapterInstallationId: "installation-codex-local",
      profile: "local" as const,
    },
    capabilities: {
      runtime: "codex" as const,
      runtimeVersion: "0.42.0",
      promptInterception: supported,
      skillSelectionControl: supported,
      rootStopContinuation: supported,
      subagentStopContinuation: supported,
      toolPrevention: supported,
      toolObservation: supported,
      stableTokenUsage: supported,
      localEvidenceAccess: supported,
    },
    identity: {
      sessionId: "session-auth",
      agent: input.identity,
    },
    enforcement: { kind: "enforced" as const },
    evidenceDigest: "a".repeat(64),
    redactedExcerpts: [],
  };
}

function envelope(
  eventId: string,
  payload: Record<string, unknown>,
): CloudSupervisionEnvelope {
  return CloudSupervisionEnvelopeSchema.parse({
    id: `outbox-${eventId}`,
    eventId,
    payload,
  });
}

function passEvaluation(eventId: string) {
  return {
    kind: "pass" as const,
    evaluationId: `evaluation-${eventId}`,
    policyId: "policy-default",
    policyVersionId: "policy-default@1",
    evaluatorVersion: "deterministic-1",
    attempts: 1,
    latencyMs: 20,
    cost: { kind: "unavailable" as const },
    score: 1,
  };
}

describe("live operation projection", () => {
  it("tracks a real root lifecycle and provider-reported subagent role", () => {
    const root = { kind: "root" as const, agentId: "codex-root:session-auth" };
    const records = [
      envelope("event-prompt", {
        ...common({
          occurredAt: "2026-08-30T10:00:00.000Z",
          workItemId: "work-root",
          identity: root,
        }),
        kind: "prompt-resolution",
        promptDigest: "b".repeat(64),
        resolution: { kind: "no-match", candidates: [] },
      }),
      envelope("event-tool", {
        ...common({
          occurredAt: "2026-08-30T10:00:01.000Z",
          workItemId: "work-root",
          identity: root,
        }),
        kind: "tool-observation",
        toolCallId: "tool-auth",
        toolName: "functions.exec",
        observation: { phase: "request", outcome: "allowed" },
      }),
      envelope("event-subagent", {
        ...common({
          occurredAt: "2026-08-30T10:00:02.000Z",
          workItemId: "work-frontend",
          identity: {
            kind: "subagent",
            agentId: "agent-frontend",
            parentAgentId: "codex-root:session-auth",
            role: "frontend-agent",
          },
        }),
        kind: "completion",
        completionKind: "subagent",
        attribution: { kind: "none" },
        tokenUsage: { kind: "unavailable" },
        evaluation: passEvaluation("subagent"),
        provisionalDisposition: { kind: "none" },
      }),
      envelope("event-root", {
        ...common({
          occurredAt: "2026-08-30T10:00:03.000Z",
          workItemId: "work-root",
          identity: root,
        }),
        kind: "completion",
        completionKind: "root",
        attribution: { kind: "none" },
        tokenUsage: { kind: "unavailable" },
        evaluation: passEvaluation("root"),
        provisionalDisposition: { kind: "none" },
      }),
    ];

    const projected = projectAcceptedCloudRecords({
      snapshot: createEmptyDashboardSnapshot({
        generatedAt: "2026-08-30T09:59:00.000Z",
      }),
      deviceId: "device-delta",
      records,
    });

    expect(projected.operations).toHaveLength(1);
    expect(projected.operations[0]).toMatchObject({
      runId: "codex:session-auth:turn-1",
      taskSummary: "Prompt bbbbbbbbbbbb",
      project: "identity-service",
      status: "passed",
      completedAt: "2026-08-30T10:00:03.000Z",
    });
    expect(projected.operations[0]?.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "root",
          role: "orchestrator",
          status: "passed",
          activity: "evaluation-completed",
        }),
        expect.objectContaining({
          kind: "subagent",
          role: "frontend-agent",
          status: "passed",
        }),
      ]),
    );
    expect(projected.overview.tokenBurnComparison).toEqual({
      kind: "unavailable",
      reason: "no-paired-runs",
    });
  });

  it("keeps a retryable root operation active and visible as retrying", () => {
    const retry = envelope("event-retry", {
      ...common({
        occurredAt: "2026-08-30T10:01:00.000Z",
        workItemId: "work-root",
        identity: { kind: "root", agentId: "codex-root:session-auth" },
      }),
      kind: "completion",
      completionKind: "root",
      attribution: { kind: "none" },
      tokenUsage: { kind: "unavailable" },
      evaluation: {
        ...passEvaluation("retry"),
        kind: "retryable-failure",
        score: 0.4,
        retryOrdinal: 1,
        findings: [
          {
            criterion: "tests",
            message: "Authentication tests failed.",
            correction: "Repair the failing tests.",
          },
        ],
      },
      provisionalDisposition: { kind: "none" },
    });

    const projected = projectAcceptedCloudRecords({
      snapshot: createEmptyDashboardSnapshot({
        generatedAt: "2026-08-30T09:59:00.000Z",
      }),
      deviceId: "device-delta",
      records: [retry],
    });

    expect(projected.operations[0]).toMatchObject({
      status: "retrying",
      completedAt: null,
      agents: [expect.objectContaining({ status: "retrying", attempts: 1 })],
    });
  });
});
