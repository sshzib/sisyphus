import { DatabaseSync } from "node:sqlite";

import {
  RuntimeEventIdSchema,
  RetryBudgetIdSchema,
  SkillCompletionRecordSchema,
  SkillVersionIdSchema,
  SupervisionDecisionSchema,
  TimestampSchema,
  WorkItemIdSchema,
} from "@sisyphus/domain";
import type {
  SupervisionStore,
  SupervisionTransaction,
} from "@sisyphus/kernel";
import { z } from "zod";

interface SQLiteSupervisionStoreInput {
  readonly path: string;
}

const PersistedEventDecisionSchema = z.object({
  observationKind: z.enum([
    "prompt",
    "tool-request",
    "tool-result",
    "root-stop",
    "subagent-stop",
  ]),
  workItemId: WorkItemIdSchema,
  retryBudgetId: RetryBudgetIdSchema,
  observationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: SupervisionDecisionSchema,
});

const RetryDirectiveCountSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const WorkItemStateSchema = z.object({
  finalEventId: RuntimeEventIdSchema.optional(),
});
const RetryBudgetStateSchema = z.object({
  retryDirectives: RetryDirectiveCountSchema,
});

const SkillStandingSchema = z.discriminatedUnion("disposition", [
  z.object({ disposition: z.literal("active") }),
  z.object({
    disposition: z.literal("probation"),
    restoredAt: TimestampSchema,
    reason: z.string().min(1),
  }),
  z.object({
    disposition: z.literal("quarantined"),
    quarantinedAt: TimestampSchema,
    terminalFailures: z.number().int().nonnegative(),
    sampleSize: z.number().int().nonnegative(),
  }),
  z.object({ disposition: z.literal("revoked"), reason: z.string().min(1) }),
]);

type SQLiteRow = Record<string, string | number | bigint | null | Uint8Array>;

function requiredString(row: SQLiteRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`Kernel column ${column} is invalid.`);
  return value;
}

function parseStoredJson<T>(source: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(source) as unknown);
}

function encoded<T>(value: T, schema: z.ZodType<T>): string {
  return JSON.stringify(schema.parse(value));
}

export class SQLiteSupervisionStore implements SupervisionStore {
  readonly #database: DatabaseSync;

