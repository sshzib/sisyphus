import { parseOrchestratorConfiguration } from "./config.js";
import { EngineeringOrchestrator } from "./orchestrator.js";

const configuration = parseOrchestratorConfiguration(process.env);
const orchestrator = new EngineeringOrchestrator(configuration);

let stopping = false;

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      const worked = await orchestrator.runOnce();
      if (!worked) await wait(configuration.pollMilliseconds);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown orchestrator failure.";
      process.stderr.write(`Sisyphus engineering orchestrator: ${message}\n`);
      await wait(configuration.pollMilliseconds);
    }
  }
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

await loop();

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
