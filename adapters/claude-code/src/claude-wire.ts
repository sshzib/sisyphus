import { createHash } from "node:crypto";

import { z } from "zod";

import {
  createActivationLeaseId,
  createAgentId,
  createEventId,
  createRunId,
  createSessionId,
  createSkillVersionId,
  createTimestamp,
  createToolCallId,
  createWorkItemId,
  type AdapterVersion,
  type HookObservation,
  type RuntimeCapabilitySnapshot,
  type RuntimeIdentity,
  type SkillActivationEvidence,
} from "@sisyphus/domain";

const JsonValueSchema = z.json();
const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

const commonHookFields = {
  session_id: z.string().trim().min(1),
  prompt_id: z.string().trim().min(1).optional(),
  transcript_path: z.string().nullable(),
  cwd: z.string().trim().min(1),
  permission_mode: z
    .enum(["default", "plan", "acceptEdits", "auto", "dontAsk", "bypassPermissions"])
    .optional(),
  agent_id: z.string().trim().min(1).optional(),
  agent_type: z.string().trim().min(1).optional(),
};

export const ClaudeUserPromptSubmitSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("UserPromptSubmit"),
  prompt: z.string().min(1),
});

export const ClaudePreToolUseSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("PreToolUse"),
  tool_name: z.string().trim().min(1),
  tool_use_id: z.string().trim().min(1),
  tool_input: JsonValueSchema,
});

export const ClaudePostToolUseSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("PostToolUse"),
  tool_name: z.string().trim().min(1),
  tool_use_id: z.string().trim().min(1),
  tool_input: JsonValueSchema,
  tool_response: JsonValueSchema,
});

export const ClaudeStopSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("Stop"),
  stop_hook_active: z.boolean(),
  last_assistant_message: z.string().nullable(),
});

export const ClaudeSubagentStopSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("SubagentStop"),
  stop_hook_active: z.boolean(),
  agent_id: z.string().trim().min(1),
  agent_type: z.string().trim().min(1),
  agent_transcript_path: z.string().nullable(),
  last_assistant_message: z.string().nullable(),
});

export const ClaudeHookEventSchema = z.discriminatedUnion("hook_event_name", [
  ClaudeUserPromptSubmitSchema,
  ClaudePreToolUseSchema,
  ClaudePostToolUseSchema,
  ClaudeStopSchema,
  ClaudeSubagentStopSchema,
]);

export type ClaudeHookEvent = z.infer<typeof ClaudeHookEventSchema>;

export type ClaudeNormalizationOptions = {
  readonly adapterVersion: AdapterVersion;
  readonly capabilities: RuntimeCapabilitySnapshot;
  readonly now: () => Date;
  readonly turnScope: string;
};

const ActivationMarkerInputSchema = z.object({
  skillVersionId: z.string().trim().min(1),
  activationLeaseId: z.string().trim().min(1),
});

const ActivationMarkerOutputSchema = z.object({
  structuredContent: z.object({
    activated: z.literal(true),
    skillVersionId: z.string().trim().min(1),
    activationLeaseId: z.string().trim().min(1),
  }),
});

export function parseClaudeHookEvent(input: unknown): ClaudeHookEvent {
  return ClaudeHookEventSchema.parse(input);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right, "en"));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("value is not JSON serializable");
}

export function stableClaudeDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function rootAgentId(sessionId: string) {
  return createAgentId(`claude-code-root:${sessionId}`);
}

export function deriveClaudeIdentity(event: ClaudeHookEvent): RuntimeIdentity {
  const sessionId = createSessionId(event.session_id);
  if (event.agent_id !== undefined) {
    return {
      sessionId,
      agent: {
        kind: "subagent",
        agentId: createAgentId(event.agent_id),
        parentAgentId: rootAgentId(event.session_id),
      },
    };
  }
  return { sessionId, agent: { kind: "root", agentId: rootAgentId(event.session_id) } };
}

