import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  AdvisoryEvaluationSchema,
  AgentRuntimeSchema,
  EvaluationIdSchema,
  PolicyVersionIdSchema,
  RuntimeEventIdSchema,
  SignedPolicyBundleSchema,
  TimestampSchema,
  type AdvisoryEvaluation,
  type EvaluationId,
  type PolicyVersionId,
  type RuntimeEventId,
  type SignedPolicyBundle,
  type Timestamp,
} from "@sisyphus/domain";
import { z } from "zod";

import type { StoredActivationLease } from "./activation-lease.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface LocalJournalInput {
  readonly path: string;
}

export interface DecisionEvidenceReference {
  readonly handle: string;
  readonly digest: string;
}

interface RecordDecisionInput {
  readonly eventId: string;
  readonly envelopeDigest: string;
  readonly receivedAt: string;
  readonly decision: unknown;
  readonly evidence: DecisionEvidenceReference;
  readonly cloudEvent: unknown;
  readonly activationLease?: StoredActivationLease;
}

interface RecordEventReceiptInput {
  readonly eventId: string;
  readonly envelopeDigest: string;
  readonly receivedAt: string;
}

interface ConsumeActivationLeaseInput {
  readonly activationLeaseDigest: string;
  readonly skillVersionId: string;
  readonly consumedAt: string;
}

interface PendingActivationLeaseInput {
  readonly activationLeaseDigest: string;
  readonly skillVersionId: string;
  readonly observedAt: string;
}

interface WorkItemIdentity {
  readonly runId: string;
  readonly workItemId: string;
}

interface CompletionAttemptInput extends WorkItemIdentity {
  readonly eventId: string;
  readonly retryBudgetId: string;
}

interface LocalDispositionRevisionInput {
  readonly eventId: string;
  readonly skillVersionId: string;
}

export interface RecordedDecision {
  readonly eventId: string;
  readonly decision: JsonValue;
  readonly envelopeDigest: string;
  readonly evidence: DecisionEvidenceReference;
  readonly outboxId: string;
  readonly activationLease?: StoredActivationLease;
}

export interface EventReceipt {
  readonly eventId: string;
  readonly envelopeDigest: string;
  readonly receivedAt: string;
}

export interface OutboxRecord {
  readonly id: string;
  readonly eventId: string;
  readonly payload: JsonValue;
  readonly createdAt: string;
}

export interface StoredPolicyBundleState {
  readonly revision: number;
  readonly payloadDigest: string;
  readonly dispositionRevision: number;
  readonly signedBundle?: SignedPolicyBundle;
}

export interface StoredLateAdvisory {
  readonly evaluationId: EvaluationId;
  readonly eventId: RuntimeEventId;
  readonly policyVersionId: PolicyVersionId;
  readonly receivedAt: Timestamp;
  readonly advisory: AdvisoryEvaluation;
}

type SQLiteRow = Record<string, string | number | bigint | null | Uint8Array>;

export class JournalEventCollisionError extends Error {}

function parseJson(input: string): JsonValue {
  const parsed: unknown = JSON.parse(input);
  if (!isJsonValue(parsed)) throw new Error("Stored journal JSON is invalid.");
  return parsed;
}

function encodeJson(input: unknown): string {
  const encoded = JSON.stringify(input);
  if (encoded === undefined) throw new Error("Journal value is not JSON serializable.");
  parseJson(encoded);
  return encoded;
}

function isJsonValue(input: unknown): input is JsonValue {
  if (input === null) return true;
  if (["boolean", "number", "string"].includes(typeof input)) return true;
  if (Array.isArray(input)) return input.every(isJsonValue);
  if (typeof input !== "object") return false;
  return Object.values(input).every(isJsonValue);
}

function requiredString(row: SQLiteRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Journal column ${key} is invalid.`);
  return value;
}

function optionalString(row: SQLiteRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Journal column ${key} is invalid.`);
  return value;
}

function assertDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function storedActivationLease(row: SQLiteRow): StoredActivationLease | undefined {
  const promptEventId = optionalString(row, "lease_prompt_event_id");
  if (promptEventId === undefined) return undefined;
  const consumedAt = optionalString(row, "lease_consumed_at");
  return {
    promptEventId,
    runtime: AgentRuntimeSchema.parse(requiredString(row, "lease_runtime")),
    runId: requiredString(row, "lease_run_id"),
    workItemId: requiredString(row, "lease_work_item_id"),
    skillVersionId: requiredString(row, "lease_skill_version_id"),
    issuedAt: requiredString(row, "lease_issued_at"),
    expiresAt: requiredString(row, "lease_expires_at"),
    activationLeaseDigest: requiredString(row, "lease_digest"),
    ...(consumedAt === undefined ? {} : { consumedAt }),
  };
}

function activationLeaseSelect(): string {
  return `
    activation_leases.prompt_event_id AS lease_prompt_event_id,
    activation_leases.runtime AS lease_runtime,
    activation_leases.run_id AS lease_run_id,
    activation_leases.work_item_id AS lease_work_item_id,
    activation_leases.skill_version_id AS lease_skill_version_id,
    activation_leases.issued_at AS lease_issued_at,
    activation_leases.expires_at AS lease_expires_at,
    activation_leases.activation_lease_digest AS lease_digest,
    activation_leases.consumed_at AS lease_consumed_at
  `;
}

function ensureDecisionColumn(
  database: DatabaseSync,
  name: "envelope_digest" | "evidence_handle" | "evidence_digest",
): void {
  const columns = database.prepare("PRAGMA table_info(decisions)").all();
  const exists = columns.some((row) => row["name"] === name);
  if (!exists) database.exec(`ALTER TABLE decisions ADD COLUMN ${name} TEXT;`);
}

function ensureActivationLeaseRuntimeColumn(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(activation_leases)").all();
  const exists = columns.some((row) => row["name"] === "runtime");
  if (!exists) {
    database.exec(
      "ALTER TABLE activation_leases ADD COLUMN runtime TEXT NOT NULL DEFAULT 'codex';",
    );
  }
}

function ensurePolicyBundleColumn(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(policy_bundle_state)").all();
  const exists = columns.some((row) => row["name"] === "signed_bundle_json");
  if (!exists) {
    database.exec("ALTER TABLE policy_bundle_state ADD COLUMN signed_bundle_json TEXT;");
  }
}

function ensureCompletionAttemptRetryBudgetColumn(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(completion_attempts)").all();
  const exists = columns.some((row) => row["name"] === "retry_budget_id");
  if (exists) return;
  database.exec(
    "ALTER TABLE completion_attempts ADD COLUMN retry_budget_id TEXT NOT NULL DEFAULT '';",
  );
  database.exec(
    "UPDATE completion_attempts SET retry_budget_id = work_item_id WHERE retry_budget_id = '';",
  );
}

export class LocalJournal {
  readonly #database: DatabaseSync;

