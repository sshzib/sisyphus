import { describe, expect, it } from "vitest";

import type { ToolRequestObservation } from "@sisyphus/domain";

import { createCursorAdapter } from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("Cursor capability profiles", () => {
  it("keeps local and cloud enforcement cohorts distinct", async () => {
    const local = createCursorAdapter({ profile: "local", runtimeVersion: "1.7.2" });
    const cloud = createCursorAdapter({ profile: "cloud", runtimeVersion: "1.7.2" });

    const localSnapshot = await local.probe();
    const cloudSnapshot = await cloud.probe();
    expect(localSnapshot.promptInterception).toEqual({ kind: "supported" });
    expect(localSnapshot.toolPrevention).toEqual({ kind: "supported" });
    expect(cloudSnapshot.promptInterception.kind).toBe("partial");
    expect(cloudSnapshot.toolPrevention.kind).toBe("partial");
    expect(cloudSnapshot.localEvidenceAccess.kind).toBe("unsupported");
  });

  it("records the runtime version and active profile on each new observation", () => {
    const local = createCursorAdapter({ profile: "local", runtimeVersion: "older" });
    const cloud = createCursorAdapter({ profile: "cloud", runtimeVersion: "older" });
    const localEvent = local.parseEvent(loadFixture("before-submit-prompt.json"));
    const cloudEvent = cloud.parseEvent(loadFixture("before-submit-prompt.json"));

    expect(localEvent.capabilities.runtimeVersion).toBe("1.7.2");
    expect(localEvent.capabilities.promptInterception.kind).toBe("supported");
    expect(localEvent.runtimeInstallation.profile).toBe("local");
    expect(cloudEvent.capabilities.promptInterception.kind).toBe("partial");
    expect(cloudEvent.runtimeInstallation.profile).toBe("cloud-agent");
    expect(cloudEvent.runtimeInstallation.adapterInstallationId).not.toBe(
      localEvent.runtimeInstallation.adapterInstallationId,
    );
  });

  it("derives a stable subagent identity without a vendor subagent ID", () => {
    const adapter = createCursorAdapter();
    const first = adapter.deriveIdentity(loadFixture("subagent-stop.json"));
    const second = adapter.deriveIdentity(loadFixture("subagent-stop.json"));
    expect(first).toEqual(second);
    expect(first.agent.kind).toBe("subagent");
  });

  it("separates root and subagent completions under one generation retry budget", () => {
    const adapter = createCursorAdapter({ runtimeVersion: "1.7.2" });
    const root = adapter.parseEvent(loadFixture("stop.json"));
    const subagent = adapter.parseEvent(loadFixture("subagent-stop.json"));

    expect(root.workItemId).not.toBe(subagent.workItemId);
    expect(root.retryBudgetId).toBe(subagent.retryBudgetId);
  });

  it("accepts only matching activation marker results", () => {
    const adapter = createCursorAdapter();
    expect(adapter.verifySkillActivation(loadFixture("post-tool-use-activation.json"))).toEqual({
      kind: "verified",
      skillVersionId: "skill-version-1",
      activationLeaseId: "lease-1",
      method: "activation-marker",
    });
  });

  it("does not turn observation into a native permission grant", () => {
    const adapter = createCursorAdapter({ profile: "cloud" });
    const tool = adapter.parseEvent(loadFixture("pre-tool-use.json"));
    if (tool.kind !== "tool-request") throw new Error("invalid tool fixture");
    expect(adapter.renderDecision<ToolRequestObservation>(tool, {
      kind: "tool-request-decision",
      eventId: tool.eventId,
      enforcement: {
        kind: "observation",
        reason: "Cloud hooks have an early-turn coverage gap.",
        missingCapabilities: ["toolPrevention"],
      },
      action: "observe-denial",
      reason: "The policy would deny this tool.",
    })).toEqual({});
  });
});
