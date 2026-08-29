import { describe, expect, it } from "vitest";

import {
  createActivationLeaseId,
  createAdapterVersion,
  createAgentId,
  createEventId,
  createPolicyId,
  createPolicyVersionId,
  createRunId,
  createRetryBudgetId,
  createRuntimeInstallationIdentity,
  createSessionId,
  createSkillVersionId,
  createSkillVersionKey,
  createTimestamp,
  createToolCallId,
  createTriggerId,
  createWorkItemId,
  type DeterministicCheckResult,
  type Capability,
  type EvaluationConstraint,
  type JudgeResult,
  type RootStopObservation,
  type PromptObservation,
  type RuntimeCapabilitySnapshot,
  type SkillAttribution,
  type SkillCompletionRecord,
  type SkillMatchCandidate,
  type ToolRequestObservation,
} from "@sisyphus/domain";

import {
  createInMemoryKernel,
  evaluateQuarantineWindow,
  type DeterministicEvaluator,
  type EvaluationJudge,
} from "../src/index.js";

const supported: Capability = { kind: "supported" };

function capabilitySnapshot(
  overrides: Partial<RuntimeCapabilitySnapshot> = {},
): RuntimeCapabilitySnapshot {
  return {
    runtime: "codex",
    runtimeVersion: "1.0.0",
    promptInterception: supported,
    skillSelectionControl: supported,
    rootStopContinuation: supported,
    subagentStopContinuation: supported,
    toolPrevention: supported,
    toolObservation: supported,
    stableTokenUsage: supported,
    localEvidenceAccess: supported,
    ...overrides,
  };
}

function constraint(
  version = "policy-version-1",
  overrides: Partial<EvaluationConstraint> = {},
): EvaluationConstraint {
  return {
    policyId: createPolicyId("policy-1"),
    policyVersionId: createPolicyVersionId(version),
    passThreshold: 0.8,
    retryLimit: 2,
    requiredCapabilities: [],
    skillCandidates: [],
    toolPolicy: { kind: "allow" },
    ...overrides,
  };
}

function verifiedAttribution(skill = "skill-1"): SkillAttribution {
  return {
    kind: "verified",
    skillVersionId: createSkillVersionId(skill),
    activationLeaseId: createActivationLeaseId(`lease-${skill}`),
    method: "activation-marker",
  };
}

function skillCandidate(skill = "skill-1"): SkillMatchCandidate {
  return {
    skillVersionId: createSkillVersionId(skill),
    stableVersionKey: createSkillVersionKey(`${skill}-v1`),
    displayName: skill,
    administratorPriority: 1,
    specificity: 1,
    disposition: "active",
    trigger: {
      triggerId: createTriggerId(`${skill}-trigger`),
      kind: "contains",
      pattern: skill,
    },
  };
}

function stop(input: {
  event: string;
  work?: string;
  retryBudget?: string;
  attribution?: SkillAttribution;
  capabilities?: RuntimeCapabilitySnapshot;
  output?: string;
}): RootStopObservation {
  return {
    kind: "root-stop",
    eventId: createEventId(input.event),
    workItemId: createWorkItemId(input.work ?? "work-1"),
    retryBudgetId: createRetryBudgetId(input.retryBudget ?? input.work ?? "budget-1"),
    runId: createRunId(`run-${input.work ?? "work-1"}`),
    occurredAt: createTimestamp("2026-08-29T10:00:00.000Z"),
    adapterVersion: createAdapterVersion("adapter-1"),
    runtimeInstallation: createRuntimeInstallationIdentity({
      adapterInstallationId: "installation-1",
      profile: "local",
    }),
    capabilities: input.capabilities ?? capabilitySnapshot(),
    identity: {
      sessionId: createSessionId("session-1"),
      agent: { kind: "root", agentId: createAgentId("agent-1") },
    },
    output: input.output ?? "candidate output",
    attribution: input.attribution ?? verifiedAttribution(),
    tokenUsage: { kind: "unavailable" },
  };
}

