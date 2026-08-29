import { JudgeResultSchema, type JudgeResult } from "@sisyphus/domain";
import type { EvaluationInput, EvaluationJudge } from "@sisyphus/kernel";
import { z } from "zod";

import { redactEvidence } from "./redaction.js";
import { controlPlaneEndpoint } from "./control-plane-endpoint.js";

const HostedJudgeInputSchema = z.object({
  endpoint: z.string().url(),
  deviceToken: z.string().trim().min(1),
  timeoutMilliseconds: z.number().int().min(100).max(120_000),
  maximumInputCharacters: z.number().int().positive().max(128_000).optional(),
});

type HostedJudgeInput = z.input<typeof HostedJudgeInputSchema> & {
  readonly fetchImplementation?: typeof fetch;
};

function judgeUrl(endpoint: string): URL {
  return controlPlaneEndpoint({
    baseUrl: endpoint,
    pathname: "/v1/judge",
    purpose: "Hosted judge endpoint",
  });
}

export class HostedJudge implements EvaluationJudge {
  readonly #endpoint: URL;
  readonly #deviceToken: string;
  readonly #timeoutMilliseconds: number;
  readonly #maximumInputCharacters: number;
  readonly #fetch: typeof fetch;

  constructor(input: HostedJudgeInput) {
    const parsed = HostedJudgeInputSchema.parse(input);
    this.#endpoint = judgeUrl(parsed.endpoint);
    this.#deviceToken = parsed.deviceToken;
    this.#timeoutMilliseconds = parsed.timeoutMilliseconds;
    this.#maximumInputCharacters = parsed.maximumInputCharacters ?? 32_000;
    this.#fetch = input.fetchImplementation ?? fetch;
  }

  async evaluate(input: EvaluationInput): Promise<JudgeResult> {
    const redacted = redactEvidence({
      source: JSON.stringify({
        observation: input.observation,
        constraint: input.constraint,
      }),
      maximumCharacters: this.#maximumInputCharacters,
    });
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.#deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        eventId: input.observation.eventId,
        policyVersionId: input.constraint.policyVersionId,
        redactedInput: redacted.text,
      }),
      signal: AbortSignal.timeout(this.#timeoutMilliseconds),
    });
    if (!response.ok) {
      throw new Error(`Hosted judge returned HTTP ${response.status}.`);
    }
    return JudgeResultSchema.parse(await response.json());
  }
}
