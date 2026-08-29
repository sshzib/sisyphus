import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createActivationLeaseId,
  createAdapterInstallationId,
  createAdapterVersion,
  createAgentId,
  createDeviceId,
  createEventId,
  createRunId,
  createRetryBudgetId,
  createRuntimeInstallationIdentity,
  createSessionId,
  createSkillVersionKey,
  createSkillVersionId,
  createTimestamp,
  createToolCallId,
  createTriggerId,
  createWorkItemId,
  type Capability,
  type DecisionFor,
  type Enforcement,
  type HookObservation,
  type AgentRuntime,
  type RuntimeCapabilitySnapshot,
  type RuntimeIdentity,
  type SkillActivationEvidence,
  type StopDecision,
} from "@sisyphus/domain";

import {
  assertAdapterConformance,
  managedActivationForDecision,
  runAdapterConformance,
  type AdapterDecisionContext,
  type AdapterConformanceFixture,
  type AdapterInstallRequest,
  type AdapterInstallation,
  type AdapterUninstallRequest,
  type AgentRuntimeAdapter,
} from "../src/index.js";

const RawEventSchema = z.object({
  kind: z.enum(["prompt", "tool-request", "tool-result", "root-stop", "subagent-stop"]),
  vendorSecret: z.string(),
});

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
const identity: RuntimeIdentity = {
  sessionId: createSessionId("session-1"),
  agent: { kind: "root", agentId: createAgentId("agent-1") },
};
const installationIdentity = createRuntimeInstallationIdentity({
  adapterInstallationId: "installation-1",
  profile: "local",
});
const verified: SkillActivationEvidence = {
  kind: "verified",
  skillVersionId: createSkillVersionId("skill-1"),
  activationLeaseId: createActivationLeaseId("lease-1"),
  method: "activation-marker",
};
const selectedSkill = {
  skillVersionId: createSkillVersionId("skill-1"),
  stableVersionKey: createSkillVersionKey("skill-1@1.0.0"),
  displayName: "Managed fixture skill",
  administratorPriority: 100,
  specificity: 100,
  disposition: "active" as const,
  activationAvailability: { kind: "available" as const },
  trigger: {
    triggerId: createTriggerId("trigger-1"),
    kind: "exact" as const,
    pattern: "build it",
  },
};
const workerIssuedActivation = {
  activationLeaseId: createActivationLeaseId("sisyphus-v1.worker-issued-fixture"),
  skillVersionId: selectedSkill.skillVersionId,
  expiresAt: createTimestamp("2026-08-29T10:05:00.000Z"),
};

function common(kind: string) {
  return {
    eventId: createEventId(`event-${kind}`),
    workItemId: createWorkItemId(`work-${kind}`),
    retryBudgetId: createRetryBudgetId(`budget-${kind}`),
    runId: createRunId(`run-${kind}`),
    occurredAt: createTimestamp("2026-08-29T10:00:00.000Z"),
    adapterVersion: createAdapterVersion("adapter-1"),
    runtimeInstallation: installationIdentity,
    capabilities,
    identity,
  };
}

class FixtureAdapter implements AgentRuntimeAdapter {
  readonly runtime: AgentRuntime = "codex";
  readonly installationIdentity = installationIdentity;
  uninstalled = false;

  async probe(): Promise<RuntimeCapabilitySnapshot> {
    return capabilities;
  }

  async install(input: AdapterInstallRequest): Promise<AdapterInstallation> {
    return {
      installationId: createAdapterInstallationId("installation-1"),
      profile: "local",
      runtime: this.runtime,
      adapterVersion: input.adapterVersion,
      installedAt: createTimestamp("2026-08-29T10:00:00.000Z"),
      scope: input.scope,
      capabilities,
    };
  }

  async uninstall(_input: AdapterUninstallRequest): Promise<void> {
    this.uninstalled = true;
  }

