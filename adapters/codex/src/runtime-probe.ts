import { execFile } from "node:child_process";

import { z } from "zod";

const ConcreteCodexVersionSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u, {
    message: "a concrete Codex runtime version is required",
  });

export type CodexVersionCommand = (
  command: string,
  arguments_: readonly string[],
) => Promise<{ readonly stdout: string }>;

export type CodexRuntimeVersionProbeInput = {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly execute?: CodexVersionCommand;
  readonly platform?: NodeJS.Platform;
};

function executeVersionCommand(
  command: string,
  arguments_: readonly string[],
): Promise<{ readonly stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...arguments_],
      { encoding: "utf8", timeout: 2_000, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          reject(new Error("Codex runtime version probe failed.", { cause: error }));
          return;
        }
        resolve({ stdout });
      },
    );
  });
}

function concreteVersion(input: string): string {
  if (input.trim().toLowerCase() === "unknown") {
    throw new Error("A concrete Codex runtime version is required.");
  }
  return ConcreteCodexVersionSchema.parse(input);
}

export async function probeCodexRuntimeVersion(
  input: CodexRuntimeVersionProbeInput = {},
): Promise<string> {
  const environment = input.environment ?? process.env;
  const configured =
    environment["SISYPHUS_CODEX_RUNTIME_VERSION"] ??
    environment["CODEX_CLI_VERSION"] ??
    environment["CODEX_VERSION"];
  if (configured !== undefined) return concreteVersion(configured);

  const platform = input.platform ?? process.platform;
  const command =
    platform === "win32"
      ? environment["ComSpec"] ?? environment["COMSPEC"] ?? "cmd.exe"
      : "codex";
  const arguments_ =
    platform === "win32"
      ? ["/d", "/s", "/c", "codex --version"]
      : ["--version"];
  const result = await (input.execute ?? executeVersionCommand)(
    command,
    arguments_,
  );
  const match = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/u.exec(
    result.stdout.trim(),
  );
  if (match?.[1] === undefined) {
    throw new Error("Codex runtime probe did not return versioned output.");
  }
  return concreteVersion(match[1]);
}
