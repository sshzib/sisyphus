import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ExecutionResultSchema,
  type ExecutionResult,
  type ProjectExecution,
  type ProjectExecutor,
} from "./execution.js";
import { scanWorkspace } from "./safety-gate.js";

const contentTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export class LocalStaticExecutor implements ProjectExecutor {
  public readonly backend = "local-static";

  public async execute(input: Parameters<ProjectExecutor["execute"]>[0]): Promise<ProjectExecution> {
    const executionId = `local-${randomUUID()}`;
    const policyStartedAt = Date.now();
    const safety = await scanWorkspace(input.workspace);
    const policyCheck = executionCheck({
      name: "local-static-policy",
      status: safety.passed && input.expectedPlan === "static-site" && safety.executionPlan === "static-site"
        ? "passed"
        : "failed",
      exitCode: safety.passed && input.expectedPlan === "static-site" && safety.executionPlan === "static-site" ? 0 : 1,
      durationMs: Date.now() - policyStartedAt,
      stdout: safety.passed
        ? "The local executor rescanned the generated workspace."
        : "The local executor rescanned the generated workspace and found a critical policy finding.",
      stderr: safety.passed && input.expectedPlan === "static-site" && safety.executionPlan === "static-site"
        ? ""
        : "Local execution accepts only safety-approved static-site artifacts.",
    });
    if (policyCheck.status === "failed") {
      return {
        backend: this.backend,
        executionId,
        result: executionResult({ checks: [policyCheck], detectedPort: null, passed: false }),
      };
    }

    const root = resolve(input.workspace);
    let server: Server | undefined;
    let detectedPort: number | null = null;
    const checks: ExecutionResult["checks"] = [
      policyCheck,
      executionCheck({
        name: "dependency-security",
        status: "passed",
        exitCode: 0,
        durationMs: 0,
        stdout: "No dependency installer, package script, or generated server code ran locally.",
        stderr: "",
      }),
      executionCheck({
        name: "tests",
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        stdout: "Static-site local execution does not run generated test code on the host.",
        stderr: "",
      }),
    ];

    try {
      const serverStartedAt = Date.now();
      server = createServer((request, response) => {
        void serveStaticRequest({ root, request, response });
      });
      detectedPort = await listen(server);
      checks.push(
        executionCheck({
          name: "local-static-server",
          status: "passed",
          exitCode: 0,
          durationMs: Date.now() - serverStartedAt,
          stdout: `Trusted loopback static server started on 127.0.0.1:${detectedPort}.`,
          stderr: "",
        }),
      );
      await input.onExecutionStarted?.({
        backend: this.backend,
        executionId,
        detectedPort,
      });

      const healthStartedAt = Date.now();
      const healthResponse = await fetch(`http://127.0.0.1:${detectedPort}/__sisyphus/health`, {
        signal: AbortSignal.timeout(4_000),
      });
      const healthBody = await healthResponse.text();
      if (!healthResponse.ok || healthBody !== "ok") {
        throw new Error("The trusted local server did not return its expected health response.");
      }
      const entryResponse = await fetch(`http://127.0.0.1:${detectedPort}/`, {
        signal: AbortSignal.timeout(4_000),
      });
      const entryBody = await entryResponse.text();
      const contentType = entryResponse.headers.get("content-type") ?? "";
      if (!entryResponse.ok || !contentType.includes("text/html") || !/<html\b/iu.test(entryBody)) {
        throw new Error("The local static server did not serve a valid HTML entry point.");
      }
      checks.push(
        executionCheck({
          name: "health-check",
          status: "passed",
          exitCode: 0,
          durationMs: Date.now() - healthStartedAt,
          stdout: "The trusted local server served the generated HTML entry point over loopback.",
          stderr: "",
        }),
      );
      return {
        backend: this.backend,
        executionId,
        result: executionResult({ checks, detectedPort, passed: true }),
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message.slice(0, 500) : "The local static executor failed unexpectedly.";
      checks.push(
        executionCheck({
          name: detectedPort === null ? "local-static-server" : "health-check",
          status: "failed",
          exitCode: 1,
          durationMs: 0,
          stdout: "",
          stderr: detail,
        }),
      );
      return {
        backend: this.backend,
        executionId,
        result: executionResult({ checks, detectedPort, passed: false }),
      };
    } finally {
      if (server !== undefined) {
        await close(server).catch(() => undefined);
      }
    }
  }
}

function executionResult(input: {
  readonly checks: ExecutionResult["checks"];
  readonly detectedPort: number | null;
  readonly passed: boolean;
}): ExecutionResult {
  return ExecutionResultSchema.parse({
    version: 1,
    passed: input.passed,
    detectedPort: input.detectedPort,
    checks: input.checks,
  });
}

function executionCheck(input: ExecutionResult["checks"][number]): ExecutionResult["checks"][number] {
  return input;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error: Error) => {
      rejectPromise(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPromise(new Error("The local static server did not return a TCP address."));
        return;
      }
      resolvePromise(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error === undefined) {
        resolvePromise();
        return;
      }
      rejectPromise(error);
    });
  });
}

async function serveStaticRequest(input: {
  readonly root: string;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
}): Promise<void> {
  const method = input.request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    writeResponse(input.response, 405, "text/plain; charset=utf-8", "Method not allowed.");
    return;
  }
  try {
    const url = new URL(input.request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__sisyphus/health") {
      writeResponse(input.response, 200, "text/plain; charset=utf-8", "ok", method === "HEAD");
      return;
    }
    const filePath = resolveStaticPath(input.root, url.pathname);
    if (filePath === undefined) {
      writeResponse(input.response, 404, "text/plain; charset=utf-8", "Not found.", method === "HEAD");
      return;
    }
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      writeResponse(input.response, 404, "text/plain; charset=utf-8", "Not found.", method === "HEAD");
      return;
    }
    const contentType = contentTypes.get(extname(filePath).toLowerCase());
    if (contentType === undefined) {
      writeResponse(input.response, 404, "text/plain; charset=utf-8", "Not found.", method === "HEAD");
      return;
    }
    const content = await readFile(filePath);
    writeResponse(input.response, 200, contentType, content, method === "HEAD");
  } catch {
    writeResponse(input.response, 404, "text/plain; charset=utf-8", "Not found.", method === "HEAD");
  }
}

function resolveStaticPath(root: string, pathname: string): string | undefined {
  const route = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  if (route.length === 0) return undefined;
  const candidate = resolve(root, route);
  const candidateRelative = relative(root, candidate);
  if (candidateRelative.length === 0 || candidateRelative.startsWith("..") || isAbsolute(candidateRelative)) {
    return undefined;
  }
  return candidate;
}

function writeResponse(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string | Uint8Array,
  headOnly = false,
): void {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  if (headOnly) {
    response.end();
    return;
  }
  response.end(body);
}