  parseEvent(input: unknown): HookObservation {
    const raw = RawEventSchema.parse(input);
    switch (raw.kind) {
      case "prompt":
        return { kind: "prompt", ...common(raw.kind), prompt: "build it" };
      case "tool-request":
        return {
          kind: "tool-request",
          ...common(raw.kind),
          toolCallId: createToolCallId("tool-1"),
          toolName: "shell",
          input: {},
        };
      case "tool-result":
        return {
          kind: "tool-result",
          ...common(raw.kind),
          toolCallId: createToolCallId("tool-1"),
          toolName: "shell",
          outcome: { kind: "succeeded", summary: "ok" },
        };
      case "root-stop":
        return {
          kind: "root-stop",
          ...common(raw.kind),
          output: "done",
          attribution: verified,
          tokenUsage: { kind: "unavailable" },
        };
      case "subagent-stop":
        return {
          kind: "subagent-stop",
          ...common(raw.kind),
          output: "done",
          attribution: verified,
          tokenUsage: { kind: "unavailable" },
        };
      default: {
        const exhaustive: never = raw.kind;
        return exhaustive;
      }
    }
  }

  renderDecision<E extends HookObservation>(
    _event: E,
    decision: DecisionFor<E>,
    context?: AdapterDecisionContext,
  ): unknown {
    const activation = managedActivationForDecision(decision, context);
    if (activation !== undefined) {
      return {
        activationLeaseId: activation.activationLeaseId,
        skillVersionId: activation.skillVersionId,
      };
    }
    return {
      retry: decision.kind === "stop-decision" && decision.action === "retry",
    };
  }

  deriveIdentity(_event: unknown) {
    return identity;
  }

  verifySkillActivation(event: unknown): SkillActivationEvidence {
    const raw = RawEventSchema.parse(event);
    return raw.kind === "root-stop" || raw.kind === "subagent-stop"
      ? verified
      : { kind: "none" };
  }
}

function fixture(): AdapterConformanceFixture {
  const enforcement: Enforcement = { kind: "enforced" };
  const stopDecision = (eventId: string): StopDecision => ({
    kind: "stop-decision",
    action: "retry",
    eventId: createEventId(eventId),
    enforcement,
    evaluation: {
      kind: "retryable-failure",
      retryOrdinal: 1,
      findings: [
        {
          criterion: "correctness",
          message: "wrong",
          correction: "fix it",
          evidence: [],
        },
      ],
    },
    feedback: {
      summary: "fix it",
      findings: [
        {
          criterion: "correctness",
          message: "wrong",
          correction: "fix it",
          evidence: [],
        },
      ],
    },
    sanction: { kind: "not-applicable" },
  });
  return {
    installRequest: {
      deviceId: createDeviceId("device-1"),
      adapterVersion: createAdapterVersion("adapter-1"),
      workerEndpoint: "http://127.0.0.1:4317",
      scope: { kind: "user" },
    },
    uninstallAfterRun: true,
    forbiddenNormalizedKeys: ["vendorSecret"],
    cases: [
      {
        kind: "prompt",
        rawEvent: { kind: "prompt", vendorSecret: "private" },
        decision: {
          kind: "prompt-decision",
          action: "continue",
          eventId: createEventId("event-prompt"),
          enforcement,
          resolution: {
            kind: "selected",
            selected: selectedSkill,
            candidates: [
              { candidate: selectedSkill, outcome: { kind: "selected" } },
            ],
          },
        },
        managedActivation: {
          kind: "required",
          workerIssued: workerIssuedActivation,
          activationResponseAccepted(response, activation) {
            return z
              .object({
                activationLeaseId: z.literal(activation.activationLeaseId),
                skillVersionId: z.literal(activation.skillVersionId),
              })
              .strict()
              .safeParse(response).success;
          },
        },
      },
      {
        kind: "tool-request",
        rawEvent: { kind: "tool-request", vendorSecret: "private" },
        decision: {
          kind: "tool-request-decision",
          action: "allow",
          eventId: createEventId("event-tool-request"),
          enforcement,
        },
      },
      {
        kind: "tool-result",
        rawEvent: { kind: "tool-result", vendorSecret: "private" },
        decision: {
          kind: "tool-result-decision",
          action: "recorded",
          eventId: createEventId("event-tool-result"),
          enforcement,
        },
      },
      {
        kind: "root-stop",
        rawEvent: { kind: "root-stop", vendorSecret: "private" },
        decision: stopDecision("event-root-stop"),
        retryResponseAccepted(response) {
          return z.object({ retry: z.literal(true) }).safeParse(response).success;
        },
      },
      {
        kind: "subagent-stop",
        rawEvent: { kind: "subagent-stop", vendorSecret: "private" },
        decision: stopDecision("event-subagent-stop"),
        retryResponseAccepted(response) {
          return z.object({ retry: z.literal(true) }).safeParse(response).success;
        },
      },
    ],
  };
}

