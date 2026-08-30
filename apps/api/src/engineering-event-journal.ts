import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  EngineeringEventSummarySchema,
  type EngineeringEventSummary,
} from "@sisyphus/ui/contracts";

const JournalEntrySchema = z
  .object({
    tenantId: z.string().trim().min(1).max(160),
    event: EngineeringEventSummarySchema,
  })
  .strict();

export interface EngineeringEventJournal {
  append(input: {
    readonly tenantId: string;
    readonly events: readonly EngineeringEventSummary[];
  }): Promise<void>;
  recent(input: {
    readonly tenantId: string;
    readonly limit: number;
  }): Promise<readonly EngineeringEventSummary[]>;
  clearPromptHistory(input: {
    readonly tenantId: string;
    readonly preserveTaskIds: readonly string[];
  }): Promise<number>;
}

export class FileEngineeringEventJournal implements EngineeringEventJournal {
  #tail: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public async append(input: {
    readonly tenantId: string;
    readonly events: readonly EngineeringEventSummary[];
  }): Promise<void> {
    const entries = input.events.map((event) =>
      JournalEntrySchema.parse({ tenantId: input.tenantId, event }),
    );
    if (entries.length === 0) return;
    const body = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    const job = this.#tail.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, body, "utf8");
    });
    this.#tail = job.then(
      () => undefined,
      () => undefined,
    );
    await job;
  }

  public async recent(input: {
    readonly tenantId: string;
    readonly limit: number;
  }): Promise<readonly EngineeringEventSummary[]> {
    await this.#tail;
    const source = await readFile(this.filePath, "utf8").catch((error: unknown) => {
      if (isMissingFile(error)) return "";
      throw error;
    });
    const events = source
      .split(/\r?\n/gu)
      .flatMap((line) => {
        if (line.length === 0) return [];
        const entry = JournalEntrySchema.safeParse(parseJsonLine(line));
        return entry.success && entry.data.tenantId === input.tenantId ? [entry.data.event] : [];
      })
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
    return events.slice(0, input.limit);
  }

  public async clearPromptHistory(input: {
    readonly tenantId: string;
    readonly preserveTaskIds: readonly string[];
  }): Promise<number> {
    const preserveTaskIds = new Set(input.preserveTaskIds);
    let removedEventCount = 0;
    const job = this.#tail.then(async () => {
      const source = await readFile(this.filePath, "utf8").catch((error: unknown) => {
        if (isMissingFile(error)) return "";
        throw error;
      });
      const remainingLines = source
        .split(/\r?\n/gu)
        .flatMap((line) => {
          if (line.length === 0) return [];
          const entry = JournalEntrySchema.safeParse(parseJsonLine(line));
          if (!entry.success) return [line];
          if (entry.data.tenantId !== input.tenantId || preserveTaskIds.has(entry.data.event.taskId)) {
            return [line];
          }
          removedEventCount += 1;
          return [];
        });
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(
        this.filePath,
        remainingLines.length === 0 ? "" : `${remainingLines.join("\n")}\n`,
        "utf8",
      );
    });
    this.#tail = job.then(
      () => undefined,
      () => undefined,
    );
    await job;
    return removedEventCount;
  }
}

function parseJsonLine(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