  constructor(input: SQLiteSupervisionStoreInput) {
    this.#database = new DatabaseSync(input.path);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS kernel_decisions (
        event_id TEXT PRIMARY KEY,
        persisted_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS kernel_work_items (
        work_item_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS kernel_retry_budgets (
        retry_budget_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS kernel_skill_standings (
        skill_version_id TEXT PRIMARY KEY,
        standing_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS kernel_skill_completions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        skill_version_id TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS kernel_skill_completions_by_skill
        ON kernel_skill_completions(skill_version_id, sequence);
      CREATE TABLE IF NOT EXISTS kernel_skill_window_starts (
        skill_version_id TEXT PRIMARY KEY,
        window_offset INTEGER NOT NULL CHECK(window_offset >= 0)
      ) STRICT;
    `);
  }

  async transaction<T>(operation: (transaction: SupervisionTransaction) => T): Promise<T> {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation(this.#transaction());
      if (result instanceof Promise) {
        throw new Error("SQLite supervision transactions must be synchronous.");
      }
      this.#database.exec("COMMIT;");
      return result;
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  #transaction(): SupervisionTransaction {
    return {
      getDecision: (eventId) => {
        const row = this.#database
          .prepare("SELECT persisted_json FROM kernel_decisions WHERE event_id = ?")
          .get(eventId);
        return row === undefined
          ? undefined
          : parseStoredJson(
              requiredString(row, "persisted_json"),
              PersistedEventDecisionSchema,
            );
      },
      putDecision: (eventId, persisted) => {
        this.#database
          .prepare("INSERT INTO kernel_decisions(event_id, persisted_json) VALUES (?, ?)")
          .run(eventId, encoded(persisted, PersistedEventDecisionSchema));
      },
      getWorkItem: (workItemId) => {
        const row = this.#database
          .prepare("SELECT state_json FROM kernel_work_items WHERE work_item_id = ?")
          .get(workItemId);
        return row === undefined
          ? {}
          : parseStoredJson(requiredString(row, "state_json"), WorkItemStateSchema);
      },
      putWorkItem: (workItemId, state) => {
        this.#database
          .prepare(
            "INSERT INTO kernel_work_items(work_item_id, state_json) VALUES (?, ?) ON CONFLICT(work_item_id) DO UPDATE SET state_json = excluded.state_json",
          )
          .run(workItemId, encoded(state, WorkItemStateSchema));
      },
      getRetryBudget: (retryBudgetId) => {
        const row = this.#database
          .prepare(
            "SELECT state_json FROM kernel_retry_budgets WHERE retry_budget_id = ?",
          )
          .get(retryBudgetId);
        return row === undefined
          ? { retryDirectives: 0 }
          : parseStoredJson(
              requiredString(row, "state_json"),
              RetryBudgetStateSchema,
            );
      },
      putRetryBudget: (retryBudgetId, state) => {
        this.#database
          .prepare(
            "INSERT INTO kernel_retry_budgets(retry_budget_id, state_json) VALUES (?, ?) ON CONFLICT(retry_budget_id) DO UPDATE SET state_json = excluded.state_json",
          )
          .run(
            RetryBudgetIdSchema.parse(retryBudgetId),
            encoded(state, RetryBudgetStateSchema),
          );
      },
      getSkillStanding: (skillVersionId) => {
        const row = this.#database
          .prepare(
            "SELECT standing_json FROM kernel_skill_standings WHERE skill_version_id = ?",
          )
          .get(skillVersionId);
        return row === undefined
          ? { disposition: "active" }
          : parseStoredJson(requiredString(row, "standing_json"), SkillStandingSchema);
      },
      putSkillStanding: (skillVersionId, standing) => {
        this.#database
          .prepare(
            "INSERT INTO kernel_skill_standings(skill_version_id, standing_json) VALUES (?, ?) ON CONFLICT(skill_version_id) DO UPDATE SET standing_json = excluded.standing_json",
          )
          .run(skillVersionId, encoded(standing, SkillStandingSchema));
      },
      listSkillCompletions: (skillVersionId) =>
        this.#database
          .prepare(
            "SELECT record_json FROM kernel_skill_completions WHERE skill_version_id = ? ORDER BY sequence",
          )
          .all(skillVersionId)
          .map((row) =>
            parseStoredJson(
              requiredString(row, "record_json"),
              SkillCompletionRecordSchema,
            ),
          ),
      appendSkillCompletion: (record) => {
        this.#database
          .prepare(
            "INSERT OR IGNORE INTO kernel_skill_completions(event_id, skill_version_id, record_json) VALUES (?, ?, ?)",
          )
          .run(
            record.eventId,
            record.skillVersionId,
            encoded(record, SkillCompletionRecordSchema),
          );
      },
      getSkillWindowStart: (skillVersionId) => {
        const row = this.#database
          .prepare(
            "SELECT window_offset FROM kernel_skill_window_starts WHERE skill_version_id = ?",
          )
          .get(skillVersionId);
        if (row === undefined) return 0;
        return z.number().int().nonnegative().parse(row["window_offset"]);
      },
      putSkillWindowStart: (skillVersionId, offset) => {
        const parsedSkillVersionId = SkillVersionIdSchema.parse(skillVersionId);
        const parsedOffset = z.number().int().nonnegative().parse(offset);
        this.#database
          .prepare(
            "INSERT INTO kernel_skill_window_starts(skill_version_id, window_offset) VALUES (?, ?) ON CONFLICT(skill_version_id) DO UPDATE SET window_offset = excluded.window_offset",
          )
          .run(parsedSkillVersionId, parsedOffset);
      },
    } satisfies SupervisionTransaction;
  }

  close(): void {
    this.#database.close();
  }
}
