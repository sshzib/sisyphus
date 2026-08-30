import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalStaticExecutor } from "./local-static-executor.js";

test("serves a safety-approved static entry point through loopback", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sisyphus-local-static-"));
  try {
    await writeFile(
      join(workspace, "index.html"),
      "<!doctype html><html lang=\"en\"><body><main><h1>Sisyphus</h1></main></body></html>",
      "utf8",
    );
    const execution = await new LocalStaticExecutor().execute({
      taskId: "task-local-static",
      integrationCommit: "integration-local-static",
      workspace,
      expectedPlan: "static-site",
    });

    assert.equal(execution.backend, "local-static");
    assert.equal(execution.result?.passed, true);
    assert.notEqual(execution.result?.detectedPort, null);
    assert.equal(
      execution.result?.checks.some(
        (check) => check.name === "health-check" && check.status === "passed",
      ),
      true,
    );
    assert.equal(
      execution.result?.checks.some(
        (check) => check.name === "tests" && check.status === "skipped",
      ),
      true,
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("refuses package execution in local static mode", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sisyphus-local-package-"));
  try {
    await writeFile(join(workspace, "package.json"), '{"scripts":{"build":"vite build"}}', "utf8");
    await writeFile(join(workspace, "package-lock.json"), '{"lockfileVersion":3}', "utf8");
    await writeFile(join(workspace, "index.html"), "<!doctype html><html><body></body></html>", "utf8");
    const execution = await new LocalStaticExecutor().execute({
      taskId: "task-local-package",
      integrationCommit: "integration-local-package",
      workspace,
      expectedPlan: "package",
    });

    assert.equal(execution.result?.passed, false);
    assert.equal(execution.result?.checks[0]?.name, "local-static-policy");
    assert.equal(execution.result?.checks[0]?.status, "failed");
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
