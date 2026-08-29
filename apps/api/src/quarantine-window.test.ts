import {
  CloudSupervisionEnvelopeSchema,
  SkillDispositionTransitionSchema,
  createSkillVersionId,
  type Capability,
  type CloudSupervisionEnvelope,
  type SkillDispositionTransition,
} from "@sisyphus/domain";
import { describe, expect, it } from "vitest";
import {
  evaluateCloudQuarantineWindow,
  quarantineCandidateSkillVersionIds,
} from "./quarantine-window.js";

const skillVersionId = createSkillVersionId("skill-quarantine-test@1.0.0");

function completion(input: {
  eventId: string;
  occurredAt: string;
  runId?: string;
  workItemId?: string;
  outcome?: "pass" | "terminal-failure" | "continuation-unsupported";
  attribution?: "verified" | "inferred";
  enforcement?: "enforced" | "observation";
  routing?: "supported" | "unsupported";
}): CloudSupervisionEnvelope {
  const supported: Capability = { kind: "supported" };
  const unsupported: Capability = {
    kind: "unsupported",
    reason: "The runtime cannot enforce managed routing.",
  };
  const evaluationBase = {
    evaluationId: `evaluation-${input.eventId}`,
    policyId: "policy-default",
    policyVersionId: "policy-default@1",
    evaluatorVersion: "quarantine-test-1",
    attempts: 3,
    latencyMs: 25,
    cost: { kind: "unavailable" } as const,
  };
  const outcome = input.outcome ?? "terminal-failure";
  const evaluation = (() => {
    switch (outcome) {
      case "pass":
        return { ...evaluationBase, kind: "pass" as const, score: 0.97 };
      case "terminal-failure":
        return {
          ...evaluationBase,
          kind: "terminal-failure" as const,
          score: 0.2,
          reason: "retries-exhausted" as const,
          findings: [
            {
              criterion: "correctness",
              message: "The verified checks still fail.",
              correction: "Repair the implementation and rerun the checks.",
            },
          ],
        };
      case "continuation-unsupported":
        return {
          ...evaluationBase,
          kind: "terminal-failure" as const,
          score: 0.2,
          reason: "continuation-unsupported" as const,
          findings: [
            {
              criterion: "continuation",
              message: "The runtime cannot continue after stop.",
              correction: "Observe the result without applying sanctions.",
            },
          ],
        };
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  })();
  return CloudSupervisionEnvelopeSchema.parse({
    id: `record-${input.eventId}`,
    eventId: input.eventId,
    payload: {
      schemaVersion: 1,
      kind: "completion",
      occurredAt: input.occurredAt,
      runId: input.runId ?? `run-${input.eventId}`,
      workItemId: input.workItemId ?? `work-${input.eventId}`,
      project: "quarantine-window-test",
      runtime: "codex",
      runtimeVersion: "0.42.0",
      adapterVersion: "0.1.0",
      runtimeInstallation: {
        adapterInstallationId: "installation-codex-local",
        profile: "local",
      },
      capabilities: {
        runtime: "codex",
        runtimeVersion: "0.42.0",
        promptInterception: supported,
        skillSelectionControl:
          input.routing === "unsupported" ? unsupported : supported,
        rootStopContinuation: supported,
        subagentStopContinuation: supported,
        toolPrevention:
          input.routing === "unsupported" ? unsupported : supported,
        toolObservation: supported,
        stableTokenUsage: supported,
        localEvidenceAccess: supported,
      },
      identity: {
        sessionId: `session-${input.eventId}`,
        agent: { kind: "root", agentId: "agent-quarantine-test" },
      },
      enforcement:
        input.enforcement === "observation"
          ? {
              kind: "observation",
              reason: "The policy is observation-only.",
              missingCapabilities: ["rootStopContinuation"],
            }
          : { kind: "enforced" },
      evidenceDigest: "a".repeat(64),
      redactedExcerpts: [],
      completionKind: "root",
      attribution:
        input.attribution === "inferred"
          ? {
              kind: "inferred",
              skillVersionId,
              reason: "The activation marker was not observed.",
            }
          : {
              kind: "verified",
              skillVersionId,
              activationLeaseId: `lease-${input.eventId}`,
              method: "activation-marker",
            },
      tokenUsage: { kind: "reported", inputTokens: 100, outputTokens: 50 },
      evaluation,
      provisionalDisposition: { kind: "none" },
    },
  });
}

function at(day: number, hour: number): string {
  return `2026-08-${day.toString().padStart(2, "0")}T${hour
    .toString()
    .padStart(2, "0")}:00:00.000Z`;
}

function restoration(occurredAt: string): SkillDispositionTransition {
  return SkillDispositionTransitionSchema.parse({
    kind: "restoration",
    skillVersionId,
    reason: "An administrator verified the repaired skill version.",
    actor: "admin@example.test",
    occurredAt,
    revision: 2,
  });
}

describe("cloud quarantine rolling window", () => {
  it("does not quarantine below five failures", () => {
    const records = [
      ...Array.from({ length: 4 }, (_, index) =>
        completion({
          eventId: `failure-${index}`,
          occurredAt: at(20, index),
        }),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        completion({
          eventId: `pass-${index}`,
          occurredAt: at(20, index + 10),
          outcome: "pass",
        }),
      ),
    ];

    expect(
      evaluateCloudQuarantineWindow({
        records,
        transitions: [],
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: false,
      terminalFailures: 4,
      sampleSize: 10,
    });
  });

  it("quarantines at five terminal failures in the latest ten", () => {
    const records = Array.from({ length: 10 }, (_, index) =>
      completion({
        eventId: `threshold-${index}`,
        occurredAt: at(21, index),
        ...(index >= 5 ? { outcome: "pass" as const } : {}),
      }),
    );

    expect(
      evaluateCloudQuarantineWindow({
        records,
        transitions: [],
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: true,
      terminalFailures: 5,
      sampleSize: 10,
      latestOccurredAt: at(21, 9),
    });
  });

  it("sorts by occurrence time before taking the latest ten", () => {
    const olderFailures = Array.from({ length: 5 }, (_, index) =>
      completion({
        eventId: `older-failure-${index}`,
        occurredAt: at(22, index),
      }),
    );
    const newerPasses = Array.from({ length: 10 }, (_, index) =>
      completion({
        eventId: `newer-pass-${index}`,
        occurredAt: at(22, index + 10),
        outcome: "pass",
      }),
    );

    expect(
      evaluateCloudQuarantineWindow({
        records: [...newerPasses, ...olderFailures].reverse(),
        transitions: [],
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: false,
      terminalFailures: 0,
      sampleSize: 10,
      latestOccurredAt: at(22, 19),
    });
  });

  it("counts only the latest outcome for one logical work item", () => {
    const repeatedFailures = Array.from({ length: 5 }, (_, index) =>
      completion({
        eventId: `same-work-failure-${index}`,
        occurredAt: at(22, index + 1),
        runId: "run-same-work",
        workItemId: "work-same-work",
      }),
    );

    expect(
      evaluateCloudQuarantineWindow({
        records: repeatedFailures,
        transitions: [],
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: false,
      terminalFailures: 1,
      sampleSize: 1,
      latestOccurredAt: at(22, 5),
    });

    expect(
      evaluateCloudQuarantineWindow({
        records: [
          ...repeatedFailures,
          completion({
            eventId: "same-work-recovered",
            occurredAt: at(22, 6),
            runId: "run-same-work",
            workItemId: "work-same-work",
            outcome: "pass",
          }),
        ],
        transitions: [],
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: false,
      terminalFailures: 0,
      sampleSize: 1,
      latestOccurredAt: at(22, 6),
    });

    expect(
      evaluateCloudQuarantineWindow({
        records: [
          ...repeatedFailures,
          completion({
            eventId: "same-work-unverified-correction",
            occurredAt: at(22, 7),
            runId: "run-same-work",
            workItemId: "work-same-work",
            attribution: "inferred",
          }),
        ],
        transitions: [],
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: false,
      terminalFailures: 0,
      sampleSize: 0,
      latestOccurredAt: null,
    });
  });

  it("excludes unverified, observed-only, unroutable, and unsupported-continuation outcomes", () => {
    const validFailure = completion({
      eventId: "valid-failure",
      occurredAt: at(23, 1),
    });
    const validPass = completion({
      eventId: "valid-pass",
      occurredAt: at(23, 2),
      outcome: "pass",
    });
    const records = [
      completion({
        eventId: "unverified",
        occurredAt: at(23, 3),
        attribution: "inferred",
      }),
      completion({
        eventId: "observed",
        occurredAt: at(23, 4),
        enforcement: "observation",
      }),
      completion({
        eventId: "unroutable",
        occurredAt: at(23, 5),
        routing: "unsupported",
      }),
      completion({
        eventId: "unsupported-continuation",
        occurredAt: at(23, 6),
        outcome: "continuation-unsupported",
      }),
      validFailure,
      validPass,
    ];

    expect(
      evaluateCloudQuarantineWindow({
        records,
        transitions: [],
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: false,
      terminalFailures: 1,
      sampleSize: 2,
    });
    expect(quarantineCandidateSkillVersionIds(records)).toEqual([
      skillVersionId,
    ]);
  });

  it("starts a fresh window after restoration", () => {
    const beforeRestoration = Array.from({ length: 5 }, (_, index) =>
      completion({
        eventId: `before-restoration-${index}`,
        occurredAt: at(24, index),
      }),
    );
    const afterRestoration = Array.from({ length: 5 }, (_, index) =>
      completion({
        eventId: `after-restoration-${index}`,
        occurredAt: at(25, index + 1),
        ...(index === 4 ? { outcome: "pass" as const } : {}),
      }),
    );
    const transitions = [restoration(at(25, 0))];

    expect(
      evaluateCloudQuarantineWindow({
        records: [...beforeRestoration, ...afterRestoration],
        transitions,
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: false,
      terminalFailures: 4,
      sampleSize: 5,
    });
    expect(
      evaluateCloudQuarantineWindow({
        records: [
          ...beforeRestoration,
          ...afterRestoration,
          completion({
            eventId: "fifth-after-restoration",
            occurredAt: at(25, 6),
          }),
        ],
        transitions,
        skillVersionId,
      }),
    ).toMatchObject({
      shouldQuarantine: true,
      terminalFailures: 5,
      sampleSize: 6,
    });
  });
});
