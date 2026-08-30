import { createHash, randomUUID } from "node:crypto";
import {
  CreateEngineeringTaskSchema,
  type EngineeringEventType,
} from "@sisyphus/domain";
import {
  EngineeringDashboardSchema,
  EngineeringExecutionStateSchema,
  EngineeringEventSummarySchema,
  EngineeringOperationSummarySchema,
  type EngineeringDashboard,
  type EngineeringExecutionState,
  type EngineeringEventSummary,
  type EngineeringOperationSummary,
} from "@sisyphus/ui/contracts";
import type { EngineeringEventJournal } from "./engineering-event-journal.js";

export interface EngineeringTaskLease {
  readonly tenantId: string;
  readonly taskId: string;
  readonly request: string;
  readonly leaseId: string;
  readonly executionGeneration: number;
  readonly operation: EngineeringOperationSummary;
}

export interface EngineeringTaskStore {
  create(input: {
    tenantId: string;
    actor: string;
    request: string;
    now: Date;
  }): Promise<EngineeringOperationSummary>;
  dashboard(input: {
    tenantId: string;
    canManageExecution: boolean;
  }): Promise<EngineeringDashboard>;
  clearHistory(input: { tenantId: string }): Promise<{ removedTaskCount: number; removedEventCount: number }>;
  lease(input: {
    tenantId: string;
    leaseId: string;
    now: Date;
    leaseDurationMs: number;
  }): Promise<EngineeringTaskLease | undefined>;
  updateLeasedTask(input: {
    tenantId: string;
    taskId: string;
    leaseId: string;
    executionGeneration: number;
    operation: EngineeringOperationSummary;
    events: readonly EngineeringEventSummary[];
    now: Date;
  }): Promise<boolean>;
  setExecution(input: {
    tenantId: string;
    actor: string;
    status: EngineeringExecutionState["status"];
    now: Date;
  }): Promise<EngineeringExecutionState>;
  permitsExecution(input: {
    tenantId: string;
    taskId: string;
    leaseId: string;
    executionGeneration: number;
    now: Date;
  }): Promise<boolean>;
}

interface StoredEngineeringTask {
  request: string;
  operation: EngineeringOperationSummary;
  leaseId: string | undefined;
  leaseExpiresAt: number | undefined;
  executionGeneration: number | undefined;
}

const terminalStatuses = new Set<EngineeringOperationSummary["status"]>([
  "approved",
  "rejected",
  "blocked",
]);

const defaultExecutionState = EngineeringExecutionStateSchema.parse({
  status: "stopped",
  generation: 0,
  changedAt: "1970-01-01T00:00:00.000Z",
  changedBy: "system",
});

function payloadDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requestSummary(request: string): string {
  const normalized = request.replaceAll(/\s+/gu, " ").trim();
  return normalized.length <= 280 ? normalized : `${normalized.slice(0, 277)}…`;
}

function initialEvent(input: {
  taskId: string;
  occurredAt: string;
  request: string;
}): EngineeringEventSummary {
  return EngineeringEventSummarySchema.parse({
    id: `engineering-event-${randomUUID()}`,
    taskId: input.taskId,
    type: "TASK_CREATED" satisfies EngineeringEventType,
    occurredAt: input.occurredAt,
    summary: `Task created: ${requestSummary(input.request)}`,
    payloadDigest: payloadDigest({ taskId: input.taskId, request: input.request }),
  });
}

export class InMemoryEngineeringTaskStore implements EngineeringTaskStore {
  readonly #tasks = new Map<string, StoredEngineeringTask>();
  readonly #eventsByTenant = new Map<string, EngineeringEventSummary[]>();
  readonly #executionByTenant = new Map<string, EngineeringExecutionState>();

  public constructor(private readonly journal?: EngineeringEventJournal) {}