const finding = {
  criterion: "correctness",
  message: "the result is wrong",
  correction: "return the expected value",
  evidence: ["expected 2, received 3"],
};

function evaluator(result: DeterministicCheckResult): DeterministicEvaluator {
  return {
    id: "check",
    async evaluate() {
      return result;
    },
  };
}

describe("supervision kernel", () => {
  it("grades a stop and allows a passing output", async () => {
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [evaluator({ kind: "pass", checkId: "check" })],
    });

    const decision = await kernel.supervise(stop({ event: "pass-1" }), constraint());

    expect(decision.action).toBe("allow");
    expect(decision.evaluation).toEqual({ kind: "pass" });
  });

  it("treats a mismatched deterministic check result as inconclusive", async () => {
    const checking: DeterministicEvaluator = {
      id: "expected-check",
      async evaluate() {
        return { kind: "pass", checkId: "different-check" };
      },
    };
    const kernel = createInMemoryKernel({ deterministicEvaluators: [checking] });

    const decision = await kernel.supervise(stop({ event: "mismatched-check" }), constraint());

    expect(decision.evaluation).toMatchObject({ kind: "inconclusive" });
    expect(decision.sanction).toEqual({ kind: "not-applicable" });
  });

  it("does not fail an agent when a partial-evidence runtime omits completion text", async () => {
    let evaluations = 0;
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        {
          id: "must-not-run",
          async evaluate() {
            evaluations += 1;
            return { kind: "fail", checkId: "must-not-run", findings: [finding] };
          },
        },
      ],
    });
    const event = stop({
      event: "missing-runtime-evidence",
      output: "",
      capabilities: capabilitySnapshot({
        runtime: "cursor",
        localEvidenceAccess: {
          kind: "partial",
          limitation: "The stop hook did not expose the final assistant message.",
        },
      }),
    });

    const decision = await kernel.supervise(event, constraint());

    expect(decision.evaluation).toEqual({
      kind: "inconclusive",
      reason: "runtime did not provide completion output evidence",
    });
    expect(decision.sanction).toEqual({ kind: "not-applicable" });
    expect(evaluations).toBe(0);
  });

  it("returns a persisted decision for replay without evaluating twice", async () => {
    let calls = 0;
    const checking: DeterministicEvaluator = {
      id: "counting-check",
      async evaluate() {
        calls += 1;
        return { kind: "fail", checkId: "counting-check", findings: [finding] };
      },
    };
    const kernel = createInMemoryKernel({ deterministicEvaluators: [checking] });
    const event = stop({ event: "duplicate-1" });

    const first = await kernel.supervise(event, constraint());
    const replay = await kernel.supervise(event, constraint("changed-policy"));

    expect(replay).toEqual(first);
    expect(calls).toBe(1);
  });

  it("rejects an event ID replay with a changed normalized payload", async () => {
    const kernel = createInMemoryKernel();
    const original = stop({ event: "duplicate-collision" });
    await kernel.supervise(original, constraint());

    await expect(
      kernel.supervise({ ...original, output: "different output" }, constraint()),
    ).rejects.toThrow("reused for a different observation");
  });

  it("records at most one completed outcome for a work item", async () => {
    const kernel = createInMemoryKernel();

    await kernel.supervise(stop({ event: "complete-once-1" }), constraint());
    const lateStop = await kernel.supervise(
      stop({ event: "complete-once-2" }),
      constraint(),
    );

    expect(lateStop.evaluation.kind).toBe("inconclusive");
    expect(await kernel.listSkillCompletions(createSkillVersionId("skill-1"))).toHaveLength(1);
  });

  it("grades distinct completion work items that share one retry budget", async () => {
    let evaluations = 0;
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        {
          id: "counting-check",
          async evaluate() {
            evaluations += 1;
            return { kind: "pass", checkId: "counting-check" };
          },
        },
      ],
    });

    const subagent = await kernel.supervise(
      stop({ event: "subagent-complete", work: "subagent-1", retryBudget: "turn-1" }),
      constraint(),
    );
    const root = await kernel.supervise(
      stop({ event: "root-complete", work: "root", retryBudget: "turn-1" }),
      constraint(),
    );

    expect(subagent.evaluation.kind).toBe("pass");
    expect(root.evaluation.kind).toBe("pass");
    expect(evaluations).toBe(2);
  });

  it("shares at most two retry directives across distinct completion work items", async () => {
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        evaluator({ kind: "fail", checkId: "check", findings: [finding] }),
      ],
    });

    const first = await kernel.supervise(
      stop({ event: "shared-retry-1", work: "subagent-1", retryBudget: "turn-1" }),
      constraint(),
    );
    const second = await kernel.supervise(
      stop({ event: "shared-retry-2", work: "root", retryBudget: "turn-1" }),
      constraint(),
    );
    const terminal = await kernel.supervise(
      stop({ event: "shared-retry-3", work: "subagent-2", retryBudget: "turn-1" }),
      constraint(),
    );

    expect(first.action).toBe("retry");
    expect(second.action).toBe("retry");
    expect(terminal.evaluation).toMatchObject({
      kind: "terminal-failure",
      reason: "retries-exhausted",
    });
  });

  it("issues at most two retries across event IDs and policy changes", async () => {
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        evaluator({ kind: "fail", checkId: "check", findings: [finding] }),
      ],
    });

    const first = await kernel.supervise(stop({ event: "retry-1" }), constraint("v1"));
    const second = await kernel.supervise(stop({ event: "retry-2" }), constraint("v2"));
    const terminal = await kernel.supervise(stop({ event: "retry-3" }), constraint("v3"));

    expect(first.action).toBe("retry");
    expect(second.action).toBe("retry");
    expect(terminal.action).toBe("allow");
    expect(terminal.evaluation).toMatchObject({
      kind: "terminal-failure",
      reason: "retries-exhausted",
    });
  });

  it.each([
    { retryLimit: 0 as const, expectedActions: ["allow"] },
    { retryLimit: 1 as const, expectedActions: ["retry", "allow"] },
    { retryLimit: 2 as const, expectedActions: ["retry", "retry", "allow"] },
  ])("enforces a signed retry limit of $retryLimit", async ({ retryLimit, expectedActions }) => {
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        evaluator({ kind: "fail", checkId: "check", findings: [finding] }),
      ],
    });

    const actions = [];
    for (let index = 0; index < expectedActions.length; index += 1) {
      const decision = await kernel.supervise(
        stop({ event: `limit-${retryLimit}-${index}` }),
        constraint(`limit-policy-${index}`, { retryLimit }),
      );
      actions.push(decision.action);
    }

    expect(actions).toEqual(expectedActions);
  });

  it("turns a nominal judge pass below the policy threshold into a retry", async () => {
    const kernel = createInMemoryKernel({
      judge: {
        async evaluate() {
          return { kind: "pass", score: 0.79 };
        },
      },
    });

    const decision = await kernel.supervise(
      stop({ event: "below-threshold" }),
      constraint("threshold-policy", { passThreshold: 0.8, retryLimit: 1 }),
    );

    expect(decision.action).toBe("retry");
    expect(decision.evaluation).toMatchObject({
      kind: "retryable-failure",
      score: 0.79,
      findings: [{ criterion: "score-threshold" }],
    });
  });

  it("downgrades to observation when stop continuation is unavailable", async () => {
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        evaluator({ kind: "fail", checkId: "check", findings: [finding] }),
      ],
    });
    const capabilities = capabilitySnapshot({
      rootStopContinuation: { kind: "unsupported", reason: "runtime has no stop hook" },
    });

    const decision = await kernel.supervise(
      stop({ event: "unsupported-1", capabilities }),
      constraint(),
    );

    expect(decision.action).toBe("allow");
    expect(decision.enforcement.kind).toBe("observation");
    expect(decision.evaluation).toMatchObject({
      kind: "terminal-failure",
      reason: "continuation-unsupported",
    });
    expect(await kernel.listSkillCompletions(createSkillVersionId("skill-1"))).toEqual([]);
  });

  it("does not sanction inferred attribution", async () => {
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        evaluator({ kind: "fail", checkId: "check", findings: [finding] }),
      ],
    });
    const attribution: SkillAttribution = {
      kind: "inferred",
      skillVersionId: createSkillVersionId("skill-1"),
      reason: "prompt matched",
    };

    await kernel.supervise(stop({ event: "inferred-1", attribution }), constraint());
    await kernel.supervise(stop({ event: "inferred-2", attribution }), constraint());
    const terminal = await kernel.supervise(
      stop({ event: "inferred-3", attribution }),
      constraint(),
    );

    expect(terminal.sanction).toMatchObject({ kind: "not-eligible" });
    expect(await kernel.listSkillCompletions(createSkillVersionId("skill-1"))).toEqual([]);
  });

  it("quarantines the exact skill version after five verified terminal failures", async () => {
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        evaluator({ kind: "fail", checkId: "check", findings: [finding] }),
      ],
    });

    for (let run = 1; run <= 5; run += 1) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await kernel.supervise(
          stop({ event: `q-${run}-${attempt}`, work: `q-work-${run}` }),
          constraint(),
        );
      }
    }

    expect(await kernel.getSkillStanding(createSkillVersionId("skill-1"))).toMatchObject({
      disposition: "quarantined",
    });
    expect(await kernel.getSkillStanding(createSkillVersionId("other-skill"))).toMatchObject({
      disposition: "active",
    });

    const promptBase = stop({ event: "quarantined-prompt-base", work: "prompt-work" });
    const prompt: PromptObservation = {
      ...promptBase,
      kind: "prompt",
      eventId: createEventId("quarantined-prompt"),
      prompt: "use skill-1",
    };
    const promptDecision = await kernel.supervise(prompt, {
      ...constraint(),
      skillCandidates: [skillCandidate()],
    });
    expect(promptDecision.resolution.kind).toBe("none");
  });

  it("restores quarantine to probation without deleting history", async () => {
    const kernel = createInMemoryKernel({
      deterministicEvaluators: [
        evaluator({ kind: "fail", checkId: "check", findings: [finding] }),
      ],
    });
    for (let run = 1; run <= 5; run += 1) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await kernel.supervise(
          stop({ event: `restore-${run}-${attempt}`, work: `restore-work-${run}` }),
          constraint(),
        );
      }
    }

    const result = await kernel.restoreSkill({
      skillVersionId: createSkillVersionId("skill-1"),
      reason: "fixed in place and reviewed",
      restoredAt: createTimestamp("2026-08-29T11:00:00.000Z"),
    });

    expect(result.kind).toBe("restored");
    expect(await kernel.getSkillStanding(createSkillVersionId("skill-1"))).toMatchObject({
      disposition: "probation",
    });
    expect(await kernel.listSkillCompletions(createSkillVersionId("skill-1"))).toHaveLength(5);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await kernel.supervise(
        stop({ event: `probation-${attempt}`, work: "probation-work" }),
        constraint(),
      );
    }
    expect(await kernel.getSkillStanding(createSkillVersionId("skill-1"))).toMatchObject({
      disposition: "probation",
    });
    expect(await kernel.listSkillCompletions(createSkillVersionId("skill-1"))).toHaveLength(6);
  });

  it("applies signed disposition transitions and never restores a revoked version", async () => {
    const kernel = createInMemoryKernel();
    const skillVersionId = createSkillVersionId("transition-skill");
    const base = {
      skillVersionId,
      reason: "Reviewed team disposition change.",
      actor: "admin@example.test",
      occurredAt: createTimestamp("2026-08-29T11:00:00.000Z"),
    };

    await kernel.applyDispositionTransition({ ...base, kind: "quarantine", revision: 1 });
    expect(await kernel.getSkillStanding(skillVersionId)).toMatchObject({
      disposition: "quarantined",
    });

    await kernel.applyDispositionTransition({ ...base, kind: "restoration", revision: 2 });
    expect(await kernel.getSkillStanding(skillVersionId)).toMatchObject({
      disposition: "probation",
    });

    await kernel.applyDispositionTransition({ ...base, kind: "revocation", revision: 3 });
    const ignored = await kernel.applyDispositionTransition({
      ...base,
      kind: "restoration",
      revision: 4,
    });

    expect(ignored.kind).toBe("ignored-revoked");
    expect(await kernel.getSkillStanding(skillVersionId)).toMatchObject({
      disposition: "revoked",
    });
  });

  it.each<"inconclusive" | "late">(["inconclusive", "late"])(
    "allows a %s judge result without sanctions",
    async (kind) => {
      const judge: EvaluationJudge = {
        async evaluate() {
          if (kind === "late") {
            return {
              kind: "late",
              receivedAt: createTimestamp("2026-08-29T10:00:01.000Z"),
              advisory: { kind: "fail", score: 0, findings: [finding] },
            };
          }
          return { kind: "inconclusive", reason: "judge unavailable" };
        },
      };
      const kernel = createInMemoryKernel({ judge });

      const decision = await kernel.supervise(stop({ event: `judge-${kind}` }), constraint());

      expect(decision.action).toBe("allow");
      expect(decision.evaluation.kind).toBe("inconclusive");
      expect(decision.sanction).toEqual({ kind: "not-applicable" });
      expect(await kernel.listSkillCompletions(createSkillVersionId("skill-1"))).toEqual([]);
      if (kind === "late") {
        expect(decision.evaluation).toMatchObject({
          advisory: {
            result: { kind: "fail", score: 0 },
          },
        });
      }
    },
  );

  it("preserves a judge score in the persisted decision", async () => {
    const kernel = createInMemoryKernel({
      judge: {
        async evaluate() {
          return { kind: "pass", score: 0.91 };
        },
      },
    });

    const decision = await kernel.supervise(stop({ event: "judge-score" }), constraint());

    expect(decision.evaluation).toEqual({ kind: "pass", score: 0.91 });
  });

  it("fails open when the judge exceeds its deadline", async () => {
    const judge: EvaluationJudge = {
      evaluate() {
        return new Promise(() => undefined);
      },
    };
    const kernel = createInMemoryKernel({ judge, judgeTimeoutMs: 5 });

    const decision = await kernel.supervise(stop({ event: "judge-timeout" }), constraint());

    expect(decision.action).toBe("allow");
    expect(decision.evaluation).toMatchObject({ kind: "inconclusive" });
    expect(decision.sanction).toEqual({ kind: "not-applicable" });
  });

  it("persists a judge result that arrives after the enforcement deadline as advisory", async () => {
    let resolveJudge: ((value: JudgeResult) => void) | undefined;
    const advisories: unknown[] = [];
    const kernel = createInMemoryKernel({
      judge: {
        evaluate() {
          return new Promise<JudgeResult>((resolve) => {
            resolveJudge = resolve;
          });
        },
      },
      judgeTimeoutMs: 5,
      now: () => new Date("2026-08-29T10:00:09.000Z"),
      advisoryResults: {
        async record(advisory) {
          advisories.push(advisory);
        },
      },
    });

    const decision = await kernel.supervise(
      stop({ event: "judge-actually-late" }),
      constraint("late-policy"),
    );
    expect(decision.evaluation).toMatchObject({ kind: "inconclusive" });

    resolveJudge?.({ kind: "fail", score: 0.1, findings: [finding] });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(advisories).toEqual([
      expect.objectContaining({
        evaluationId: "evaluation:judge-actually-late:late-policy",
        eventId: "judge-actually-late",
        policyVersionId: "late-policy",
        receivedAt: "2026-08-29T10:00:09.000Z",
        advisory: { kind: "fail", score: 0.1, findings: [finding] },
      }),
    ]);
  });
});

