import type {
  CloudEvaluationMetadata,
  CloudSupervisionEnvelope,
  CloudSupervisionRecord,
  CompletionCloudRecord,
  SkillDispositionTransition,
} from "@sisyphus/domain";
import type {
  AgentSummary,
  Attribution,
  DashboardSnapshot,
  EnforcementCoverage,
  EvaluationResult,
  IntegrationSummary,
  RunSummary,
  SkillSummary,
} from "@sisyphus/ui/contracts";

function attributionCohort(
  record: CompletionCloudRecord,
): Attribution {
  switch (record.attribution.kind) {
    case "verified":
      return "verified";
    case "inferred":
      return "inferred";
    case "none":
      return "absent";
    default: {
      const exhaustive: never = record.attribution;
      return exhaustive;
    }
  }
}

function enforcementCohort(
  record: CloudSupervisionRecord,
): EnforcementCoverage {
  if (record.enforcement.kind === "enforced") {
    return "enforced";
  }
  const hasPartialCapability = record.enforcement.missingCapabilities.some(
    (name) => record.capabilities[name].kind === "partial",
  );
  return hasPartialCapability ? "partial" : "observed-only";
}

function evaluationResult(
  evaluation: CloudEvaluationMetadata,
): EvaluationResult {
  return evaluation.kind === "late" ? "inconclusive" : evaluation.kind;
}

function evaluationScore(
  evaluation: CloudEvaluationMetadata,
): number | null {
  switch (evaluation.kind) {
    case "pass":
    case "retryable-failure":
    case "terminal-failure":
      return Math.round(evaluation.score * 1_000) / 10;
    case "late":
      return Math.round(evaluation.advisory.score * 1_000) / 10;
    case "inconclusive":
      return null;
    default: {
      const exhaustive: never = evaluation;
      return exhaustive;
    }
  }
}

function evaluationFindings(
  evaluation: CloudEvaluationMetadata,
): string[] {
  switch (evaluation.kind) {
    case "retryable-failure":
    case "terminal-failure":
      return evaluation.findings.map((finding) => finding.message);
    case "late":
      return evaluation.advisory.kind === "fail"
        ? evaluation.advisory.findings.map((finding) => finding.message)
        : ["The late judge result is advisory and did not change enforcement."];
    case "inconclusive":
      return [evaluation.reason];
    case "pass":
      return [];
    default: {
      const exhaustive: never = evaluation;
      return exhaustive;
    }
  }
}

function tokenCount(record: CompletionCloudRecord): number {
  if (record.tokenUsage.kind === "unavailable") {
    return 0;
  }
  return record.tokenUsage.inputTokens + record.tokenUsage.outputTokens;
}

function projectedRun(input: {
  record: CompletionCloudRecord;
  eventId: CloudSupervisionEnvelope["eventId"];
}): RunSummary {
  const { record } = input;
  const skillVersionId =
    record.attribution.kind === "none"
      ? null
      : record.attribution.skillVersionId;
  return {
    id: `${record.runId}:${record.workItemId}`,
    eventId: input.eventId,
    occurredAt: record.occurredAt,
    runtime: record.runtime,
    runtimeVersion: record.runtimeVersion,
    agentName: record.identity.agent.agentId,
    project: record.project,
    skillVersionId,
    skillName: skillVersionId,
    attribution: attributionCohort(record),
    enforcement: enforcementCohort(record),
    result: evaluationResult(record.evaluation),
    score: evaluationScore(record.evaluation),
    attempts: record.evaluation.attempts,
    tokens: tokenCount(record),
    latencyMs: record.evaluation.latencyMs,
    findings: evaluationFindings(record.evaluation),
  };
}

function weightedRate(input: {
  previousRate: number;
  previousSamples: number;
  passed: boolean;
}): number {
  const numerator =
    input.previousRate * input.previousSamples + (input.passed ? 100 : 0);
  return Math.round((numerator / (input.previousSamples + 1)) * 10) / 10;
}

