import { describe, expect, it } from "vitest";

import {
  createActivationLeaseId,
  createAdapterVersion,
  createDeviceId,
  createSkillVersionId,
  createSkillVersionKey,
  createTimestamp,
  createTriggerId,
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

import { createCursorAdapter } from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("Cursor adapter conformance", () => {
  it("passes the shared contract for a local Agent session", async () => {
    const adapter = createCursorAdapter({
      profile: "local",
      runtimeVersion: "1.7.2",
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    const prompt = adapter.parseEvent(loadFixture("before-submit-prompt.json"));
    const request = adapter.parseEvent(loadFixture("pre-tool-use.json"));
    const result = adapter.parseEvent(loadFixture("post-tool-use.json"));
    const rootStop = adapter.parseEvent(loadFixture("stop.json"));
    const subagentStop = adapter.parseEvent(loadFixture("subagent-stop.json"));
    if (
      prompt.kind !== "prompt" ||
      request.kind !== "tool-request" ||
      result.kind !== "tool-result" ||
      rootStop.kind !== "root-stop" ||
      subagentStop.kind !== "subagent-stop"
    ) {
      throw new Error("invalid fixtures");
    }

    const selectedSkill = {
      skillVersionId: createSkillVersionId("skill-cursor-conformance@1.0.0"),
      stableVersionKey: createSkillVersionKey("skill-cursor-conformance@1.0.0"),
      displayName: "Cursor conformance skill",
      administratorPriority: 100,
      specificity: 100,
      disposition: "active" as const,
      activationAvailability: { kind: "available" as const },
      trigger: {
        triggerId: createTriggerId("trigger-cursor-conformance"),
        kind: "contains" as const,
        pattern: "parser",
      },
    };
    const promptDecision: DecisionFor<PromptObservation> = {
      kind: "prompt-decision",
      eventId: prompt.eventId,
      enforcement: {
        kind: "observation",
        reason: "Cursor cannot inject selected managed skill context.",
        missingCapabilities: ["skillSelectionControl"],
      },
      action: "continue",
      resolution: {
        kind: "selected",
        selected: selectedSkill,
        candidates: [
          { candidate: selectedSkill, outcome: { kind: "selected" } },
        ],
      },
    };
    const requestDecision: DecisionFor<ToolRequestObservation> = {
      kind: "tool-request-decision",
      eventId: request.eventId,
      enforcement: { kind: "enforced" },
      action: "allow",
    };
    const resultDecision: DecisionFor<ToolResultObservation> = {
      kind: "tool-result-decision",
      eventId: result.eventId,
      enforcement: { kind: "enforced" },
      action: "recorded",
    };
    const rootRetry: DecisionFor<RootStopObservation> = {
      kind: "stop-decision",
      eventId: rootStop.eventId,
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
    };
    const subagentAllow: DecisionFor<SubagentStopObservation> = {
      kind: "stop-decision",
      eventId: subagentStop.eventId,
      enforcement: {
        kind: "observation",
        reason: "Cursor consumes subagent follow-ups only after completed runs.",
        missingCapabilities: ["subagentStopContinuation"],
      },
      action: "allow",
      evaluation: { kind: "pass" },
      sanction: { kind: "not-applicable" },
    };
    const fixture: AdapterConformanceFixture = {
      installRequest: {
        deviceId: createDeviceId("device-cursor"),
        adapterVersion: createAdapterVersion("0.1.0"),
        workerEndpoint: "http://127.0.0.1:7331",
        scope: { kind: "user" },
      },
      uninstallAfterRun: true,
      forbiddenNormalizedKeys: [
        "hook_event_name",
        "conversation_id",
        "generation_id",
        "tool_input",
        "tool_output",
        "transcript_path",
      ],
      cases: [
        {
          kind: "prompt",
          rawEvent: loadFixture("before-submit-prompt.json"),
          decision: promptDecision,
          managedActivation: {
            kind: "unsupported",
            reason:
              "beforeSubmitPrompt cannot inject the worker-issued managed activation marker.",
            workerIssued: {
              activationLeaseId: createActivationLeaseId(
                "sisyphus-v1.cursor-conformance",
              ),
              skillVersionId: selectedSkill.skillVersionId,
              expiresAt: createTimestamp("2026-08-29T10:05:00.000Z"),
            },
          },
        },
        { kind: "tool-request", rawEvent: loadFixture("pre-tool-use.json"), decision: requestDecision },
        { kind: "tool-result", rawEvent: loadFixture("post-tool-use.json"), decision: resultDecision },
        {
          kind: "root-stop",
          rawEvent: loadFixture("stop.json"),
          decision: rootRetry,
          retryResponseAccepted: (response) =>
            typeof response === "object" && response !== null && "followup_message" in response,
        },
        {
          kind: "subagent-stop",
          rawEvent: loadFixture("subagent-stop.json"),
          decision: subagentAllow,
          retryResponseAccepted: () => false,
        },
      ],
    };

    const report = await runAdapterConformance({ adapter, fixture });
    assertAdapterConformance(report);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });
});