  constructor(input: LocalJournalInput) {
    this.#database = new DatabaseSync(input.path);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        event_id TEXT PRIMARY KEY,
        envelope_digest TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        evidence_handle TEXT NOT NULL,
        evidence_digest TEXT NOT NULL,
        outbox_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    ensureDecisionColumn(this.#database, "envelope_digest");
    ensureDecisionColumn(this.#database, "evidence_handle");
    ensureDecisionColumn(this.#database, "evidence_digest");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS event_receipts (
        event_id TEXT PRIMARY KEY,
        envelope_digest TEXT NOT NULL,
        received_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS completion_attempts (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        retry_budget_id TEXT NOT NULL,
        attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 3)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS completion_attempts_by_work_item
        ON completion_attempts(run_id, work_item_id, attempt);
      CREATE TABLE IF NOT EXISTS local_disposition_revisions (
        event_id TEXT PRIMARY KEY,
        skill_version_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision > 0),
        UNIQUE(skill_version_id, revision)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS policy_bundle_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        revision INTEGER NOT NULL CHECK(revision > 0),
        payload_digest TEXT NOT NULL,
        disposition_revision INTEGER NOT NULL CHECK(disposition_revision >= 0),
        signed_bundle_json TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE REFERENCES decisions(event_id),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        acknowledged_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS activation_leases (
        prompt_event_id TEXT PRIMARY KEY REFERENCES decisions(event_id),
        runtime TEXT NOT NULL,
        activation_lease_digest TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        skill_version_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        UNIQUE (run_id, work_item_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS activation_leases_consumed_work_item
        ON activation_leases(run_id, work_item_id, consumed_at);
      CREATE TABLE IF NOT EXISTS late_advisories (
        evaluation_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        policy_version_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        advisory_json TEXT NOT NULL
      ) STRICT;
    `);
    ensureActivationLeaseRuntimeColumn(this.#database);
    ensurePolicyBundleColumn(this.#database);
    ensureCompletionAttemptRetryBudgetColumn(this.#database);
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS completion_attempts_by_retry_budget
        ON completion_attempts(run_id, retry_budget_id, attempt);
    `);
  }

  recordDecision(input: RecordDecisionInput): RecordedDecision {
    assertDigest(input.envelopeDigest, "Envelope digest");
    assertDigest(input.evidence.digest, "Evidence digest");
    this.recordEventReceipt({
      eventId: input.eventId,
      envelopeDigest: input.envelopeDigest,
      receivedAt: input.receivedAt,
    });
    if (
      input.activationLease !== undefined &&
      input.activationLease.promptEventId !== input.eventId
    ) {
      throw new Error("Activation lease prompt event does not match its decision.");
    }
    const outboxId = randomUUID();
    const createdAt = new Date().toISOString();
    const decisionJson = encodeJson(input.decision);
    const cloudEventJson = encodeJson(input.cloudEvent);
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const insertion = this.#database
        .prepare(
          `INSERT OR IGNORE INTO decisions(
            event_id, envelope_digest, decision_json, evidence_handle,
            evidence_digest, outbox_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.eventId,
          input.envelopeDigest,
          decisionJson,
          input.evidence.handle,
          input.evidence.digest,
          outboxId,
          createdAt,
        );

      if (insertion.changes === 1) {
        this.#database
          .prepare(
            "INSERT INTO outbox(id, event_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
          )
          .run(outboxId, input.eventId, cloudEventJson, createdAt);
        if (input.activationLease !== undefined) {
          this.#database
            .prepare(
              `INSERT INTO activation_leases(
                prompt_event_id, runtime, activation_lease_digest, run_id, work_item_id,
                skill_version_id, issued_at, expires_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              input.activationLease.promptEventId,
              input.activationLease.runtime,
              input.activationLease.activationLeaseDigest,
              input.activationLease.runId,
              input.activationLease.workItemId,
              input.activationLease.skillVersionId,
              input.activationLease.issuedAt,
              input.activationLease.expiresAt,
            );
        }
      }
      this.#database.exec("COMMIT;");
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    const recorded = this.decisionFor(input.eventId);
    if (recorded === undefined) throw new Error("Decision was not persisted.");
    if (recorded.envelopeDigest !== input.envelopeDigest) {
      throw new JournalEventCollisionError(
        `Event ID ${input.eventId} belongs to a different envelope.`,
      );
    }
    return recorded;
  }

  recordEventReceipt(input: RecordEventReceiptInput): EventReceipt {
    assertDigest(input.envelopeDigest, "Envelope digest");
    if (Number.isNaN(Date.parse(input.receivedAt))) {
      throw new Error("Event receipt time must be an ISO timestamp.");
    }
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          "INSERT OR IGNORE INTO event_receipts(event_id, envelope_digest, received_at) VALUES (?, ?, ?)",
        )
        .run(input.eventId, input.envelopeDigest, input.receivedAt);
      this.#database.exec("COMMIT;");
    } catch (error: unknown) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
    const receipt = this.eventReceiptFor(input.eventId);
    if (receipt === undefined) throw new Error("Event receipt was not persisted.");
    if (receipt.envelopeDigest !== input.envelopeDigest) {
      throw new JournalEventCollisionError(
        `Event ID ${input.eventId} belongs to a different envelope.`,
      );
    }
    return receipt;
  }

  eventReceiptFor(eventId: string): EventReceipt | undefined {
    const row = this.#database
      .prepare(
        "SELECT event_id, envelope_digest, received_at FROM event_receipts WHERE event_id = ?",
      )
      .get(eventId);
    if (row === undefined) return undefined;
    return {
      eventId: requiredString(row, "event_id"),
      envelopeDigest: requiredString(row, "envelope_digest"),
      receivedAt: requiredString(row, "received_at"),
    };
  }

  decisionFor(eventId: string): RecordedDecision | undefined {
    const row = this.#database
      .prepare(
        `SELECT
          decisions.event_id,
          decisions.envelope_digest,
          decisions.decision_json,
          decisions.evidence_handle,
          decisions.evidence_digest,
          decisions.outbox_id,
          ${activationLeaseSelect()}
        FROM decisions
        LEFT JOIN activation_leases
          ON activation_leases.prompt_event_id = decisions.event_id
        WHERE decisions.event_id = ?`,
      )
      .get(eventId);
    if (row === undefined) return undefined;
    const activationLease = storedActivationLease(row);
    return {
      eventId: requiredString(row, "event_id"),
      decision: parseJson(requiredString(row, "decision_json")),
      envelopeDigest: requiredString(row, "envelope_digest"),
      evidence: {
        handle: requiredString(row, "evidence_handle"),
        digest: requiredString(row, "evidence_digest"),
      },
      outboxId: requiredString(row, "outbox_id"),
      ...(activationLease === undefined ? {} : { activationLease }),
    };
  }

  evidenceFor(eventId: string): DecisionEvidenceReference | undefined {
    const row = this.#database
      .prepare(
        "SELECT evidence_handle, evidence_digest FROM decisions WHERE event_id = ?",
      )
      .get(eventId);
    if (row === undefined) return undefined;
    return {
      handle: requiredString(row, "evidence_handle"),
      digest: requiredString(row, "evidence_digest"),
    };
  }

  recordCompletionAttempt(input: CompletionAttemptInput): number {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO completion_attempts(
            event_id, run_id, work_item_id, retry_budget_id, attempt
          )
          SELECT ?, ?, ?, ?,
            CASE WHEN COALESCE(MAX(attempt), 0) >= 3 THEN 3 ELSE COALESCE(MAX(attempt), 0) + 1 END
          FROM completion_attempts
          WHERE run_id = ? AND retry_budget_id = ?`,
        )
        .run(
          input.eventId,
          input.runId,
          input.workItemId,
          input.retryBudgetId,
          input.runId,
          input.retryBudgetId,
        );
      const row = this.#database
        .prepare(
          "SELECT run_id, work_item_id, retry_budget_id, attempt FROM completion_attempts WHERE event_id = ?",
        )
        .get(input.eventId);
      if (row === undefined) throw new Error("Completion attempt was not persisted.");
      if (
        requiredString(row, "run_id") !== input.runId ||
        requiredString(row, "work_item_id") !== input.workItemId ||
        requiredString(row, "retry_budget_id") !== input.retryBudgetId
      ) {
        throw new JournalEventCollisionError(
          `Event ID ${input.eventId} belongs to a different work item.`,
        );
      }
      const attempt = z.number().int().min(1).max(3).parse(row["attempt"]);
      this.#database.exec("COMMIT;");
      return attempt;
    } catch (error: unknown) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordLocalDispositionRevision(input: LocalDispositionRevisionInput): number {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO local_disposition_revisions(
            event_id, skill_version_id, revision
          )
          SELECT ?, ?, COALESCE(MAX(revision), 0) + 1
          FROM local_disposition_revisions
          WHERE skill_version_id = ?`,
        )
        .run(input.eventId, input.skillVersionId, input.skillVersionId);
      const row = this.#database
        .prepare(
          `SELECT skill_version_id, revision
          FROM local_disposition_revisions
          WHERE event_id = ?`,
        )
        .get(input.eventId);
      if (row === undefined) throw new Error("Local disposition revision was not persisted.");
      if (requiredString(row, "skill_version_id") !== input.skillVersionId) {
        throw new JournalEventCollisionError(
          `Event ID ${input.eventId} belongs to a different skill disposition.`,
        );
      }
      const revision = z.number().int().positive().parse(row["revision"]);
      this.#database.exec("COMMIT;");
      return revision;
    } catch (error: unknown) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  policyBundleState(): StoredPolicyBundleState | undefined {
    const row = this.#database
      .prepare(
        `SELECT revision, payload_digest, disposition_revision, signed_bundle_json
        FROM policy_bundle_state
        WHERE singleton = 1`,
      )
      .get();
    if (row === undefined) return undefined;
    const payloadDigest = requiredString(row, "payload_digest");
    assertDigest(payloadDigest, "Policy payload digest");
    const signedBundleJson = optionalString(row, "signed_bundle_json");
    return {
      revision: z.number().int().positive().parse(row["revision"]),
      payloadDigest,
      dispositionRevision: z
        .number()
        .int()
        .nonnegative()
        .parse(row["disposition_revision"]),
      ...(signedBundleJson === undefined
        ? {}
        : { signedBundle: SignedPolicyBundleSchema.parse(JSON.parse(signedBundleJson)) }),
    };
  }

