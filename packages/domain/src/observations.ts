import { z } from "zod";

import { SkillAttributionSchema } from "./attribution.js";
import { RuntimeCapabilitySnapshotSchema } from "./capabilities.js";
import {
  AdapterVersionSchema,
  AgentIdSchema,
  RunIdSchema,
  RuntimeEventIdSchema,
  SessionIdSchema,
  TimestampSchema,
  ToolCallIdSchema,
  WorkItemIdSchema,
} from "./identifiers.js";

export const RuntimeIdentitySchema = z
  .object({
    sessionId: SessionIdSchema,
    agent: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("root"), agentId: AgentIdSchema }).strict(),
      z
        .object({
          kind: z.literal("subagent"),
          agentId: AgentIdSchema,
          parentAgentId: AgentIdSchema,
        })
        .strict(),
    ]),
  })
  .strict();
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

export const TokenUsageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reported"),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("estimated"),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      tokenizer: z.string().trim().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

const observationBase = {
  eventId: RuntimeEventIdSchema,
  workItemId: WorkItemIdSchema,
  runId: RunIdSchema,
  occurredAt: TimestampSchema,
  adapterVersion: AdapterVersionSchema,
  capabilities: RuntimeCapabilitySnapshotSchema,
  identity: RuntimeIdentitySchema,
};

export const PromptObservationSchema = z.object({
  kind: z.literal("prompt"),
  ...observationBase,
  prompt: z.string().min(1),
});
export type PromptObservation = z.infer<typeof PromptObservationSchema>;

export const ToolRequestObservationSchema = z.object({
  kind: z.literal("tool-request"),
  ...observationBase,
  toolCallId: ToolCallIdSchema,
  toolName: z.string().trim().min(1),
  input: z.record(z.string(), z.unknown()),
});
export type ToolRequestObservation = z.infer<typeof ToolRequestObservationSchema>;

export const ToolResultObservationSchema = z.object({
  kind: z.literal("tool-result"),
  ...observationBase,
  toolCallId: ToolCallIdSchema,
  toolName: z.string().trim().min(1),
  outcome: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("succeeded"), summary: z.string() }),
    z.object({ kind: z.literal("failed"), summary: z.string() }),
  ]),
});
export type ToolResultObservation = z.infer<typeof ToolResultObservationSchema>;

export const RootStopObservationSchema = z.object({
  kind: z.literal("root-stop"),
  ...observationBase,
  output: z.string(),
  attribution: SkillAttributionSchema,
  tokenUsage: TokenUsageSchema,
});
export type RootStopObservation = z.infer<typeof RootStopObservationSchema>;

export const SubagentStopObservationSchema = z.object({
  kind: z.literal("subagent-stop"),
  ...observationBase,
  output: z.string(),
  attribution: SkillAttributionSchema,
  tokenUsage: TokenUsageSchema,
});
export type SubagentStopObservation = z.infer<typeof SubagentStopObservationSchema>;

export const HookObservationSchema = z.discriminatedUnion("kind", [
  PromptObservationSchema,
  ToolRequestObservationSchema,
  ToolResultObservationSchema,
  RootStopObservationSchema,
  SubagentStopObservationSchema,
]);
export type HookObservation = z.infer<typeof HookObservationSchema>;
export type StopObservation = RootStopObservation | SubagentStopObservation;

export function parseHookObservation(input: unknown): HookObservation {
  return HookObservationSchema.parse(input);
}

export const createHookObservation = parseHookObservation;
