import {
  DeterministicCheckResultSchema,
  JudgeResultSchema,
  type EvaluationAssessment,
  type EvaluationConstraint,
  type EvaluationFinding,
  type JudgeResult,
  type StopObservation,
} from "@sisyphus/domain";

import type { DeterministicEvaluator, EvaluationJudge } from "./ports.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown evaluator error";
}

export class EvaluationEngine {
  readonly #deterministicEvaluators: readonly DeterministicEvaluator[];
  readonly #judge: EvaluationJudge | undefined;
  readonly #judgeTimeoutMs: number;

  constructor(input: {
    readonly deterministicEvaluators?: readonly DeterministicEvaluator[] | undefined;
    readonly judge?: EvaluationJudge | undefined;
    readonly judgeTimeoutMs?: number | undefined;
  }) {
    this.#deterministicEvaluators = input.deterministicEvaluators ?? [];
    this.#judge = input.judge;
    this.#judgeTimeoutMs = input.judgeTimeoutMs ?? 8_000;
    if (!Number.isFinite(this.#judgeTimeoutMs) || this.#judgeTimeoutMs <= 0) {
      throw new Error("judgeTimeoutMs must be a positive finite number");
    }
  }

  async evaluate(
    observation: StopObservation,
    constraint: EvaluationConstraint,
  ): Promise<EvaluationAssessment> {
    if (
      observation.output.trim() === "" &&
      observation.capabilities.localEvidenceAccess.kind !== "supported"
    ) {
      return {
        kind: "inconclusive",
        reason: "runtime did not provide completion output evidence",
      };
    }
    const findings: EvaluationFinding[] = [];
    for (const evaluator of this.#deterministicEvaluators) {
      try {
        const result = DeterministicCheckResultSchema.parse(
          await evaluator.evaluate({ observation, constraint }),
        );
        if (result.checkId !== evaluator.id) {
          return {
            kind: "inconclusive",
            reason: `deterministic evaluator ${evaluator.id} returned result for ${result.checkId}`,
          };
        }
        if (result.kind === "fail") findings.push(...result.findings);
      } catch (error: unknown) {
        return {
          kind: "inconclusive",
          reason: `deterministic evaluator ${evaluator.id} failed: ${errorMessage(error)}`,
        };
      }
    }

    if (findings.length > 0) return { kind: "fail", findings };
    if (this.#judge === undefined) return { kind: "pass" };

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<{ readonly kind: "timeout" }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), this.#judgeTimeoutMs);
      });
      const judge = this.#judge;
      const evaluation = judge
        .evaluate({ observation, constraint })
        .then((result): { readonly kind: "result"; readonly result: JudgeResult } => ({
          kind: "result",
          result,
        }));
      const invocation = await Promise.race([evaluation, timeout]);
      if (invocation.kind === "timeout") {
        return {
          kind: "inconclusive",
          reason: `judge exceeded ${this.#judgeTimeoutMs}ms deadline`,
        };
      }
      const result = JudgeResultSchema.parse(
        invocation.result,
      );
      switch (result.kind) {
        case "pass":
          return { kind: "pass", score: result.score };
        case "fail":
          return { kind: "fail", findings: result.findings, score: result.score };
        case "inconclusive":
          return { kind: "inconclusive", reason: result.reason };
        case "late":
          return {
            kind: "inconclusive",
            reason: "judge result arrived after the deadline",
            advisory: {
              receivedAt: result.receivedAt,
              result: result.advisory,
            },
          };
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    } catch (error: unknown) {
      return { kind: "inconclusive", reason: `judge failed: ${errorMessage(error)}` };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }
}
