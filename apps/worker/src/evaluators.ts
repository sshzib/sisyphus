import { spawn } from "node:child_process";

import { z } from "zod";

import type {
  DeterministicCheckResult,
  EvaluationFinding,
} from "@sisyphus/domain";
import type { DeterministicEvaluator, EvaluationInput } from "@sisyphus/kernel";

export const CommandEvaluatorInputSchema = z.object({
  id: z.string().trim().min(1),
  executable: z.string().trim().min(1),
  arguments: z.array(z.string()),
  workingDirectory: z.string().trim().min(1),
  timeoutMilliseconds: z.number().int().positive().max(10 * 60_000),
  maximumEvidenceCharacters: z.number().int().positive().max(64_000).optional(),
});

export type CommandEvaluatorInput = z.input<typeof CommandEvaluatorInputSchema>;

interface CommandOutcome {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
  readonly timedOut: boolean;
  readonly startError?: string;
}

const subprocessEnvironmentKeys = [
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
] as const;

function subprocessEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of subprocessEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function clipped(input: string, maximumCharacters: number): string {
  const characters = Array.from(input.trim());
  if (characters.length <= maximumCharacters) return characters.join("");
  return `${characters.slice(0, maximumCharacters - 2).join("")} …`;
}

async function runCommand(
  input: z.output<typeof CommandEvaluatorInputSchema>,
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const child = spawn(input.executable, input.arguments, {
      cwd: input.workingDirectory,
      env: subprocessEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    let startError: string | undefined;
    const append = (chunk: Buffer): void => {
      if (output.length < 128_000) output += chunk.toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => {
      startError = error.message;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMilliseconds);
    timeout.unref();
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        signal,
        output,
        timedOut,
        ...(startError === undefined ? {} : { startError }),
      });
    });
  });
}

export class CommandEvaluator implements DeterministicEvaluator {
  readonly id: string;
  readonly #input: z.output<typeof CommandEvaluatorInputSchema>;

  constructor(input: CommandEvaluatorInput) {
    this.#input = CommandEvaluatorInputSchema.parse(input);
    this.id = this.#input.id;
  }

  async evaluate(_input: EvaluationInput): Promise<DeterministicCheckResult> {
    const outcome = await runCommand(this.#input);
    if (outcome.exitCode === 0 && !outcome.timedOut && outcome.startError === undefined) {
      return { kind: "pass", checkId: this.id };
    }
    const reason = outcome.timedOut
      ? `timed out after ${this.#input.timeoutMilliseconds} ms`
      : outcome.startError ??
        `exited with ${outcome.exitCode ?? outcome.signal ?? "an unknown failure"}`;
    const evidence = clipped(
      outcome.output === "" ? reason : `${reason}\n${outcome.output}`,
      this.#input.maximumEvidenceCharacters ?? 8_000,
    );
    return {
      kind: "fail",
      checkId: this.id,
      findings: [
        {
          criterion: this.id,
          message: `Configured ${this.id} check ${reason}.`,
          correction: `Fix the reported ${this.id} failures and rerun the check.`,
          evidence: [evidence],
        },
      ],
    };
  }
}

export const CompletionGuardInputSchema = z.object({
  maximumOutputTokens: z.number().int().positive().optional(),
  requiredEvidencePatterns: z.array(z.string().trim().min(1)).default([]),
});

export type CompletionGuardInput = z.input<typeof CompletionGuardInputSchema>;

export class CompletionGuardEvaluator implements DeterministicEvaluator {
  readonly id = "completion-guards";
  readonly #input: z.output<typeof CompletionGuardInputSchema>;

  constructor(input: CompletionGuardInput) {
    this.#input = CompletionGuardInputSchema.parse(input);
  }

  async evaluate(input: EvaluationInput): Promise<DeterministicCheckResult> {
    const findings: EvaluationFinding[] = [];
    if (input.observation.output.trim() === "") {
      findings.push({
        criterion: "nonempty-output",
        message: "The agent completed without an output.",
        correction: "Return a concrete completion summary and verification evidence.",
        evidence: [],
      });
    }
    if (
      this.#input.maximumOutputTokens !== undefined &&
      input.observation.tokenUsage.kind !== "unavailable" &&
      input.observation.tokenUsage.outputTokens > this.#input.maximumOutputTokens
    ) {
      findings.push({
        criterion: "output-token-limit",
        message: `Output used ${input.observation.tokenUsage.outputTokens} tokens; the limit is ${this.#input.maximumOutputTokens}.`,
        correction: "Remove redundant output while preserving the required result and evidence.",
        evidence: [`reported output tokens: ${input.observation.tokenUsage.outputTokens}`],
      });
    }
    const normalizedOutput = input.observation.output.toLocaleLowerCase("en");
    for (const pattern of this.#input.requiredEvidencePatterns) {
      if (normalizedOutput.includes(pattern.toLocaleLowerCase("en"))) continue;
      findings.push({
        criterion: "verification-evidence",
        message: `Completion did not contain required evidence: ${pattern}.`,
        correction: `Run the verification and include evidence matching "${pattern}".`,
        evidence: [],
      });
    }
    if (findings.length === 0) return { kind: "pass", checkId: this.id };
    return { kind: "fail", checkId: this.id, findings };
  }
}