function removeWeightedRate(input: {
  previousRate: number;
  previousSamples: number;
  passed: boolean;
}): number {
  const nextSamples = input.previousSamples - 1;
  if (nextSamples <= 0) {
    return 0;
  }
  const numerator = Math.min(
    nextSamples * 100,
    Math.max(
      0,
      input.previousRate * input.previousSamples - (input.passed ? 100 : 0),
    ),
  );
  return Math.round((numerator / nextSamples) * 10) / 10;
}

function projectAgent(
  agents: AgentSummary[],
  record: CompletionCloudRecord,
): AgentSummary[] {
  const attribution = attributionCohort(record);
  const enforcement = enforcementCohort(record);
  const agentId = `${record.identity.agent.agentId}:${attribution}:${enforcement}`;
  const existing = agents.find((agent) => agent.id === agentId);
  const result = evaluationResult(record.evaluation);
  const score = evaluationScore(record.evaluation);
  const recovered = result === "pass" && record.evaluation.attempts > 1;
  if (existing === undefined) {
    return [
      {
        id: agentId,
        name: record.identity.agent.agentId,
        runtime: record.runtime,
        attributionCohort: attribution,
        enforcementCohort: enforcement,
        runs: 1,
        passRate: result === "pass" ? 100 : 0,
        retryRecoveryRate: recovered ? 100 : 0,
        terminalFailures: result === "terminal-failure" ? 1 : 0,
        averageScore: score ?? 0,
        tokens: tokenCount(record),
      },
      ...agents,
    ];
  }
  const nextRuns = existing.runs + 1;
  const nextAverage =
    score === null
      ? existing.averageScore
      : Math.round(
          ((existing.averageScore * existing.runs + score) / nextRuns) * 10,
        ) / 10;
  const updated: AgentSummary = {
    ...existing,
    runs: nextRuns,
    passRate: weightedRate({
      previousRate: existing.passRate,
      previousSamples: existing.runs,
      passed: result === "pass",
    }),
    retryRecoveryRate:
      weightedRate({
        previousRate: existing.retryRecoveryRate,
        previousSamples: existing.runs,
        passed: recovered,
      }),
    terminalFailures:
      existing.terminalFailures + (result === "terminal-failure" ? 1 : 0),
    averageScore: nextAverage,
    tokens: existing.tokens + tokenCount(record),
  };
  return agents.map((agent) => (agent.id === agentId ? updated : agent));
}

function removeAgentSample(
  agents: AgentSummary[],
  run: RunSummary,
): AgentSummary[] {
  const agentId = `${run.agentName}:${run.attribution}:${run.enforcement}`;
  const existing = agents.find((agent) => agent.id === agentId);
  if (existing === undefined) {
    return agents;
  }
  if (existing.runs <= 1) {
    return agents.filter((agent) => agent.id !== agentId);
  }
  const nextRuns = existing.runs - 1;
  const recovered = run.result === "pass" && run.attempts > 1;
  const nextAverage =
    run.score === null
      ? existing.averageScore
      : Math.min(
          100,
          Math.max(
            0,
            Math.round(
              ((existing.averageScore * existing.runs - run.score) / nextRuns) *
                10,
            ) / 10,
          ),
        );
  const updated: AgentSummary = {
    ...existing,
    runs: nextRuns,
    passRate: removeWeightedRate({
      previousRate: existing.passRate,
      previousSamples: existing.runs,
      passed: run.result === "pass",
    }),
    retryRecoveryRate: removeWeightedRate({
      previousRate: existing.retryRecoveryRate,
      previousSamples: existing.runs,
      passed: recovered,
    }),
    terminalFailures: Math.max(
      0,
      existing.terminalFailures - (run.result === "terminal-failure" ? 1 : 0),
    ),
    averageScore: nextAverage,
    tokens: Math.max(0, existing.tokens - run.tokens),
  };
  return agents.map((agent) => (agent.id === agentId ? updated : agent));
}

