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

import { createClaudeCodeAdapter } from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("Claude Code adapter conformance", () => {
  it("passes the shared normalized lifecycle contract", async () => {
    const adapter = createClaudeCodeAdapter({
      runtimeVersion: "2.1.229",
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    const prompt = adapter.parseEvent(loadFixture("user-prompt-submit.json"));
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
      skillVersionId: createSkillVersionId("skill-claude-conformance@1.0.0"),
      stableVersionKey: createSkillVersionKey("skill-claude-conformance@1.0.0"),
      displayName: "Claude conformance skill",
      administratorPriority: 100,
      specificity: 100,
      disposition: "active" as const,
      activationAvailability: { kind: "available" as const },
      trigger: {
        triggerId: createTriggerId("trigger-claude-conformance"),
        kind: "contains" as const,
        pattern: "parser",
      },
    };
    const promptDecision: DecisionFor<PromptObservation> = {
      kind: "prompt-decision",
      eventId: prompt.eventId,
      enforcement: { kind: "enforced" },
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
    const retry = (eventId: RootStopObservation["eventId"] | SubagentStopObservation["eventId"]):
      DecisionFor<RootStopObservation> => ({
        kind: "stop-decision",
        eventId,
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
    const fixture: AdapterConformanceFixture = {
      installRequest: {
        deviceId: createDeviceId("device-claude"),
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
        {
          kind: "prompt",
          rawEvent: loadFixture("user-prompt-submit.json"),
          decision: promptDecision,
          managedActivation: {
            kind: "required",
            workerIssued: {
              activationLeaseId: createActivationLeaseId(
                "sisyphus-v1.claude-conformance",
              ),
              skillVersionId: selectedSkill.skillVersionId,
              expiresAt: createTimestamp("2026-08-29T10:05:00.000Z"),
            },
            activationResponseAccepted(response, activation) {
              const parsed = z
                .object({
                  continue: z.literal(true),
                  hookSpecificOutput: z
                    .object({
                      hookEventName: z.literal("UserPromptSubmit"),
                      additionalContext: z.string(),
                    })
                    .strict(),
                })
                .strict()
                .safeParse(response);
              if (!parsed.success) return false;
              const markerText = /with (\{[^\r\n]+\})\./u.exec(
                parsed.data.hookSpecificOutput.additionalContext,
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
        { kind: "tool-request", rawEvent: loadFixture("pre-tool-use.json"), decision: requestDecision },
        { kind: "tool-result", rawEvent: loadFixture("post-tool-use.json"), decision: resultDecision },
        {
          kind: "root-stop",
          rawEvent: loadFixture("stop.json"),
          decision: retry(rootStop.eventId),
          retryResponseAccepted: (response) =>
            typeof response === "object" && response !== null && "decision" in response,
        },
        {
          kind: "subagent-stop",
          rawEvent: loadFixture("subagent-stop.json"),
          decision: retry(subagentStop.eventId),
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
