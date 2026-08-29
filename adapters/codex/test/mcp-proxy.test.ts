import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  LocalChallengeNonceSchema,
  signLocalChallenge,
} from "@sisyphus/local-protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const proxyScript = fileURLToPath(
  new URL("../../../plugins/sisyphus-codex/scripts/mcp-proxy.mjs", import.meta.url),
);

const secretLease = "lease_that_must_not_reach_a_port_squatter";
const secretSkill = "skill_that_must_not_reach_a_port_squatter";

type CapturedRequest = {
  readonly authorization: string | undefined;
  readonly body: string;
  readonly method: string | undefined;
  readonly url: string | undefined;
};

const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

async function requestBody(request: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    else if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else throw new Error("Unexpected request body chunk.");
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("bundled Codex MCP proxy", () => {
  it("discloses neither its credential nor queued tool arguments to a port squatter", async () => {
    const token = randomBytes(32).toString("base64url");
    const requests: CapturedRequest[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const url = new URL(request.url ?? "/", "http://worker.local");
        LocalChallengeNonceSchema.parse(url.searchParams.get("nonce"));
        requests.push({
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString("utf8"),
          method: request.method,
          url: request.url,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            channel: "mcp",
            nonce: url.searchParams.get("nonce"),
            proof: "A".repeat(43),
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing port.");

    const child = spawn(process.execPath, [proxyScript], {
      env: {
        SISYPHUS_MCP_TOKEN: token,
        SISYPHUS_WORKER_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.end(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "activate_skill",
          arguments: { activationLeaseId: secretLease, skillVersionId: secretSkill },
        },
      })}\n`,
    );

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });

    expect(exitCode).not.toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      authorization: undefined,
      body: "",
      method: "GET",
    });
    expect(requests[0]?.url).toContain("/v1/challenge?channel=mcp&nonce=");
    const disclosed = JSON.stringify({ requests, stderr, stdout });
    expect(disclosed).not.toContain(token);
    expect(disclosed).not.toContain(secretLease);
    expect(disclosed).not.toContain(secretSkill);
  }, 10_000);

  it("forwards tools only after the worker proves possession of the MCP credential", async () => {
    const token = randomBytes(32).toString("base64url");
    const events: string[] = [];
    const authorizations: (string | undefined)[] = [];
    const remoteMessages: unknown[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://worker.local");
        if (url.pathname === "/v1/challenge") {
          const nonce = LocalChallengeNonceSchema.parse(url.searchParams.get("nonce"));
          events.push("challenge");
          authorizations.push(request.headers.authorization);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              channel: "mcp",
              nonce,
              proof: signLocalChallenge({ channel: "mcp", nonce, token }),
            }),
          );
          return;
        }
        if (url.pathname !== "/mcp") {
          response.writeHead(404).end();
          return;
        }

        const source = await requestBody(request);
        const parsed: unknown = JSON.parse(source);
        const message = JsonRpcRequestSchema.parse(parsed);
        events.push(`mcp:${message.method}`);
        authorizations.push(request.headers.authorization);
        remoteMessages.push(message);
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        if (message.id === undefined) {
          response.writeHead(400).end();
          return;
        }

        let result: unknown;
        if (message.method === "initialize") {
          const params = z
            .object({ protocolVersion: z.string() })
            .passthrough()
            .parse(message.params);
          result = {
            protocolVersion: params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "authenticated-test-worker", version: "0.1.0" },
          };
        } else if (message.method === "tools/list") {
          result = {
            tools: [
              {
                name: "activate_skill",
                description: "Activate the selected skill.",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          };
        } else if (message.method === "tools/call") {
          result = {
            content: [{ type: "text", text: "activated" }],
            structuredContent: { activated: true },
          };
        } else {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing port.");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [proxyScript],
      env: {
        SISYPHUS_MCP_TOKEN: token,
        SISYPHUS_WORKER_URL: `http://127.0.0.1:${address.port}`,
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "sisyphus-proxy-test", version: "0.1.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["activate_skill"]);
      const result = await client.callTool({
        name: "activate_skill",
        arguments: { activationLeaseId: secretLease, skillVersionId: secretSkill },
      });
      expect(result).toMatchObject({ structuredContent: { activated: true } });
    } finally {
      await client.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }

    expect(events[0]).toBe("challenge");
    expect(authorizations[0]).toBeUndefined();
    expect(authorizations.slice(1).every((value) => value === `Bearer ${token}`)).toBe(true);
    expect(JSON.stringify(remoteMessages)).toContain(secretLease);
    expect(JSON.stringify(remoteMessages)).toContain(secretSkill);
  }, 10_000);
});
