import type {
  AgentRuntime,
  CloudSupervisionEnvelope,
  SkillDispositionTransition,
  SkillVersionId,
  Timestamp,
} from "@sisyphus/domain";

const WINDOW_SIZE = 10;
const TERMINAL_FAILURE_THRESHOLD = 5;

interface EligibleCloudSkillOutcome {
  readonly eventId: CloudSupervisionEnvelope["eventId"];
  readonly runId: CloudSupervisionEnvelope["payload"]["runId"];
  readonly workItemId: CloudSupervisionEnvelope["payload"]["workItemId"];
  readonly skillVersionId: SkillVersionId;
  readonly occurredAt: Timestamp;
  readonly runtime: AgentRuntime;
  readonly outcome: "pass" | "terminal-failure";
}

export interface CloudQuarantineWindowResult {
  readonly shouldQuarantine: boolean;
  readonly terminalFailures: number;
  readonly sampleSize: number;
  readonly latestOccurredAt: Timestamp | null;
  readonly latestRuntime: AgentRuntime | null;
}

function eligibleOutcome(
  envelope: CloudSupervisionEnvelope,
): EligibleCloudSkillOutcome | undefined {
  const record = envelope.payload;
  if (
    record.kind !== "completion" ||
    record.attribution.kind !== "verified" ||
    record.enforcement.kind !== "enforced" ||
    (record.capabilities.skillSelectionControl.kind !== "supported" &&
      record.capabilities.toolPrevention.kind !== "supported")
  ) {
    return undefined;
  }

  switch (record.evaluation.kind) {
    case "pass":
      return {
        eventId: envelope.eventId,
        runId: record.runId,
        workItemId: record.workItemId,
        skillVersionId: record.attribution.skillVersionId,
        occurredAt: record.occurredAt,
        runtime: record.runtime,
        outcome: "pass",
      };
    case "terminal-failure":
      return record.evaluation.reason === "retries-exhausted"
        ? {
            eventId: envelope.eventId,
            runId: record.runId,
            workItemId: record.workItemId,
            skillVersionId: record.attribution.skillVersionId,
            occurredAt: record.occurredAt,
            runtime: record.runtime,
            outcome: "terminal-failure",
          }
        : undefined;
    case "retryable-failure":
    case "inconclusive":
    case "late":
      return undefined;
    default: {
      const exhaustive: never = record.evaluation;
      return exhaustive;
    }
  }
}

function latestWindowReset(input: {
  readonly transitions: readonly SkillDispositionTransition[];
  readonly skillVersionId: SkillVersionId;
}): SkillDispositionTransition | undefined {
  return input.transitions
    .filter(
      (transition) =>
        transition.skillVersionId === input.skillVersionId &&
        (transition.kind === "probation" || transition.kind === "restoration"),
    )
    .reduce<SkillDispositionTransition | undefined>(
      (latest, transition) =>
        latest === undefined || transition.revision > latest.revision
          ? transition
          : latest,
      undefined,
    );
}

function compareChronology(
  left: Pick<EligibleCloudSkillOutcome, "eventId" | "occurredAt">,
  right: Pick<EligibleCloudSkillOutcome, "eventId" | "occurredAt">,
): number {
  const timeDifference = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }
  return left.eventId.localeCompare(right.eventId);
}

function collapseLogicalCompletions(
  records: readonly CloudSupervisionEnvelope[],
): CloudSupervisionEnvelope[] {
  const byRun = new Map<
    CloudSupervisionEnvelope["payload"]["runId"],
    Map<
      CloudSupervisionEnvelope["payload"]["workItemId"],
      CloudSupervisionEnvelope
    >
  >();
  for (const record of records) {
    if (record.payload.kind !== "completion") {
      continue;
    }
    const byWorkItem = byRun.get(record.payload.runId) ?? new Map();
    const previous = byWorkItem.get(record.payload.workItemId);
    if (
      previous === undefined ||
      compareChronology(
        {
          eventId: previous.eventId,
          occurredAt: previous.payload.occurredAt,
        },
        { eventId: record.eventId, occurredAt: record.payload.occurredAt },
      ) < 0
    ) {
      byWorkItem.set(record.payload.workItemId, record);
    }
    byRun.set(record.payload.runId, byWorkItem);
  }
  return [...byRun.values()].flatMap((byWorkItem) => [
    ...byWorkItem.values(),
  ]);
}

export function quarantineCandidateSkillVersionIds(
  records: readonly CloudSupervisionEnvelope[],
): SkillVersionId[] {
  const candidates = new Set<SkillVersionId>();
  for (const record of collapseLogicalCompletions(records)) {
    const outcome = eligibleOutcome(record);
    if (outcome !== undefined) {
      candidates.add(outcome.skillVersionId);
    }
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

export function evaluateCloudQuarantineWindow(input: {
  readonly records: readonly CloudSupervisionEnvelope[];
  readonly transitions: readonly SkillDispositionTransition[];
  readonly skillVersionId: SkillVersionId;
}): CloudQuarantineWindowResult {
  const reset = latestWindowReset(input);
  const resetTime = reset === undefined ? null : Date.parse(reset.occurredAt);
  const eligible = collapseLogicalCompletions(input.records)
    .map(eligibleOutcome)
    .filter(
      (outcome): outcome is EligibleCloudSkillOutcome =>
        outcome !== undefined,
    );
  const window = eligible
    .filter(
      (outcome) =>
        outcome.skillVersionId === input.skillVersionId &&
        (resetTime === null || Date.parse(outcome.occurredAt) > resetTime),
    )
    .sort(compareChronology)
    .slice(-WINDOW_SIZE);
  const terminalFailures = window.filter(
    (outcome) => outcome.outcome === "terminal-failure",
  ).length;
  const latest = window.at(-1);

  return {
    shouldQuarantine: terminalFailures >= TERMINAL_FAILURE_THRESHOLD,
    terminalFailures,
    sampleSize: window.length,
    latestOccurredAt: latest?.occurredAt ?? null,
    latestRuntime: latest?.runtime ?? null,
  };
}

export function cloudQuarantineReason(
  window: Pick<
    CloudQuarantineWindowResult,
    "terminalFailures" | "sampleSize"
  >,
): string {
  return `Server threshold reached: ${window.terminalFailures} terminal failures among the latest ${window.sampleSize} eligible verified outcomes.`;
}