export function verifyClaudeSkillActivation(
  event: ClaudeHookEvent,
): SkillActivationEvidence {
  if (
    event.hook_event_name !== "PostToolUse" ||
    event.tool_name !== "mcp__sisyphus__activate_skill"
  ) {
    return { kind: "none" };
  }
  const input = ActivationMarkerInputSchema.safeParse(event.tool_input);
  if (!input.success) return { kind: "none" };
  const output = ActivationMarkerOutputSchema.safeParse(event.tool_response);
  if (
    output.success &&
    output.data.structuredContent.skillVersionId === input.data.skillVersionId &&
    output.data.structuredContent.activationLeaseId === input.data.activationLeaseId
  ) {
    return {
      kind: "verified",
      skillVersionId: createSkillVersionId(input.data.skillVersionId),
      activationLeaseId: createActivationLeaseId(input.data.activationLeaseId),
      method: "activation-marker",
    };
  }
  return {
    kind: "inferred",
    skillVersionId: createSkillVersionId(input.data.skillVersionId),
    reason: "the activation marker did not return a matching worker confirmation",
  };
}

function eventDiscriminator(event: ClaudeHookEvent): unknown {
  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      return { prompt: event.prompt };
    case "PreToolUse":
    case "PostToolUse":
      return { toolUseId: event.tool_use_id };
    case "Stop":
      return { active: event.stop_hook_active, output: event.last_assistant_message };
    case "SubagentStop":
      return {
        active: event.stop_hook_active,
        agentId: event.agent_id,
        output: event.last_assistant_message,
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function eventIdFor(event: ClaudeHookEvent, turnScope: string) {
  return createEventId(
    `claude-code:${stableClaudeDigest({
      sessionId: event.session_id,
      turnScope,
      promptId: event.prompt_id,
      hook: event.hook_event_name,
      event: eventDiscriminator(event),
    })}`,
  );
}

function toolInputRecord(input: z.infer<typeof JsonValueSchema>): Record<string, unknown> {
  const parsed = JsonObjectSchema.safeParse(input);
  return parsed.success ? parsed.data : { value: input };
}

function toolSucceeded(response: z.infer<typeof JsonValueSchema>): boolean {
  const error = z.object({ isError: z.literal(true) }).safeParse(response);
  if (error.success) return false;
  const exitCode = z.object({ exitCode: z.number() }).safeParse(response);
  return !exitCode.success || exitCode.data.exitCode === 0;
}

function summaryOf(response: z.infer<typeof JsonValueSchema>): string {
  const full = typeof response === "string" ? response : canonicalJson(response);
  return full.length <= 8_000 ? full : `${full.slice(0, 8_000)}\n[tool response truncated]`;
}

function observationBase(event: ClaudeHookEvent, options: ClaudeNormalizationOptions) {
  const occurredAt = options.now();
  if (Number.isNaN(occurredAt.getTime())) throw new Error("now() returned an invalid date");
  const scope = z.string().trim().min(1).parse(options.turnScope);
  return {
    eventId: eventIdFor(event, scope),
    workItemId: createWorkItemId(`claude-code:${event.session_id}:${scope}`),
    runId: createRunId(`claude-code:${event.session_id}:${scope}`),
    occurredAt: createTimestamp(occurredAt.toISOString()),
    adapterVersion: options.adapterVersion,
    capabilities: options.capabilities,
    identity: deriveClaudeIdentity(event),
  };
}

export function normalizeClaudeEvent(
  event: ClaudeHookEvent,
  options: ClaudeNormalizationOptions,
): HookObservation {
  const base = observationBase(event, options);
  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      return { kind: "prompt", ...base, prompt: event.prompt };
    case "PreToolUse":
      return {
        kind: "tool-request",
        ...base,
        toolCallId: createToolCallId(event.tool_use_id),
        toolName: event.tool_name,
        input: toolInputRecord(event.tool_input),
      };
    case "PostToolUse":
      return {
        kind: "tool-result",
        ...base,
        toolCallId: createToolCallId(event.tool_use_id),
        toolName: event.tool_name,
        outcome: {
          kind: toolSucceeded(event.tool_response) ? "succeeded" : "failed",
          summary: summaryOf(event.tool_response),
        },
      };
    case "Stop":
      return {
        kind: "root-stop",
        ...base,
        output: event.last_assistant_message ?? "",
        attribution: { kind: "none" },
        tokenUsage: { kind: "unavailable" },
      };
    case "SubagentStop":
      return {
        kind: "subagent-stop",
        ...base,
        output: event.last_assistant_message ?? "",
        attribution: { kind: "none" },
        tokenUsage: { kind: "unavailable" },
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