describe("quarantine window", () => {
  function record(index: number, outcome: "pass" | "terminal-failure"): SkillCompletionRecord {
    return {
      eventId: createEventId(`window-${index}`),
      runId: createRunId(`window-run-${index}`),
      workItemId: createWorkItemId(`window-work-${index}`),
      adapterVersion: createAdapterVersion("0.1.0"),
      policyId: createPolicyId("window-policy"),
      policyVersionId: createPolicyVersionId("window-policy-v1"),
      skillVersionId: createSkillVersionId("skill-window"),
      identity: {
        sessionId: createSessionId(`window-session-${index}`),
        agent: { kind: "root", agentId: createAgentId("window-agent") },
      },
      attempt: 1,
      completedAt: createTimestamp("2026-08-29T10:00:00.000Z"),
      outcome,
      capabilities: capabilitySnapshot(),
    };
  }

  it("uses only the latest ten verified completed records", () => {
    const records = [
      record(1, "terminal-failure"),
      record(2, "terminal-failure"),
      record(3, "terminal-failure"),
      record(4, "terminal-failure"),
      record(5, "terminal-failure"),
      ...Array.from({ length: 10 }, (_, index) => record(index + 6, "pass")),
    ];

    expect(evaluateQuarantineWindow(records)).toEqual({
      shouldQuarantine: false,
      terminalFailures: 0,
      sampleSize: 10,
    });
  });
});

