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

test("uses only the guarded local static executor when AWS is not configured", () => {
  const configuration = parseOrchestratorConfiguration(environment());
  assert.equal(configuration.codebuild, undefined);
});

test("requires a complete CodeBuild configuration only when CodeBuild is selected", () => {
  assert.throws(() =>
    parseOrchestratorConfiguration(
      environment({ SISYPHUS_EXECUTION_MODE: "codebuild" }),
    ),
  );
});

test("enables both local static and CodeBuild execution when AWS is configured", () => {
  const configuration = parseOrchestratorConfiguration(
    environment({
      AWS_REGION: "ap-south-1",
      SISYPHUS_CODEBUILD_PROJECT: "sisyphus-sandbox",
      SISYPHUS_ARTIFACT_BUCKET: "sisyphus-artifacts",
    }),
  );
  assert.deepEqual(configuration.codebuild, {
    kind: "codebuild",
    region: "ap-south-1",
    projectName: "sisyphus-sandbox",
    artifactBucket: "sisyphus-artifacts",
    inputPrefix: "engineering/input",
    resultPrefix: "engineering/results",
  });
});
