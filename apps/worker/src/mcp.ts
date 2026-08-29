import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  createSkillVersionId,
  type AgentRuntime,
  type SkillVersionId,
} from "@sisyphus/domain";
import { z } from "zod";

import { activationLeaseDigest } from "./activation-lease.js";
import type { LocalJournal } from "./journal.js";
import type { ManagedSkillInstruction } from "./managed-catalog.js";
import {
  authorizeLocalRequest,
  type LocalBearerToken,
} from "./local-auth.js";

interface McpRequestHandlerInput {
  readonly journal: LocalJournal;
  readonly mcpToken: LocalBearerToken;
  readonly instructionForSkill: (input: {
    readonly runtime: AgentRuntime;
    readonly skillVersionId: SkillVersionId;
  }) => ManagedSkillInstruction | undefined;
  readonly now?: (() => Date) | undefined;
}

const ManagedSkillInstructionSchema = z
  .object({
    skillVersionId: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    content: z.string().min(1),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    provenance: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("canonical") }).strict(),
      z
        .object({
          kind: z.literal("runtime-wrapper"),
          wrapperId: z.string().trim().min(1),
          path: z.string().trim().min(1),
        })
        .strict(),
    ]),
  })
  .strict();

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
        instruction: ManagedSkillInstructionSchema,
      },
    },
    async ({ activationLeaseId, skillVersionId }) => {
      const now = (input.now ?? (() => new Date()))();
      if (Number.isNaN(now.getTime())) throw new Error("Worker clock is invalid.");
      const digest = activationLeaseDigest(activationLeaseId);
      const pending = input.journal.pendingActivationLease({
        activationLeaseDigest: digest,
        skillVersionId,
        observedAt: now.toISOString(),
      });
      if (pending === undefined) {
        throw new Error("Activation lease is invalid, expired, or already consumed.");
      }
      const instruction = input.instructionForSkill({
        runtime: pending.runtime,
        skillVersionId: createSkillVersionId(pending.skillVersionId),
      });
      if (instruction === undefined) {
        throw new Error("The activation lease has no managed instruction snapshot.");
      }
      const consumed = input.journal.consumeActivationLease({
        activationLeaseDigest: digest,
        skillVersionId,
        consumedAt: now.toISOString(),
      });
      if (consumed === undefined) {
        throw new Error("Activation lease is invalid, expired, or already consumed.");
      }
      const result = {
        activated: true as const,
        skillVersionId,
        activationLeaseId,
        instruction,
      };
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
