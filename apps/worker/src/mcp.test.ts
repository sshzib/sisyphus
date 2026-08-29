import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createContentHash } from "@sisyphus/catalog";
import { afterEach, describe, expect, it } from "vitest";

import { ActivationLeaseAuthority } from "./activation-lease.js";
import { LocalJournal } from "./journal.js";
import { parseLocalBearerToken } from "./local-auth.js";
import { createMcpRequestHandler } from "./mcp.js";

const mcpToken = parseLocalBearerToken(
  "mcp_token_0123456789abcdefghijklmnopqrstuvwxyz0",
);
const authority = new ActivationLeaseAuthority({ key: new Uint8Array(32).fill(9) });

describe("worker MCP tools", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  it("consumes only a worker-issued activation lease and refuses its replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-mcp-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    cleanups.push(() => journal.close());
    const issued = authority.issue({
      promptEventId: "prompt-event-1",
      runtime: "codex",
      runId: "run-1",
      workItemId: "work-1",
      skillVersionId: "skill-version-1",
      issuedAt: "2026-08-29T10:00:00.000Z",
      expiresAt: "2026-08-29T10:05:00.000Z",
    });
    journal.recordDecision({
      eventId: "prompt-event-1",
      decision: { kind: "prompt-decision" },
      envelopeDigest: "a".repeat(64),
      receivedAt: "2026-08-29T10:00:00.000Z",
      evidence: { handle: "evidence-1", digest: "b".repeat(64) },
      cloudEvent: { kind: "prompt-observed" },
      activationLease: issued.record,
    });
    const server = createServer(
      createMcpRequestHandler({
        journal,
        mcpToken,
        instructionForSkill: ({ runtime, skillVersionId }) => ({
          skillVersionId,
          displayName: "Managed test skill",
          content: `Instructions for ${runtime}.`,
          contentHash: createContentHash(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ),
          provenance: { kind: "canonical" },
        }),
        now: () => new Date("2026-08-29T10:01:00.000Z"),
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing server port.");

    const client = new Client({ name: "worker-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } },
    );
    await client.connect(transport as Transport);
    cleanups.push(() => client.close());

    const result = await client.callTool({
      name: "activate_skill",
      arguments: {
        skillVersionId: "skill-version-1",
        activationLeaseId: issued.lease.activationLeaseId,
      },
    });

    expect(result.structuredContent).toEqual({
      activated: true,
      skillVersionId: "skill-version-1",
      activationLeaseId: issued.lease.activationLeaseId,
      instruction: {
        skillVersionId: "skill-version-1",
        displayName: "Managed test skill",
        content: "Instructions for codex.",
        contentHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        provenance: { kind: "canonical" },
      },
    });
    expect(journal.activationFor({ runId: "run-1", workItemId: "work-1" })).toMatchObject({
      skillVersionId: "skill-version-1",
      consumedAt: "2026-08-29T10:01:00.000Z",
    });

    const replay = await client.callTool({
      name: "activate_skill",
      arguments: {
        skillVersionId: "skill-version-1",
        activationLeaseId: issued.lease.activationLeaseId,
      },
    });
    expect(replay.isError).toBe(true);
  });

  it("rejects unauthenticated MCP requests before dispatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-mcp-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    cleanups.push(() => journal.close());
    const server = createServer(createMcpRequestHandler({ journal, mcpToken }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing server port.");

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "activate_skill",
          arguments: { skillVersionId: "forged-skill", activationLeaseId: "forged-lease" },
        },
      }),
    });

    expect(response.status).toBe(401);
    expect(journal.activationFor({ runId: "run-1", workItemId: "work-1" })).toBeUndefined();
  });

  it("rejects an authenticated activation that was never issued by a decision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-mcp-"));
    const journal = new LocalJournal({ path: join(directory, "worker.db") });
    cleanups.push(() => journal.close());
    const server = createServer(
      createMcpRequestHandler({
        journal,
        mcpToken,
        now: () => new Date("2026-08-29T10:01:00.000Z"),
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing server port.");
    const client = new Client({ name: "worker-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } },
    );
    await client.connect(transport as Transport);
    cleanups.push(() => client.close());

    const result = await client.callTool({
      name: "activate_skill",
      arguments: { skillVersionId: "forged-skill", activationLeaseId: "forged-lease" },
    });

    expect(result.isError).toBe(true);
  });
});
