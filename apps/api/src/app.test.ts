import { verify as verifySignature } from "node:crypto";
import {
  CloudSupervisionRecordSchema,
  JudgeResultSchema,
  type CloudSupervisionRecord,
  type CompletionCloudRecord,
  type JudgeResult,
} from "@sisyphus/domain";
import {
  AuditEventSchema,
  DashboardSnapshotSchema,
  RestoreSkillResponseSchema,
} from "@sisyphus/ui/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp, type CreateAppOptions } from "./app.js";
import { canonicalJson } from "./canonical-json.js";
import type { JudgeProvider, JudgeProviderInput } from "./judge.js";
import {
  Ed25519PolicyBundleSigner,
  POLICY_BUNDLE_RENEWAL_LEAD_MS,
  POLICY_BUNDLE_VALIDITY_MS,
  SignedPolicyBundleSchema,
} from "./policy-bundle.js";
import { demoCredentials } from "./repository.js";

const openApps: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

async function testApp(options?: CreateAppOptions) {
  const app = await createApp(options);
  openApps.push(app);
  return app;
}

class RecordingJudgeProvider implements JudgeProvider {
  public calls = 0;
  public apiKey: string | undefined;

  public constructor(private readonly result: JudgeResult) {}

  public async judge(input: JudgeProviderInput): Promise<JudgeResult> {
    this.calls += 1;
    this.apiKey = input.apiKey;
    return this.result;
  }
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function cloudRecordBase(input: { runId: string; agentId?: string }) {
  const supported = { kind: "supported" };
  return {
    schemaVersion: 1,
    occurredAt: "2026-08-29T10:30:00.000Z",
    runId: input.runId,
    workItemId: `work-${input.runId}`,
    project: "release-audit",
    runtime: "codex",
    runtimeVersion: "0.42.0",
    adapterVersion: "0.1.0",
    capabilities: {
      runtime: "codex",
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
      sessionId: `session-${input.runId}`,
      agent: { kind: "root", agentId: input.agentId ?? "agent-batch" },
    },
    enforcement: { kind: "enforced" },
    evidenceDigest: "a".repeat(64),
    redactedExcerpts: [
      {
        source: "output",
        text: "All checks passed. [REDACTED]",
        redaction: { kind: "applied", rulesetVersion: "redactor-1" },
      },
    ],
  };
}

function cloudPayload(input: {
  runId: string;
  score?: number;
  agentId?: string;
}): CompletionCloudRecord {
  const record = CloudSupervisionRecordSchema.parse({
    ...cloudRecordBase({
      runId: input.runId,
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    }),
    kind: "completion",
    completionKind: "root",
    attribution: {
      kind: "verified",
      skillVersionId: "skill-ts-review@4.2.1",
      activationLeaseId: `lease-${input.runId}`,
      method: "activation-marker",
    },
    tokenUsage: { kind: "reported", inputTokens: 320, outputTokens: 180 },
    evaluation: {
      kind: "pass",
      evaluationId: `evaluation-${input.runId}`,
      policyId: "policy-default",
      policyVersionId: "policy-default@1",
      evaluatorVersion: "deterministic-1",
      attempts: 1,
      latencyMs: 48,
      cost: { kind: "unavailable" },
      score: input.score ?? 0.96,
    },
    provisionalDisposition: { kind: "none" },
  });
  if (record.kind !== "completion") {
    throw new Error("The cloud completion fixture parsed as another record kind.");
  }
  return record;
}

function promptResolutionPayload(runId: string): CloudSupervisionRecord {
  return CloudSupervisionRecordSchema.parse({
    ...cloudRecordBase({ runId }),
    kind: "prompt-resolution",
    promptDigest: "b".repeat(64),
    resolution: {
      kind: "selected",
      selectedSkillVersionId: "skill-ts-review@4.2.1",
      candidates: [
        {
          skillVersionId: "skill-ts-review@4.2.1",
          administratorPriority: 90,
          specificity: 80,
          outcome: { kind: "selected" },
        },
        {
          skillVersionId: "skill-boundaries@1.6.0",
          administratorPriority: 70,
          specificity: 95,
          outcome: { kind: "rejected", reason: "lower-priority" },
        },
      ],
    },
  });
}

function toolObservationPayload(runId: string): CloudSupervisionRecord {
  return CloudSupervisionRecordSchema.parse({
    ...cloudRecordBase({ runId }),
    kind: "tool-observation",
    toolCallId: `tool-${runId}`,
    toolName: "shell",
    observation: { phase: "result", outcome: "succeeded" },
  });
}

function cloudEnvelope(input: {
  id: string;
  eventId: string;
  score?: number;
  agentId?: string;
}) {
  return {
    id: input.id,
    eventId: input.eventId,
    payload: cloudPayload({
      runId: `run-${input.eventId}`,
      ...(input.score === undefined ? {} : { score: input.score }),
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    }),
  };
}

describe("control plane tenancy", () => {
  it("derives the tenant from the bearer credential", async () => {
    const app = await testApp();
    const acmeResponse = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: bearer(demoCredentials.acmeAdmin),
    });
    const betaResponse = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: bearer(demoCredentials.betaAdmin),
    });

