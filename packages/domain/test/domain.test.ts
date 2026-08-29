import { describe, expect, it } from "vitest";

import {
  CloudSupervisionRecordSchema,
  HookObservationSchema,
  RuntimeCapabilitySnapshotSchema,
  SignedPolicyBundlePayloadSchema,
  createActivationLeaseId,
  createAdapterVersion,
  createAgentId,
  createEventId,
  createRunId,
  createRetryBudgetId,
  createRuntimeInstallationIdentity,
  createSessionId,
  createSkillVersionId,
  createSkillVersionKey,
  createTriggerId,
  createWorkItemId,
  isSanctionableAttribution,
  parseStopDecision,
  parseSupervisionDecision,
  resolveSkill,
  type RuntimeCapabilitySnapshot,
  type Capability,
  type SkillMatchCandidate,
} from "../src/index.js";

const supported: Capability = { kind: "supported" };

const capabilities: RuntimeCapabilitySnapshot = {
  runtime: "codex",
  runtimeVersion: "1.0.0",
  promptInterception: supported,
  skillSelectionControl: supported,
  rootStopContinuation: supported,
  subagentStopContinuation: supported,
  toolPrevention: supported,
  toolObservation: supported,
  stableTokenUsage: supported,
  localEvidenceAccess: supported,
};

function cloudRecord() {
  return {
    schemaVersion: 1,
    kind: "completion",
    completionKind: "root",
    occurredAt: "2026-08-29T10:00:00.000Z",
    runId: "run-cloud-1",
    workItemId: "work-cloud-1",
    project: "domain-tests",
    runtime: "codex",
    runtimeVersion: "1.0.0",
    adapterVersion: "adapter-1",
    runtimeInstallation: {
      adapterInstallationId: "installation-1",
      profile: "local",
    },
    capabilities,
    identity: {
      sessionId: "session-cloud-1",
      agent: { kind: "root", agentId: "agent-cloud-1" },
    },
    attribution: { kind: "none" },
    tokenUsage: { kind: "reported", inputTokens: 10, outputTokens: 5 },
    enforcement: { kind: "enforced" },
    evidenceDigest: "a".repeat(64),
    evaluation: {
      kind: "pass",
      evaluationId: "evaluation-cloud-1",
      policyId: "policy-cloud",
      policyVersionId: "policy-cloud@1",
      evaluatorVersion: "evaluator-1",
      attempts: 1,
      latencyMs: 12,
      cost: { kind: "reported", usdMicros: 42 },
      score: 0.98,
    },
    provisionalDisposition: { kind: "none" },
    redactedExcerpts: [
      {
        source: "output",
        text: "Verified output [REDACTED]",
        redaction: { kind: "applied", rulesetVersion: "redactor-1" },
      },
    ],
  };
}

function candidate(input: {
  id: string;
  key: string;
  priority: number;
  specificity: number;
  status?: "active" | "probation" | "quarantined" | "revoked";
}): SkillMatchCandidate {
  return {
    skillVersionId: createSkillVersionId(input.id),
    stableVersionKey: createSkillVersionKey(input.key),
    displayName: input.id,
    administratorPriority: input.priority,
    specificity: input.specificity,
    disposition: input.status ?? "active",
    trigger: {
      triggerId: createTriggerId(`trigger-${input.id}`),
      kind: "contains",
      pattern: input.id,
    },
  };
}

describe("runtime capability snapshots", () => {
  it("rejects partial and unsupported capabilities without explanations", () => {
    expect(() =>
      RuntimeCapabilitySnapshotSchema.parse({
        ...capabilities,
        toolPrevention: { kind: "partial" },
      }),
    ).toThrow();

    expect(() =>
      RuntimeCapabilitySnapshotSchema.parse({
        ...capabilities,
        toolPrevention: { kind: "unsupported" },
      }),
    ).toThrow();
  });
});

