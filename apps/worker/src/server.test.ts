import { once } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkerHttpServer } from "./server.js";
import { parseLocalBearerToken } from "./local-auth.js";

const hookToken = parseLocalBearerToken(
  "hook_token_0123456789abcdefghijklmnopqrstuvwxyz",
);
const mcpToken = parseLocalBearerToken(
  "mcp_token_0123456789abcdefghijklmnopqrstuvwxyz0",
);
const desktopToken = parseLocalBearerToken(
  "desktop_token_0123456789abcdefghijklmnopqrstuvwxyz",
);

describe("worker HTTP server", () => {
  const servers: ReturnType<typeof createWorkerHttpServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(async (server) => {
        server.close();
        await once(server, "close");
      }),
    );
  });

  async function endpointFor(server: ReturnType<typeof createWorkerHttpServer>): Promise<URL> {
    server.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing server port.");
    return new URL(`http://127.0.0.1:${address.port}`);
  }

  it("reports health and returns the supervisor decision envelope", async () => {
    const supervise = vi.fn(async () => ({ decision: { kind: "prompt-decision" } }));
    const endpoint = await endpointFor(
      createWorkerHttpServer({
        hookToken,
        supervisor: { supervise },
        mcpHandler: (_request, response) => response.writeHead(204).end(),
      }),
    );

    const health = await fetch(new URL("/health", endpoint));
    const response = await fetch(new URL("/v1/supervise", endpoint), {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId: "event-1" }),
    });

    expect(await health.json()).toEqual({
      status: "ok",
      service: "sisyphus-worker",
      version: "0.1.0",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ decision: { kind: "prompt-decision" } });
    expect(supervise).toHaveBeenCalledWith({ eventId: "event-1" });
  });

  it("rejects malformed JSON at the boundary", async () => {
    const supervise = vi.fn();
    const endpoint = await endpointFor(
      createWorkerHttpServer({
        hookToken,
        supervisor: { supervise },
        mcpHandler: (_request, response) => response.writeHead(204).end(),
      }),
    );

    const response = await fetch(new URL("/v1/supervise", endpoint), {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: "{not-json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid-request" });
    expect(supervise).not.toHaveBeenCalled();
  });

  it("rejects missing and incorrect hook credentials before reading the payload", async () => {
    const supervise = vi.fn();
    const endpoint = await endpointFor(
      createWorkerHttpServer({
        hookToken,
        supervisor: { supervise },
        mcpHandler: (_request, response) => response.writeHead(204).end(),
      }),
    );

    const missing = await fetch(new URL("/v1/supervise", endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "event-1" }),
    });
    const incorrect = await fetch(new URL("/v1/supervise", endpoint), {
      method: "POST",
      headers: {
        authorization: "Bearer hook_token_wrong_0123456789abcdefghijklmnopqr",
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId: "event-1" }),
    });

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "unauthorized" });
    expect(await incorrect.json()).toEqual({ error: "unauthorized" });
    expect(supervise).not.toHaveBeenCalled();
  });

  it("returns raw evidence only to the separate desktop credential", async () => {
    const evidenceFor = vi.fn(async () => ({
      eventId: "event-1",
      digest: "d".repeat(64),
      evidence: "private local evidence",
    }));
    const endpoint = await endpointFor(
      createWorkerHttpServer({
        hookToken,
        desktopToken,
        evidenceBroker: { evidenceFor },
        supervisor: { supervise: vi.fn() },
        mcpHandler: (_request, response) => response.writeHead(204).end(),
      }),
    );
    const request = (token?: string) =>
      fetch(new URL("/v1/evidence", endpoint), {
        method: "POST",
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          "content-type": "application/json",
        },
        body: JSON.stringify({ eventId: "event-1" }),
      });

    expect((await request()).status).toBe(401);
    expect((await request(hookToken)).status).toBe(401);
    expect((await request(mcpToken)).status).toBe(401);
    const accepted = await request(desktopToken);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(await accepted.json()).toMatchObject({ evidence: "private local evidence" });
    expect(evidenceFor).toHaveBeenCalledTimes(1);
  });
});
