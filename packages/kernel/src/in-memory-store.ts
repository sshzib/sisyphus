import type {
  RuntimeEventId,
  RetryBudgetId,
  SkillCompletionRecord,
  SkillVersionId,
  WorkItemId,
} from "@sisyphus/domain";

import type {
  PersistedEventDecision,
  SupervisionStore,
  SupervisionTransaction,
} from "./ports.js";
import type { RetryBudgetState, SkillStanding, WorkItemState } from "./state.js";

export class InMemorySupervisionStore implements SupervisionStore {
  readonly #decisions = new Map<RuntimeEventId, PersistedEventDecision>();
  readonly #workItems = new Map<WorkItemId, WorkItemState>();
  readonly #retryBudgets = new Map<RetryBudgetId, RetryBudgetState>();
  readonly #standings = new Map<SkillVersionId, SkillStanding>();
  readonly #completions = new Map<SkillVersionId, readonly SkillCompletionRecord[]>();
  readonly #windowStarts = new Map<SkillVersionId, number>();

  async transaction<T>(operation: (transaction: SupervisionTransaction) => T): Promise<T> {
    const transaction: SupervisionTransaction = {
      getDecision: (eventId) => this.#decisions.get(eventId),
      putDecision: (eventId, persisted) => {
        this.#decisions.set(eventId, persisted);
      },
      getWorkItem: (workItemId) => this.#workItems.get(workItemId) ?? {},
      putWorkItem: (workItemId, state) => {
        this.#workItems.set(workItemId, state);
      },
      getRetryBudget: (retryBudgetId) =>
        this.#retryBudgets.get(retryBudgetId) ?? { retryDirectives: 0 },
      putRetryBudget: (retryBudgetId, state) => {
        this.#retryBudgets.set(retryBudgetId, state);
      },
      getSkillStanding: (skillVersionId) =>
        this.#standings.get(skillVersionId) ?? { disposition: "active" },
      putSkillStanding: (skillVersionId, standing) => {
        this.#standings.set(skillVersionId, standing);
      },
      listSkillCompletions: (skillVersionId) =>
        this.#completions.get(skillVersionId) ?? [],
      appendSkillCompletion: (record) => {
        const existing = this.#completions.get(record.skillVersionId) ?? [];
        this.#completions.set(record.skillVersionId, [...existing, record]);
      },
      getSkillWindowStart: (skillVersionId) => this.#windowStarts.get(skillVersionId) ?? 0,
      putSkillWindowStart: (skillVersionId, offset) => {
        this.#windowStarts.set(skillVersionId, offset);
      },
    };
    return operation(transaction);
  }
}
