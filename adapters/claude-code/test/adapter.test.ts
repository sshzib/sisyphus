import { describe, expect, it } from "vitest";

import {
  createActivationLeaseId,
  createEventId,
  createSkillVersionId,
  createSkillVersionKey,
  createTriggerId,
  createTimestamp,
  type PromptDecision,
  type PromptObservation,
  type RootStopObservation,
  type ToolRequestObservation,
} from "@sisyphus/domain";

import {
  createClaudeCodeAdapter,
  parseClaudeHookEvent,
} from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("Claude Code adapter", () => {
  it("normalizes modern hook payloads with prompt-scoped run IDs", () => {
    const adapter = createClaudeCodeAdapter({
      runtimeVersion: "2.1.229",
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    const prompt = adapter.parseEvent(loadFixture("user-prompt-submit.json"));
    const tool = adapter.parseEvent(loadFixture("pre-tool-use.json"));

    expect(prompt.kind).toBe("prompt");
    expect(tool.kind).toBe("tool-request");
    expect(prompt.runId).toBe(tool.runId);
    expect(prompt.capabilities.runtime).toBe("claude-code");
  });

  it("keeps consecutive promptless-ID turns separate within one session", () => {
    const adapter = createClaudeCodeAdapter();
    const fixturePrompt = parseClaudeHookEvent(loadFixture("user-prompt-submit.json"));
    const fixtureStop = parseClaudeHookEvent(loadFixture("stop.json"));
    if (
      fixturePrompt.hook_event_name !== "UserPromptSubmit" ||
      fixtureStop.hook_event_name !== "Stop"
    ) {
      throw new Error("invalid turn fixtures");
    }
    const { prompt_id: _promptId, ...promptWithoutId } = fixturePrompt;
    const { prompt_id: _stopPromptId, ...stopWithoutId } = fixtureStop;

    const firstPrompt = adapter.parseEvent(promptWithoutId);
    const firstStop = adapter.parseEvent(stopWithoutId);
    if (firstStop.kind !== "root-stop") throw new Error("invalid first stop");
    expect(firstPrompt.workItemId).toBe(firstStop.workItemId);
    adapter.renderDecision<RootStopObservation>(firstStop, {
      kind: "stop-decision",
      eventId: firstStop.eventId,
      enforcement: { kind: "enforced" },
      action: "allow",
      evaluation: { kind: "pass" },
      sanction: { kind: "not-eligible", reason: "fixture has no attribution" },
    });

    const secondPrompt = adapter.parseEvent(promptWithoutId);
    const secondStop = adapter.parseEvent(stopWithoutId);

    expect(secondPrompt.workItemId).toBe(secondStop.workItemId);
    expect(secondPrompt.workItemId).not.toBe(firstPrompt.workItemId);
  });

  it("separates root and subagent completions under one prompt retry budget", () => {
    const adapter = createClaudeCodeAdapter({ runtimeVersion: "2.1.229" });
    const root = adapter.parseEvent(loadFixture("stop.json"));
    const subagent = adapter.parseEvent(loadFixture("subagent-stop.json"));

    expect(root.workItemId).not.toBe(subagent.workItemId);
    expect(root.retryBudgetId).toBe(subagent.retryBudgetId);
  });

  it("proves activation only from a matching managed MCP result", () => {
    const adapter = createClaudeCodeAdapter();
    expect(adapter.verifySkillActivation(loadFixture("post-tool-use-activation.json"))).toEqual({
      kind: "verified",
      skillVersionId: "skill-version-1",
      activationLeaseId: "lease-1",
      method: "activation-marker",
    });
  });

  it("renders native tool denial and stop continuation JSON", () => {
    const adapter = createClaudeCodeAdapter();
    const tool = adapter.parseEvent(loadFixture("pre-tool-use.json"));
    const stop = adapter.parseEvent(loadFixture("stop.json"));
    if (tool.kind !== "tool-request" || stop.kind !== "root-stop") {
      throw new Error("invalid fixtures");
    }
    const deny = adapter.renderDecision<ToolRequestObservation>(tool, {
      kind: "tool-request-decision",
      eventId: tool.eventId,
      enforcement: { kind: "enforced" },
      action: "deny",
      reason: "Policy denied this command.",
    });
    const retry = adapter.renderDecision<RootStopObservation>(stop, {
      kind: "stop-decision",
      eventId: stop.eventId,
      enforcement: { kind: "enforced" },
      action: "retry",
      evaluation: {
        kind: "retryable-failure",
        retryOrdinal: 1,
        findings: [{ criterion: "tests", message: "Failed.", correction: "Fix it.", evidence: [] }],
      },
      feedback: {
        summary: "Tests failed.",
        findings: [{ criterion: "tests", message: "Failed.", correction: "Fix it.", evidence: [] }],
      },
      sanction: { kind: "not-applicable" },
    });

    expect(deny).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Policy denied this command.",
      },
    });
    expect(retry).toMatchObject({ decision: "block" });
  });

  it("leaves native permissions untouched for observation-only tool policy", () => {
    const adapter = createClaudeCodeAdapter();
    const tool = adapter.parseEvent(loadFixture("pre-tool-use.json"));
    if (tool.kind !== "tool-request") throw new Error("invalid tool fixture");
    expect(adapter.renderDecision<ToolRequestObservation>(tool, {
      kind: "tool-request-decision",
      eventId: tool.eventId,
      enforcement: {
        kind: "observation",
        reason: "Tool prevention is unavailable.",
        missingCapabilities: ["toolPrevention"],
      },
      action: "observe-denial",
      reason: "The policy would deny this command.",
    })).toEqual({});
  });

  it("renders selected skill context with an activation marker", () => {
    const adapter = createClaudeCodeAdapter();
    const decision: PromptDecision = {
      kind: "prompt-decision",
      eventId: createEventId("event-1"),
      enforcement: { kind: "enforced" },
      action: "continue",
      resolution: {
        kind: "selected",
        selected: {
          skillVersionId: createSkillVersionId("skill-version-1"),
          stableVersionKey: createSkillVersionKey("parser@1.0.0"),
          displayName: "Parser",
          administratorPriority: 10,
          specificity: 5,
          disposition: "active",
          trigger: {
            triggerId: createTriggerId("trigger-1"),
            kind: "contains",
            pattern: "parser",
          },
        },
        candidates: [],
      },
    };

    const prompt = adapter.parseEvent(loadFixture("user-prompt-submit.json"));
    if (prompt.kind !== "prompt") throw new Error("invalid prompt fixture");
    const activationLeaseId = createActivationLeaseId(
      "sisyphus-v1.claude-adapter-test",
    );
    const response = adapter.renderDecision<PromptObservation>(prompt, decision, {
      kind: "managed-skill-activation",
      activation: {
        activationLeaseId,
        skillVersionId: createSkillVersionId("skill-version-1"),
        expiresAt: createTimestamp("2026-08-29T10:05:00.000Z"),
      },
    });
    expect(response).toMatchObject({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit" },
    });
    expect(JSON.stringify(response)).toContain(activationLeaseId);
  });
});
