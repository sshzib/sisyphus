import { createHash } from "node:crypto";

import {
  enforcementFor,
  isSanctionableAttribution,
  resolveSkill,
  supportsCapability,
  type CapabilityName,
  type DecisionFor,
  type Enforcement,
  type EvaluationAssessment,
  type EvaluationConstraint,
  type HookObservation,
  type PromptDecision,
  type PromptObservation,
  type RootStopObservation,
  type SkillCompletionRecord,
  type SkillDispositionTransition,
  type SkillDisposition,
  type SkillMatchCandidate,
  type SkillVersionId,
  type StopDecision,
  type StopObservation,
  type SubagentStopObservation,
  type SupervisionDecision,
  type ToolRequestDecision,
  type ToolRequestObservation,
  type ToolResultDecision,
  type ToolResultObservation,
} from "@sisyphus/domain";

import { EvaluationEngine } from "./evaluation-engine.js";
import { InMemorySupervisionStore } from "./in-memory-store.js";
import type {
  DeterministicEvaluator,
  EvaluationJudge,
  PersistedEventDecision,
  SupervisionStore,
  SupervisionTransaction,
} from "./ports.js";
import {
  evaluateQuarantineWindow,
  type ApplyDispositionTransitionResult,
  type RestoreSkillInput,
  type RestoreSkillResult,
  type RetryDirectiveCount,
  type SkillStanding,
} from "./state.js";

export interface SupervisionKernel {
  supervise<E extends HookObservation>(
    event: E,
    constraint: EvaluationConstraint,
  ): Promise<DecisionFor<E>>;
  supervise(
    event: PromptObservation,
    constraint: EvaluationConstraint,
  ): Promise<DecisionFor<PromptObservation>>;
  supervise(
    event: ToolRequestObservation,
    constraint: EvaluationConstraint,
  ): Promise<DecisionFor<ToolRequestObservation>>;
  supervise(
    event: ToolResultObservation,
    constraint: EvaluationConstraint,
  ): Promise<DecisionFor<ToolResultObservation>>;
  supervise(
    event: RootStopObservation,
    constraint: EvaluationConstraint,
  ): Promise<DecisionFor<RootStopObservation>>;
  supervise(
    event: SubagentStopObservation,
    constraint: EvaluationConstraint,
  ): Promise<DecisionFor<SubagentStopObservation>>;
  supervise(
    event: HookObservation,
    constraint: EvaluationConstraint,
  ): Promise<SupervisionDecision>;

  restoreSkill(input: RestoreSkillInput): Promise<RestoreSkillResult>;
  applyDispositionTransition(
    transition: SkillDispositionTransition,
  ): Promise<ApplyDispositionTransitionResult>;
  getSkillStanding(skillVersionId: SkillVersionId): Promise<SkillStanding>;
  listSkillCompletions(
    skillVersionId: SkillVersionId,
  ): Promise<readonly SkillCompletionRecord[]>;
}

function requiredCapabilities(
  constraint: EvaluationConstraint,
  actionCapabilities: readonly CapabilityName[],
): readonly CapabilityName[] {
  return [...new Set([...constraint.requiredCapabilities, ...actionCapabilities])];
}

function persistedDecision(
  transaction: SupervisionTransaction,
  event: HookObservation,
): SupervisionDecision | undefined {
  const persisted = transaction.getDecision(event.eventId);
  if (persisted === undefined) return undefined;
  if (
    persisted.observationKind !== event.kind ||
    persisted.workItemId !== event.workItemId ||
    persisted.observationDigest !== observationDigest(event)
  ) {
    throw new Error(`event ID ${event.eventId} was reused for a different observation`);
  }
  return persisted.decision;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).toSorted(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("observation is not canonical JSON");
}

function observationDigest(event: HookObservation): string {
  return createHash("sha256").update(canonicalJson(event), "utf8").digest("hex");
}

