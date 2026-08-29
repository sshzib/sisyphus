import type {
  DeterministicCheckResult,
  EvaluationConstraint,
  HookObservation,
  JudgeResult,
  RuntimeEventId,
  SkillCompletionRecord,
  SkillVersionId,
  StopObservation,
  SupervisionDecision,
  WorkItemId,
} from "@sisyphus/domain";

import type { SkillStanding, WorkItemState } from "./state.js";

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

export type PersistedEventDecision = {
  readonly observationKind: HookObservation["kind"];
  readonly workItemId: WorkItemId;
  readonly observationDigest: string;
  readonly decision: SupervisionDecision;
};

export interface SupervisionTransaction {
  getDecision(eventId: RuntimeEventId): PersistedEventDecision | undefined;
  putDecision(eventId: RuntimeEventId, persisted: PersistedEventDecision): void;

  getWorkItem(workItemId: WorkItemId): WorkItemState;
  putWorkItem(workItemId: WorkItemId, state: WorkItemState): void;

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
