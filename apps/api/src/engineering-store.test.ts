import { describe, expect, it } from "vitest";
import { InMemoryEngineeringTaskStore } from "./engineering-store.js";

describe("InMemoryEngineeringTaskStore", () => {
  it("does not re-lease an operation blocked on external sandbox configuration", async () => {
    const store = new InMemoryEngineeringTaskStore();
    const createdAt = new Date("2026-08-30T00:00:00.000Z");
    const operation = await store.create({
      tenantId: "tenant-test",
      actor: "tester",
      request: "Build a simple static landing page with an accessible product heading.",
      now: createdAt,
    });
    await store.setExecution({
      tenantId: "tenant-test",
      actor: "admin-test",
      status: "running",
      now: createdAt,
    });
    const lease = await store.lease({
      tenantId: "tenant-test",
      leaseId: "00000000-0000-4000-8000-000000000001",
      now: createdAt,
      leaseDurationMs: 60_000,
    });

    expect(lease).toBeDefined();
    if (lease === undefined) throw new Error("The test task was not leased.");

    await expect(
      store.updateLeasedTask({
        tenantId: lease.tenantId,
        taskId: lease.taskId,
        leaseId: lease.leaseId,
        executionGeneration: lease.executionGeneration,
        operation: {
          ...operation,
          status: "blocked",
          safety: { status: "passed", findings: 0 },
          sandbox: { status: "blocked", buildId: null, detectedPort: null },
        },
        events: [],
        now: new Date(createdAt.getTime() + 1_000),
      }),
    ).resolves.toBe(true);

    await expect(
      store.lease({
        tenantId: "tenant-test",
        leaseId: "00000000-0000-4000-8000-000000000002",
        now: new Date(createdAt.getTime() + 120_000),
        leaseDurationMs: 60_000,
      }),
    ).resolves.toBeUndefined();
  });

  it("deletes only terminal prompt history and preserves active work", async () => {
    const store = new InMemoryEngineeringTaskStore();
    const createdAt = new Date("2026-08-30T00:00:00.000Z");
    const completed = await store.create({
      tenantId: "tenant-test",
      actor: "tester",
      request: "Build a simple static landing page with an accessible product heading.",
      now: createdAt,
    });
    const active = await store.create({
      tenantId: "tenant-test",
      actor: "tester",
      request: "Build another simple static landing page with an accessible product heading.",
      now: new Date(createdAt.getTime() + 1_000),
    });
    await store.setExecution({
      tenantId: "tenant-test",
      actor: "admin-test",
      status: "running",
      now: new Date(createdAt.getTime() + 1_500),
    });
    const lease = await store.lease({
      tenantId: "tenant-test",
      leaseId: "00000000-0000-4000-8000-000000000003",
      now: new Date(createdAt.getTime() + 2_000),
      leaseDurationMs: 60_000,
    });

    expect(lease?.taskId).toBe(completed.id);
    if (lease === undefined) throw new Error("The completed task was not leased.");
    await store.updateLeasedTask({
      tenantId: lease.tenantId,
      taskId: lease.taskId,
      leaseId: lease.leaseId,
      executionGeneration: lease.executionGeneration,
      operation: {
        ...completed,
        status: "approved",
        safety: { status: "passed", findings: 0 },
        sandbox: { status: "passed", buildId: "local-test", detectedPort: 43123 },
      },
      events: [],
      now: new Date(createdAt.getTime() + 3_000),
    });

    await expect(store.clearHistory({ tenantId: "tenant-test" })).resolves.toEqual({
      removedTaskCount: 1,
      removedEventCount: 1,
    });
    await expect(store.dashboard({ tenantId: "tenant-test", canManageExecution: true })).resolves.toMatchObject({
      operations: [{ id: active.id, status: "queued" }],
    });
  });

  it("fails closed until started and fences a stopped worker lease", async () => {
    const store = new InMemoryEngineeringTaskStore();
    const now = new Date("2026-08-30T00:00:00.000Z");
    const operation = await store.create({
      tenantId: "tenant-test",
      actor: "tester",
      request: "Build a simple static landing page with an accessible product heading.",
      now,
    });

    await expect(store.lease({
      tenantId: "tenant-test",
      leaseId: "00000000-0000-4000-8000-000000000004",
      now,
      leaseDurationMs: 60_000,
    })).resolves.toBeUndefined();

    await store.setExecution({
      tenantId: "tenant-test",
      actor: "admin-test",
      status: "running",
      now: new Date(now.getTime() + 1_000),
    });
    const lease = await store.lease({
      tenantId: "tenant-test",
      leaseId: "00000000-0000-4000-8000-000000000005",
      now: new Date(now.getTime() + 2_000),
      leaseDurationMs: 60_000,
    });

    expect(lease).toBeDefined();
    if (lease === undefined) throw new Error("The started task was not leased.");
    await expect(store.permitsExecution({
      tenantId: lease.tenantId,
      taskId: lease.taskId,
      leaseId: lease.leaseId,
      executionGeneration: lease.executionGeneration,
      now: new Date(now.getTime() + 3_000),
    })).resolves.toBe(true);

    await store.setExecution({
      tenantId: "tenant-test",
      actor: "admin-test",
      status: "stopped",
      now: new Date(now.getTime() + 4_000),
    });

    await expect(store.permitsExecution({
      tenantId: lease.tenantId,
      taskId: lease.taskId,
      leaseId: lease.leaseId,
      executionGeneration: lease.executionGeneration,
      now: new Date(now.getTime() + 5_000),
    })).resolves.toBe(false);
    await expect(store.dashboard({ tenantId: "tenant-test", canManageExecution: true })).resolves.toMatchObject({
      execution: { status: "stopped" },
      operations: [{ id: operation.id, status: "blocked" }],
    });
  });

  it("carries the selected backend in a new lease and refuses changes while running", async () => {
    const store = new InMemoryEngineeringTaskStore();
    const now = new Date("2026-08-30T00:00:00.000Z");
    await store.create({
      tenantId: "tenant-test",
      actor: "tester",
      request: "Build a simple static landing page with an accessible product heading.",
      now,
    });

    await expect(store.setExecutionBackend({
      tenantId: "tenant-test",
      actor: "admin-test",
      backend: "codebuild",
      now: new Date(now.getTime() + 1_000),
    })).resolves.toMatchObject({
      kind: "updated",
      execution: { status: "stopped", backend: "codebuild", generation: 1 },
    });
    await store.setExecution({
      tenantId: "tenant-test",
      actor: "admin-test",
      status: "running",
      now: new Date(now.getTime() + 2_000),
    });

    const lease = await store.lease({
      tenantId: "tenant-test",
      leaseId: "00000000-0000-4000-8000-000000000006",
      now: new Date(now.getTime() + 3_000),
      leaseDurationMs: 60_000,
    });

    expect(lease?.executionBackend).toBe("codebuild");
    await expect(store.setExecutionBackend({
      tenantId: "tenant-test",
      actor: "admin-test",
      backend: "local-static",
      now: new Date(now.getTime() + 4_000),
    })).resolves.toMatchObject({
      kind: "execution-running",
      execution: { backend: "codebuild", generation: 2 },
    });
  });

  it("carries the selected model tier from task creation into a lease", async () => {
    const store = new InMemoryEngineeringTaskStore();
    const now = new Date("2026-08-30T00:00:00.000Z");
    await store.create({
      tenantId: "tenant-test",
      actor: "tester",
      request: "Build a responsive landing page with an accessible product heading.",
      modelTier: "high",
      now,
    });
    await store.setExecution({
      tenantId: "tenant-test",
      actor: "admin-test",
      status: "running",
      now: new Date(now.getTime() + 1_000),
    });

    const lease = await store.lease({
      tenantId: "tenant-test",
      leaseId: "00000000-0000-4000-8000-000000000007",
      now: new Date(now.getTime() + 2_000),
      leaseDurationMs: 60_000,
    });

    expect(lease?.modelTier).toBe("high");
  });
});
