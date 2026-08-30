import assert from "node:assert/strict";
import test from "node:test";
import { fallbackPlanForSimpleWebRequest, OpenRouterClient } from "./openrouter.js";
import { validateWorkforceShape } from "./workforce-policy.js";

test("keeps review agents on their assigned reviewer model during retries", () => {
  const client = new OpenRouterClient(
    "test-key",
    "planner-model",
    "builder-fallback-model",
    {
      frontend: "frontend-model",
      "qa tester": "qa-reviewer-model",
    },
    12,
  );

  assert.equal(client.hasFallbackModel("frontend engineer"), true);
  assert.equal(client.modelForRole("frontend engineer", true), "builder-fallback-model");
  assert.equal(client.hasFallbackModel("qa tester"), false);
  assert.equal(client.modelForRole("qa tester", true), "qa-reviewer-model");
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