function versionFromSkillId(skillVersionId: string): string {
  const separator = skillVersionId.lastIndexOf("@");
  return separator < 0 ? "unknown" : skillVersionId.slice(separator + 1);
}

function projectSkill(
  skills: SkillSummary[],
  record: CompletionCloudRecord,
): SkillSummary[] {
  if (record.attribution.kind !== "verified") {
    return skills;
  }
  const skillVersionId = record.attribution.skillVersionId;
  const existing = skills.find(
    (skill) => skill.skillVersionId === skillVersionId,
  );
  const result = evaluationResult(record.evaluation);
  if (existing === undefined) {
    return [
      {
        skillVersionId,
        name: skillVersionId,
        version: versionFromSkillId(skillVersionId),
        runtime: record.runtime,
        disposition: "active",
        verifiedAttributionRate: 100,
        runs: 1,
        passRate: result === "pass" ? 100 : 0,
        terminalFailures: result === "terminal-failure" ? 1 : 0,
        lastChangedAt: record.occurredAt,
      },
      ...skills,
    ];
  }
  const updated: SkillSummary = {
    ...existing,
    runs: existing.runs + 1,
    passRate: weightedRate({
      previousRate: existing.passRate,
      previousSamples: existing.runs,
      passed: result === "pass",
    }),
    terminalFailures:
      existing.terminalFailures + (result === "terminal-failure" ? 1 : 0),
  };
  return skills.map((skill) =>
    skill.skillVersionId === skillVersionId ? updated : skill,
  );
}

function removeSkillSample(
  skills: SkillSummary[],
  run: RunSummary,
): SkillSummary[] {
  if (run.attribution !== "verified" || run.skillVersionId === null) {
    return skills;
  }
  const existing = skills.find(
    (skill) => skill.skillVersionId === run.skillVersionId,
  );
  if (existing === undefined) {
    return skills;
  }
  if (existing.runs <= 1) {
    return skills.filter(
      (skill) => skill.skillVersionId !== run.skillVersionId,
    );
  }
  const updated: SkillSummary = {
    ...existing,
    runs: existing.runs - 1,
    passRate: removeWeightedRate({
      previousRate: existing.passRate,
      previousSamples: existing.runs,
      passed: run.result === "pass",
    }),
    terminalFailures: Math.max(
      0,
      existing.terminalFailures - (run.result === "terminal-failure" ? 1 : 0),
    ),
  };
  return skills.map((skill) =>
    skill.skillVersionId === run.skillVersionId ? updated : skill,
  );
}

function projectIntegration(
  integrations: IntegrationSummary[],
  record: CloudSupervisionRecord,
): IntegrationSummary[] {
  const existing = integrations.find(
    (integration) =>
      integration.runtime === record.runtime && integration.scope === "local",
  );
  if (existing === undefined) {
    return [
      {
        id: `integration-${record.runtime}-local`,
        runtime: record.runtime,
        scope: "local",
        status: "healthy",
        adapterVersion: record.adapterVersion,
        runtimeVersion: record.runtimeVersion,
        capabilities: record.capabilities,
        lastSeenAt: record.occurredAt,
      },
      ...integrations,
    ];
  }
  const updated: IntegrationSummary = {
    ...existing,
    status: "healthy",
    adapterVersion: record.adapterVersion,
    runtimeVersion: record.runtimeVersion,
    capabilities: record.capabilities,
    lastSeenAt: record.occurredAt,
  };
  return integrations.map((integration) =>
    integration.id === existing.id ? updated : integration,
  );
}