    expect(acmeResponse.statusCode).toBe(200);
    expect(betaResponse.statusCode).toBe(200);
    const acme = DashboardSnapshotSchema.parse(acmeResponse.json());
    const beta = DashboardSnapshotSchema.parse(betaResponse.json());
    expect(acme.agents.some((agent) => agent.name === "Atlas")).toBe(true);
    expect(beta.agents.map((agent) => agent.name)).toEqual(["Beta Builder"]);
    expect(beta.agents.some((agent) => agent.name === "Atlas")).toBe(false);
  });

  it("does not allow an administrator to restore another tenant's skill", async () => {
    const app = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/skills/skill-refactor%401.9.2/restore",
      headers: bearer(demoCredentials.betaAdmin),
      payload: { reason: "Reviewed and approved after adapter changes." },
    });

    expect(response.statusCode).toBe(404);
  });

  it("requires an administrator for restoration and records probation", async () => {
    const app = await testApp();
    const viewerResponse = await app.inject({
      method: "POST",
      url: "/v1/skills/skill-refactor%401.9.2/restore",
      headers: bearer(demoCredentials.acmeViewer),
      payload: { reason: "Reviewed and approved after adapter changes." },
    });
    expect(viewerResponse.statusCode).toBe(403);

    const adminResponse = await app.inject({
      method: "POST",
      url: "/v1/skills/skill-refactor%401.9.2/restore",
      headers: bearer(demoCredentials.acmeAdmin),
      payload: { reason: "Reviewed and approved after adapter changes." },
    });
    expect(adminResponse.statusCode).toBe(200);
    const restored = RestoreSkillResponseSchema.parse(adminResponse.json());
    expect(restored.skill.disposition).toBe("probation");
    expect(restored.auditEvent.actor).toBe("admin@acme.test");
  });
});