describe("prompt and tool capability downgrade", () => {
  it("labels a selected skill as observation-only without routing control", async () => {
    const kernel = createInMemoryKernel();
    const base = stop({
      event: "prompt-base",
      capabilities: capabilitySnapshot({
        skillSelectionControl: { kind: "unsupported", reason: "not exposed" },
      }),
    });
    const event: PromptObservation = {
      ...base,
      kind: "prompt",
      eventId: createEventId("prompt-1"),
      prompt: "use the prompt skill",
    };
    const policy = { ...constraint(), skillCandidates: [skillCandidate("prompt-skill")] };

    const decision = await kernel.supervise(event, policy);

    expect(decision.resolution.kind).toBe("selected");
    expect(decision.enforcement.kind).toBe("observation");
  });

  it("labels a managed-wrapper failure as observation-only", async () => {
    const kernel = createInMemoryKernel();
    const base = stop({ event: "wrapper-unavailable-base" });
    const event: PromptObservation = {
      ...base,
      kind: "prompt",
      eventId: createEventId("wrapper-unavailable-prompt"),
      prompt: "use the managed skill",
    };
    const unavailable = {
      ...skillCandidate("wrapper-unavailable-skill"),
      activationAvailability: {
        kind: "unavailable" as const,
        reason: "The runtime wrapper could not be loaded.",
      },
    };

    const decision = await kernel.supervise(event, {
      ...constraint(),
      skillCandidates: [unavailable],
    });

    expect(decision.resolution).toMatchObject({
      kind: "none",
      candidates: [
        { outcome: { kind: "rejected", reason: "wrapper-unavailable" } },
      ],
    });
    expect(decision.enforcement).toEqual({
      kind: "observation",
      reason: "A matching managed skill could not be delivered to the runtime.",
      missingCapabilities: [],
    });
  });

  it("observes a requested tool denial when prevention is unsupported", async () => {
    const kernel = createInMemoryKernel();
    const base = stop({
      event: "tool-base",
      capabilities: capabilitySnapshot({
        toolPrevention: { kind: "partial", limitation: "runtime only logs tool calls" },
      }),
    });
    const event: ToolRequestObservation = {
      ...base,
      kind: "tool-request",
      eventId: createEventId("tool-request-1"),
      toolCallId: createToolCallId("tool-call-1"),
      toolName: "shell",
      input: {},
    };

    const decision = await kernel.supervise(event, {
      ...constraint(),
      toolPolicy: { kind: "deny", reason: "blocked by policy" },
    });

    expect(decision.action).toBe("observe-denial");
    expect(decision.enforcement.kind).toBe("observation");
  });
});
