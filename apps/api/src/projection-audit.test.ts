import {
  CloudSupervisionEnvelopeSchema,
  type Capability,
} from "@sisyphus/domain";
import { createDemoSnapshot } from "@sisyphus/ui/demo";
import { describe, expect, it } from "vitest";
import { projectAcceptedCloudRecords } from "./projection.js";

const supported: Capability = { kind: "supported" };

function auditedRetryEnvelope() {
  const runtimeVersion = "0.43.0";
  return CloudSupervisionEnvelopeSchema.parse({
    id: "outbox-audit-retry",
    eventId: "event-audit-retry",
    payload: {
      schemaVersion: 1,
      kind: "completion",
      occurredAt: "2026-08-29T12:00:00.000Z",
      runId: "run-audit-retry",
      workItemId: "work-audit-retry",
      project: "release-audit",
      runtime: "codex",
      runtimeVersion,
      adapterVersion: "0.2.0",
      runtimeInstallation: {
        adapterInstallationId: "installation-codex-local",
        profile: "local",
      },
      capabilities: {
        runtime: "codex",
        runtimeVersion,
        promptInterception: supported,
        skillSelectionControl: supported,
        rootStopContinuation: {
          kind: "partial",
          limitation: "Continuation is temporarily unavailable.",
        },
        subagentStopContinuation: supported,
        toolPrevention: supported,
        toolObservation: supported,
        stableTokenUsage: supported,
        localEvidenceAccess: supported,
      },
      identity: {
        sessionId: "session-audit-retry",
        agent: { kind: "root", agentId: "agent-audit" },
      },
      enforcement: {
        kind: "observation",
        reason: "rootStopContinuation: Continuation is temporarily unavailable.",
        missingCapabilities: ["rootStopContinuation"],
      },
      evidenceDigest: "a".repeat(64),
      redactedExcerpts: [],
      completionKind: "root",
      attribution: {
        kind: "verified",
        skillVersionId: "skill-ts-review@4.2.1",
        activationLeaseId: "lease-audit-retry",
        method: "activation-marker",
      },
      tokenUsage: { kind: "reported", inputTokens: 120, outputTokens: 80 },
      evaluation: {
        kind: "retryable-failure",
        evaluationId: "evaluation-audit-retry",
        policyId: "policy-default",
        policyVersionId: "policy-default@1",
        evaluatorVersion: "deterministic-1",
        attempts: 1,
        latencyMs: 42,
        cost: { kind: "unavailable" },
        score: 0.61,
        retryOrdinal: 1,
        findings: [
          {
            criterion: "correctness",
            message: "The expected check did not pass.",
            correction: "Repair the failing check and verify it.",
          },
        ],
      },
      provisionalDisposition: { kind: "none" },
    },
  });
}

describe("dashboard audit projection", () => {
  it("records retries, degraded enforcement, and adapter changes once", () => {
    const envelope = auditedRetryEnvelope();
    const first = projectAcceptedCloudRecords({
      snapshot: createDemoSnapshot(),
      deviceId: "device-delta",
      records: [envelope],
    });

    expect(first.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "audit-retry-event-audit-retry",
          action: "retry.issued",
        }),
        expect.objectContaining({
          id: "audit-enforcement-degraded-event-audit-retry",
          action: "integration.degraded",
        }),
        expect.objectContaining({
          id: "audit-adapter-changed-event-audit-retry",
          action: "adapter.changed",
        }),
      ]),
    );

    const replayed = projectAcceptedCloudRecords({
      snapshot: first,
      deviceId: "device-delta",
      records: [envelope],
    });
    expect(
      replayed.audit.filter((event) => event.id.endsWith("event-audit-retry")),
    ).toHaveLength(5);
  });
});
