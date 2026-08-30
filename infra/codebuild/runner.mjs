import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const maximumOutput = 24_000;
const workspace = resolve(process.env.CODEBUILD_SRC_DIR ?? process.cwd());
const resultPath = "/tmp/sisyphus-sandbox-result.json";

const result = {
  version: 1,
  passed: false,
  detectedPort: null,
  checks: [],
};

try {
  const manifest = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
  const packageManager = await detectPackageManager();
  const scripts = manifest.scripts ?? {};

  await recordCommand("dependency-install", packageManager, installArguments(packageManager));
  if (scripts.build !== undefined) {
    await recordCommand("build", packageManager, ["run", "build"]);
  } else {
    recordSkipped("build", "No build script was declared.");
  }

  if (scripts.dev === undefined) {
    recordSkipped("development-server", "No dev script was declared.");
    recordSkipped("health-check", "No dev script was declared.");
  } else {
    const server = await startDevelopmentServer(packageManager);
    try {
      const port = await waitForHealthyPort(server);
      result.detectedPort = port;
      result.checks.push({
        name: "health-check",
        status: "passed",
        exitCode: 0,
        durationMs: 0,
        stdout: `HTTP health check passed on port ${port}.`,
        stderr: "",
      });
    } catch (error) {
      result.checks.push({
        name: "health-check",
        status: "failed",
        exitCode: null,
        durationMs: 0,
        stdout: clip(server.output()),
        stderr: clip(error instanceof Error ? error.message : "Development server health check failed."),
      });
    } finally {
      await stopProcess(server.child);
    }
  }

  if (scripts.test !== undefined) {
    await recordCommand("tests", packageManager, ["run", "test"]);
  } else {
    result.checks.push({
      name: "tests",
      status: "failed",
      exitCode: null,
      durationMs: 0,
      stdout: "",
      stderr: "No automated test script was declared; the acceptance pipeline requires tests.",
    });
  }
  if (scripts["test:integration"] !== undefined) {
    await recordCommand("integration-tests", packageManager, ["run", "test:integration"]);
  }
  if (scripts["test:e2e"] !== undefined) {
    await recordCommand("e2e-tests", packageManager, ["run", "test:e2e"]);
  }
  if (scripts.lint !== undefined) {
    await recordCommand("lint", packageManager, ["run", "lint"]);
  }
  if (scripts.typecheck !== undefined) {
    await recordCommand("typecheck", packageManager, ["run", "typecheck"]);
  }
  if (scripts.lint === undefined && scripts.typecheck === undefined) {
    recordSkipped("static-check", "No lint or typecheck script was declared.");
  }
  await recordCommand("dependency-security", packageManager, auditArguments(packageManager));
  result.passed = result.checks.every((check) => check.status !== "failed");
} catch (error) {
  result.checks.push({
    name: "sandbox-runner",
    status: "failed",
    exitCode: null,
    durationMs: 0,
    stdout: "",
    stderr: clip(error instanceof Error ? error.message : "The sandbox runner failed."),
  });
}

await writeFile(resultPath, JSON.stringify(result), "utf8");
await uploadResult();
process.exitCode = result.passed ? 0 : 1;

async function detectPackageManager() {
  try {
    await readFile(join(workspace, "pnpm-lock.yaml"));
    return "pnpm";
  } catch {
    return "npm";
  }
}

function installArguments(packageManager) {
  return packageManager === "pnpm"
    ? ["install", "--frozen-lockfile", "--ignore-scripts"]
    : ["ci", "--ignore-scripts"];
}

function auditArguments(packageManager) {
  return packageManager === "pnpm"
    ? ["audit", "--prod", "--audit-level", "high"]
    : ["audit", "--omit=dev", "--audit-level=high"];
}

async function recordCommand(name, command, args) {
  const startedAt = Date.now();
  const outcome = await run(command, args, { cwd: workspace });
  result.checks.push({
    name,
    status: outcome.exitCode === 0 ? "passed" : "failed",
    exitCode: outcome.exitCode,
    durationMs: Date.now() - startedAt,
    stdout: clip(outcome.stdout),
    stderr: clip(outcome.stderr),
  });
}

function recordSkipped(name, detail) {
  result.checks.push({
    name,
    status: "skipped",
    exitCode: null,
    durationMs: 0,
    stdout: detail,
    stderr: "",
  });
}

async function startDevelopmentServer(packageManager) {
  const child = spawn(packageManager, ["run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: workspace,
    detached: process.platform !== "win32",
    env: safeEnvironment(),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = clip(`${output}${chunk}`); });
  child.stderr.on("data", (chunk) => { output = clip(`${output}${chunk}`); });
  return { child, output: () => output };
}

async function waitForHealthyPort(server) {
  const deadline = Date.now() + 30_000;
  const checked = new Set();
  while (Date.now() < deadline) {
    const ports = [...server.output().matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\s)(\d{2,5})/gu)]
      .map((match) => Number(match[1]))
      .filter((port) => Number.isInteger(port) && port > 0 && port < 65_536);
    for (const port of ports) {
      if (checked.has(port)) continue;
      checked.add(port);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) });
        if (response.status >= 200 && response.status < 500) return port;
      } catch {
        checked.delete(port);
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error("The development server did not expose a healthy detected port within 30 seconds.");
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
}

function run(command, args, options) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      ...options,
      env: safeEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = clip(`${stdout}${chunk}`); });
    child.stderr.on("data", (chunk) => { stderr = clip(`${stderr}${chunk}`); });
    child.once("error", (error) => resolvePromise({ exitCode: null, stdout, stderr: error.message }));
    child.once("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}

async function uploadResult() {
  const bucket = requiredEnvironment("SISYPHUS_RESULT_BUCKET");
  const key = requiredEnvironment("SISYPHUS_RESULT_KEY");
  const target = `s3://${bucket}/${key}`;
  const outcome = await run("aws", ["s3", "cp", resultPath, target, "--only-show-errors"], { cwd: workspace });
  if (outcome.exitCode !== 0) {
    process.stderr.write(`Sisyphus result upload failed: ${clip(outcome.stderr)}\n`);
    process.exitCode = 1;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required by the trusted sandbox runner.`);
  return value;
}

function safeEnvironment() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "/tmp",
    CI: "true",
    npm_config_ignore_scripts: "true",
    NO_COLOR: "1",
  };
}

function clip(value) {
  return redact(value).slice(-maximumOutput);
}

function redact(value) {
  return value.replace(/(?:AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{20,})/gu, "[REDACTED]");
}