describe("adapter conformance", () => {
  it("checks every normalized event and proves continuation responses", async () => {
    const adapter = new FixtureAdapter();

    const report = await runAdapterConformance({ adapter, fixture: fixture() });

    expect(() => assertAdapterConformance(report)).not.toThrow();
    expect(adapter.uninstalled).toBe(true);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("fails an adapter that leaks a vendor-only key", async () => {
    class LeakyAdapter extends FixtureAdapter {
      override parseEvent(input: unknown): HookObservation {
        const normalized = super.parseEvent(input);
        Object.defineProperty(normalized, "vendorSecret", {
          value: "leaked",
          enumerable: true,
        });
        return normalized;
      }
    }
    const report = await runAdapterConformance({
      adapter: new LeakyAdapter(),
      fixture: fixture(),
    });

    expect(() => assertAdapterConformance(report)).toThrow(/vendor key vendorSecret leaked/);
  });

  it("rejects an adapter-fabricated managed activation lease", async () => {
    class FabricatingAdapter extends FixtureAdapter {
      override renderDecision<E extends HookObservation>(
        event: E,
        decision: DecisionFor<E>,
        context?: AdapterDecisionContext,
      ): unknown {
        if (event.kind === "prompt") {
          const activation = managedActivationForDecision(decision, context);
          return {
            activationLeaseId: "adapter-fabricated-lease",
            skillVersionId: activation?.skillVersionId,
            expectedLeaseDecoy: activation?.activationLeaseId,
          };
        }
        return super.renderDecision(event, decision);
      }
    }
    const report = await runAdapterConformance({
      adapter: new FabricatingAdapter(),
      fixture: fixture(),
    });

    expect(() => assertAdapterConformance(report)).toThrow(
      /worker-issued activation lease/u,
    );
  });

  it("rejects enforced selection when the runtime has only partial control", async () => {
    const partialCapabilities: RuntimeCapabilitySnapshot = {
      ...capabilities,
      skillSelectionControl: {
        kind: "partial",
        limitation: "The runtime cannot enforce exclusive skill routing.",
      },
    };
    class PartialSelectionAdapter extends FixtureAdapter {
      override async probe(): Promise<RuntimeCapabilitySnapshot> {
        return partialCapabilities;
      }

      override async install(input: AdapterInstallRequest): Promise<AdapterInstallation> {
        return {
          ...(await super.install(input)),
          capabilities: partialCapabilities,
        };
      }

      override parseEvent(input: unknown): HookObservation {
        return {
          ...super.parseEvent(input),
          capabilities: partialCapabilities,
        };
      }
    }
    const report = await runAdapterConformance({
      adapter: new PartialSelectionAdapter(),
      fixture: fixture(),
    });

    expect(() => assertAdapterConformance(report)).toThrow(
      /claimed enforcement without supported skill selection control/u,
    );
  });
});
