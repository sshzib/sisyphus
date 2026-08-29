import {
  CloudSupervisionEnvelopeSchema,
  type CloudSupervisionEnvelope,
} from "@sisyphus/domain";
import { createDemoSnapshot } from "@sisyphus/ui/demo";
import { describe, expect, it } from "vitest";
import { projectAcceptedCloudRecords } from "./projection.js";

const supported = { kind: "supported" } as const;

function completion(input: {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly evaluation:
    | { readonly kind: "pass"; readonly score: number; readonly attempts?: number }
    | { readonly kind: "inconclusive"; readonly reason: string }
    | { readonly kind: "terminal-failure"; readonly score: number };
  readonly attribution: "verified" | "inferred";
  readonly profile?: "local" | "cloud-agent";
  readonly runtimeVersion?: string;
}): CloudSupervisionEnvelope {
  const runtimeVersion = input.runtimeVersion ?? "0.42.0";
  const profile = input.profile ?? "local";
  const evaluationBase = {
    evaluationId: `evaluation-${input.eventId}`,
    policyId: "policy-metrics",
    policyVersionId: "policy-metrics@1",
    evaluatorVersion: "metrics-test-1",
    attempts:
      input.evaluation.kind === "pass"
        ? (input.evaluation.attempts ?? 1)
        : input.evaluation.kind === "terminal-failure"
          ? 3
          : 1,
    latencyMs: 20,
    cost: { kind: "unavailable" } as const,
  };
  const evaluation =
    input.evaluation.kind === "pass"
      ? { ...evaluationBase, kind: "pass" as const, score: input.evaluation.score }
      : input.evaluation.kind === "inconclusive"
        ? {
            ...evaluationBase,
            kind: "inconclusive" as const,
            reason: input.evaluation.reason,
          }
        : {
            ...evaluationBase,
            kind: "terminal-failure" as const,
            score: input.evaluation.score,
            reason: "retries-exhausted" as const,
            findings: [
              {
                criterion: "correctness",
                message: "The result is still incorrect.",
                correction: "Repair and verify the result.",
              },
            ],
          };
  return CloudSupervisionEnvelopeSchema.parse({
    id: `outbox-${input.eventId}`,
    eventId: input.eventId,
    payload: {
      schemaVersion: 1,
      kind: "completion",
      occurredAt: input.occurredAt,
      runId: `run-${input.eventId}`,
      workItemId: `work-${input.eventId}`,
      project: "metrics-project",
      runtime: "codex",
      runtimeVersion,
      adapterVersion: "0.1.0",
      runtimeInstallation: {
        adapterInstallationId: `installation-codex-${profile}`,
        profile,
      },
      capabilities: {
        runtime: "codex",
        runtimeVersion,
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
        sessionId: `session-${input.eventId}`,
        agent: { kind: "root", agentId: "agent-metrics" },
      },
      enforcement: { kind: "enforced" },
      evidenceDigest: "a".repeat(64),
      redactedExcerpts: [],
      completionKind: "root",
      attribution:
        input.attribution === "verified"
          ? {
              kind: "verified",
              skillVersionId: "skill-metrics@1.0.0",
              activationLeaseId: `lease-${input.eventId}`,
              method: "activation-marker",
            }
          : {
              kind: "inferred",
              skillVersionId: "skill-metrics@1.0.0",
              reason: "The activation marker was not observed.",
            },
      tokenUsage: { kind: "reported", inputTokens: 100, outputTokens: 50 },
      evaluation,
      provisionalDisposition: { kind: "none" },
    },
  });
}

