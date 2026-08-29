import { codexFailOpenResponse, type CodexHookResponse } from "./responses.js";
import { runCodexHook } from "./hook-runner.js";

const maximumInputBytes = 8 * 1024 * 1024;

function readStandardInput(): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = "";
    let settled = false;

    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
      action();
    }

    function onData(chunk: unknown): void {
      if (typeof chunk !== "string") {
        finish(() => reject(new Error("hook stdin was not UTF-8 text")));
        return;
      }
      input += chunk;
      if (Buffer.byteLength(input, "utf8") > maximumInputBytes) {
        process.stdin.pause();
        finish(() => reject(new Error("hook stdin exceeded the size limit")));
      }
    }

    function onEnd(): void {
      finish(() => resolve(input));
    }

    function onError(): void {
      finish(() => reject(new Error("hook stdin could not be read")));
    }

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}

function writeResponse(response: CodexHookResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function main(): Promise<void> {
  try {
    const source = await readStandardInput();
    const rawEvent: unknown = JSON.parse(source);
    const configuredEndpoint = process.env.SISYPHUS_WORKER_URL;
    const workerToken = process.env.SISYPHUS_HOOK_TOKEN;
    if (workerToken === undefined) throw new Error("hook credential is unavailable");
    const response = await runCodexHook(
      configuredEndpoint === undefined
        ? { rawEvent, workerToken }
        : { rawEvent, workerToken, workerEndpoint: configuredEndpoint },
    );
    writeResponse(response);
  } catch {
    writeResponse(codexFailOpenResponse());
  }
}

await main();