  recordPolicyBundleState(input: StoredPolicyBundleState): void {
    assertDigest(input.payloadDigest, "Policy payload digest");
    z.number().int().positive().parse(input.revision);
    z.number().int().nonnegative().parse(input.dispositionRevision);
    const previous = this.policyBundleState();
    if (previous !== undefined) {
      if (input.revision < previous.revision) {
        throw new Error("Policy bundle state cannot roll back its revision.");
      }
      if (
        input.revision === previous.revision &&
        input.payloadDigest !== previous.payloadDigest
      ) {
        throw new Error("Policy bundle revision cannot change its payload digest.");
      }
      if (input.dispositionRevision < previous.dispositionRevision) {
        throw new Error("Policy bundle state cannot roll back disposition revisions.");
      }
    }
    this.#database
      .prepare(
        `INSERT INTO policy_bundle_state(
          singleton, revision, payload_digest, disposition_revision, signed_bundle_json
        ) VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          revision = excluded.revision,
          payload_digest = excluded.payload_digest,
          disposition_revision = excluded.disposition_revision,
          signed_bundle_json = excluded.signed_bundle_json`,
      )
      .run(
        input.revision,
        input.payloadDigest,
        input.dispositionRevision,
        input.signedBundle === undefined ? null : encodeJson(input.signedBundle),
      );
  }