describe("worker batch ingest", () => {
  it("accepts replays without creating a second audit event", async () => {
    const app = await testApp();
    const batch = {
      records: [
        cloudEnvelope({
          id: "outbox-17",
          eventId: "worker-event-91",
        }),
      ],
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: batch,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: batch,
    });

    const BatchResponseSchema = z.object({ acceptedIds: z.array(z.string()) }).strict();
    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(BatchResponseSchema.parse(first.json()).acceptedIds).toEqual(["outbox-17"]);
    expect(BatchResponseSchema.parse(replay.json()).acceptedIds).toEqual(["outbox-17"]);

    const auditResponse = await app.inject({
      method: "GET",
      url: "/v1/audit",
      headers: bearer(demoCredentials.acmeAdmin),
    });
    const AuditListSchema = z.object({ items: z.array(AuditEventSchema) }).strict();
    const audit = AuditListSchema.parse(auditResponse.json());
    expect(
      audit.items.filter(
        (event) =>
          event.action === "event.ingested" &&
          event.summary.includes("worker-event-91"),
      ),
    ).toHaveLength(1);
  });

  it("scopes idempotency keys to the authenticated tenant", async () => {
    const app = await testApp();
    const acme = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [cloudEnvelope({ id: "acme-1", eventId: "shared-event" })],
      },
    });
    const beta = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.betaDevice),
      payload: {
        records: [cloudEnvelope({ id: "beta-1", eventId: "shared-event" })],
      },
    });

    expect(acme.statusCode).toBe(202);
    expect(beta.statusCode).toBe(202);
  });

  it("rejects payload collisions and tenant fields", async () => {
    const app = await testApp();
    const first = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [cloudEnvelope({ id: "record-a", eventId: "event-a", score: 0.9 })],
      },
    });
    expect(first.statusCode).toBe(202);

    const collision = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [cloudEnvelope({ id: "record-b", eventId: "event-a", score: 0.12 })],
      },
    });
    expect(collision.statusCode).toBe(409);

    const injectedTenant = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        tenantId: "tenant-beta",
        records: [cloudEnvelope({ id: "record-c", eventId: "event-c" })],
      },
    });
    expect(injectedTenant.statusCode).toBe(400);
  });

  it("rejects arbitrary fields, raw evidence, and nested credential-shaped strings", async () => {
    const app = await testApp();
    const arbitrary = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          {
            id: "arbitrary-record",
            eventId: "arbitrary-event",
            payload: { runtime: "codex", result: "pass", redacted: true },
          },
        ],
      },
    });
    expect(arbitrary.statusCode).toBe(400);

    const valid = cloudPayload({ runId: "run-raw-field" });
    const rawField = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          {
            id: "raw-field-record",
            eventId: "raw-field-event",
            payload: { ...valid, rawPrompt: "Unredacted user prompt" },
          },
        ],
      },
    });
    expect(rawField.statusCode).toBe(400);

    const nestedVendorPayload = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          {
            id: "native-record",
            eventId: "native-event",
            payload: {
              ...valid,
              capabilities: {
                ...valid.capabilities,
                nativeEvent: { codexThreadId: "private-thread" },
              },
            },
          },
        ],
      },
    });
    expect(nestedVendorPayload.statusCode).toBe(400);

    const credentialLeak = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          {
            id: "credential-record",
            eventId: "credential-event",
            payload: {
              ...valid,
              redactedExcerpts: [
                {
                  source: "output",
                  text: "Leaked sk-this-token-should-never-upload-123456789",
                  redaction: {
                    kind: "applied",
                    rulesetVersion: "redactor-1",
                  },
                },
              ],
            },
          },
        ],
      },
    });
    expect(credentialLeak.statusCode).toBe(400);
  });

  it("projects an accepted completion into every dashboard cohort", async () => {
    const app = await testApp();
    const beforeResponse = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: bearer(demoCredentials.acmeAdmin),
    });
    const before = DashboardSnapshotSchema.parse(beforeResponse.json());
    const previousSkill = before.skills.find(
      (skill) => skill.skillVersionId === "skill-ts-review@4.2.1",
    );

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          cloudEnvelope({
            id: "projection-record",
            eventId: "projection-event",
            agentId: "agent-projection",
          }),
        ],
      },
    });
    expect(ingest.statusCode).toBe(202);

    const afterResponse = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: bearer(demoCredentials.acmeAdmin),
    });
    const after = DashboardSnapshotSchema.parse(afterResponse.json());
    expect(after.overview.totalRuns).toBe(before.overview.totalRuns + 1);
    expect(after.runs[0]).toMatchObject({
      id: "run-projection-event:work-run-projection-event",
      result: "pass",
      score: 96,
    });
    expect(
      after.agents.some((agent) => agent.name === "agent-projection"),
    ).toBe(true);
    expect(
      after.skills.find(
        (skill) => skill.skillVersionId === "skill-ts-review@4.2.1",
      )?.runs,
    ).toBe((previousSkill?.runs ?? 0) + 1);
    expect(
      after.integrations.find(
        (integration) =>
          integration.runtime === "codex" && integration.scope === "local",
      )?.lastSeenAt,
    ).toBe("2026-08-29T10:30:00.000Z");
    expect(
      after.devices.find((device) => device.id === "device-delta")?.syncLagSeconds,
    ).toBe(0);
  });

  it("replaces a work item retry without counting another agent sample", async () => {
    const app = await testApp();
    const basePayload = cloudPayload({
      runId: "run-stable-work-item",
      agentId: "agent-stable-work-item",
      score: 0.61,
    });
    const firstPayload = CloudSupervisionRecordSchema.parse({
      ...basePayload,
      evaluation: {
        ...basePayload.evaluation,
        kind: "retryable-failure",
        retryOrdinal: 1,
        findings: [
          {
            criterion: "correctness",
            message: "The first attempt did not satisfy the fixture.",
            correction: "Return the verified result on the retry.",
          },
        ],
      },
    });
    const secondPayload = CloudSupervisionRecordSchema.parse({
      ...basePayload,
      evaluation: {
        ...basePayload.evaluation,
        evaluationId: "evaluation-stable-work-item-retry",
        attempts: 2,
        score: 0.97,
      },
    });
    const first = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          {
            id: "stable-work-item-first",
            eventId: "stable-work-item-event-1",
            payload: firstPayload,
          },
        ],
      },
    });
    const retry = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          {
            id: "stable-work-item-retry",
            eventId: "stable-work-item-event-2",
            payload: secondPayload,
          },
        ],
      },
    });
    expect(first.statusCode).toBe(202);
    expect(retry.statusCode).toBe(202);

    const response = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: bearer(demoCredentials.acmeAdmin),
    });
    const dashboard = DashboardSnapshotSchema.parse(response.json());
    const projectedRuns = dashboard.runs.filter((run) =>
      run.id.startsWith("run-stable-work-item:"),
    );
    const projectedAgents = dashboard.agents.filter(
      (agent) => agent.name === "agent-stable-work-item",
    );
    expect(projectedRuns).toHaveLength(1);
    expect(projectedRuns[0]).toMatchObject({
      eventId: "stable-work-item-event-2",
      attempts: 2,
      score: 97,
    });
    expect(projectedAgents).toHaveLength(1);
    expect(projectedAgents[0]).toMatchObject({
      runs: 1,
      passRate: 100,
      retryRecoveryRate: 100,
      terminalFailures: 0,
      averageScore: 97,
    });
    const projectedSkill = dashboard.skills.find(
      (skill) => skill.skillVersionId === "skill-ts-review@4.2.1",
    );
    expect(projectedSkill).toMatchObject({
      runs: 215,
      passRate: 93.8,
      terminalFailures: 6,
    });
  });

  it("projects prompt conflicts and tool telemetry without uploading raw inputs", async () => {
    const app = await testApp();
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          {
            id: "prompt-record",
            eventId: "prompt-event",
            payload: promptResolutionPayload("run-prompt-event"),
          },
          {
            id: "tool-record",
            eventId: "tool-event",
            payload: toolObservationPayload("run-tool-event"),
          },
        ],
      },
    });
    expect(ingest.statusCode).toBe(202);

    const response = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: bearer(demoCredentials.acmeAdmin),
    });
    const dashboard = DashboardSnapshotSchema.parse(response.json());
    expect(dashboard.conflicts[0]).toMatchObject({
      id: "conflict-prompt-event",
      selectedSkill: "skill-ts-review@4.2.1",
    });
    expect(dashboard.conflicts[0]?.promptSummary).toContain("fingerprint");
    expect(
      dashboard.runs.some(
        (run) => run.id === "run-prompt-event" || run.id === "run-tool-event",
      ),
    ).toBe(false);
    expect(
      dashboard.integrations.find(
        (integration) =>
          integration.runtime === "codex" && integration.scope === "local",
      )?.lastSeenAt,
    ).toBe("2026-08-29T10:30:00.000Z");
  });

  it("requires a device credential", async () => {
    const app = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeAdmin),
      payload: {
        records: [cloudEnvelope({ id: "record-a", eventId: "event-a" })],
      },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("cloud judge", () => {
  it("returns inconclusive when a tenant has no provider", async () => {
    const app = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/judge",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        eventId: "judge-no-provider",
        policyVersionId: "policy-v1",
        redactedInput: "Agent output: tests passed. [REDACTED]",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JudgeResultSchema.parse(response.json())).toEqual({
      kind: "inconclusive",
      reason: "No judge provider is configured for this tenant.",
    });
  });

  it("keeps the provider key out of responses and deduplicates judge replays", async () => {
    const provider = new RecordingJudgeProvider({ kind: "pass", score: 0.93 });
    const app = await testApp({ judgeProvider: provider });
    const apiKey = "sk-demo-encrypted-provider-key-123456789";
    const configuration = await app.inject({
      method: "PUT",
      url: "/v1/judge/provider",
      headers: bearer(demoCredentials.acmeAdmin),
      payload: { apiKey, model: "gpt-5-mini" },
    });
    expect(configuration.statusCode).toBe(200);
    expect(configuration.body).not.toContain(apiKey);

    const judgePayload = {
      eventId: "judge-event-11",
      policyVersionId: "policy-v3",
      redactedInput: "The implementation passed typecheck and seven API tests.",
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/judge",
      headers: bearer(demoCredentials.acmeDevice),
      payload: judgePayload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/judge",
      headers: bearer(demoCredentials.acmeDevice),
      payload: judgePayload,
    });

    expect(JudgeResultSchema.parse(first.json())).toEqual({ kind: "pass", score: 0.93 });
    expect(JudgeResultSchema.parse(replay.json())).toEqual({ kind: "pass", score: 0.93 });
    expect(provider.calls).toBe(1);
    expect(provider.apiKey).toBe(apiKey);
  });

  it("rejects credential-shaped judge input and fails closed to inconclusive on timeout", async () => {
    const timeoutProvider: JudgeProvider = {
      async judge() {
        return new Promise<JudgeResult>(() => undefined);
      },
    };
    const app = await testApp({ judgeProvider: timeoutProvider, judgeDeadlineMs: 5 });
    await app.inject({
      method: "PUT",
      url: "/v1/judge/provider",
      headers: bearer(demoCredentials.acmeAdmin),
      payload: {
        apiKey: "sk-demo-provider-key-abcdefghijklmnopqrstuvwxyz",
        model: "gpt-5-mini",
      },
    });

    const leaked = await app.inject({
      method: "POST",
      url: "/v1/judge",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        eventId: "judge-leak",
        policyVersionId: "policy-v3",
        redactedInput: "Found sk-this-should-have-been-redacted-1234567890 in output.",
      },
    });
    expect(leaked.statusCode).toBe(400);

    const timeout = await app.inject({
      method: "POST",
      url: "/v1/judge",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        eventId: "judge-timeout",
        policyVersionId: "policy-v3",
        redactedInput: "The locally redacted output is ready for evaluation.",
      },
    });
    const timeoutResult = JudgeResultSchema.parse(timeout.json());
    expect(timeoutResult.kind).toBe("inconclusive");
  });
});

