import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";

import { z, ZodError } from "zod";

import {
  authorizeLocalRequest,
  type LocalBearerToken,
} from "./local-auth.js";
import { WorkerRequestError } from "./supervisor.js";
import type { LocalEvidenceBrokerPort } from "./evidence-broker.js";

const MAXIMUM_REQUEST_BYTES = 8 * 1024 * 1024;

interface SupervisorPort {
  supervise(input: unknown): Promise<{
    readonly decision: unknown;
    readonly activationLease?: unknown;
  }>;
}

interface WorkerHttpServerInput {
  readonly hookToken: LocalBearerToken;
  readonly supervisor: SupervisorPort;
  readonly mcpHandler: RequestListener;
  readonly desktopToken?: LocalBearerToken;
  readonly evidenceBroker?: LocalEvidenceBrokerPort;
  readonly onError?: ((error: unknown) => void) | undefined;
}

const EvidenceRequestSchema = z
  .object({ eventId: z.string().trim().min(1).max(512) })
  .strict();

function writeAuthorizationError(
  response: ServerResponse,
  kind: "unauthorized" | "non-loopback",
): void {
  const status = kind === "unauthorized" ? 401 : 403;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...(kind === "unauthorized" ? { "www-authenticate": "Bearer" } : {}),
  });
  response.end(JSON.stringify({ error: kind }));
}

class InvalidHttpRequest extends Error {}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new InvalidHttpRequest("Content-Type must be application/json.");
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_REQUEST_BYTES) {
    throw new InvalidHttpRequest("Request body is too large.");
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > MAXIMUM_REQUEST_BYTES) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(buffer);
    }
  }
  if (tooLarge) throw new InvalidHttpRequest("Request body is too large.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidHttpRequest("Request body is not valid JSON.");
  }
}

async function handleRequest(
  input: WorkerHttpServerInput,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://worker.local");
  if (url.pathname === "/mcp") {
    input.mcpHandler(request, response);
    return;
  }
  if (url.pathname === "/health") {
    if (request.method !== "GET") {
      writeJson(response, 405, { error: "method-not-allowed" });
      return;
    }
    writeJson(response, 200, {
      status: "ok",
      service: "sisyphus-worker",
      version: "0.1.0",
    });
    return;
  }
  if (url.pathname === "/v1/evidence") {
    if (input.desktopToken === undefined || input.evidenceBroker === undefined) {
      writeJson(response, 404, { error: "not-found" });
      return;
    }
    if (request.method !== "POST") {
      writeJson(response, 405, { error: "method-not-allowed" });
      return;
    }
    const authorization = authorizeLocalRequest(request, input.desktopToken);
    if (authorization.kind !== "authorized") {
      writeAuthorizationError(response, authorization.kind);
      return;
    }
    try {
      const body = EvidenceRequestSchema.parse(await readJson(request));
      const evidence = await input.evidenceBroker.evidenceFor(body.eventId);
      if (evidence === undefined) {
        writeJson(response, 404, { error: "evidence-not-found" });
        return;
      }
      writeJson(response, 200, evidence);
    } catch (error: unknown) {
      if (error instanceof InvalidHttpRequest || error instanceof ZodError) {
        writeJson(response, 400, { error: "invalid-request" });
        return;
      }
      input.onError?.(error);
      writeJson(response, 500, { error: "evidence-read-failed" });
    }
    return;
  }
  if (url.pathname !== "/v1/supervise") {
    writeJson(response, 404, { error: "not-found" });
    return;
  }
  if (request.method !== "POST") {
    writeJson(response, 405, { error: "method-not-allowed" });
    return;
  }

  const authorization = authorizeLocalRequest(request, input.hookToken);
  if (authorization.kind !== "authorized") {
    writeAuthorizationError(response, authorization.kind);
    return;
  }

  try {
    const body = await readJson(request);
    writeJson(response, 200, await input.supervisor.supervise(body));
  } catch (error: unknown) {
    if (
      error instanceof InvalidHttpRequest ||
      error instanceof WorkerRequestError ||
      error instanceof ZodError
    ) {
      writeJson(response, 400, { error: "invalid-request" });
      return;
    }
    input.onError?.(error);
    writeJson(response, 500, { error: "supervision-failed" });
  }
}

export function createWorkerHttpServer(input: WorkerHttpServerInput): Server {
  return createServer((request, response) => {
    void handleRequest(input, request, response);
  });
}