  pendingOutbox(limit = 100): readonly OutboxRecord[] {
    z.number().int().min(1).max(100).parse(limit);
    return this.#database
      .prepare(
        "SELECT id, event_id, payload_json, created_at FROM outbox WHERE acknowledged_at IS NULL ORDER BY created_at, id LIMIT ?",
      )
      .all(limit)
      .map((row) => ({
        id: requiredString(row, "id"),
        eventId: requiredString(row, "event_id"),
        payload: parseJson(requiredString(row, "payload_json")),
        createdAt: requiredString(row, "created_at"),
      }));
  }

  acknowledge(id: string): void {
    this.#database
      .prepare(
        "UPDATE outbox SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ?",
      )
      .run(new Date().toISOString(), id);
  }

  recordLateAdvisory(input: StoredLateAdvisory): void {
    const evaluationId = EvaluationIdSchema.parse(input.evaluationId);
    const eventId = RuntimeEventIdSchema.parse(input.eventId);
    const policyVersionId = PolicyVersionIdSchema.parse(input.policyVersionId);
    const receivedAt = TimestampSchema.parse(input.receivedAt);
    const advisory = AdvisoryEvaluationSchema.parse(input.advisory);
    const advisoryJson = encodeJson(advisory);
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO late_advisories(
          evaluation_id, event_id, policy_version_id, received_at, advisory_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(evaluationId, eventId, policyVersionId, receivedAt, advisoryJson);
    const stored = this.lateAdvisoryFor(evaluationId);
    if (stored === undefined || encodeJson(stored.advisory) !== advisoryJson) {
      throw new JournalEventCollisionError(
        `Evaluation ID ${evaluationId} belongs to a different advisory result.`,
      );
    }
  }

  lateAdvisoryFor(evaluationId: EvaluationId): StoredLateAdvisory | undefined {
    const row = this.#database
      .prepare(
        `SELECT evaluation_id, event_id, policy_version_id, received_at, advisory_json
        FROM late_advisories WHERE evaluation_id = ?`,
      )
      .get(evaluationId);
    if (row === undefined) return undefined;
    return {
      evaluationId: EvaluationIdSchema.parse(requiredString(row, "evaluation_id")),
      eventId: RuntimeEventIdSchema.parse(requiredString(row, "event_id")),
      policyVersionId: PolicyVersionIdSchema.parse(
        requiredString(row, "policy_version_id"),
      ),
      receivedAt: TimestampSchema.parse(requiredString(row, "received_at")),
      advisory: AdvisoryEvaluationSchema.parse(
        parseJson(requiredString(row, "advisory_json")),
      ),
    };
  }

  consumeActivationLease(
    input: ConsumeActivationLeaseInput,
  ): StoredActivationLease | undefined {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const update = this.#database
        .prepare(
          `UPDATE activation_leases
          SET consumed_at = ?
          WHERE activation_lease_digest = ?
            AND skill_version_id = ?
            AND consumed_at IS NULL
            AND expires_at > ?`,
        )
        .run(
          input.consumedAt,
          input.activationLeaseDigest,
          input.skillVersionId,
          input.consumedAt,
        );
      if (update.changes !== 1) {
        this.#database.exec("COMMIT;");
        return undefined;
      }
      const row = this.#database
        .prepare(
          `SELECT ${activationLeaseSelect()}
          FROM activation_leases
          WHERE activation_lease_digest = ?`,
        )
        .get(input.activationLeaseDigest);
      this.#database.exec("COMMIT;");
      if (row === undefined) throw new Error("Consumed activation lease disappeared.");
      return storedActivationLease(row);
    } catch (error: unknown) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  pendingActivationLease(
    input: PendingActivationLeaseInput,
  ): StoredActivationLease | undefined {
    const row = this.#database
      .prepare(
        `SELECT ${activationLeaseSelect()}
        FROM activation_leases
        WHERE activation_lease_digest = ?
          AND skill_version_id = ?
          AND consumed_at IS NULL
          AND expires_at > ?`,
      )
      .get(input.activationLeaseDigest, input.skillVersionId, input.observedAt);
    return row === undefined ? undefined : storedActivationLease(row);
  }

  activationFor(input: WorkItemIdentity): StoredActivationLease | undefined {
    const row = this.#database
      .prepare(
        `SELECT ${activationLeaseSelect()}
        FROM activation_leases
        WHERE run_id = ? AND work_item_id = ? AND consumed_at IS NOT NULL`,
      )
      .get(input.runId, input.workItemId);
    return row === undefined ? undefined : storedActivationLease(row);
  }

  close(): void {
    this.#database.close();
  }
}