function storeDecision(
  transaction: SupervisionTransaction,
  event: HookObservation,
  decision: SupervisionDecision,
): void {
  const persisted: PersistedEventDecision = {
    observationKind: event.kind,
    workItemId: event.workItemId,
    observationDigest: observationDigest(event),
    decision,
  };
  transaction.putDecision(event.eventId, persisted);
}

function stricterDisposition(
  candidate: SkillDisposition,
  stored: SkillStanding["disposition"],
): SkillDisposition {
  if (candidate === "revoked" || stored === "revoked") return "revoked";
  if (candidate === "quarantined" || stored === "quarantined") return "quarantined";
  if (candidate === "probation" || stored === "probation") return "probation";
  return "active";
}

function effectiveCandidate(
  transaction: SupervisionTransaction,
  candidate: SkillMatchCandidate,
): SkillMatchCandidate {
  const stored = transaction.getSkillStanding(candidate.skillVersionId);
  return {
    ...candidate,
    disposition: stricterDisposition(candidate.disposition, stored.disposition),
  };
}

function nextRetry(count: RetryDirectiveCount):
  | { readonly kind: "retry"; readonly ordinal: 1 | 2; readonly nextCount: 1 | 2 }
  | { readonly kind: "exhausted" } {
  switch (count) {
    case 0:
      return { kind: "retry", ordinal: 1, nextCount: 1 };
    case 1:
      return { kind: "retry", ordinal: 2, nextCount: 2 };
    case 2:
      return { kind: "exhausted" };
    default: {
      const exhaustive: never = count;
      return exhaustive;
    }
  }
}

function attemptFor(count: RetryDirectiveCount): 1 | 2 | 3 {
  switch (count) {
    case 0:
      return 1;
    case 1:
      return 2;
    case 2:
      return 3;
    default: {
      const exhaustive: never = count;
      return exhaustive;
    }
  }
}

function feedbackSummary(findings: EvaluationAssessment & { kind: "fail" }): string {
  return findings.findings.map((finding) => finding.correction).join("; ");
}

function optionalScore(score: number | undefined): { readonly score?: number } {
  return score === undefined ? {} : { score };
}

function canRecordSkillOutcome(
  event: StopObservation,
  constraint: EvaluationConstraint,
): Enforcement {
  const policyEnforcement = enforcementFor(
    event.capabilities,
    constraint.requiredCapabilities,
  );
  if (policyEnforcement.kind === "observation") return policyEnforcement;
  if (
    supportsCapability(event.capabilities, "skillSelectionControl") ||
    supportsCapability(event.capabilities, "toolPrevention")
  ) {
    return { kind: "enforced" };
  }
  return {
    kind: "observation",
    reason: "runtime cannot prove managed skill routing or tool enforcement",
    missingCapabilities: ["skillSelectionControl", "toolPrevention"],
  };
}

function appendCompletion(input: {
  transaction: SupervisionTransaction;
  event: StopObservation;
  constraint: EvaluationConstraint;
  skillVersionId: SkillVersionId;
  outcome: SkillCompletionRecord["outcome"];
}): SkillCompletionRecord {
  const retryDirectives = input.transaction.getWorkItem(
    input.event.workItemId,
  ).retryDirectives;
  const attempt = attemptFor(retryDirectives);
  const record: SkillCompletionRecord = {
    eventId: input.event.eventId,
    runId: input.event.runId,
    workItemId: input.event.workItemId,
    adapterVersion: input.event.adapterVersion,
    policyId: input.constraint.policyId,
    policyVersionId: input.constraint.policyVersionId,
    skillVersionId: input.skillVersionId,
    identity: input.event.identity,
    attempt,
    completedAt: input.event.occurredAt,
    outcome: input.outcome,
    capabilities: input.event.capabilities,
  };
  input.transaction.appendSkillCompletion(record);
  return record;
}

