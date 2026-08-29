import { describe, expect, it } from "vitest";

import {
  RootStopObservationSchema,
  parseEvaluationConstraint,
} from "@sisyphus/domain";

import { CommandEvaluator, CompletionGuardEvaluator } from "./evaluators.js";

const evaluationInput = {
  observation: RootStopObservationSchema.parse({
    kind: "root-stop",
    eventId: "event-1",
    workItemId: "work-1",
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
      stableTokenUsage: { kind: "supported" },
      localEvidenceAccess: { kind: "supported" },
    },
    identity: {
      sessionId: "session-1",
      agent: { kind: "root", agentId: "agent-1" },
    },
    output: "Implemented the change. Verification: 14 tests passed.",
    attribution: { kind: "none" },
    tokenUsage: { kind: "reported", inputTokens: 100, outputTokens: 40 },
  }),
  constraint: parseEvaluationConstraint({
    policyId: "policy-1",
    policyVersionId: "policy-version-1",
    requiredCapabilities: [],
    skillCandidates: [],
    toolPolicy: { kind: "allow" },
  }),
};

describe("CommandEvaluator", () => {
  it("passes a successful configured command", async () => {
    const evaluator = new CommandEvaluator({
      id: "tests",
      executable: process.execPath,
      arguments: ["-e", "process.stdout.write('ok')"],
      workingDirectory: process.cwd(),
      timeoutMilliseconds: 2_000,
    });

    await expect(evaluator.evaluate(evaluationInput)).resolves.toEqual({
      kind: "pass",
      checkId: "tests",
    });
  });

  it("returns concrete evidence and correction for a failing command", async () => {
    const evaluator = new CommandEvaluator({
      id: "typecheck",
      executable: process.execPath,
      arguments: ["-e", "process.stderr.write('bad type'); process.exit(2)"],
      workingDirectory: process.cwd(),
      timeoutMilliseconds: 2_000,
    });

    const result = await evaluator.evaluate(evaluationInput);

    expect(result).toMatchObject({
      kind: "fail",
      checkId: "typecheck",
      findings: [
        {
          criterion: "typecheck",
          correction: "Fix the reported typecheck failures and rerun the check.",
        },
      ],
    });
    expect(JSON.stringify(result)).toContain("bad type");
  });

  it("does not expose worker credentials to evaluated commands", async () => {
    const previous = process.env.SISYPHUS_HOOK_TOKEN;
    process.env.SISYPHUS_HOOK_TOKEN = "worker-secret-that-must-not-cross-the-boundary";
    try {
      const evaluator = new CommandEvaluator({
        id: "secret-boundary",
        executable: process.execPath,
        arguments: [
          "-e",
          "process.stdout.write(process.env.SISYPHUS_HOOK_TOKEN ?? 'absent'); process.exit(2)",
        ],
        workingDirectory: process.cwd(),
        timeoutMilliseconds: 2_000,
      });

      const result = await evaluator.evaluate(evaluationInput);

      expect(JSON.stringify(result)).toContain("absent");
      expect(JSON.stringify(result)).not.toContain(
        "worker-secret-that-must-not-cross-the-boundary",
      );
    } finally {
      if (previous === undefined) delete process.env.SISYPHUS_HOOK_TOKEN;
      else process.env.SISYPHUS_HOOK_TOKEN = previous;
    }
  });
});

describe("CompletionGuardEvaluator", () => {
  it("checks token limits and required verification evidence", async () => {
    const evaluator = new CompletionGuardEvaluator({
      maximumOutputTokens: 20,
      requiredEvidencePatterns: ["tests passed", "typecheck passed"],
    });

    const result = await evaluator.evaluate(evaluationInput);

    expect(result).toMatchObject({ kind: "fail", checkId: "completion-guards" });
    expect(JSON.stringify(result)).toContain("output-token-limit");
    expect(JSON.stringify(result)).toContain("typecheck passed");
  });
});
