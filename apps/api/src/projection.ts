import { createHash } from "node:crypto";

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
import { canonicalJson } from "./canonical-json.js";

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
      return null;
    case "inconclusive":
      return null;
    default: {
      const exhaustive: never = evaluation;
      return exhaustive;
    }
  }
}

function comparisonCohortId(record: CompletionCloudRecord): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        runtime: record.runtime,
        profile: record.runtimeInstallation.profile,
        adapterInstallationId:
          record.runtimeInstallation.adapterInstallationId,
        runtimeVersion: record.runtimeVersion,
        adapterVersion: record.adapterVersion,
        capabilities: record.capabilities,
        attribution: attributionCohort(record),
        enforcement: enforcementCohort(record),
      }),
      "utf8",
    )
    .digest("hex");
}

function agentProjectionId(record: CompletionCloudRecord): string {
  return `${comparisonCohortId(record)}:${record.identity.agent.agentId}`;
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
    profile: record.runtimeInstallation.profile,
    runtimeVersion: record.runtimeVersion,
    adapterVersion: record.adapterVersion,
    adapterInstallationId:
      record.runtimeInstallation.adapterInstallationId,
    comparisonCohortId: comparisonCohortId(record),
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
  const agentId = agentProjectionId(record);
  const existing = agents.find((agent) => agent.id === agentId);
  const result = evaluationResult(record.evaluation);
  const score = evaluationScore(record.evaluation);
  const conclusive = result !== "inconclusive";
  const retried =
    record.evaluation.attempts > 1 ||
    record.evaluation.kind === "retryable-failure";
  const recovered = retried && result === "pass";
  if (existing === undefined) {
    return [
      {
        id: agentId,
        name: record.identity.agent.agentId,
        runtime: record.runtime,
        profile: record.runtimeInstallation.profile,
        runtimeVersion: record.runtimeVersion,
        adapterVersion: record.adapterVersion,
        adapterInstallationId:
          record.runtimeInstallation.adapterInstallationId,
        comparisonCohortId: comparisonCohortId(record),
        attributionCohort: attribution,
        enforcementCohort: enforcement,
        runs: 1,
        conclusiveRuns: conclusive ? 1 : 0,
        scoredRuns: score === null ? 0 : 1,
        retryRuns: retried ? 1 : 0,
        passRate: conclusive && result === "pass" ? 100 : 0,
        retryRecoveryRate: recovered ? 100 : 0,
        terminalFailures: result === "terminal-failure" ? 1 : 0,
        averageScore: score ?? 0,
        tokens: tokenCount(record),
      },
      ...agents,
    ];
  }
  const nextRuns = existing.runs + 1;
  const nextScoredRuns = existing.scoredRuns + (score === null ? 0 : 1);
  const nextAverage =
    score === null
      ? existing.averageScore
      : nextScoredRuns === 0
        ? 0
        : Math.round(
            ((existing.averageScore * existing.scoredRuns + score) /
              nextScoredRuns) * 10,
          ) / 10;
  const updated: AgentSummary = {
    ...existing,
    runs: nextRuns,
    conclusiveRuns: existing.conclusiveRuns + (conclusive ? 1 : 0),
    scoredRuns: nextScoredRuns,
    retryRuns: existing.retryRuns + (retried ? 1 : 0),
    passRate: conclusive
      ? weightedRate({
          previousRate: existing.passRate,
          previousSamples: existing.conclusiveRuns,
          passed: result === "pass",
        })
      : existing.passRate,
    retryRecoveryRate: retried
      ? weightedRate({
          previousRate: existing.retryRecoveryRate,
          previousSamples: existing.retryRuns,
          passed: recovered,
        })
      : existing.retryRecoveryRate,
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
  const agentId = `${run.comparisonCohortId}:${run.agentName}`;
  const existing = agents.find((agent) => agent.id === agentId);
  if (existing === undefined) {
    return agents;
  }
  if (existing.runs <= 1) {
    return agents.filter((agent) => agent.id !== agentId);
  }
  const nextRuns = existing.runs - 1;
  const conclusive = run.result !== "inconclusive";
  const retried = run.attempts > 1 || run.result === "retryable-failure";
  const recovered = retried && run.result === "pass";
  const nextScoredRuns = existing.scoredRuns - (run.score === null ? 0 : 1);
  const nextAverage =
    run.score === null
      ? existing.averageScore
      : nextScoredRuns <= 0
        ? 0
        : Math.min(
            100,
            Math.max(
              0,
              Math.round(
                ((existing.averageScore * existing.scoredRuns - run.score) /
                  nextScoredRuns) *
                  10,
              ) / 10,
            ),
          );
  const updated: AgentSummary = {
    ...existing,
    runs: nextRuns,
    conclusiveRuns: existing.conclusiveRuns - (conclusive ? 1 : 0),
    scoredRuns: nextScoredRuns,
    retryRuns: existing.retryRuns - (retried ? 1 : 0),
    passRate: conclusive
      ? removeWeightedRate({
          previousRate: existing.passRate,
          previousSamples: existing.conclusiveRuns,
          passed: run.result === "pass",
        })
      : existing.passRate,
    retryRecoveryRate: retried
      ? removeWeightedRate({
          previousRate: existing.retryRecoveryRate,
          previousSamples: existing.retryRuns,
          passed: recovered,
        })
      : existing.retryRecoveryRate,
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
  if (record.attribution.kind === "none") {
    return skills;
  }
  const skillVersionId = record.attribution.skillVersionId;
  const verified = record.attribution.kind === "verified";
  const existing = skills.find(
    (skill) =>
      skill.skillVersionId === skillVersionId && skill.runtime === record.runtime,
  );
  const result = evaluationResult(record.evaluation);
  const conclusive = result !== "inconclusive";
  if (existing === undefined) {
    return [
      {
        skillVersionId,
        name: skillVersionId,
        version: versionFromSkillId(skillVersionId),
        runtime: record.runtime,
        disposition: "active",
        verifiedAttributionRate: verified ? 100 : 0,
        runs: 1,
        verifiedRuns: verified ? 1 : 0,
        conclusiveRuns: conclusive ? 1 : 0,
        passRate: conclusive && result === "pass" ? 100 : 0,
        terminalFailures:
          verified && result === "terminal-failure" ? 1 : 0,
        lastChangedAt: record.occurredAt,
      },
      ...skills,
    ];
  }
  const updated: SkillSummary = {
    ...existing,
    runs: existing.runs + 1,
    verifiedRuns: existing.verifiedRuns + (verified ? 1 : 0),
    conclusiveRuns: existing.conclusiveRuns + (conclusive ? 1 : 0),
    verifiedAttributionRate: weightedRate({
      previousRate: existing.verifiedAttributionRate,
      previousSamples: existing.runs,
      passed: verified,
    }),
    passRate: conclusive
      ? weightedRate({
          previousRate: existing.passRate,
          previousSamples: existing.conclusiveRuns,
          passed: result === "pass",
        })
      : existing.passRate,
    terminalFailures:
      existing.terminalFailures +
      (verified && result === "terminal-failure" ? 1 : 0),
  };
  return skills.map((skill) =>
    skill.skillVersionId === skillVersionId && skill.runtime === record.runtime
      ? updated
      : skill,
  );
}

function removeSkillSample(
  skills: SkillSummary[],
  run: RunSummary,
): SkillSummary[] {
  if (run.attribution === "absent" || run.skillVersionId === null) {
    return skills;
  }
  const existing = skills.find(
    (skill) =>
      skill.skillVersionId === run.skillVersionId && skill.runtime === run.runtime,
  );
  if (existing === undefined) {
    return skills;
  }
  if (existing.runs <= 1) {
    return skills.filter(
      (skill) =>
        skill.skillVersionId !== run.skillVersionId || skill.runtime !== run.runtime,
    );
  }
  const updated: SkillSummary = {
    ...existing,
    runs: existing.runs - 1,
    verifiedRuns:
      existing.verifiedRuns - (run.attribution === "verified" ? 1 : 0),
    conclusiveRuns:
      existing.conclusiveRuns - (run.result === "inconclusive" ? 0 : 1),
    verifiedAttributionRate: removeWeightedRate({
      previousRate: existing.verifiedAttributionRate,
      previousSamples: existing.runs,
      passed: run.attribution === "verified",
    }),
    passRate:
      run.result === "inconclusive"
        ? existing.passRate
        : removeWeightedRate({
            previousRate: existing.passRate,
            previousSamples: existing.conclusiveRuns,
            passed: run.result === "pass",
          }),
    terminalFailures: Math.max(
      0,
      existing.terminalFailures -
        (run.attribution === "verified" && run.result === "terminal-failure"
          ? 1
          : 0),
    ),
  };
  return skills.map((skill) =>
    skill.skillVersionId === run.skillVersionId && skill.runtime === run.runtime
      ? updated
      : skill,
  );
}

function integrationScope(
  profile: CloudSupervisionRecord["runtimeInstallation"]["profile"],
): IntegrationSummary["scope"] {
  switch (profile) {
    case "local":
      return "local";
    case "cloud-agent":
      return "cloud";
    default: {
      const exhaustive: never = profile;
      return exhaustive;
    }
  }
}

function projectIntegration(
  integrations: IntegrationSummary[],
  record: CloudSupervisionRecord,
): IntegrationSummary[] {
  const profile = record.runtimeInstallation.profile;
  const scope = integrationScope(profile);
  const existing = matchingIntegration(integrations, record);
  if (existing === undefined) {
    return [
      {
        id: `integration:${record.runtime}:${profile}:${record.runtimeInstallation.adapterInstallationId}`,
        runtime: record.runtime,
        adapterInstallationId: record.runtimeInstallation.adapterInstallationId,
        profile,
        scope,
        status: "healthy",
        adapterVersion: record.adapterVersion,
        runtimeVersion: record.runtimeVersion,
        capabilities: record.capabilities,
        lastSeenAt: record.occurredAt,
      },
      ...integrations,
    ];
  }
  if (!shouldReplaceIntegration(existing, record)) {
    return integrations;
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

function matchingIntegration(
  integrations: IntegrationSummary[],
  record: CloudSupervisionRecord,
): IntegrationSummary | undefined {
  return integrations.find(
    (integration) =>
      integration.runtime === record.runtime &&
      integration.adapterInstallationId ===
        record.runtimeInstallation.adapterInstallationId &&
      integration.profile === record.runtimeInstallation.profile,
  );
}

function integrationConfigurationKey(
  input:
    | CloudSupervisionRecord
    | Pick<
        IntegrationSummary,
        | "runtime"
        | "runtimeVersion"
        | "adapterVersion"
        | "capabilities"
        | "adapterInstallationId"
        | "profile"
      >,
): string {
  const installation =
    "runtimeInstallation" in input
      ? input.runtimeInstallation
      : {
          profile: input.profile,
          adapterInstallationId: input.adapterInstallationId,
        };
  return canonicalJson({
    runtime: input.runtime,
    profile: installation.profile,
    adapterInstallationId: installation.adapterInstallationId,
    runtimeVersion: input.runtimeVersion,
    adapterVersion: input.adapterVersion,
    capabilities: input.capabilities,
  });
}

function shouldReplaceIntegration(
  integration: IntegrationSummary,
  record: CloudSupervisionRecord,
): boolean {
  const chronology =
    Date.parse(record.occurredAt) - Date.parse(integration.lastSeenAt);
  if (chronology !== 0) return chronology > 0;
  return (
    integrationConfigurationKey(record) >
    integrationConfigurationKey(integration)
  );
}

function adapterConfigurationChanged(
  integration: IntegrationSummary,
  record: CloudSupervisionRecord,
): boolean {
  return (
    integration.adapterVersion !== record.adapterVersion ||
    integration.runtimeVersion !== record.runtimeVersion ||
    JSON.stringify(integration.capabilities) !== JSON.stringify(record.capabilities)
  );
}

function updateOverview(snapshot: DashboardSnapshot): DashboardSnapshot["overview"] {
  const totalRuns = snapshot.agents.reduce((sum, agent) => sum + agent.runs, 0);
  const conclusiveRuns = snapshot.agents.reduce(
    (sum, agent) => sum + agent.conclusiveRuns,
    0,
  );
  const retryRuns = snapshot.agents.reduce(
    (sum, agent) => sum + agent.retryRuns,
    0,
  );
  const tokensSpent = snapshot.agents.reduce(
    (sum, agent) => sum + agent.tokens,
    0,
  );
  const weightedPasses = snapshot.agents.reduce(
    (sum, agent) => sum + agent.passRate * agent.conclusiveRuns,
    0,
  );
  const weightedRecoveries = snapshot.agents.reduce(
    (sum, agent) => sum + agent.retryRecoveryRate * agent.retryRuns,
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
      conclusiveRuns === 0
        ? 0
        : Math.round((weightedPasses / conclusiveRuns) * 10) / 10,
    retryRecoveryRate:
      retryRuns === 0
        ? 0
        : Math.round((weightedRecoveries / retryRuns) * 10) / 10,
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
  const previousIntegration = matchingIntegration(
    input.snapshot.integrations,
    record,
  );
  const operationalAudit: DashboardSnapshot["audit"] = [];
  if (
    previousIntegration !== undefined &&
    shouldReplaceIntegration(previousIntegration, record) &&
    adapterConfigurationChanged(previousIntegration, record)
  ) {
    operationalAudit.push({
      id: `audit-adapter-changed-${input.envelope.eventId}`,
      occurredAt: record.occurredAt,
      actor: `device:${input.deviceId}`,
      action: "adapter.changed",
      summary: `Observed adapter ${record.adapterVersion} on runtime ${record.runtimeVersion}.`,
      runtime: record.runtime,
    });
  }
  if (record.enforcement.kind === "observation") {
    operationalAudit.push({
      id: `audit-enforcement-degraded-${input.envelope.eventId}`,
      occurredAt: record.occurredAt,
      actor: `device:${input.deviceId}`,
      action: "integration.degraded",
      summary: `Enforcement degraded to observation: ${record.enforcement.reason}`,
      runtime: record.runtime,
    });
  }
  return {
    ...input.snapshot,
    generatedAt:
      Date.parse(record.occurredAt) >= Date.parse(input.snapshot.generatedAt)
        ? record.occurredAt
        : input.snapshot.generatedAt,
    integrations: projectIntegration(input.snapshot.integrations, record),
    devices: input.snapshot.devices.map((device) =>
      device.id === input.deviceId
        ? {
            ...device,
            status: "online",
            runtimes: [...new Set([...device.runtimes, record.runtime])],
            lastSeenAt:
              Date.parse(record.occurredAt) >= Date.parse(device.lastSeenAt)
                ? record.occurredAt
                : device.lastSeenAt,
            syncLagSeconds: 0,
          }
        : device,
    ),
    audit: [
      ...operationalAudit,
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

function retryAudit(input: {
  deviceId: string;
  envelope: CloudSupervisionEnvelope & { payload: CompletionCloudRecord };
}): DashboardSnapshot["audit"] {
  const evaluation = input.envelope.payload.evaluation;
  if (evaluation.kind !== "retryable-failure") {
    return [];
  }
  return [
    {
      id: `audit-retry-${input.envelope.eventId}`,
      occurredAt: input.envelope.payload.occurredAt,
      actor: `device:${input.deviceId}`,
      action: "retry.issued",
      summary: `Issued retry ${evaluation.retryOrdinal} for ${input.envelope.payload.runId}:${input.envelope.payload.workItemId}.`,
      runtime: input.envelope.payload.runtime,
    },
  ];
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
    const chronologicalOrder =
      Date.parse(run.occurredAt) - Date.parse(existingRun.occurredAt) ||
      run.eventId.localeCompare(existingRun.eventId);
    if (chronologicalOrder <= 0) {
      return projected;
    }
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
        ...retryAudit(input),
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
      ...retryAudit(input),
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
