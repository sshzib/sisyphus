import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileEngineeringEventJournal } from "./engineering-event-journal.js";

describe("FileEngineeringEventJournal", () => {
  it("removes only the requested tenant task events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-engineering-events-"));
    const filePath = join(directory, "events.jsonl");
    const journal = new FileEngineeringEventJournal(filePath);
    try {
      await journal.append({
        tenantId: "tenant-a",
        events: [event("task-delete"), event("task-keep")],
      });
      await journal.append({ tenantId: "tenant-b", events: [event("task-delete")] });

      await expect(
        journal.clearPromptHistory({ tenantId: "tenant-a", preserveTaskIds: ["task-keep"] }),
      ).resolves.toBe(1);

      await expect(journal.recent({ tenantId: "tenant-a", limit: 10 })).resolves.toEqual([event("task-keep")]);
      await expect(journal.recent({ tenantId: "tenant-b", limit: 10 })).resolves.toEqual([event("task-delete")]);
      await expect(readFile(filePath, "utf8")).resolves.not.toContain('"tenantId":"tenant-a","event":{"id":"event-task-delete"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function event(taskId: string) {
  return {
    id: `event-${taskId}`,
    taskId,
    type: "TASK_CREATED",
    occurredAt: "2026-08-30T00:00:00.000Z",
    summary: `Task created: ${taskId}`,
    payloadDigest: "a".repeat(64),
  };
}