describe("signed policy bundles", () => {
  it("signs the tenant-derived policy set with Ed25519", async () => {
    const signer = Ed25519PolicyBundleSigner.generate("test-policy-key");
    const app = await testApp({ policyBundleSigner: signer });
    const response = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });

    expect(response.statusCode).toBe(200);
    const bundle = SignedPolicyBundleSchema.parse(response.json());
    expect(bundle.keyId).toBe("test-policy-key");
    expect(
      verifySignature(
        null,
        Buffer.from(canonicalJson(bundle.payload), "utf8"),
        signer.publicKeyPem,
        Buffer.from(bundle.signature, "base64"),
      ),
    ).toBe(true);
    expect(bundle.payload).toMatchObject({
      tenantId: "tenant-acme",
      audience: {
        deviceId: "device-delta",
        adapterInstallationId: "installation-codex-local",
      },
      revision: 1,
      dispositionTransitions: [],
    });
    expect(bundle.payload.adapterConfigurationDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      bundle.payload.policies.map((policy) => ({
        id: policy.constraint.policyId,
        runtime: policy.runtime,
      })),
    ).toEqual([
      { id: "policy-default", runtime: null },
      { id: "policy-opencode-observe", runtime: "opencode" },
      { id: "policy-protected-tools", runtime: "codex" },
    ]);
    expect(
      bundle.payload.policies.every(
        (policy) =>
          policy.skillRouting.kind === "unavailable" &&
          policy.constraint.skillCandidates.length === 0,
      ),
    ).toBe(true);
  });

  it("reuses an unchanged signed payload and rejects signature reuse after tampering", async () => {
    const signer = Ed25519PolicyBundleSigner.generate("tamper-test-key");
    const app = await testApp({ policyBundleSigner: signer });
    const firstResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });
    const secondResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });
    const first = SignedPolicyBundleSchema.parse(firstResponse.json());
    const second = SignedPolicyBundleSchema.parse(secondResponse.json());
    expect(second).toEqual(first);

    const metricsOnlyIngest = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          cloudEnvelope({
            id: "policy-metrics-record",
            eventId: "policy-metrics-event",
          }),
        ],
      },
    });
    expect(metricsOnlyIngest.statusCode).toBe(202);
    const afterMetricsResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });
    expect(
      SignedPolicyBundleSchema.parse(afterMetricsResponse.json()),
    ).toEqual(first);

    const tamperedPayload = {
      ...first.payload,
      tenantId: "tenant-beta",
    };
    expect(
      verifySignature(
        null,
        Buffer.from(canonicalJson(tamperedPayload), "utf8"),
        signer.publicKeyPem,
        Buffer.from(first.signature, "base64"),
      ),
    ).toBe(false);
  });

  it("renews an unchanged bundle only when its validity window is nearly spent", async () => {
    let nowMs = Date.parse("2026-08-29T10:00:00.000Z");
    const app = await testApp({
      policyBundleSigner:
        Ed25519PolicyBundleSigner.generate("renewal-test-key"),
      clock: () => new Date(nowMs),
    });
    const getBundle = async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/policy-bundle",
        headers: bearer(demoCredentials.acmeDevice),
      });
      return SignedPolicyBundleSchema.parse(response.json());
    };

    const first = await getBundle();
    nowMs +=
      POLICY_BUNDLE_VALIDITY_MS - POLICY_BUNDLE_RENEWAL_LEAD_MS - 1;
    const stillCurrent = await getBundle();
    expect(stillCurrent).toEqual(first);

    nowMs += 1;
    const renewed = await getBundle();
    expect(renewed.payload.revision).toBe(first.payload.revision + 1);
    expect(renewed.payload.issuedAt).not.toBe(first.payload.issuedAt);
    expect(renewed.signature).not.toBe(first.signature);
  });

  it("binds bundles to the authenticated tenant and installation", async () => {
    const app = await testApp();
    const acmeResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });
    const betaResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.betaDevice),
    });
    const acme = SignedPolicyBundleSchema.parse(acmeResponse.json());
    const beta = SignedPolicyBundleSchema.parse(betaResponse.json());
    expect(acme.payload.tenantId).toBe("tenant-acme");
    expect(acme.payload.audience.deviceId).toBe("device-delta");
    expect(beta.payload.tenantId).toBe("tenant-beta");
    expect(beta.payload.audience).toEqual({
      deviceId: "device-beta",
      adapterInstallationId: "installation-claude-local",
    });
    expect(beta.payload.tenantId).not.toBe(acme.payload.tenantId);
  });

  it("signs explicit monotonic disposition transitions", async () => {
    const signer = Ed25519PolicyBundleSigner.generate("restoration-test-key");
    const app = await testApp({ policyBundleSigner: signer });
    const reason = "Administrator verified the replacement adapter and tests.";
    const restoration = await app.inject({
      method: "POST",
      url: "/v1/skills/skill-refactor%401.9.2/restore",
      headers: bearer(demoCredentials.acmeAdmin),
      payload: { reason },
    });
    expect(restoration.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });
    const bundle = SignedPolicyBundleSchema.parse(response.json());
    const transition = bundle.payload.dispositionTransitions[0];
    expect(transition).toMatchObject({
      kind: "restoration",
      skillVersionId: "skill-refactor@1.9.2",
      reason,
      actor: "admin@acme.test",
      revision: 1,
    });
    expect(
      transition === undefined ? Number.NaN : Date.parse(transition.occurredAt),
    ).not.toBe(Number.NaN);
    expect(
      verifySignature(
        null,
        Buffer.from(canonicalJson(bundle.payload), "utf8"),
        signer.publicKeyPem,
        Buffer.from(bundle.signature, "base64"),
      ),
    ).toBe(true);
  });

  it("promotes provisional quarantine and converges restoration in later bundles", async () => {
    const app = await testApp();
    const initialBundleResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });
    const initialBundle = SignedPolicyBundleSchema.parse(
      initialBundleResponse.json(),
    );
    const completion = cloudPayload({ runId: "run-provisional-hold" });
    const quarantinedCompletion = CloudSupervisionRecordSchema.parse({
      ...completion,
      provisionalDisposition: {
        kind: "quarantine",
        skillVersionId: "skill-ts-review@4.2.1",
        reason: "Five terminal failures reached the verified rolling threshold.",
        localRevision: 1,
      },
    });
    const ingest = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: bearer(demoCredentials.acmeDevice),
      payload: {
        records: [
          {
            id: "provisional-hold-record",
            eventId: "provisional-hold-event",
            payload: quarantinedCompletion,
          },
        ],
      },
    });
    expect(ingest.statusCode).toBe(202);

    const heldBundleResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });
    const heldBundle = SignedPolicyBundleSchema.parse(heldBundleResponse.json());
    expect(heldBundle.payload.revision).toBe(
      initialBundle.payload.revision + 1,
    );
    expect(heldBundle.payload.dispositionTransitions).toMatchObject([
      {
        kind: "quarantine",
        skillVersionId: "skill-ts-review@4.2.1",
        actor: "device:device-delta",
        revision: 1,
      },
    ]);

    const restore = await app.inject({
      method: "POST",
      url: "/v1/skills/skill-ts-review%404.2.1/restore",
      headers: bearer(demoCredentials.acmeAdmin),
      payload: {
        reason: "Administrator verified the repaired skill version and evidence.",
      },
    });
    expect(restore.statusCode).toBe(200);
    const restoredBundleResponse = await app.inject({
      method: "GET",
      url: "/v1/policy-bundle",
      headers: bearer(demoCredentials.acmeDevice),
    });
    const restoredBundle = SignedPolicyBundleSchema.parse(
      restoredBundleResponse.json(),
    );
    expect(restoredBundle.payload.revision).toBe(
      heldBundle.payload.revision + 1,
    );
    expect(
      restoredBundle.payload.dispositionTransitions.map((transition) => ({
        kind: transition.kind,
        revision: transition.revision,
      })),
    ).toEqual([
      { kind: "quarantine", revision: 1 },
      { kind: "restoration", revision: 2 },
    ]);
  });
});
