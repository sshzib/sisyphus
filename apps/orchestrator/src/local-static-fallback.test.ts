import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createLocalStaticFallbackPlan,
  createLocalStaticFallbackProposal,
} from "./local-static-fallback.js";
import { LocalStaticExecutor } from "./local-static-executor.js";
import { scanWorkspace } from "./safety-gate.js";

test("creates and verifies a real static storefront when provider generation is unavailable", async () => {
  const request = "Build a bold mobile-ready landing page for the Zudio clothing shop with product discovery.";
  const plan = createLocalStaticFallbackPlan(request);
  const requirement = plan.requirements[0];
  assert.ok(requirement);
  const proposal = createLocalStaticFallbackProposal({
    request,
    requirement,
    iteration: 1,
  });
  const index = proposal.files[0];
  assert.ok(index);

  assert.deepEqual(
    proposal.files.map((file) => file.path),
    ["index.html", "styles.css", "script.js"],
  );
  assert.match(index.content, /Zudio/i);
  assert.match(index.content, /styles\.css/u);
  assert.match(index.content, /script\.js/u);

  const workspace = await mkdtemp(join(tmpdir(), "sisyphus-local-fallback-"));
  try {
    await Promise.all(
      proposal.files.map((file) => writeFile(join(workspace, file.path), file.content, "utf8")),
    );
    const safety = await scanWorkspace(workspace);
    assert.equal(safety.passed, true);
    assert.equal(safety.executionPlan, "static-site");

    const execution = await new LocalStaticExecutor().execute({
      taskId: "task-local-fallback",
      integrationCommit: "integration-local-fallback",
      workspace,
      expectedPlan: "static-site",
    });
    assert.equal(execution.result?.passed, true);
    assert.equal(
      execution.result?.checks.some((check) => check.name === "health-check" && check.status === "passed"),
      true,
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
