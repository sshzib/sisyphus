import { describe, expect, it } from "vitest";

import {
  createActivationLeaseId,
  createSkillVersionId,
  createSkillVersionKey,
  createTriggerId,
  type DecisionFor,
  type PromptObservation,
  type RootStopObservation,
  type ToolRequestObservation,
} from "@sisyphus/domain";

import { createCodexAdapter } from "../src/index.js";
import { loadFixture } from "./fixture.js";

const fixedTime = new Date("2026-08-29T10:00:00.000Z");

function adapter() {
  return createCodexAdapter({
    runtimeVersion: "0.99.0",
    adapterVersion: "0.1.0",
    now: () => fixedTime,
  });
}

describe("Codex event parsing", () => {
  it.each([
    ["user-prompt-submit.json", "prompt"],
    ["pre-tool-use.json", "tool-request"],
    ["post-tool-use.json", "tool-result"],
    ["stop.json", "root-stop"],
    ["subagent-stop.json", "subagent-stop"],
  ])("normalizes %s as %s", (fixtureName, expectedKind) => {
    const event = adapter().parseEvent(loadFixture(fixtureName));

    expect(event.kind).toBe(expectedKind);
    expect(event.capabilities.runtime).toBe("codex");
    expect(event.capabilities.runtimeVersion).toBe("0.99.0");
    expect(event.adapterVersion).toBe("0.1.0");
    expect(event.occurredAt).toBe(fixedTime.toISOString());
  });

  it("creates the same event id when the same hook is replayed", () => {
    const raw = loadFixture("stop.json");
    const first = adapter().parseEvent(raw);
    const second = adapter().parseEvent(raw);

    expect(first.eventId).toBe(second.eventId);
    expect(first.workItemId).toBe(second.workItemId);
  });

  it("separates root and subagent completions while sharing the turn retry budget", () => {
    const root = adapter().parseEvent(loadFixture("stop.json"));
    const subagent = adapter().parseEvent(loadFixture("subagent-stop.json"));

    expect(root.kind).toBe("root-stop");
    expect(subagent.kind).toBe("subagent-stop");
    expect(root.workItemId).not.toBe(subagent.workItemId);
    expect(root.retryBudgetId).toBe(subagent.retryBudgetId);
    expect(root.runtimeInstallation).toEqual({
      adapterInstallationId: "codex:local:0.1.0",
      profile: "local",
    });
  });

  it("rejects malformed hook input at the adapter boundary", () => {
    expect(() =>
      adapter().parseEvent({
        hook_event_name: "PreToolUse",
        session_id: "session-001",
        turn_id: "turn-001",
        tool_name: "Bash",
      }),
    ).toThrow();
  });

  it("derives root and subagent identities without vendor fields", () => {
    const root = adapter().deriveIdentity(loadFixture("stop.json"));
    const subagent = adapter().deriveIdentity(loadFixture("subagent-stop.json"));

    expect(root).toEqual({
      sessionId: "session-001",
      agent: { kind: "root", agentId: "codex-root:session-001" },
    });
    expect(subagent).toEqual({
      sessionId: "session-001",
      agent: {
        kind: "subagent",
        agentId: "agent-042",
        parentAgentId: "codex-root:session-001",
      },
    });
  });
});

describe("managed skill activation", () => {
  it("verifies a matching worker-confirmed activation marker", () => {
    expect(
      adapter().verifySkillActivation(loadFixture("post-tool-use-activation.json")),
    ).toEqual({
      kind: "verified",
      skillVersionId: createSkillVersionId("skill-parser-v3"),
      activationLeaseId: createActivationLeaseId("lease-001"),
      method: "activation-marker",
    });
  });

  it("does not verify ordinary tool results", () => {
    expect(adapter().verifySkillActivation(loadFixture("post-tool-use.json"))).toEqual({
      kind: "none",
    });
  });
});

describe("Codex decision rendering", () => {
  it("does not mint an activation lease while rendering an untrusted decision", () => {
    const event = adapter().parseEvent(loadFixture("user-prompt-submit.json"));
    if (event.kind !== "prompt") throw new Error("expected prompt fixture");
    const decision: DecisionFor<PromptObservation> = {
      kind: "prompt-decision",
      eventId: event.eventId,
      enforcement: { kind: "enforced" },
      action: "continue",
      resolution: {
        kind: "selected",
        selected: {
          skillVersionId: createSkillVersionId("skill-parser-v3"),
          stableVersionKey: createSkillVersionKey("parser-v3"),
          displayName: "Parser repair",
          administratorPriority: 10,
          specificity: 20,
          disposition: "active",
          trigger: {
            triggerId: createTriggerId("parser-trigger"),
            kind: "contains",
            pattern: "parser",
          },
        },
        candidates: [],
      },
    };

    const response = adapter().renderDecision(event, decision);

    expect(response).toEqual({ continue: true });
    expect(JSON.stringify(response)).not.toContain("activationLeaseId");
  });

  it("renders an enforced tool denial using the current Codex shape", () => {
    const event = adapter().parseEvent(loadFixture("pre-tool-use.json"));
    if (event.kind !== "tool-request") throw new Error("expected tool request fixture");
    const decision: DecisionFor<ToolRequestObservation> = {
      kind: "tool-request-decision",
      eventId: event.eventId,
      enforcement: { kind: "enforced" },
      action: "deny",
      reason: "The command violates team policy.",
    };

    expect(adapter().renderDecision(event, decision)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "The command violates team policy.",
      },
    });
  });

  it("does not bypass native permissions for an observation-only denial", () => {
    const event = adapter().parseEvent(loadFixture("pre-tool-use.json"));
    if (event.kind !== "tool-request") throw new Error("expected tool request fixture");
    const decision: DecisionFor<ToolRequestObservation> = {
      kind: "tool-request-decision",
      eventId: event.eventId,
      enforcement: {
        kind: "observation",
        reason: "Tool prevention is unavailable.",
        missingCapabilities: ["toolPrevention"],
      },
      action: "observe-denial",
      reason: "The policy would deny this command.",
    };

    expect(adapter().renderDecision(event, decision)).toEqual({});
  });

  it("turns retry findings into Stop continuation feedback", () => {
    const event = adapter().parseEvent(loadFixture("stop.json"));
    if (event.kind !== "root-stop") throw new Error("expected root stop fixture");
    const decision: DecisionFor<RootStopObservation> = {
      kind: "stop-decision",
      eventId: event.eventId,
      enforcement: { kind: "enforced" },
      action: "retry",
      evaluation: {
        kind: "retryable-failure",
        retryOrdinal: 1,
        findings: [
          {
            criterion: "verification",
            message: "The output claims tests passed without evidence.",
            correction: "Run the focused test and report its result.",
            evidence: [],
          },
        ],
      },
      feedback: {
        summary: "Verification is missing.",
        findings: [
          {
            criterion: "verification",
            message: "The output claims tests passed without evidence.",
            correction: "Run the focused test and report its result.",
            evidence: [],
          },
        ],
      },
      sanction: { kind: "not-applicable" },
    };

    expect(adapter().renderDecision(event, decision)).toEqual({
      decision: "block",
      reason:
        "Verification is missing.\n\n- verification: The output claims tests passed without evidence. Correction: Run the focused test and report its result.",
    });
  });
});