function updateOverview(snapshot: DashboardSnapshot): DashboardSnapshot["overview"] {
  const totalRuns = snapshot.agents.reduce((sum, agent) => sum + agent.runs, 0);
  const tokensSpent = snapshot.agents.reduce(
    (sum, agent) => sum + agent.tokens,
    0,
  );
  const weightedPasses = snapshot.agents.reduce(
    (sum, agent) => sum + agent.passRate * agent.runs,
    0,
  );
  const terminalFailures = snapshot.agents.reduce(
    (sum, agent) => sum + agent.terminalFailures,
    0,
  );
  const averageLatencyMs =
    snapshot.runs.length === 0
      ? 0
      : Math.round(
          snapshot.runs.reduce((sum, run) => sum + run.latencyMs, 0) /
            snapshot.runs.length,
        );
  const enforcedRuns = snapshot.runs.filter(
    (run) => run.enforcement === "enforced",
  ).length;
  return {
    ...snapshot.overview,
    totalRuns,
    passRate:
      totalRuns === 0 ? 0 : Math.round((weightedPasses / totalRuns) * 10) / 10,
    terminalFailures,
    tokensSpent,
    tokensAvoidedEstimate: Math.round(tokensSpent * 0.143),
    averageLatencyMs,
    enforcedShare:
      snapshot.runs.length === 0
        ? 0
        : Math.round((enforcedRuns / snapshot.runs.length) * 1_000) / 10,
  };
}

function projectCommon(input: {
  snapshot: DashboardSnapshot;
  deviceId: string;
  envelope: CloudSupervisionEnvelope;
}): DashboardSnapshot {
  const record = input.envelope.payload;
  return {
    ...input.snapshot,
    generatedAt: record.occurredAt,
    integrations: projectIntegration(input.snapshot.integrations, record),
    devices: input.snapshot.devices.map((device) =>
      device.id === input.deviceId
        ? {
            ...device,
            status: "online",
            runtimes: [...new Set([...device.runtimes, record.runtime])],
            lastSeenAt: record.occurredAt,
            syncLagSeconds: 0,
          }
        : device,
    ),
    audit: [
      {
        id: `audit-ingest-${input.envelope.eventId}`,
        occurredAt: record.occurredAt,
        actor: `device:${input.deviceId}`,
        action: "event.ingested",
        summary: `Accepted worker event ${input.envelope.eventId}.`,
        runtime: record.runtime,
      },
      ...input.snapshot.audit,
    ],
  };
}

function resolutionReason(input: {
  kind: "selected" | "rejected";
  reason?: string;
}): string {
  if (input.kind === "selected") {
    return "Selected by the deterministic resolution order.";
  }
  return (input.reason ?? "rejected").replaceAll("-", " ");
}

function projectPromptResolution(input: {
  snapshot: DashboardSnapshot;
  deviceId: string;
  envelope: CloudSupervisionEnvelope & {
    payload: Extract<CloudSupervisionRecord, { kind: "prompt-resolution" }>;
  };
}): DashboardSnapshot {
  const projected = projectCommon(input);
  const resolution = input.envelope.payload.resolution;
  if (resolution.kind !== "selected") {
    return projected;
  }
  return {
    ...projected,
    conflicts: [
      {
        id: `conflict-${input.envelope.eventId}`,
        occurredAt: input.envelope.payload.occurredAt,
        runtime: input.envelope.payload.runtime,
        promptSummary: `Prompt fingerprint ${input.envelope.payload.promptDigest.slice(0, 12)}`,
        selectedSkill: resolution.selectedSkillVersionId,
        candidates: resolution.candidates.map((candidate) => ({
          skillVersionId: candidate.skillVersionId,
          skillName: candidate.skillVersionId,
          priority: candidate.administratorPriority,
          specificity: candidate.specificity,
          selected: candidate.outcome.kind === "selected",
          reason: resolutionReason(candidate.outcome),
        })),
      },
      ...projected.conflicts,
    ],
  };
}

