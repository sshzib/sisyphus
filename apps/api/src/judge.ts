import { createHash } from "node:crypto";
import {
  JudgeResultSchema,
  type JudgeResult,
  type PolicyVersionId,
  type RuntimeEventId,
} from "@sisyphus/domain";
import { z } from "zod";
import { canonicalJson } from "./canonical-json.js";

export interface JudgeProviderInput {
  apiKey: string;
  model: string;
  eventId: RuntimeEventId;
  policyVersionId: PolicyVersionId;
  redactedInput: string;
  signal: AbortSignal;
}

export interface JudgeProvider {
  judge(input: JudgeProviderInput): Promise<JudgeResult>;
}

export interface JudgeConfigurationStore {
  judgeProviderConfiguration(tenantId: string): Promise<
    | { apiKey: string; model: string }
    | undefined
  >;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const OpenAiResponseSchema = z
  .object({
    output_text: z.string().min(1),
  })
  .passthrough();

const judgeResultJsonSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "score"],
      properties: {
        kind: { type: "string", const: "pass" },
        score: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "score", "findings"],
      properties: {
        kind: { type: "string", const: "fail" },
        score: { type: "number", minimum: 0, maximum: 1 },
        findings: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["criterion", "message", "correction", "evidence"],
            properties: {
              criterion: { type: "string", minLength: 1 },
              message: { type: "string", minLength: 1 },
              correction: { type: "string", minLength: 1 },
              evidence: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "reason"],
      properties: {
        kind: { type: "string", const: "inconclusive" },
        reason: { type: "string", minLength: 1 },
      },
    },
  ],
} satisfies Record<string, unknown>;

export class OpenAiResponsesJudgeProvider implements JudgeProvider {
  readonly #fetcher: Fetcher;
  readonly #endpoint: string;

  public constructor(input?: { fetcher?: Fetcher; endpoint?: string }) {
    this.#fetcher = input?.fetcher ?? ((request, init) => globalThis.fetch(request, init));
    this.#endpoint = input?.endpoint ?? "https://api.openai.com/v1/responses";
  }

  public async judge(input: JudgeProviderInput): Promise<JudgeResult> {
    const response = await this.#fetcher(this.#endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: input.signal,
      body: JSON.stringify({
        model: input.model,
        store: false,
        max_output_tokens: 1400,
        instructions:
          "Grade the supplied coding-agent output. Score correctness, instruction compliance, completeness, verification evidence, and token efficiency. Cite only evidence present in the redacted input. Return inconclusive when the evidence cannot support a reliable grade.",
        input: input.redactedInput,
        text: {
          format: {
            type: "json_schema",
            name: "sisyphus_judge_result",
            strict: true,
            schema: judgeResultJsonSchema,
          },
          verbosity: "low",
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI Responses API returned HTTP ${response.status}.`);
    }
    const payload = OpenAiResponseSchema.parse(await response.json());
    const result: unknown = JSON.parse(payload.output_text);
    return JudgeResultSchema.parse(result);
  }
}

export class JudgeIdempotencyCollisionError extends Error {
  public constructor(eventId: string) {
    super(`Judge event ${eventId} was replayed with different input.`);
    this.name = "JudgeIdempotencyCollisionError";
  }
}

interface CachedJudgeRequest {
  digest: string;
  result: Promise<JudgeResult>;
}

export class JudgeBroker {
  readonly #cache = new Map<string, CachedJudgeRequest>();

  public constructor(
    private readonly store: JudgeConfigurationStore,
    private readonly provider: JudgeProvider,
    private readonly deadlineMs = 8000,
  ) {}

  public async judge(input: {
    tenantId: string;
    eventId: RuntimeEventId;
    policyVersionId: PolicyVersionId;
    redactedInput: string;
  }): Promise<JudgeResult> {
    const cacheKey = `${input.tenantId}\u0000${input.eventId}\u0000${input.policyVersionId}`;
    const digest = createHash("sha256")
      .update(canonicalJson({
        eventId: input.eventId,
        policyVersionId: input.policyVersionId,
        redactedInput: input.redactedInput,
      }))
      .digest("hex");
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) {
      if (cached.digest !== digest) {
        throw new JudgeIdempotencyCollisionError(input.eventId);
      }
      return cached.result;
    }

    const result = this.runJudge(input);
    this.#cache.set(cacheKey, { digest, result });
    return result;
  }

  private async runJudge(input: {
    tenantId: string;
    eventId: RuntimeEventId;
    policyVersionId: PolicyVersionId;
    redactedInput: string;
  }): Promise<JudgeResult> {
    const configuration = await this.store.judgeProviderConfiguration(input.tenantId);
    if (configuration === undefined) {
      return {
        kind: "inconclusive",
        reason: "No judge provider is configured for this tenant.",
      };
    }

    const abortController = new AbortController();
    let deadlineHandle: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<JudgeResult>((resolve) => {
      deadlineHandle = setTimeout(() => {
        abortController.abort();
        resolve({
          kind: "inconclusive",
          reason: "The judge provider exceeded the evaluation deadline.",
        });
      }, this.deadlineMs);
    });
    const providerResult = this.provider
      .judge({
        ...configuration,
        eventId: input.eventId,
        policyVersionId: input.policyVersionId,
        redactedInput: input.redactedInput,
        signal: abortController.signal,
      })
      .then((result) => JudgeResultSchema.parse(result))
      .catch((): JudgeResult => ({
        kind: "inconclusive",
        reason: "The judge provider was unavailable or returned an invalid result.",
      }));
    const result = await Promise.race([providerResult, deadline]);
    if (deadlineHandle !== undefined) {
      clearTimeout(deadlineHandle);
    }
    return JudgeResultSchema.parse(result);
  }
}
