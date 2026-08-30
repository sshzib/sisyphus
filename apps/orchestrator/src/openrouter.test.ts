import assert from "node:assert/strict";
import test from "node:test";
import { createOpenRouterTierPolicy, modelForTierPlan } from "./model-tier-policy.js";
import { fallbackPlanForSimpleWebRequest, OpenRouterClient } from "./openrouter.js";
import { validateWorkforceShape } from "./workforce-policy.js";

test("keeps review agents on their assigned reviewer model during retries", () => {
  const client = new OpenRouterClient(
    "test-key",
    createOpenRouterTierPolicy({
      plannerModel: "planner-model",
      specialistModel: "builder-fallback-model",
      roleModels: {
        frontend: "frontend-model",
        "qa tester": "qa-reviewer-model",
      },
    }),
    12,
  );

  assert.equal(client.hasFallbackModel({ modelTier: "low", role: "frontend engineer" }), true);
  assert.equal(
    client.modelForRole({ modelTier: "low", role: "frontend engineer", reassigned: true }),
    "planner-model",
  );
  assert.equal(client.hasFallbackModel({ modelTier: "low", role: "qa tester" }), false);
  assert.equal(
    client.modelForRole({ modelTier: "low", role: "qa tester", reassigned: true }),
    "qa-reviewer-model",
  );
});

test("routes every tier to its intended planner and specialist models", () => {
  const policy = createOpenRouterTierPolicy({
    plannerModel: undefined,
    specialistModel: undefined,
    roleModels: {},
  });
  const client = new OpenRouterClient(
    "test-key",
    policy,
    12,
  );

  assert.equal(
    modelForTierPlan({ policy, modelTier: "high", retry: false }),
    "z-ai/glm-5.3",
  );
  assert.equal(
    modelForTierPlan({ policy, modelTier: "high", retry: true }),
    "moonshotai/kimi-k2.7-code",
  );
  assert.equal(
    client.modelForRole({ modelTier: "low", role: "frontend engineer" }),
    "qwen/qwen3.7-flash",
  );
  assert.equal(
    client.modelForRole({ modelTier: "medium", role: "system architect" }),
    "google/gemini-2.5-flash",
  );
  assert.equal(
    client.modelForRole({ modelTier: "high", role: "backend engineer" }),
    "moonshotai/kimi-k2.7-code",
  );
  assert.equal(
    client.modelForRole({ modelTier: "high", role: "qa tester" }),
    "z-ai/glm-5.3",
  );
  assert.equal(
    client.modelForRole({ modelTier: "max", role: "frontend engineer" }),
    "anthropic/claude-sonnet-5",
  );
  assert.equal(
    client.modelForRole({ modelTier: "max", role: "security reviewer" }),
    "anthropic/claude-opus-5",
  );
});

test("falls back to one frontend owner for a simple landing page when a planner output remains invalid", () => {
  const plan = fallbackPlanForSimpleWebRequest(
    "Build a polished interactive landing page for Spotify.",
    12,
  );

  assert.ok(plan);
  assert.deepEqual(
    plan.requirements.map((requirement) => requirement.specialistRole),
    ["frontend", "design reviewer", "qa tester"],
  );
  assert.doesNotThrow(() => validateWorkforceShape(plan.requirements));
  assert.equal(
    fallbackPlanForSimpleWebRequest("Build a web app with a backend API and database persistence.", 12),
    undefined,
  );
});