function projectCompletion(input: {
  snapshot: DashboardSnapshot;
  deviceId: string;
  envelope: CloudSupervisionEnvelope & { payload: CompletionCloudRecord };
}): DashboardSnapshot {
  const record = input.envelope.payload;
  const projected = projectCommon(input);
  const run = projectedRun({
    record,
    eventId: input.envelope.eventId,
  });
  const existingRun = input.snapshot.runs.find(
    (candidate) => candidate.id === run.id,
  );
  if (existingRun !== undefined) {
    const agentsWithoutPriorAttempt = removeAgentSample(
      projected.agents,
      existingRun,
    );
    const skillsWithoutPriorAttempt = removeSkillSample(
      projected.skills,
      existingRun,
    );
    const retried: DashboardSnapshot = {
      ...projected,
      runs: projected.runs.map((candidate) =>
        candidate.id === run.id ? run : candidate,
      ),
      agents: projectAgent(agentsWithoutPriorAttempt, record),
      skills: projectSkill(skillsWithoutPriorAttempt, record),
      audit: [
        {
          id: `audit-evaluation-${input.envelope.eventId}`,
          occurredAt: record.occurredAt,
          actor: `device:${input.deviceId}`,
          action: "evaluation.completed",
          summary: `Updated ${record.evaluation.kind} evaluation for ${run.id}.`,
          runtime: run.runtime,
        },
        ...projected.audit,
      ],
    };
    return { ...retried, overview: updateOverview(retried) };
  }
  const completed: DashboardSnapshot = {
    ...projected,
    runs: [run, ...projected.runs],
    agents: projectAgent(projected.agents, record),
    skills: projectSkill(projected.skills, record),
    audit: [
      {
        id: `audit-evaluation-${input.envelope.eventId}`,
        occurredAt: record.occurredAt,
        actor: `device:${input.deviceId}`,
        action: "evaluation.completed",
        summary: `Projected ${record.evaluation.kind} evaluation for ${run.id}.`,
        runtime: run.runtime,
      },
      ...projected.audit,
    ],
  };
  return { ...completed, overview: updateOverview(completed) };
}

function projectOne(input: {
  snapshot: DashboardSnapshot;
  deviceId: string;
  envelope: CloudSupervisionEnvelope;
}): DashboardSnapshot {
  if (
    input.snapshot.audit.some(
      (event) => event.id === `audit-ingest-${input.envelope.eventId}`,
    )
  ) {
    return input.snapshot;
  }
  switch (input.envelope.payload.kind) {
    case "prompt-resolution":
      return projectPromptResolution({
        ...input,
        envelope: { ...input.envelope, payload: input.envelope.payload },
      });
    case "tool-observation":
      return projectCommon(input);
    case "completion":
      return projectCompletion({
        ...input,
        envelope: { ...input.envelope, payload: input.envelope.payload },
      });
    default: {
      const exhaustive: never = input.envelope.payload;
      return exhaustive;
    }
  }
}

export function projectAcceptedCloudRecords(input: {
  snapshot: DashboardSnapshot;
  deviceId: string;
  records: CloudSupervisionEnvelope[];
}): DashboardSnapshot {
  return input.records.reduce(
    (snapshot, envelope) => projectOne({
      snapshot,
      deviceId: input.deviceId,
      envelope,
    }),
    input.snapshot,
  );
}

export function applyDispositionTransition(input: {
  snapshot: DashboardSnapshot;
  transition: SkillDispositionTransition;
}): DashboardSnapshot {
  const existing = input.snapshot.skills.find(
    (skill) => skill.skillVersionId === input.transition.skillVersionId,
  );
  if (
    existing === undefined ||
    (existing.disposition === "revoked" &&
      input.transition.kind !== "revocation")
  ) {
    return input.snapshot;
  }
  const disposition = (() => {
    switch (input.transition.kind) {
      case "quarantine":
        return "quarantined";
      case "probation":
      case "restoration":
        return "probation";
      case "revocation":
        return "revoked";
      default: {
        const exhaustive: never = input.transition;
        return exhaustive;
      }
    }
  })();
  return {
    ...input.snapshot,
    generatedAt: input.transition.occurredAt,
    skills: input.snapshot.skills.map((skill) =>
      skill.skillVersionId === input.transition.skillVersionId
        ? {
            ...skill,
            disposition,
            lastChangedAt: input.transition.occurredAt,
          }
        : skill,
    ),
  };
}
