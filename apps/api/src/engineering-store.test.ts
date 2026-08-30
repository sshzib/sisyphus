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
    await expect(store.dashboard("tenant-test")).resolves.toMatchObject({
      operations: [{ id: active.id, status: "queued" }],
    });
  });
});
