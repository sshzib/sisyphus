import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseEvaluationConstraint, parseHookObservation } from "@sisyphus/domain";
import { createSupervisionKernel } from "@sisyphus/kernel";
import { describe, expect, it, vi } from "vitest";

import { SQLiteSupervisionStore } from "./sqlite-store.js";

const constraint = parseEvaluationConstraint({
  policyId: "policy-1",
  policyVersionId: "policy-version-1",
  requiredCapabilities: [],
  skillCandidates: [],
  toolPolicy: { kind: "allow" },
});

function stop(eventId: string, workItemId = "work-1") {
  return parseHookObservation({
    kind: "root-stop",
    eventId,
    workItemId,
    retryBudgetId: "budget-1",
    runId: "run-1",
    occurredAt: "2026-08-29T10:00:00.000Z",
    adapterVersion: "adapter-1",
    runtimeInstallation: {
      adapterInstallationId: "installation-1",
      profile: "local",
    },
    capabilities: {
      runtime: "codex",
      runtimeVersion: "0.1.0",
      promptInterception: { kind: "supported" },
      skillSelectionControl: { kind: "supported" },
      rootStopContinuation: { kind: "supported" },
      subagentStopContinuation: { kind: "supported" },
      toolPrevention: { kind: "supported" },
      toolObservation: { kind: "supported" },
      stableTokenUsage: { kind: "unsupported", reason: "not reported" },
      localEvidenceAccess: { kind: "supported" },
    },
    identity: {
      sessionId: "session-1",
      agent: { kind: "root", agentId: "agent-1" },
    },
    output: "bad output",
    attribution: { kind: "none" },
    tokenUsage: { kind: "unavailable" },
  });
}

describe("SQLiteSupervisionStore", () => {
  it("preserves the shared two-retry budget across worker restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-kernel-store-"));
    const path = join(directory, "kernel.db");
    const evaluate = vi.fn(async () => ({
      kind: "fail" as const,
      checkId: "fixture",
      findings: [
        {
          criterion: "correctness",
          message: "fixture failure",
          correction: "fix it",
          evidence: [],
        },
      ],
    }));

    const firstStore = new SQLiteSupervisionStore({ path });
    const firstKernel = createSupervisionKernel({
      store: firstStore,
      deterministicEvaluators: [{ id: "fixture", evaluate }],
    });
    const first = await firstKernel.supervise(stop("event-1"), constraint);
    firstStore.close();

    const restartedStore = new SQLiteSupervisionStore({ path });
    const restartedKernel = createSupervisionKernel({
      store: restartedStore,
      deterministicEvaluators: [{ id: "fixture", evaluate }],
    });
    const second = await restartedKernel.supervise(
      stop("event-2", "work-2"),
      constraint,
    );
    restartedStore.close();

    expect(first).toMatchObject({
      action: "retry",
      evaluation: { retryOrdinal: 1 },
    });
    expect(second).toMatchObject({
      action: "retry",
      evaluation: { retryOrdinal: 2 },
    });
  });
});
