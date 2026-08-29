import type {
  AdvisoryEvaluation,
  DeterministicCheckResult,
  EvaluationConstraint,
  EvaluationId,
  HookObservation,
  JudgeResult,
  RetryBudgetId,
  PolicyVersionId,
  RuntimeEventId,
  SkillCompletionRecord,
  SkillVersionId,
  StopObservation,
  SupervisionDecision,
  Timestamp,
  WorkItemId,
} from "@sisyphus/domain";

import type { RetryBudgetState, SkillStanding, WorkItemState } from "./state.js";

export type EvaluationInput = {
  readonly observation: StopObservation;
  readonly constraint: EvaluationConstraint;
};

export interface DeterministicEvaluator {
  readonly id: string;
  evaluate(input: EvaluationInput): Promise<DeterministicCheckResult>;
}

export interface EvaluationJudge {
  evaluate(input: EvaluationInput): Promise<JudgeResult>;
}

export interface AdvisoryResultPort {
  record(input: {
    readonly evaluationId: EvaluationId;
    readonly eventId: RuntimeEventId;
    readonly policyVersionId: PolicyVersionId;
    readonly receivedAt: Timestamp;
    readonly advisory: AdvisoryEvaluation;
  }): Promise<void>;
}

export type PersistedEventDecision = {
  readonly observationKind: HookObservation["kind"];
  readonly workItemId: WorkItemId;
  readonly retryBudgetId: RetryBudgetId;
  readonly observationDigest: string;
  readonly decision: SupervisionDecision;
};

export interface SupervisionTransaction {
  getDecision(eventId: RuntimeEventId): PersistedEventDecision | undefined;
  putDecision(eventId: RuntimeEventId, persisted: PersistedEventDecision): void;

  getWorkItem(workItemId: WorkItemId): WorkItemState;
  putWorkItem(workItemId: WorkItemId, state: WorkItemState): void;

  getRetryBudget(retryBudgetId: RetryBudgetId): RetryBudgetState;
  putRetryBudget(retryBudgetId: RetryBudgetId, state: RetryBudgetState): void;

  getSkillStanding(skillVersionId: SkillVersionId): SkillStanding;
  putSkillStanding(skillVersionId: SkillVersionId, standing: SkillStanding): void;

  listSkillCompletions(skillVersionId: SkillVersionId): readonly SkillCompletionRecord[];
  appendSkillCompletion(record: SkillCompletionRecord): void;
  getSkillWindowStart(skillVersionId: SkillVersionId): number;
  putSkillWindowStart(skillVersionId: SkillVersionId, offset: number): void;
}

export interface SupervisionStore {
  transaction<T>(operation: (transaction: SupervisionTransaction) => T): Promise<T>;
}
