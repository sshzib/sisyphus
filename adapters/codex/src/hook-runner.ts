import { z } from "zod";
import {
  createLocalChallengeNonce,
  verifyLocalChallenge,
} from "@sisyphus/local-protocol";

import { createCodexAdapter, type CodexRuntimeAdapter } from "./adapter.js";
import { inspectCodexEvent } from "./codex-wire.js";
import { parseAndRenderWorkerResponse, CodexSupervisionEnvelopeSchema } from "./worker-protocol.js";
import type { CodexHookResponse } from "./responses.js";

const WorkerEndpointSchema = z.string().url();
const WorkerHookTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u);

function supervisionUrl(input: string): URL {
  const endpoint = new URL(WorkerEndpointSchema.parse(input));
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!loopbackHosts.has(endpoint.hostname)) {
    throw new Error("the Sisyphus worker endpoint must use a loopback host");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("the Sisyphus worker endpoint must use HTTP or HTTPS");
  }
  endpoint.pathname = "/v1/supervise";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

async function authenticateWorker(input: {
  readonly endpoint: string;
  readonly token: string;
  readonly request: typeof fetch;
}): Promise<void> {
  const nonce = createLocalChallengeNonce();
  const url = supervisionUrl(input.endpoint);
  url.pathname = "/v1/challenge";
  url.searchParams.set("channel", "hook");
  url.searchParams.set("nonce", nonce);
  const response = await input.request(url, {
    method: "GET",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error("Sisyphus worker authentication failed.");
  const body: unknown = await response.json();
  if (
    !verifyLocalChallenge({
      response: body,
      channel: "hook",
      nonce,
      token: input.token,
    })
  ) {
    throw new Error("Sisyphus worker authentication failed.");
  }
}

export type RunCodexHookInput = {
  readonly rawEvent: unknown;
  readonly workerToken: string;
  readonly workerEndpoint?: string;
  readonly adapter?: CodexRuntimeAdapter;
  readonly request?: typeof fetch;
};

export async function runCodexHook(input: RunCodexHookInput): Promise<CodexHookResponse> {
  const adapter = input.adapter ?? createCodexAdapter();
  const inspected = inspectCodexEvent(input.rawEvent, adapter.normalizationOptions());
  const envelope = CodexSupervisionEnvelopeSchema.parse({
    runtime: "codex",
    adapterVersion: inspected.observation.adapterVersion,
    eventId: inspected.observation.eventId,
    event: inspected.observation,
    identity: inspected.identity,
    activation: inspected.activation,
    nativeEvent: inspected.raw,
  });
  const request = input.request ?? fetch;
  const workerToken = WorkerHookTokenSchema.parse(input.workerToken);
  const workerEndpoint = input.workerEndpoint ?? "http://127.0.0.1:7331";
  await authenticateWorker({ endpoint: workerEndpoint, token: workerToken, request });
  const response = await request(
    supervisionUrl(workerEndpoint),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`Sisyphus worker returned HTTP ${response.status}`);
  const workerOutput: unknown = await response.json();
  return parseAndRenderWorkerResponse(inspected.observation, workerOutput);
}
