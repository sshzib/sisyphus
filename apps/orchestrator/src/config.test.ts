import assert from "node:assert/strict";
import test from "node:test";
import { parseOrchestratorConfiguration } from "./config.js";

function environment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    SISYPHUS_API_URL: "http://127.0.0.1:7330",
    SISYPHUS_ORCHESTRATOR_TOKEN: "a".repeat(32),
    SISYPHUS_ORCHESTRATOR_TENANT_ID: "tenant-local",
    ...overrides,
  };
}

test("uses guarded local static execution when an execution backend is not configured", () => {
  const configuration = parseOrchestratorConfiguration(environment());
  assert.deepEqual(configuration.execution, { kind: "local-static" });
});

test("requires a complete CodeBuild configuration only when CodeBuild is selected", () => {
  assert.throws(() =>
    parseOrchestratorConfiguration(
      environment({ SISYPHUS_EXECUTION_MODE: "codebuild" }),
    ),
  );
});