function recordCompletedOutcome(input: {
  transaction: SupervisionTransaction;
  event: StopObservation;
  constraint: EvaluationConstraint;
  outcome: SkillCompletionRecord["outcome"];
}): StopDecision["sanction"] {
  if (!isSanctionableAttribution(input.event.attribution)) {
    return { kind: "not-eligible", reason: "skill attribution is not verified" };
  }
  const coverage = canRecordSkillOutcome(input.event, input.constraint);
  if (coverage.kind === "observation") {
    return { kind: "not-eligible", reason: coverage.reason };
  }

  const skillVersionId = input.event.attribution.skillVersionId;
  appendCompletion({
    transaction: input.transaction,
    event: input.event,
    constraint: input.constraint,
    skillVersionId,
    outcome: input.outcome,
  });
  const allCompletions = input.transaction.listSkillCompletions(skillVersionId);
  const windowStart = input.transaction.getSkillWindowStart(skillVersionId);
  const window = evaluateQuarantineWindow(allCompletions.slice(windowStart));
  const standing = input.transaction.getSkillStanding(skillVersionId);
  if (window.shouldQuarantine && standing.disposition !== "revoked") {
    input.transaction.putSkillStanding(skillVersionId, {
      disposition: "quarantined",
      quarantinedAt: input.event.occurredAt,
      terminalFailures: window.terminalFailures,
      sampleSize: window.sampleSize,
    });
    return {
      kind: "quarantined",
      skillVersionId,
      terminalFailures: window.terminalFailures,
      sampleSize: window.sampleSize,
    };
  }
  return { kind: "recorded", skillVersionId };
}

export class DefaultSupervisionKernel implements SupervisionKernel {
  readonly #store: SupervisionStore;
  readonly #evaluation: EvaluationEngine;

