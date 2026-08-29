import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createWorkerApplication } from "./application.js";
import { loadWorkerConfiguration } from "./config.js";
import { EnvironmentDeviceKeyProvider } from "./device-key.js";

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : "unknown worker error";
}

const bootstrapSecretNames = [
  "SISYPHUS_DEVICE_TOKEN",
  "SISYPHUS_DESKTOP_TOKEN",
  "SISYPHUS_EVIDENCE_KEY",
  "SISYPHUS_HOOK_TOKEN",
  "SISYPHUS_MCP_TOKEN",
] as const;

function scrubProcessBootstrapSecrets(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment !== process.env) return;
  for (const name of bootstrapSecretNames) delete process.env[name];
}

export async function main(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const configuration = await loadWorkerConfiguration({ environment });
  const evidenceKey = await new EnvironmentDeviceKeyProvider({ environment }).load();
  scrubProcessBootstrapSecrets(environment);
  const application = await createWorkerApplication({
    configuration,
    evidenceKey,
    onError: (error) => console.error(`Sisyphus supervision error: ${errorSummary(error)}`),
  });
  const preparation = await application.prepare();
  if (preparation.kind === "restored") {
    console.error(
      `Sisyphus policy refresh deferred; using the verified stored bundle: ${preparation.reason}`,
    );
  }
  application.server.listen(configuration.port, configuration.host);
  await once(application.server, "listening");
  console.error(
    `Sisyphus worker listening on http://${configuration.host}:${configuration.port}`,
  );

  let synchronizationActive = false;
  const synchronize = async (): Promise<void> => {
    if (synchronizationActive) return;
    synchronizationActive = true;
    try {
      await application.synchronize();
    } catch (error: unknown) {
      console.error(`Sisyphus synchronization deferred: ${errorSummary(error)}`);
    } finally {
      synchronizationActive = false;
    }
  };
  void synchronize();
  const interval = setInterval(() => void synchronize(), 30_000);
  interval.unref();

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    clearInterval(interval);
    try {
      await application.close();
    } catch (error: unknown) {
      process.exitCode = 1;
      console.error(`Sisyphus shutdown error: ${errorSummary(error)}`);
    }
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}

export * from "./application.js";
export * from "./config.js";
export * from "./evaluators.js";
export * from "./hosted-judge.js";
export * from "./policy.js";
export * from "./supervisor.js";
