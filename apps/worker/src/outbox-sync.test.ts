import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalJournal } from "./journal.js";
import { OutboxSynchronizer } from "./outbox-sync.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("OutboxSynchronizer", () => {
  it("refuses to send a device credential over remote HTTP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-sync-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });

    expect(
      () =>
        new OutboxSynchronizer({
          endpoint: "http://control-plane.example.com",
          deviceToken: "device-secret",
          journal,
        }),
    ).toThrow("HTTPS");
    journal.close();
  });

  it("uploads a batch with device auth and acknowledges accepted records", async () => {
    let authorization = "";
    let requestBody = "";
    const server = createServer((request, response) => {
      authorization = request.headers.authorization ?? "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        requestBody += chunk;
      });
      request.on("end", () => {
        const parsed: unknown = JSON.parse(requestBody);
        const id = extractFirstRecordId(parsed);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ acceptedIds: [id] }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing test address.");

    const directory = await mkdtemp(join(tmpdir(), "sisyphus-sync-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    journal.recordDecision({
      eventId: "event-sync",
      decision: { kind: "allow-stop" },
      envelopeDigest: "a".repeat(64),
      receivedAt: "2026-08-29T10:00:00.000Z",
      evidence: { handle: "evidence-sync", digest: "b".repeat(64) },
      cloudEvent: { kind: "evaluation", excerpt: "safe [redacted]" },
    });
    const synchronizer = new OutboxSynchronizer({
      endpoint: `http://127.0.0.1:${address.port}`,
      deviceToken: "device-secret",
      journal,
    });

    await expect(synchronizer.flush()).resolves.toBe(1);
    expect(authorization).toBe("Bearer device-secret");
    expect(requestBody).toContain("safe [redacted]");
    expect(Object.keys(extractFirstRecord(JSON.parse(requestBody)))).toEqual([
      "id",
      "eventId",
      "payload",
    ]);
    expect(journal.pendingOutbox()).toEqual([]);
    journal.close();
  });

  it("keeps records pending when the control plane rejects a batch", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(503);
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing test address.");
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-sync-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    journal.recordDecision({
      eventId: "event-retry",
      decision: { kind: "allow-stop" },
      envelopeDigest: "c".repeat(64),
      receivedAt: "2026-08-29T10:00:00.000Z",
      evidence: { handle: "evidence-retry", digest: "d".repeat(64) },
      cloudEvent: { kind: "evaluation" },
    });
    const synchronizer = new OutboxSynchronizer({
      endpoint: `http://127.0.0.1:${address.port}`,
      deviceToken: "device-secret",
      journal,
    });

    await expect(synchronizer.flush()).rejects.toThrow("503");
    expect(journal.pendingOutbox()).toHaveLength(1);
    journal.close();
  });
});

function extractFirstRecordId(input: unknown): string {
  const first = extractFirstRecord(input);
  if (!("id" in first) || typeof first.id !== "string") throw new Error("Invalid record.");
  return first.id;
}

function extractFirstRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || !("records" in input)) {
    throw new Error("Invalid batch.");
  }
  const records = input.records;
  if (!Array.isArray(records) || records.length === 0) throw new Error("Invalid records.");
  const first: unknown = records[0];
  if (typeof first !== "object" || first === null) {
    throw new Error("Invalid record.");
  }
  return first as Record<string, unknown>;
}
