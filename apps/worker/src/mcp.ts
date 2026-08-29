import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

import { activationLeaseDigest } from "./activation-lease.js";
import type { LocalJournal } from "./journal.js";
import {
  authorizeLocalRequest,
  type LocalBearerToken,
} from "./local-auth.js";

interface McpRequestHandlerInput {
  readonly journal: LocalJournal;
  readonly mcpToken: LocalBearerToken;
  readonly now?: (() => Date) | undefined;
}

function writeJsonRpcError(response: ServerResponse, status: number): void {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    }),
  );
}

function writeAuthorizationError(
  response: ServerResponse,
  kind: "unauthorized" | "non-loopback",
): void {
  if (response.headersSent) return;
  response.writeHead(kind === "unauthorized" ? 401 : 403, {
    "cache-control": "no-store",
    "content-type": "application/json",
    ...(kind === "unauthorized" ? { "www-authenticate": "Bearer" } : {}),
  });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32_000, message: "Local authorization failed" },
      id: null,
    }),
  );
}

async function handleMcpRequest(
  input: McpRequestHandlerInput,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const authorization = authorizeLocalRequest(request, input.mcpToken);
  if (authorization.kind !== "authorized") {
    writeAuthorizationError(response, authorization.kind);
    return;
  }
  const server = new McpServer({ name: "sisyphus-worker", version: "0.1.0" });
  server.registerTool(
    "activate_skill",
    {
      description: "Consume the worker-issued managed skill activation lease.",
      inputSchema: {
        skillVersionId: z.string().min(1),
        activationLeaseId: z.string().min(1),
      },
      outputSchema: {
        activated: z.literal(true),
        skillVersionId: z.string(),
        activationLeaseId: z.string(),
      },
    },
    async ({ activationLeaseId, skillVersionId }) => {
      const now = (input.now ?? (() => new Date()))();
      if (Number.isNaN(now.getTime())) throw new Error("Worker clock is invalid.");
      const consumed = input.journal.consumeActivationLease({
        activationLeaseDigest: activationLeaseDigest(activationLeaseId),
        skillVersionId,
        consumedAt: now.toISOString(),
      });
      if (consumed === undefined) {
        throw new Error("Activation lease is invalid, expired, or already consumed.");
      }
      const result = { activated: true as const, skillVersionId, activationLeaseId };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  server.registerTool(
    "worker_health",
    {
      description: "Report whether the local supervision worker is accepting requests.",
      outputSchema: { healthy: z.literal(true) },
    },
    async () => {
      const result = { healthy: true as const };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  const transport = new StreamableHTTPServerTransport();
  try {
    await server.connect(transport as Transport);
    await transport.handleRequest(request, response);
  } catch {
    writeJsonRpcError(response, 500);
  } finally {
    await transport.close();
    await server.close();
  }
}

export function createMcpRequestHandler(input: McpRequestHandlerInput): RequestListener {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://worker.local");
    if (url.pathname !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    void handleMcpRequest(input, request, response);
  };
}
