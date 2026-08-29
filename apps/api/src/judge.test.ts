import {
  createEventId,
  createPolicyVersionId,
} from "@sisyphus/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAiResponsesJudgeProvider } from "./judge.js";

describe("OpenAiResponsesJudgeProvider", () => {
  it("uses stateless strict structured output", async () => {
    let requestBody: unknown;
    const provider = new OpenAiResponsesJudgeProvider({
      fetcher: async (_request, init) => {
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
