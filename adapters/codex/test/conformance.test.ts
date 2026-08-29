import { describe, expect, it } from "vitest";

import {
  createAdapterVersion,
  createDeviceId,
  type DecisionFor,
  type PromptObservation,
  type RootStopObservation,
  type SubagentStopObservation,
  type ToolRequestObservation,
  type ToolResultObservation,
} from "@sisyphus/domain";
import {
  assertAdapterConformance,
  runAdapterConformance,
  type AdapterConformanceFixture,
} from "@sisyphus/adapter-kit";

import { createCodexAdapter } from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("Codex adapter conformance", () => {
  it("passes the shared contract for every supported hook", async () => {
    const adapter = createCodexAdapter({
      runtimeVersion: "0.99.0",
      adapterVersion: "0.1.0",
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    const prompt = adapter.parseEvent(loadFixture("user-prompt-submit.json"));
    const toolRequest = adapter.parseEvent(loadFixture("pre-tool-use.json"));
    const toolResult = adapter.parseEvent(loadFixture("post-tool-use.json"));
    const rootStop = adapter.parseEvent(loadFixture("stop.json"));
    const subagentStop = adapter.parseEvent(loadFixture("subagent-stop.json"));
    if (prompt.kind !== "prompt") throw new Error("invalid prompt fixture");
    if (toolRequest.kind !== "tool-request") throw new Error("invalid tool request fixture");
    if (toolResult.kind !== "tool-result") throw new Error("invalid tool result fixture");
    if (rootStop.kind !== "root-stop") throw new Error("invalid root stop fixture");
    if (subagentStop.kind !== "subagent-stop") throw new Error("invalid subagent stop fixture");

    const promptDecision: DecisionFor<PromptObservation> = {
      kind: "prompt-decision",
      eventId: prompt.eventId,
      enforcement: { kind: "enforced" },
      action: "continue",
      resolution: { kind: "none", candidates: [] },
    };
    const toolRequestDecision: DecisionFor<ToolRequestObservation> = {
      kind: "tool-request-decision",
      eventId: toolRequest.eventId,
      enforcement: { kind: "enforced" },
      action: "allow",
    };
    const toolResultDecision: DecisionFor<ToolResultObservation> = {
      kind: "tool-result-decision",
      eventId: toolResult.eventId,
      enforcement: { kind: "enforced" },
      action: "recorded",
    };
    const rootStopDecision: DecisionFor<RootStopObservation> = {
      kind: "stop-decision",
      eventId: rootStop.eventId,
      enforcement: { kind: "enforced" },
      action: "retry",
      evaluation: {
        kind: "retryable-failure",
        retryOrdinal: 1,
        findings: [
          {
            criterion: "correctness",
            message: "A focused check failed.",
            correction: "Fix the failure and rerun the check.",
            evidence: ["parser.test.ts"],
          },
        ],
      },
      feedback: {
        summary: "The focused check failed.",
        findings: [
          {
            criterion: "correctness",
            message: "A focused check failed.",
            correction: "Fix the failure and rerun the check.",
            evidence: ["parser.test.ts"],
          },
        ],
      },
      sanction: { kind: "not-applicable" },
    };
    const subagentStopDecision: DecisionFor<SubagentStopObservation> = {
      ...rootStopDecision,
      eventId: subagentStop.eventId,
    };

    const fixture: AdapterConformanceFixture = {
      installRequest: {
        deviceId: createDeviceId("device-001"),
        adapterVersion: createAdapterVersion("0.1.0"),
        workerEndpoint: "http://127.0.0.1:7331",
        scope: { kind: "user" },
      },
      uninstallAfterRun: true,
      forbiddenNormalizedKeys: [
        "hook_event_name",
        "transcript_path",
        "permission_mode",
        "tool_input",
        "tool_response",
      ],
      cases: [
        { kind: "prompt", rawEvent: loadFixture("user-prompt-submit.json"), decision: promptDecision },
        { kind: "tool-request", rawEvent: loadFixture("pre-tool-use.json"), decision: toolRequestDecision },
        { kind: "tool-result", rawEvent: loadFixture("post-tool-use.json"), decision: toolResultDecision },
        {
          kind: "root-stop",
          rawEvent: loadFixture("stop.json"),
          decision: rootStopDecision,
          retryResponseAccepted: (response) =>
            typeof response === "object" && response !== null && "decision" in response,
        },
        {
          kind: "subagent-stop",
          rawEvent: loadFixture("subagent-stop.json"),
          decision: subagentStopDecision,
          retryResponseAccepted: (response) =>
            typeof response === "object" && response !== null && "decision" in response,
        },
      ],
    };

    const report = await runAdapterConformance({ adapter, fixture });

    assertAdapterConformance(report);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });
});
