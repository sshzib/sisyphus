import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CodexSupervisionEnvelopeSchema } from "../src/index.js";

const hookScript = fileURLToPath(
  new URL("../../../plugins/sisyphus-codex/scripts/hook.mjs", import.meta.url),
);
const promptFixture = readFileSync(
  new URL("./fixtures/user-prompt-submit.json", import.meta.url),
  "utf8",
);
const mcpConfiguration: unknown = JSON.parse(
  readFileSync(
    new URL("../../../plugins/sisyphus-codex/.mcp.json", import.meta.url),
    "utf8",
  ),
);

function runHook(input: string) {
  return spawnSync(process.execPath, [hookScript], {
    input,
    encoding: "utf8",
    env: { ...process.env, SISYPHUS_WORKER_URL: "http://127.0.0.1:1" },
    timeout: 10_000,
  });
}

describe("bundled Codex hook", () => {
  it("sources the MCP bearer credential from its dedicated environment variable", () => {
    expect(mcpConfiguration).toEqual({
      mcpServers: {
        sisyphus: {
          type: "http",
          url: "http://127.0.0.1:7331/mcp",
          bearer_token_env_var: "SISYPHUS_MCP_TOKEN",
        },
      },
    });
  });

  it("fails open without leaking the raw prompt when the worker is unavailable", () => {
    const result = runHook(promptFixture);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("failing parser test");
    const output: unknown = JSON.parse(result.stdout);
    expect(output).toEqual({
      systemMessage: "Sisyphus supervision was unavailable. Codex continued without evaluation.",
    });
  });

  it("returns valid fail-open JSON for malformed stdin", () => {
    const result = runHook("not-json");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("fails open silently when the hook credential is missing", () => {
    const result = spawnSync(process.execPath, [hookScript], {
      input: promptFixture,
      encoding: "utf8",
      env: { SISYPHUS_WORKER_URL: "http://127.0.0.1:7331" },
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("SISYPHUS_HOOK_TOKEN");
  });

  it("sends its dedicated bearer credential from the built hook artifact", async () => {
    const hookToken = "hook_token_0123456789abcdefghijklmnopqrstuvwxyz";
    let authorization = "";
    const server = createServer((request, response) => {
      authorization = request.headers.authorization ?? "";
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const decoded: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const envelope = CodexSupervisionEnvelopeSchema.parse(decoded);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            decision: {
              kind: "prompt-decision",
              eventId: envelope.eventId,
              enforcement: { kind: "enforced" },
              action: "continue",
              resolution: { kind: "none", candidates: [] },
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing port.");
    const child = spawn(process.execPath, [hookScript], {
      env: {
        ...process.env,
        SISYPHUS_HOOK_TOKEN: hookToken,
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
    child.stdin.end(promptFixture);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });

    expect(exitCode).toBe(0);
    expect(authorization).toBe(`Bearer ${hookToken}`);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ continue: true });
  }, 10_000);
});