  public async create(input: {
    tenantId: string;
    actor: string;
    request: string;
    now: Date;
  }): Promise<EngineeringOperationSummary> {
    const request = CreateEngineeringTaskSchema.parse({ request: input.request }).request;
    const id = `task-${randomUUID()}`;
    const occurredAt = input.now.toISOString();
    const operation = EngineeringOperationSummarySchema.parse({
      id,
      requestSummary: requestSummary(request),
      status: "queued",
      createdAt: occurredAt,
      updatedAt: occurredAt,
      requirements: [],
      agents: [],
      safety: { status: "not-started", findings: 0 },
      sandbox: { status: "not-started", buildId: null, detectedPort: null },
      evidence: [],
    });
    this.#tasks.set(taskKey(input.tenantId, id), {
      request,
      operation,
      leaseId: undefined,
      leaseExpiresAt: undefined,
      executionGeneration: undefined,
    });
    await this.#recordEvents(input.tenantId, [initialEvent({ taskId: id, occurredAt, request })]);
    return operation;
  }

  public async dashboard(input: {
    tenantId: string;
    canManageExecution: boolean;
  }): Promise<EngineeringDashboard> {
    const operations = [...this.#tasks.entries()]
      .filter(([key]) => key.startsWith(`${input.tenantId}\u0000`))
      .map(([, task]) => task.operation)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const persistedEvents = await this.journal
      ?.recent({ tenantId: input.tenantId, limit: 100 })
      .catch(() => []);
    return EngineeringDashboardSchema.parse({
      execution: this.#executionState(input.tenantId),
      canManageExecution: input.canManageExecution,
      operations: operations.slice(0, 20),
      events: deduplicateEvents([
        ...(this.#eventsByTenant.get(input.tenantId) ?? []),
        ...(persistedEvents ?? []),
      ]).slice(0, 100),
    });
  }

  public async clearHistory(input: { tenantId: string }): Promise<{ removedTaskCount: number; removedEventCount: number }> {
    const removedTaskIds = [...this.#tasks.entries()]
      .filter(([key, task]) => key.startsWith(`${input.tenantId}\u0000`) && terminalStatuses.has(task.operation.status))
      .map(([, task]) => task.operation.id);
    const activeTaskIds = [...this.#tasks.entries()]
      .filter(([key, task]) => key.startsWith(`${input.tenantId}\u0000`) && !terminalStatuses.has(task.operation.status))
      .map(([, task]) => task.operation.id);
    const activeTaskIdSet = new Set(activeTaskIds);
    for (const taskId of removedTaskIds) {
      this.#tasks.delete(taskKey(input.tenantId, taskId));
    }
    const inMemoryRemovedEventCount = (this.#eventsByTenant.get(input.tenantId) ?? []).filter(
      (event) => !activeTaskIdSet.has(event.taskId),
    ).length;
    this.#eventsByTenant.set(
      input.tenantId,
      (this.#eventsByTenant.get(input.tenantId) ?? []).filter(
        (event) => activeTaskIdSet.has(event.taskId),
      ),
    );
    const persistedRemovedEventCount = await this.journal?.clearPromptHistory({
      tenantId: input.tenantId,
      preserveTaskIds: activeTaskIds,
    });
    return {
      removedTaskCount: removedTaskIds.length,
      removedEventCount: persistedRemovedEventCount ?? inMemoryRemovedEventCount,
    };
  }

  public async lease(input: {
    tenantId: string;
    leaseId: string;
    now: Date;
    leaseDurationMs: number;
  }): Promise<EngineeringTaskLease | undefined> {
    const execution = this.#executionState(input.tenantId);
    if (execution.status !== "running") return undefined;
    const now = input.now.getTime();
    const candidate = [...this.#tasks.entries()]
      .filter(([key, task]) => {
        if (!key.startsWith(`${input.tenantId}\u0000`)) return false;
        if (terminalStatuses.has(task.operation.status)) return false;
        return task.leaseExpiresAt === undefined || task.leaseExpiresAt <= now;
      })
      .sort(([, left], [, right]) => Date.parse(left.operation.createdAt) - Date.parse(right.operation.createdAt))[0];
    if (candidate === undefined) return undefined;

    const [key, task] = candidate;
    const operation = EngineeringOperationSummarySchema.parse({
      ...task.operation,
      status: task.operation.status === "queued" ? "planning" : task.operation.status,
      updatedAt: input.now.toISOString(),
    });
    const stored = {
      ...task,
      operation,
      leaseId: input.leaseId,
      leaseExpiresAt: now + input.leaseDurationMs,
      executionGeneration: execution.generation,
    } satisfies StoredEngineeringTask;
    this.#tasks.set(key, stored);
    return {
      tenantId: input.tenantId,
      taskId: operation.id,
      request: stored.request,
      leaseId: input.leaseId,
      executionGeneration: execution.generation,
      operation,
    };
  }

  public async updateLeasedTask(input: {
    tenantId: string;
    taskId: string;
    leaseId: string;
    executionGeneration: number;
    operation: EngineeringOperationSummary;
    events: readonly EngineeringEventSummary[];
    now: Date;
  }): Promise<boolean> {
    const key = taskKey(input.tenantId, input.taskId);
    const existing = this.#tasks.get(key);
    if (
      existing === undefined ||
      existing.leaseId !== input.leaseId ||
      existing.executionGeneration !== input.executionGeneration ||
      existing.leaseExpiresAt === undefined ||
      existing.leaseExpiresAt < input.now.getTime() ||
      this.#executionState(input.tenantId).status !== "running" ||
      this.#executionState(input.tenantId).generation !== input.executionGeneration ||
      input.operation.id !== input.taskId
    ) {
      return false;
    }
    const operation = EngineeringOperationSummarySchema.parse({
      ...input.operation,
      updatedAt: input.now.toISOString(),
    });
    const events = input.events.map((event) => EngineeringEventSummarySchema.parse(event));
    this.#tasks.set(key, {
      ...existing,
      operation,
      leaseId: terminalStatuses.has(operation.status) ? undefined : existing.leaseId,
      leaseExpiresAt: terminalStatuses.has(operation.status)
        ? undefined
        : existing.leaseExpiresAt,
      executionGeneration: terminalStatuses.has(operation.status)
        ? undefined
        : existing.executionGeneration,
    });
    await this.#recordEvents(input.tenantId, events);
    return true;
  }

  public async setExecution(input: {
    tenantId: string;
    actor: string;
    status: EngineeringExecutionState["status"];
    now: Date;
  }): Promise<EngineeringExecutionState> {
    const current = this.#executionState(input.tenantId);
    const next = EngineeringExecutionStateSchema.parse({
      status: input.status,
      generation: current.generation + 1,
      changedAt: input.now.toISOString(),
      changedBy: input.actor,
    });
    this.#executionByTenant.set(input.tenantId, next);
    if (next.status === "stopped") {
      const blockedAt = input.now.toISOString();
      const events: EngineeringEventSummary[] = [];
      for (const [key, task] of this.#tasks.entries()) {
        if (!key.startsWith(`${input.tenantId}\u0000`) || task.leaseId === undefined || terminalStatuses.has(task.operation.status)) {
          continue;
        }
        const operation = EngineeringOperationSummarySchema.parse({
          ...task.operation,
          status: "blocked",
          updatedAt: blockedAt,
          safety: { status: "blocked", findings: task.operation.safety.findings },
          sandbox: {
            ...task.operation.sandbox,
            status: "blocked",
          },
        });
        this.#tasks.set(key, {
          ...task,
          operation,
          leaseId: undefined,
          leaseExpiresAt: undefined,
          executionGeneration: undefined,
        });
        events.push(
          engineeringEvent({
            taskId: operation.id,
            type: "WORKFLOW_BLOCKED",
            occurredAt: blockedAt,
            summary: "Execution was stopped by a tenant administrator; the active worker lease was cancelled.",
            payload: { reason: "execution-stopped" },
          }),
        );
      }
      await this.#recordEvents(input.tenantId, events);
    }
    return next;
  }

  public async permitsExecution(input: {
    tenantId: string;
    taskId: string;
    leaseId: string;
    executionGeneration: number;
    now: Date;
  }): Promise<boolean> {
    const execution = this.#executionState(input.tenantId);
    const task = this.#tasks.get(taskKey(input.tenantId, input.taskId));
    return (
      execution.status === "running" &&
      execution.generation === input.executionGeneration &&
      task !== undefined &&
      task.leaseId === input.leaseId &&
      task.executionGeneration === input.executionGeneration &&
      task.leaseExpiresAt !== undefined &&
      task.leaseExpiresAt >= input.now.getTime()
    );
  }

  async #recordEvents(tenantId: string, events: readonly EngineeringEventSummary[]): Promise<void> {
    this.#prependEvents(tenantId, events);
    await this.journal?.append({ tenantId, events }).catch(() => undefined);
  }

  #prependEvents(tenantId: string, events: readonly EngineeringEventSummary[]): void {
    if (events.length === 0) return;
    this.#eventsByTenant.set(tenantId, [
      ...[...events].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)),
      ...(this.#eventsByTenant.get(tenantId) ?? []),
    ].slice(0, 100));
  }

  #executionState(tenantId: string): EngineeringExecutionState {
    return this.#executionByTenant.get(tenantId) ?? defaultExecutionState;
  }
}

function deduplicateEvents(events: readonly EngineeringEventSummary[]): EngineeringEventSummary[] {
  const seen = new Set<string>();
  return [...events]
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
}

function taskKey(tenantId: string, taskId: string): string {
  return `${tenantId}\u0000${taskId}`;
}

export function engineeringEvent(input: {
  taskId: string;
  type: EngineeringEventType;
  occurredAt: string;
  summary: string;
  payload?: unknown;
}): EngineeringEventSummary {
  return EngineeringEventSummarySchema.parse({
    id: `engineering-event-${randomUUID()}`,
    taskId: input.taskId,
    type: input.type,
    occurredAt: input.occurredAt,
    summary: input.summary,
    payloadDigest: payloadDigest(input.payload ?? {}),
  });
}
