import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a worker smoke-test port."));
        return;
      }
      server.close((error) =>
        error === undefined ? resolvePort(address.port) : reject(error),
      );
    });
  });
}

async function defaultResourcesDirectory() {
  const desktopDirectory = resolve(import.meta.dirname, "..");
  const outputDirectory = resolve(desktopDirectory, "dist");
  if (process.platform === "win32") {
    return resolve(outputDirectory, "win-unpacked", "resources");
  }
  if (process.platform === "linux") {
    return resolve(outputDirectory, "linux-unpacked", "resources");
  }
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageDirectory = resolve(outputDirectory, entry.name);
    const packageEntries = await readdir(packageDirectory, { withFileTypes: true }).catch(
      () => [],
    );
    const application = packageEntries.find(
      (candidate) => candidate.isDirectory() && candidate.name.endsWith(".app"),
    );
    if (application !== undefined) {
      return resolve(packageDirectory, application.name, "Contents", "Resources");
    }
  }
  throw new Error("Could not locate the packaged macOS resources directory.");
}

async function waitForHealth(origin, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged worker exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return response.json();
    } catch {
      // The worker may still be opening SQLite and its loopback listener.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Packaged worker did not become healthy.");
}

const resourcesDirectory = resolve(
  argument("--resources") ?? (await defaultResourcesDirectory()),
);
const entrypoint = resolve(resourcesDirectory, "worker", "index.js");
await readFile(entrypoint);

const dataDirectory = await mkdtemp(resolve(tmpdir(), "sisyphus-packaged-worker-"));
const port = await freePort();
const hookToken = randomBytes(32).toString("base64url");
const mcpToken = randomBytes(32).toString("base64url");
const desktopToken = randomBytes(32).toString("base64url");
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name, value]) => !name.startsWith("SISYPHUS_") && value !== undefined,
  ),
);
const child = spawn(process.execPath, [entrypoint], {
  cwd: dirname(entrypoint),
  env: {
    ...inheritedEnvironment,
    SISYPHUS_DATA_DIR: dataDirectory,
    SISYPHUS_EVIDENCE_KEY: randomBytes(32).toString("base64url"),
    SISYPHUS_HOOK_TOKEN: hookToken,
    SISYPHUS_MCP_TOKEN: mcpToken,
    SISYPHUS_DESKTOP_TOKEN: desktopToken,
    SISYPHUS_WORKER_HOST: "127.0.0.1",
    SISYPHUS_WORKER_PORT: String(port),
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  const origin = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(origin, child);
  if (health?.status !== "ok" || health?.service !== "sisyphus-worker") {
    throw new Error("Packaged worker returned an invalid health contract.");
  }
  const unauthorized = await fetch(`${origin}/v1/evidence`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${randomBytes(32).toString("base64url")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ eventId: "packaged-worker-smoke" }),
  });
  if (unauthorized.status !== 401) {
    throw new Error(`Invalid desktop credential returned HTTP ${unauthorized.status}.`);
  }
  const authorized = await fetch(`${origin}/v1/evidence`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${desktopToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ eventId: "packaged-worker-smoke" }),
  });
  if (authorized.status !== 404) {
    throw new Error(`Authenticated evidence probe returned HTTP ${authorized.status}.`);
  }
  console.log(
    JSON.stringify({
      status: "ok",
      platform: process.platform,
      resourcesDirectory,
      workerVersion: health.version,
      evidenceAuthentication: "verified",
    }),
  );
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (child.exitCode !== 0 && child.exitCode !== null && stderr.trim() !== "") {
    process.stderr.write(stderr);
  }
}
