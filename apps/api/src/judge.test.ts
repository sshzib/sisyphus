import {
  createEventId,
  createPolicyVersionId,
} from "@sisyphus/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  JudgeBroker,
  type JudgeProvider,
  OpenAiResponsesJudgeProvider,
} from "./judge.js";
import { createInMemoryRepository } from "./repository.js";

describe("OpenAiResponsesJudgeProvider", () => {
  it("refuses to send provider keys over remote plaintext HTTP", () => {
    expect(
      () =>
        new OpenAiResponsesJudgeProvider({
          endpoint: "http://judge.example.test/v1/responses",
        }),
    ).toThrow(/HTTPS/u);
  });

  it("uses stateless strict structured output", async () => {
    let requestBody: unknown;
    const provider = new OpenAiResponsesJudgeProvider({
      fetcher: async (_request, init) => {
        expect(init?.redirect).toBe("error");
        if (typeof init?.body === "string") {
          requestBody = JSON.parse(init.body);
        }
        return new Response(
          JSON.stringify({ output_text: JSON.stringify({ kind: "pass", score: 0.88 }) }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const result = await provider.judge({
      apiKey: "sk-test-provider-key-abcdefghijklmnopqrstuvwxyz",
      model: "gpt-5-mini",
      eventId: createEventId("judge-provider-event"),
      policyVersionId: createPolicyVersionId("policy-v1"),
      redactedInput: "The output includes passing test evidence.",
      signal: new AbortController().signal,
    });

    const RequestSchema = z
      .object({
        model: z.literal("gpt-5-mini"),
        store: z.literal(false),
        input: z.string(),
        text: z
          .object({
            format: z
              .object({
                type: z.literal("json_schema"),
                name: z.literal("sisyphus_judge_result"),
                strict: z.literal(true),
                schema: z.record(z.string(), z.unknown()),
              })
              .strict(),
            verbosity: z.literal("low"),
          })
          .strict(),
      })
      .passthrough();
    const parsedRequest = RequestSchema.parse(requestBody);
    expect(parsedRequest.store).toBe(false);
    expect(parsedRequest.text.format.strict).toBe(true);
    expect(result).toEqual({ kind: "pass", score: 0.88 });
  });
});

describe("JudgeBroker persistence boundary", () => {
  it("deduplicates across broker instances and detects changed input", async () => {
    const repository = createInMemoryRepository();
    await repository.configureJudgeProvider({
      tenantId: "tenant-acme",
      apiKey: "sk-test-persisted-provider-key-abcdefghijklmnopqrstuvwxyz",
      model: "gpt-5-mini",
    });
    let calls = 0;
    const provider: JudgeProvider = {
      async judge() {
        calls += 1;
        return { kind: "pass", score: 0.91 };
      },
    };
    const firstBroker = new JudgeBroker(repository, provider, 100);
    const secondBroker = new JudgeBroker(repository, provider, 100);
    const request = {
      tenantId: "tenant-acme",
      eventId: createEventId("judge-persisted-event"),
      policyVersionId: createPolicyVersionId("policy-persisted-v1"),
      redactedInput: "Typecheck and the integration fixture passed.",
    };

    await expect(firstBroker.judge(request)).resolves.toEqual({
      kind: "pass",
      score: 0.91,
    });
    await expect(secondBroker.judge(request)).resolves.toEqual({
      kind: "pass",
      score: 0.91,
    });
    await expect(
      secondBroker.judge({
        ...request,
        redactedInput: "A different redacted input was replayed.",
      }),
    ).rejects.toThrow(/replayed with different input/u);
    expect(calls).toBe(1);
  });
});