describe("dashboard performance projection", () => {
  it("projects equal-timestamp integration changes independently of ingest order", () => {
    const firstVersion = completion({
      eventId: "integration-order-first",
      occurredAt: "2026-08-29T12:02:00.000Z",
      evaluation: { kind: "pass", score: 1 },
      attribution: "verified",
      runtimeVersion: "0.43.0",
    });
    const secondVersion = completion({
      eventId: "integration-order-second",
      occurredAt: "2026-08-29T12:02:00.000Z",
      evaluation: { kind: "pass", score: 1 },
      attribution: "verified",
      runtimeVersion: "0.44.0",
    });
    const project = (records: CloudSupervisionEnvelope[]) =>
      projectAcceptedCloudRecords({
        snapshot: createDemoSnapshot(),
        deviceId: "device-delta",
        records,
      }).integrations.find(
        (integration) =>
          integration.adapterInstallationId ===
          firstVersion.payload.runtimeInstallation.adapterInstallationId,
      );

    expect(project([firstVersion, secondVersion])).toEqual(
      project([secondVersion, firstVersion]),
    );
    expect(project([firstVersion, secondVersion])).toMatchObject({
      runtimeVersion: "0.44.0",
      lastSeenAt: "2026-08-29T12:02:00.000Z",
    });
  });

  it("keeps the newest completion when an older replacement arrives later", () => {
    const newest = completion({
      eventId: "replacement-newest",
      occurredAt: "2026-08-29T12:01:00.000Z",
      evaluation: { kind: "pass", score: 1 },
      attribution: "verified",
    });
    const older = CloudSupervisionEnvelopeSchema.parse({
      ...completion({
        eventId: "replacement-older",
        occurredAt: "2026-08-29T12:00:00.000Z",
        evaluation: { kind: "terminal-failure", score: 0 },
        attribution: "verified",
      }),
      payload: {
        ...completion({
          eventId: "replacement-older-payload",
          occurredAt: "2026-08-29T12:00:00.000Z",
          evaluation: { kind: "terminal-failure", score: 0 },
          attribution: "verified",
        }).payload,
        runId: newest.payload.runId,
        workItemId: newest.payload.workItemId,
      },
    });

    const snapshot = projectAcceptedCloudRecords({
      snapshot: createDemoSnapshot(),
      deviceId: "device-delta",
      records: [newest, older],
    });

    expect(
      snapshot.runs.find(
        (run) => run.id === `${newest.payload.runId}:${newest.payload.workItemId}`,
      ),
    ).toMatchObject({
      eventId: newest.eventId,
      result: "pass",
      score: 100,
    });
    expect(snapshot.agents.find((agent) => agent.name === "agent-metrics")).toMatchObject({
      runs: 1,
      passRate: 100,
      terminalFailures: 0,
    });
  });

  it("separates profile and runtime-upgrade comparison cohorts", () => {
    const snapshot = projectAcceptedCloudRecords({
      snapshot: createDemoSnapshot(),
      deviceId: "device-delta",
      records: [
        completion({
          eventId: "cohort-local",
          occurredAt: "2026-08-29T11:57:00.000Z",
          evaluation: { kind: "pass", score: 0.9 },
          attribution: "verified",
        }),
        completion({
          eventId: "cohort-cloud",
          occurredAt: "2026-08-29T11:58:00.000Z",
          evaluation: { kind: "pass", score: 0.9 },
          attribution: "verified",
          profile: "cloud-agent",
        }),
        completion({
          eventId: "cohort-upgrade",
          occurredAt: "2026-08-29T11:59:00.000Z",
          evaluation: { kind: "pass", score: 0.9 },
          attribution: "verified",
          runtimeVersion: "0.43.0",
        }),
      ],
    });

    const cohorts = snapshot.agents.filter(
      (agent) => agent.name === "agent-metrics",
    );
    expect(cohorts).toHaveLength(3);
    expect(new Set(cohorts.map((agent) => agent.comparisonCohortId)).size).toBe(3);
  });

  it("does not dilute scores or pass rates with inconclusive runs", () => {
    const snapshot = projectAcceptedCloudRecords({
      snapshot: createDemoSnapshot(),
      deviceId: "device-delta",
      records: [
        completion({
          eventId: "metrics-inconclusive",
          occurredAt: "2026-08-29T12:00:00.000Z",
          evaluation: { kind: "inconclusive", reason: "Judge timed out." },
          attribution: "verified",
        }),
        completion({
          eventId: "metrics-pass",
          occurredAt: "2026-08-29T12:01:00.000Z",
          evaluation: { kind: "pass", score: 0.9 },
          attribution: "verified",
        }),
        completion({
          eventId: "metrics-recovered",
          occurredAt: "2026-08-29T12:02:00.000Z",
          evaluation: { kind: "pass", score: 1, attempts: 2 },
          attribution: "verified",
        }),
      ],
    });

    expect(snapshot.agents.find((agent) => agent.name === "agent-metrics")).toMatchObject({
      runs: 3,
      conclusiveRuns: 2,
      scoredRuns: 2,
      retryRuns: 1,
      passRate: 100,
      retryRecoveryRate: 100,
      averageScore: 95,
    });
  });

  it("measures inferred attribution without treating it as a sanction failure", () => {
    const snapshot = projectAcceptedCloudRecords({
      snapshot: createDemoSnapshot(),
      deviceId: "device-delta",
      records: [
        completion({
          eventId: "metrics-inferred-failure",
          occurredAt: "2026-08-29T12:03:00.000Z",
          evaluation: { kind: "terminal-failure", score: 0.2 },
          attribution: "inferred",
        }),
        completion({
          eventId: "metrics-verified-pass",
          occurredAt: "2026-08-29T12:04:00.000Z",
          evaluation: { kind: "pass", score: 1 },
          attribution: "verified",
        }),
      ],
    });

    expect(
      snapshot.skills.find(
        (skill) => skill.skillVersionId === "skill-metrics@1.0.0",
      ),
    ).toMatchObject({
      runs: 2,
      verifiedAttributionRate: 50,
      passRate: 50,
      terminalFailures: 0,
    });
  });
});
