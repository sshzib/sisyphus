import { describe, expect, it } from "vitest";
import { z } from "zod";

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

import { createOpenCodeAdapter } from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("OpenCode adapter conformance", () => {
  it("passes normalized grading and telemetry without claiming continuation", async () => {
    const adapter = createOpenCodeAdapter({
      runtimeVersion: "1.17.1",
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    const prompt = adapter.parseEvent(loadFixture("chat-message.json"));
    const request = adapter.parseEvent(loadFixture("tool-before.json"));
    const result = adapter.parseEvent(loadFixture("tool-after.json"));
    const rootStop = adapter.parseEvent(loadFixture("text-complete.json"));
    const subagentStop = adapter.parseEvent(loadFixture("task-after.json"));
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
      skillVersionId: createSkillVersionId("skill-opencode-conformance@1.0.0"),
      stableVersionKey: createSkillVersionKey("skill-opencode-conformance@1.0.0"),
      displayName: "OpenCode conformance skill",
      administratorPriority: 100,
      specificity: 100,
      disposition: "active" as const,
      activationAvailability: { kind: "available" as const },
      trigger: {
        triggerId: createTriggerId("trigger-opencode-conformance"),
        kind: "contains" as const,
        pattern: "parser",
      },
    };
    const promptDecision: DecisionFor<PromptObservation> = {
      kind: "prompt-decision",
      eventId: prompt.eventId,
      enforcement: {
        kind: "observation",
        reason: "OpenCode cannot enforce exclusive native skill routing.",
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
    const allow = (
      eventId: RootStopObservation["eventId"] | SubagentStopObservation["eventId"],
      capability: "rootStopContinuation" | "subagentStopContinuation",
    ): DecisionFor<RootStopObservation> => ({
      kind: "stop-decision",
      eventId,
      enforcement: {
        kind: "observation",
        reason: "OpenCode continuation is unsupported.",
        missingCapabilities: [capability],
      },
      action: "allow",
      evaluation: { kind: "terminal-failure", reason: "continuation-unsupported", findings: [
        { criterion: "tests", message: "Failed.", correction: "Fix it.", evidence: [] },
      ] },
      sanction: { kind: "not-applicable" },
    });
    const fixture: AdapterConformanceFixture = {
      installRequest: {
        deviceId: createDeviceId("device-opencode"),
        adapterVersion: createAdapterVersion("0.1.0"),
        workerEndpoint: "http://127.0.0.1:7331",
        scope: { kind: "user" },
      },
      uninstallAfterRun: true,
      forbiddenNormalizedKeys: [
        "hook_event_name",
        "sessionID",
        "callID",
        "messageID",
        "partID",
        "metadata",
      ],
      cases: [
        {
          kind: "prompt",
          rawEvent: loadFixture("chat-message.json"),
          decision: promptDecision,
          managedActivation: {
            kind: "required",
            workerIssued: {
              activationLeaseId: createActivationLeaseId(
                "sisyphus-v1.opencode-conformance",
              ),
              skillVersionId: selectedSkill.skillVersionId,
              expiresAt: createTimestamp("2026-08-29T10:05:00.000Z"),
            },
            activationResponseAccepted(response, activation) {
              const parsed = z
                .object({
                  action: z.literal("append-context"),
                  context: z.string(),
                })
                .strict()
                .safeParse(response);
              if (!parsed.success) return false;
              const markerText = /with (\{[^\r\n]+\})\./u.exec(
                parsed.data.context,
              )?.[1];
              if (markerText === undefined) return false;
              try {
                return z
                  .object({
                    skillVersionId: z.literal(activation.skillVersionId),
                    activationLeaseId: z.literal(activation.activationLeaseId),
                  })
                  .strict()
                  .safeParse(JSON.parse(markerText)).success;
              } catch {
                return false;
              }
            },
          },
        },
        { kind: "tool-request", rawEvent: loadFixture("tool-before.json"), decision: requestDecision },
        { kind: "tool-result", rawEvent: loadFixture("tool-after.json"), decision: resultDecision },
        {
          kind: "root-stop",
          rawEvent: loadFixture("text-complete.json"),
          decision: allow(rootStop.eventId, "rootStopContinuation"),
          retryResponseAccepted: () => false,
        },
        {
          kind: "subagent-stop",
          rawEvent: loadFixture("task-after.json"),
          decision: allow(subagentStop.eventId, "subagentStopContinuation"),
          retryResponseAccepted: () => false,
        },
      ],
    };

    const report = await runAdapterConformance({ adapter, fixture });
    assertAdapterConformance(report);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });
});
