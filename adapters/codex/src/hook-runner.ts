import { z } from "zod";

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
  const response = await request(
    supervisionUrl(input.workerEndpoint ?? "http://127.0.0.1:7331"),
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
