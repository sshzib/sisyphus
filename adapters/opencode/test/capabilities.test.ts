import { describe, expect, it } from "vitest";

import type { RootStopObservation, ToolRequestObservation } from "@sisyphus/domain";

import {
  createOpenCodeAdapter,
  parseOpenCodeHookEvent,
} from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("OpenCode capability guardrails", () => {
  it("reports stop continuation unsupported until a continuation path is proven", async () => {
    const capabilities = await createOpenCodeAdapter({ runtimeVersion: "1.17.1" }).probe();
    expect(capabilities.rootStopContinuation.kind).toBe("unsupported");
    expect(capabilities.subagentStopContinuation.kind).toBe("unsupported");
    expect(capabilities.toolPrevention.kind).toBe("supported");
  });

  it("never renders a forced continuation for an accidental retry decision", () => {
    const adapter = createOpenCodeAdapter();
    const stop = adapter.parseEvent(loadFixture("text-complete.json"));
    if (stop.kind !== "root-stop") throw new Error("invalid stop fixture");
    const response = adapter.renderDecision<RootStopObservation>(stop, {
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

    expect(response).toEqual({
      action: "observe",
      reason: "OpenCode stop continuation is unsupported; record a terminal failure.",
    });
    expect(JSON.stringify(response)).not.toMatch(/followup|continue|retry/i);
  });

  it("maps Task completion to a subagent completion with stable identity", () => {
    const adapter = createOpenCodeAdapter();
    const first = adapter.parseEvent(loadFixture("task-after.json"));
    const second = adapter.parseEvent(loadFixture("task-after.json"));
    expect(first.kind).toBe("subagent-stop");
    expect(first.identity).toEqual(second.identity);
  });

  it("correlates two consecutive messages to separate work items", () => {
    const adapter = createOpenCodeAdapter();
    const promptFixture = parseOpenCodeHookEvent(loadFixture("chat-message.json"));
    const stopFixture = parseOpenCodeHookEvent(loadFixture("text-complete.json"));
    if (
      promptFixture.hook_event_name !== "chat.message" ||
      stopFixture.hook_event_name !== "experimental.text.complete"
    ) {
      throw new Error("invalid turn fixtures");
    }

    const firstPrompt = adapter.parseEvent(promptFixture);
    const firstStop = adapter.parseEvent(stopFixture);
    if (firstStop.kind !== "root-stop") throw new Error("invalid first stop");
    expect(firstPrompt.workItemId).toBe(firstStop.workItemId);
    adapter.renderDecision<RootStopObservation>(firstStop, {
      kind: "stop-decision",
      eventId: firstStop.eventId,
      enforcement: {
        kind: "observation",
        reason: "Continuation is unsupported.",
        missingCapabilities: ["rootStopContinuation"],
      },
      action: "allow",
      evaluation: { kind: "pass" },
      sanction: { kind: "not-eligible", reason: "fixture has no attribution" },
    });

    const secondPrompt = adapter.parseEvent({
      ...promptFixture,
      input: { ...promptFixture.input, messageID: "message-2" },
    });
    const secondStop = adapter.parseEvent({
      ...stopFixture,
      input: {
        ...stopFixture.input,
        messageID: "assistant-message-2",
        partID: "assistant-part-2",
      },
    });

    expect(secondPrompt.workItemId).toBe(secondStop.workItemId);
    expect(secondPrompt.workItemId).not.toBe(firstPrompt.workItemId);
  });

  it("renders an observation-only denial without a blocking action", () => {
    const adapter = createOpenCodeAdapter();
    const tool = adapter.parseEvent(loadFixture("tool-before.json"));
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
      reason: "The policy would deny this tool.",
    })).toEqual({ action: "observe", reason: "The policy would deny this tool." });
  });
});