  constructor(input: {
    readonly store: SupervisionStore;
    readonly deterministicEvaluators?: readonly DeterministicEvaluator[] | undefined;
    readonly judge?: EvaluationJudge | undefined;
    readonly judgeTimeoutMs?: number | undefined;
  }) {
    this.#store = input.store;
    this.#evaluation = new EvaluationEngine({
      deterministicEvaluators: input.deterministicEvaluators,
      judge: input.judge,
      judgeTimeoutMs: input.judgeTimeoutMs,
    });
  }

  supervise<E extends HookObservation>(
    event: E,
    constraint: EvaluationConstraint,
  ): Promise<DecisionFor<E>>;
  supervise(
    event: PromptObservation,
    constraint: EvaluationConstraint,
  ): Promise<PromptDecision>;
  supervise(
    event: ToolRequestObservation,
    constraint: EvaluationConstraint,
  ): Promise<ToolRequestDecision>;
  supervise(
    event: ToolResultObservation,
    constraint: EvaluationConstraint,
  ): Promise<ToolResultDecision>;
  supervise(
    event: RootStopObservation,
    constraint: EvaluationConstraint,
  ): Promise<StopDecision>;
  supervise(
    event: SubagentStopObservation,
    constraint: EvaluationConstraint,
  ): Promise<StopDecision>;
  supervise(
    event: HookObservation,
    constraint: EvaluationConstraint,
  ): Promise<SupervisionDecision>;
  async supervise(
    event: HookObservation,
    constraint: EvaluationConstraint,
  ): Promise<SupervisionDecision> {
    const duplicate = await this.#store.transaction((transaction) =>
      persistedDecision(transaction, event),
    );
    if (duplicate !== undefined) return duplicate;

    switch (event.kind) {
      case "prompt":
        return this.#supervisePrompt(event, constraint);
      case "tool-request":
        return this.#superviseToolRequest(event, constraint);
      case "tool-result":
        return this.#superviseToolResult(event, constraint);
      case "root-stop":
      case "subagent-stop": {
        const completedBy = await this.#store.transaction(
          (transaction) => transaction.getWorkItem(event.workItemId).finalEventId,
        );
        const assessment: EvaluationAssessment =
          completedBy === undefined
            ? await this.#evaluation.evaluate(event, constraint)
            : {
                kind: "inconclusive",
                reason: `work item already completed by event ${completedBy}`,
              };
        return this.#commitStop(event, constraint, assessment);
      }
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  }

  async #supervisePrompt(
    event: PromptObservation,
    constraint: EvaluationConstraint,
  ): Promise<PromptDecision> {
    return this.#store.transaction((transaction) => {
      const duplicate = persistedDecision(transaction, event);
      if (duplicate !== undefined) {
        if (duplicate.kind !== "prompt-decision") {
          throw new Error(`event ID ${event.eventId} has an incompatible decision`);
        }
        return duplicate;
      }

      const candidates = constraint.skillCandidates.map((candidate) =>
        effectiveCandidate(transaction, candidate),
      );
      const resolution = resolveSkill(candidates);
      const actionCapabilities: CapabilityName[] = ["promptInterception"];
      if (resolution.kind === "selected") actionCapabilities.push("skillSelectionControl");
      const decision: PromptDecision = {
        kind: "prompt-decision",
        action: "continue",
        eventId: event.eventId,
        enforcement: enforcementFor(
          event.capabilities,
          requiredCapabilities(constraint, actionCapabilities),
        ),
        resolution,
      };
      storeDecision(transaction, event, decision);
      return decision;
    });
  }

  async #superviseToolRequest(
    event: ToolRequestObservation,
    constraint: EvaluationConstraint,
  ): Promise<ToolRequestDecision> {
    return this.#store.transaction((transaction) => {
      const duplicate = persistedDecision(transaction, event);
      if (duplicate !== undefined) {
        if (duplicate.kind !== "tool-request-decision") {
          throw new Error(`event ID ${event.eventId} has an incompatible decision`);
        }
        return duplicate;
      }

      const enforcement = enforcementFor(
        event.capabilities,
        requiredCapabilities(
          constraint,
          constraint.toolPolicy.kind === "deny" ? ["toolPrevention"] : [],
        ),
      );
      let decision: ToolRequestDecision;
      if (constraint.toolPolicy.kind === "allow") {
        decision = {
          kind: "tool-request-decision",
          action: "allow",
          eventId: event.eventId,
          enforcement,
        };
      } else if (enforcement.kind === "enforced") {
        decision = {
          kind: "tool-request-decision",
          action: "deny",
          reason: constraint.toolPolicy.reason,
          eventId: event.eventId,
          enforcement,
        };
      } else {
        decision = {
          kind: "tool-request-decision",
          action: "observe-denial",
          reason: constraint.toolPolicy.reason,
          eventId: event.eventId,
          enforcement,
        };
      }
      storeDecision(transaction, event, decision);
      return decision;
    });
  }

  async #superviseToolResult(
    event: ToolResultObservation,
    constraint: EvaluationConstraint,
  ): Promise<ToolResultDecision> {
    return this.#store.transaction((transaction) => {
      const duplicate = persistedDecision(transaction, event);
      if (duplicate !== undefined) {
        if (duplicate.kind !== "tool-result-decision") {
          throw new Error(`event ID ${event.eventId} has an incompatible decision`);
        }
        return duplicate;
      }
      const decision: ToolResultDecision = {
        kind: "tool-result-decision",
        action: "recorded",
        eventId: event.eventId,
        enforcement: enforcementFor(
          event.capabilities,
          requiredCapabilities(constraint, ["toolObservation"]),
        ),
      };
      storeDecision(transaction, event, decision);
      return decision;
    });
  }

  async #commitStop(
    event: StopObservation,
    constraint: EvaluationConstraint,
    assessment: EvaluationAssessment,
  ): Promise<StopDecision> {
    return this.#store.transaction((transaction) => {
      const duplicate = persistedDecision(transaction, event);
      if (duplicate !== undefined) {
        if (duplicate.kind !== "stop-decision") {
          throw new Error(`event ID ${event.eventId} has an incompatible decision`);
        }
        return duplicate;
      }

      const actionCapability: CapabilityName =
        event.kind === "root-stop" ? "rootStopContinuation" : "subagentStopContinuation";
      const continuation = enforcementFor(
        event.capabilities,
        requiredCapabilities(constraint, [actionCapability]),
      );
      const workItem = transaction.getWorkItem(event.workItemId);
      let decision: StopDecision;

      if (workItem.finalEventId !== undefined) {
        decision = {
          kind: "stop-decision",
          action: "allow",
          eventId: event.eventId,
          enforcement: enforcementFor(event.capabilities, constraint.requiredCapabilities),
          evaluation: {
            kind: "inconclusive",
            reason: `work item already completed by event ${workItem.finalEventId}`,
          },
          sanction: { kind: "not-applicable" },
        };
        storeDecision(transaction, event, decision);
        return decision;
      }

      switch (assessment.kind) {
        case "pass": {
          decision = {
            kind: "stop-decision",
            action: "allow",
            eventId: event.eventId,
            enforcement: enforcementFor(event.capabilities, constraint.requiredCapabilities),
            evaluation: { kind: "pass", ...optionalScore(assessment.score) },
            sanction: recordCompletedOutcome({
              transaction,
              event,
              constraint,
              outcome: "pass",
            }),
          };
          transaction.putWorkItem(event.workItemId, {
            retryDirectives: workItem.retryDirectives,
            finalEventId: event.eventId,
          });
          break;
        }
        case "inconclusive": {
          decision = {
            kind: "stop-decision",
            action: "allow",
            eventId: event.eventId,
            enforcement: continuation,
            evaluation: {
              kind: "inconclusive",
              reason: assessment.reason,
              ...(assessment.advisory === undefined
                ? {}
                : { advisory: assessment.advisory }),
            },
            sanction: { kind: "not-applicable" },
          };
          transaction.putWorkItem(event.workItemId, {
            retryDirectives: workItem.retryDirectives,
            finalEventId: event.eventId,
          });
          break;
        }
        case "fail": {
          if (continuation.kind === "observation") {
            decision = {
              kind: "stop-decision",
              action: "allow",
              eventId: event.eventId,
              enforcement: continuation,
              evaluation: {
                kind: "terminal-failure",
                reason: "continuation-unsupported",
                findings: assessment.findings,
                ...optionalScore(assessment.score),
              },
              sanction: {
                kind: "not-eligible",
                reason: "retry continuation is not enforced",
              },
            };
            transaction.putWorkItem(event.workItemId, {
              retryDirectives: workItem.retryDirectives,
              finalEventId: event.eventId,
            });
            break;
          }

          const retry = nextRetry(workItem.retryDirectives);
          if (retry.kind === "retry") {
            decision = {
              kind: "stop-decision",
              action: "retry",
              eventId: event.eventId,
              enforcement: { kind: "enforced" },
              evaluation: {
                kind: "retryable-failure",
                retryOrdinal: retry.ordinal,
                findings: assessment.findings,
                ...optionalScore(assessment.score),
              },
              feedback: {
                summary: feedbackSummary(assessment),
                findings: assessment.findings,
              },
              sanction: { kind: "not-applicable" },
            };
            transaction.putWorkItem(event.workItemId, {
              retryDirectives: retry.nextCount,
            });
            break;
          }

          decision = {
            kind: "stop-decision",
            action: "allow",
            eventId: event.eventId,
            enforcement: continuation,
            evaluation: {
              kind: "terminal-failure",
              reason: "retries-exhausted",
              findings: assessment.findings,
              ...optionalScore(assessment.score),
            },
            sanction: recordCompletedOutcome({
              transaction,
              event,
              constraint,
              outcome: "terminal-failure",
            }),
          };
          transaction.putWorkItem(event.workItemId, {
            retryDirectives: workItem.retryDirectives,
            finalEventId: event.eventId,
          });
          break;
        }
        default: {
          const exhaustive: never = assessment;
          return exhaustive;
        }
      }

      storeDecision(transaction, event, decision);
      return decision;
    });
  }

  async restoreSkill(input: RestoreSkillInput): Promise<RestoreSkillResult> {
    if (input.reason.trim().length === 0) throw new Error("restoration reason is required");
    return this.#store.transaction((transaction) => {
      const standing = transaction.getSkillStanding(input.skillVersionId);
      if (standing.disposition === "revoked") {
        return { kind: "not-restorable", standing };
      }
      if (standing.disposition !== "quarantined") {
        return { kind: "not-quarantined", standing };
      }
      const probation: SkillStanding = {
        disposition: "probation",
        restoredAt: input.restoredAt,
        reason: input.reason,
      };
      transaction.putSkillStanding(input.skillVersionId, probation);
      transaction.putSkillWindowStart(
        input.skillVersionId,
        transaction.listSkillCompletions(input.skillVersionId).length,
      );
      return { kind: "restored", standing: probation };
    });
  }

  async applyDispositionTransition(
    transition: SkillDispositionTransition,
  ): Promise<ApplyDispositionTransitionResult> {
    return this.#store.transaction((transaction) => {
      const standing = transaction.getSkillStanding(transition.skillVersionId);
      if (standing.disposition === "revoked") {
        return { kind: "ignored-revoked", standing };
      }
      switch (transition.kind) {
        case "revocation": {
          const revoked: SkillStanding = {
            disposition: "revoked",
            reason: transition.reason,
          };
          transaction.putSkillStanding(transition.skillVersionId, revoked);
          return { kind: "applied", standing: revoked };
        }
        case "quarantine": {
          const quarantined: SkillStanding = {
            disposition: "quarantined",
            quarantinedAt: transition.occurredAt,
            terminalFailures: 0,
            sampleSize: 0,
          };
          transaction.putSkillStanding(transition.skillVersionId, quarantined);
          return { kind: "applied", standing: quarantined };
        }
        case "probation":
        case "restoration": {
          const probation: SkillStanding = {
            disposition: "probation",
            restoredAt: transition.occurredAt,
            reason: transition.reason,
          };
          transaction.putSkillStanding(transition.skillVersionId, probation);
          transaction.putSkillWindowStart(
            transition.skillVersionId,
            transaction.listSkillCompletions(transition.skillVersionId).length,
          );
          return { kind: "applied", standing: probation };
        }
        default: {
          const exhaustive: never = transition;
          return exhaustive;
        }
      }
    });
  }

  async getSkillStanding(skillVersionId: SkillVersionId): Promise<SkillStanding> {
    return this.#store.transaction((transaction) =>
      transaction.getSkillStanding(skillVersionId),
    );
  }

  async listSkillCompletions(
    skillVersionId: SkillVersionId,
  ): Promise<readonly SkillCompletionRecord[]> {
    return this.#store.transaction((transaction) => [
      ...transaction.listSkillCompletions(skillVersionId),
    ]);
  }
}

export function createSupervisionKernel(input: {
  readonly store: SupervisionStore;
  readonly deterministicEvaluators?: readonly DeterministicEvaluator[] | undefined;
  readonly judge?: EvaluationJudge | undefined;
  readonly judgeTimeoutMs?: number | undefined;
}): SupervisionKernel {
  return new DefaultSupervisionKernel(input);
}

export function createInMemoryKernel(
  input: {
    readonly store?: SupervisionStore;
    readonly deterministicEvaluators?: readonly DeterministicEvaluator[] | undefined;
    readonly judge?: EvaluationJudge | undefined;
    readonly judgeTimeoutMs?: number | undefined;
  } = {},
): SupervisionKernel {
  return createSupervisionKernel({
    store: input.store ?? new InMemorySupervisionStore(),
    deterministicEvaluators: input.deterministicEvaluators,
    judge: input.judge,
    judgeTimeoutMs: input.judgeTimeoutMs,
  });
}
