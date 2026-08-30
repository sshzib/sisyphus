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

test("uses the fixed tier policy when only an OpenRouter key is configured", () => {
  const configuration = parseOrchestratorConfiguration(
    environment({ SISYPHUS_OPENROUTER_API_KEY: "o".repeat(20) }),
  );
  if (configuration.openRouter.kind !== "enabled") {
    throw new Error("OpenRouter should be enabled when its API key is configured.");
  }

  assert.equal(configuration.openRouter.tierPolicy.low.plannerModel, "deepseek/deepseek-v4-flash");
  assert.equal(configuration.openRouter.tierPolicy.high.specialistModel, "moonshotai/kimi-k2.7-code");
  assert.equal(configuration.openRouter.tierPolicy.max.plannerModel, "anthropic/claude-opus-5");
});

test("keeps legacy OpenRouter settings as Low-tier overrides", () => {
  const configuration = parseOrchestratorConfiguration(
    environment({
      SISYPHUS_OPENROUTER_API_KEY: "o".repeat(20),
      SISYPHUS_OPENROUTER_MODEL: "legacy-planner",
      SISYPHUS_OPENROUTER_FALLBACK_MODEL: "legacy-specialist",
      SISYPHUS_OPENROUTER_ROLE_MODELS: '{"frontend":"legacy-frontend"}',
    }),
  );
  if (configuration.openRouter.kind !== "enabled") {
    throw new Error("OpenRouter should be enabled when its API key is configured.");
  }

  assert.equal(configuration.openRouter.tierPolicy.low.plannerModel, "legacy-planner");
  assert.equal(configuration.openRouter.tierPolicy.low.specialistModel, "legacy-specialist");
  assert.equal(configuration.openRouter.tierPolicy.low.roleModels.frontend, "legacy-frontend");
  assert.equal(configuration.openRouter.tierPolicy.medium.plannerModel, "google/gemini-2.5-flash");
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