describe("normalized observations", () => {
  it("parses a runtime-neutral root stop and strips unknown vendor fields", () => {
    const parsed = HookObservationSchema.parse({
      kind: "root-stop",
      eventId: createEventId("event-1"),
      workItemId: createWorkItemId("work-1"),
      retryBudgetId: createRetryBudgetId("budget-1"),
      runId: createRunId("run-1"),
      occurredAt: "2026-08-29T10:00:00.000Z",
      adapterVersion: createAdapterVersion("adapter-1"),
      runtimeInstallation: createRuntimeInstallationIdentity({
        adapterInstallationId: "installation-1",
        profile: "local",
      }),
      capabilities,
      identity: {
        sessionId: createSessionId("session-1"),
        agent: { kind: "root", agentId: createAgentId("agent-1") },
      },
      output: "done",
      attribution: { kind: "none" },
      tokenUsage: { kind: "unavailable" },
      codexPrivatePayload: { mustNotLeak: true },
    });

    expect(parsed.kind).toBe("root-stop");
    expect("codexPrivatePayload" in parsed).toBe(false);
  });
});

describe("cloud supervision records", () => {
  it("accepts only strict runtime-neutral redacted metadata", () => {
    expect(CloudSupervisionRecordSchema.parse(cloudRecord())).toMatchObject({
      schemaVersion: 1,
      runtime: "codex",
      runtimeInstallation: {
        adapterInstallationId: "installation-1",
        profile: "local",
      },
      evaluation: { kind: "pass", score: 0.98 },
    });
    const { runtimeInstallation: _runtimeInstallation, ...withoutInstallation } =
      cloudRecord();
    expect(() =>
      CloudSupervisionRecordSchema.parse(withoutInstallation),
    ).toThrow();
    expect(() =>
      CloudSupervisionRecordSchema.parse({
        ...cloudRecord(),
        rawPrompt: "must not cross the cloud boundary",
      }),
    ).toThrow();
    expect(() =>
      CloudSupervisionRecordSchema.parse({
        ...cloudRecord(),
        capabilities: { ...capabilities, runtime: "cursor" },
      }),
    ).toThrow();
  });

  it("preserves late advisory score metadata without changing enforcement", () => {
    const record = cloudRecord();
    const parsed = CloudSupervisionRecordSchema.parse({
      ...record,
      evaluation: {
        kind: "late",
        evaluationId: "evaluation-cloud-late",
        policyId: "policy-cloud",
        policyVersionId: "policy-cloud@1",
        evaluatorVersion: "judge-1",
        attempts: 1,
        latencyMs: 10_500,
        cost: { kind: "reported", usdMicros: 125 },
        receivedAt: "2026-08-29T10:01:00.000Z",
        advisory: { kind: "pass", score: 0.91 },
      },
    });
    expect(parsed).toMatchObject({
      kind: "completion",
      enforcement: { kind: "enforced" },
      evaluation: {
        kind: "late",
        advisory: { kind: "pass", score: 0.91 },
      },
    });
  });

  it("requires ordered disposition revisions in signed payloads", () => {
    const base = {
      tenantId: "tenant-1",
      audience: {
        deviceId: "device-1",
        adapterInstallationId: "installation-1",
      },
      revision: 4,
      issuedAt: "2026-08-29T10:00:00.000Z",
      expiresAt: "2026-08-29T10:15:00.000Z",
      adapterConfigurationDigest: "a".repeat(64),
      policies: [
        {
          order: 0,
          runtime: "codex",
          profile: "local",
          passThreshold: 0.8,
          retryLimit: 2,
          requiredCapabilities: ["toolObservation"],
          skillRouting: {
            kind: "unavailable",
            reason: "No managed wrapper is installed for this fixture.",
          },
          constraint: {
            policyId: "policy-1",
            policyVersionId: "policy-1@1",
            requiredCapabilities: ["toolObservation"],
            skillCandidates: [],
            cloudEvidence: { kind: "disabled" },
            toolPolicy: { kind: "allow" },
          },
        },
      ],
    };
    expect(
      SignedPolicyBundlePayloadSchema.parse({
        ...base,
        dispositionTransitions: [],
      }),
    ).toMatchObject({ revision: 4 });
    expect(() =>
      SignedPolicyBundlePayloadSchema.parse({
        ...base,
        policies: [
          {
            ...base.policies[0],
            constraint: {
              ...base.policies[0]?.constraint,
              cloudEvidence: {
                kind: "redacted-excerpts",
                sources: ["output", "output"],
                maximumCharacters: 500,
              },
            },
          },
        ],
        dispositionTransitions: [],
      }),
    ).toThrow("Cloud evidence sources must be unique");
    expect(() =>
      SignedPolicyBundlePayloadSchema.parse({
        ...base,
        dispositionTransitions: [
          {
            kind: "restoration",
            skillVersionId: "skill-1@1",
            reason: "Administrator restored the tested skill.",
            actor: "admin-1",
            occurredAt: "2026-08-29T09:00:00.000Z",
            revision: 2,
          },
          {
            kind: "quarantine",
            skillVersionId: "skill-2@1",
            reason: "Administrator restored another tested skill.",
            actor: "admin-1",
            occurredAt: "2026-08-29T09:30:00.000Z",
            revision: 1,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      SignedPolicyBundlePayloadSchema.parse({
        ...base,
        dispositionTransitions: [
          {
            kind: "revocation",
            skillVersionId: "skill-1@1",
            reason: "Administrator permanently revoked the compromised version.",
            actor: "admin-1",
            occurredAt: "2026-08-29T09:00:00.000Z",
            revision: 1,
          },
          {
            kind: "restoration",
            skillVersionId: "skill-1@1",
            reason: "Administrator attempted to restore the revoked version.",
            actor: "admin-1",
            occurredAt: "2026-08-29T09:30:00.000Z",
            revision: 2,
          },
        ],
      }),
    ).toThrow();
  });
});

describe("skill resolution", () => {
  it("uses priority, then specificity, then the skill-version ID", () => {
    const result = resolveSkill([
      candidate({ id: "specific", key: "z", priority: 4, specificity: 20 }),
      candidate({ id: "priority", key: "z", priority: 5, specificity: 1 }),
      candidate({ id: "version-a", key: "z", priority: 5, specificity: 10 }),
      candidate({ id: "version-z", key: "a", priority: 5, specificity: 10 }),
    ]);

    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.selected.skillVersionId).toBe(createSkillVersionId("version-a"));
      expect(result.candidates.map((entry) => entry.outcome.kind)).toEqual([
        "rejected",
        "rejected",
        "selected",
        "rejected",
      ]);
      expect(result.candidates[3]?.outcome).toEqual({
        kind: "rejected",
        reason: "lexical-tiebreak",
      });
    }
  });

  it("excludes quarantined and revoked versions", () => {
    const result = resolveSkill([
      candidate({ id: "quarantined", key: "a", priority: 100, specificity: 100, status: "quarantined" }),
      candidate({ id: "revoked", key: "b", priority: 100, specificity: 100, status: "revoked" }),
      candidate({ id: "active", key: "c", priority: 1, specificity: 1 }),
    ]);

    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.selected.skillVersionId).toBe(createSkillVersionId("active"));
      expect(result.candidates[0]?.outcome).toEqual({ kind: "rejected", reason: "quarantined" });
      expect(result.candidates[1]?.outcome).toEqual({ kind: "rejected", reason: "revoked" });
    }
  });
});

