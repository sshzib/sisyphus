import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  type JSONRPCMessage,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createLocalChallengeNonce,
  verifyLocalChallenge,
} from "@sisyphus/local-protocol";
import { z } from "zod";

const WorkerEndpointSchema = z.string().url();
const WorkerMcpTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u);
const ProxyEnvironmentSchema = z.object({
  SISYPHUS_MCP_TOKEN: WorkerMcpTokenSchema,
  SISYPHUS_WORKER_URL: WorkerEndpointSchema.optional(),
});

class StreamableClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: NonNullable<Transport["onmessage"]>;

  constructor(private readonly transport: StreamableHTTPClientTransport) {}

  async start(): Promise<void> {
    this.transport.onclose = () => this.onclose?.();
    this.transport.onerror = (error) => this.onerror?.(error);
    this.transport.onmessage = (message: JSONRPCMessage) => this.onmessage?.(message);
    await this.transport.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    if (options === undefined) {
      await this.transport.send(message);
      return;
    }
    await this.transport.send(message, {
      ...(options.resumptionToken === undefined
        ? {}
        : { resumptionToken: options.resumptionToken }),
      ...(options.onresumptiontoken === undefined
        ? {}
        : { onresumptiontoken: options.onresumptiontoken }),
    });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion(version);
  }
}

function localWorkerUrl(endpoint: string, pathname: string): URL {
  const url = new URL(WorkerEndpointSchema.parse(endpoint));
  const loopbackHosts = new Set(["127.0.0.1", "[::1]"]);
  if (!loopbackHosts.has(url.hostname)) {
    throw new Error("the Sisyphus worker endpoint must use a loopback IP address");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("the Sisyphus worker endpoint must use HTTP or HTTPS");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("the Sisyphus worker endpoint must not contain credentials");
  }
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url;
}

async function authenticateWorker(input: {
  readonly endpoint: string;
  readonly request: typeof fetch;
  readonly token: string;
}): Promise<void> {
  const nonce = createLocalChallengeNonce();
  const challengeUrl = localWorkerUrl(input.endpoint, "/v1/challenge");
  challengeUrl.searchParams.set("channel", "mcp");
  challengeUrl.searchParams.set("nonce", nonce);
  const response = await input.request(challengeUrl, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error("Sisyphus worker authentication failed.");
  const body: unknown = await response.json();
  if (
    !verifyLocalChallenge({
      response: body,
      channel: "mcp",
      nonce,
      token: input.token,
    })
  ) {
    throw new Error("Sisyphus worker authentication failed.");
  }
}

async function runMcpProxy(): Promise<void> {
  const environment = ProxyEnvironmentSchema.parse(process.env);
  const endpoint = environment.SISYPHUS_WORKER_URL ?? "http://127.0.0.1:7331";
  await authenticateWorker({
    endpoint,
    request: fetch,
    token: environment.SISYPHUS_MCP_TOKEN,
  });

  const remoteClient = new Client({ name: "sisyphus-codex-proxy", version: "0.1.0" });
  const remoteTransport = new StreamableHTTPClientTransport(
    localWorkerUrl(endpoint, "/mcp"),
    {
      requestInit: {
        headers: { authorization: `Bearer ${environment.SISYPHUS_MCP_TOKEN}` },
        redirect: "error",
      },
    },
  );
  await remoteClient.connect(new StreamableClientTransport(remoteTransport));

  const localServer = new Server(
    { name: "sisyphus-codex", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  localServer.setRequestHandler(ListToolsRequestSchema, async (request) =>
    remoteClient.listTools(request.params),
  );
  localServer.setRequestHandler(CallToolRequestSchema, async (request) =>
    remoteClient.callTool(request.params),
  );
  localServer.onclose = () => {
    void remoteClient.close().catch(() => undefined);
  };
  remoteClient.onclose = () => {
    void localServer.close().catch(() => undefined);
  };

  await localServer.connect(new StdioServerTransport());
}

try {
  await runMcpProxy();
} catch {
  process.exitCode = 1;
}