describe("attribution", () => {
  it("allows only verified attribution to affect sanctions", () => {
    expect(isSanctionableAttribution({ kind: "none" })).toBe(false);
    expect(
      isSanctionableAttribution({
        kind: "inferred",
        skillVersionId: createSkillVersionId("skill-1"),
        reason: "prompt matched",
      }),
    ).toBe(false);
    expect(
      isSanctionableAttribution({
        kind: "verified",
        skillVersionId: createSkillVersionId("skill-1"),
        activationLeaseId: createActivationLeaseId("lease-1"),
        method: "activation-marker",
      }),
    ).toBe(true);
  });
});

describe("decision boundaries", () => {
  it("parses persisted decisions without weakening retry enforcement", () => {
    const decision = {
      kind: "stop-decision",
      action: "retry",
      eventId: createEventId("decision-1"),
      enforcement: { kind: "enforced" },
      evaluation: {
        kind: "retryable-failure",
        retryOrdinal: 1,
        findings: [
          {
            criterion: "correctness",
            message: "wrong result",
            correction: "return the expected result",
            evidence: [],
          },
        ],
      },
      feedback: {
        summary: "return the expected result",
        findings: [
          {
            criterion: "correctness",
            message: "wrong result",
            correction: "return the expected result",
            evidence: [],
          },
        ],
      },
      sanction: { kind: "not-applicable" },
    };

    expect(parseStopDecision(decision)).toMatchObject({ action: "retry" });
    expect(parseSupervisionDecision(decision)).toMatchObject({ kind: "stop-decision" });
    expect(() =>
      parseStopDecision({
        ...decision,
        enforcement: {
          kind: "observation",
          reason: "unsupported",
          missingCapabilities: ["rootStopContinuation"],
        },
      }),
    ).toThrow();
  });
});
