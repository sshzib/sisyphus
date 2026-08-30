import { createHash } from "node:crypto";

import { z } from "zod";

import {
  createActivationLeaseId,
  createAgentId,
  createEventId,
  createRetryBudgetId,
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
  type RuntimeInstallationIdentity,
  type SkillActivationEvidence,
} from "@sisyphus/domain";

const JsonValueSchema = z.json();
const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

const commonHookFields = {
  conversation_id: z.string().trim().min(1),
  generation_id: z.string().trim().min(1),
  model: z.string().trim().min(1),
  model_id: z.string().trim().min(1).optional(),
  model_params: z
    .array(z.object({ id: z.string().trim().min(1), value: z.string() }))
    .optional(),
  cursor_version: z.string().trim().min(1),
  workspace_roots: z.array(z.string()),
  user_email: z.string().email().nullable(),
  transcript_path: z.string().nullable(),
};

export const CursorBeforeSubmitPromptSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("beforeSubmitPrompt"),
  prompt: z.string().min(1),
  attachments: z.array(
    z.object({ type: z.enum(["file", "rule"]), file_path: z.string().trim().min(1) }),
  ),
});

export const CursorPreToolUseSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("preToolUse"),
  tool_name: z.string().trim().min(1),
  tool_input: JsonObjectSchema,
  tool_use_id: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
  agent_message: z.string(),
});

export const CursorPostToolUseSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("postToolUse"),
  tool_name: z.string().trim().min(1),
  tool_input: JsonObjectSchema,
  tool_output: z.string(),
  tool_use_id: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
  duration: z.number().nonnegative(),
});

export const CursorStopSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("stop"),
  status: z.enum(["completed", "aborted", "error"]),
  loop_count: z.number().int().nonnegative(),
});

export const CursorSubagentStopSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("subagentStop"),
  subagent_type: z.string().trim().min(1),
  status: z.enum(["completed", "error", "aborted"]),
  task: z.string(),
  description: z.string(),
  summary: z.string(),
  duration_ms: z.number().nonnegative(),
  message_count: z.number().int().nonnegative(),
  tool_call_count: z.number().int().nonnegative(),
  loop_count: z.number().int().nonnegative(),
  modified_files: z.array(z.string()),
  agent_transcript_path: z.string().nullable(),
});

export const CursorHookEventSchema = z.discriminatedUnion("hook_event_name", [
  CursorBeforeSubmitPromptSchema,
  CursorPreToolUseSchema,
  CursorPostToolUseSchema,
  CursorStopSchema,
  CursorSubagentStopSchema,
]);

export type CursorHookEvent = z.infer<typeof CursorHookEventSchema>;

export type CursorNormalizationOptions = {
  readonly adapterVersion: AdapterVersion;
  readonly capabilitiesForVersion: (runtimeVersion: string) => RuntimeCapabilitySnapshot;
  readonly runtimeInstallation: RuntimeInstallationIdentity;
  readonly now: () => Date;
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

export function parseCursorHookEvent(input: unknown): CursorHookEvent {
  return CursorHookEventSchema.parse(input);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).toSorted(([left], [right]) =>
      left.localeCompare(right, "en"),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("value is not JSON serializable");
}

export function stableCursorDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function parseJsonText(input: string): unknown {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed;
  } catch {
    return undefined;
  }
}

function rootAgentId(conversationId: string) {
  return createAgentId(`cursor-root:${conversationId}`);
}

function subagentId(event: z.infer<typeof CursorSubagentStopSchema>) {
  return createAgentId(
    `cursor-subagent:${stableCursorDigest({
      conversationId: event.conversation_id,
      generationId: event.generation_id,
      transcriptPath: event.agent_transcript_path,
      type: event.subagent_type,
      task: event.task,
    })}`,
  );
}

export function deriveCursorIdentity(event: CursorHookEvent): RuntimeIdentity {
  const sessionId = createSessionId(event.conversation_id);
  if (event.hook_event_name === "subagentStop") {
    return {
      sessionId,
      agent: {
        kind: "subagent",
        agentId: subagentId(event),
        parentAgentId: rootAgentId(event.conversation_id),
        role: event.subagent_type,
      },
    };
  }
  return {
    sessionId,
    agent: { kind: "root", agentId: rootAgentId(event.conversation_id) },
  };
}

export function verifyCursorSkillActivation(
  event: CursorHookEvent,
): SkillActivationEvidence {
  if (
    event.hook_event_name !== "postToolUse" ||
    (event.tool_name !== "MCP:activate_skill" &&
      event.tool_name !== "mcp__sisyphus__activate_skill")
  ) {
    return { kind: "none" };
  }
  const input = ActivationMarkerInputSchema.safeParse(event.tool_input);
  if (!input.success) return { kind: "none" };
  const output = ActivationMarkerOutputSchema.safeParse(parseJsonText(event.tool_output));
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

function eventDiscriminator(event: CursorHookEvent): unknown {
  switch (event.hook_event_name) {
    case "beforeSubmitPrompt":
      return { prompt: event.prompt };
    case "preToolUse":
    case "postToolUse":
      return { toolUseId: event.tool_use_id };
    case "stop":
      return { loopCount: event.loop_count, status: event.status };
    case "subagentStop":
      return {
        loopCount: event.loop_count,
        status: event.status,
        subagentId: subagentId(event),
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function eventIdFor(event: CursorHookEvent) {
  return createEventId(
    `cursor:${stableCursorDigest({
      conversationId: event.conversation_id,
      generationId: event.generation_id,
      hook: event.hook_event_name,
      event: eventDiscriminator(event),
    })}`,
  );
}

function toolSucceeded(output: string): boolean {
  const parsed = parseJsonText(output);
  const isError = z.object({ isError: z.literal(true) }).safeParse(parsed);
  if (isError.success) return false;
  const exitCode = z.object({ exitCode: z.number() }).safeParse(parsed);
  return !exitCode.success || exitCode.data.exitCode === 0;
}

function summaryOf(output: string): string {
  return output.length <= 8_000 ? output : `${output.slice(0, 8_000)}\n[tool response truncated]`;
}

function observationBase(event: CursorHookEvent, options: CursorNormalizationOptions) {
  const occurredAt = options.now();
  if (Number.isNaN(occurredAt.getTime())) throw new Error("now() returned an invalid date");
  const retryBudgetId = createRetryBudgetId(
    `cursor:${event.conversation_id}:${event.generation_id}`,
  );
  const identity = deriveCursorIdentity(event);
  const completionScope =
    identity.agent.kind === "subagent"
      ? `subagent:${identity.agent.agentId}`
      : "root";
  return {
    eventId: eventIdFor(event),
    workItemId: createWorkItemId(`${retryBudgetId}:${completionScope}`),
    retryBudgetId,
    runId: createRunId(`cursor:${event.conversation_id}:${event.generation_id}`),
    occurredAt: createTimestamp(occurredAt.toISOString()),
    adapterVersion: options.adapterVersion,
    runtimeInstallation: options.runtimeInstallation,
    capabilities: options.capabilitiesForVersion(event.cursor_version),
    identity,
  };
}

export function normalizeCursorEvent(
  event: CursorHookEvent,
  options: CursorNormalizationOptions,
): HookObservation {
  const base = observationBase(event, options);
  switch (event.hook_event_name) {
    case "beforeSubmitPrompt":
      return { kind: "prompt", ...base, prompt: event.prompt };
    case "preToolUse":
      return {
        kind: "tool-request",
        ...base,
        toolCallId: createToolCallId(event.tool_use_id),
        toolName: event.tool_name,
        input: event.tool_input,
      };
    case "postToolUse":
      return {
        kind: "tool-result",
        ...base,
        toolCallId: createToolCallId(event.tool_use_id),
        toolName: event.tool_name,
        outcome: {
          kind: toolSucceeded(event.tool_output) ? "succeeded" : "failed",
          summary: summaryOf(event.tool_output),
        },
      };
    case "stop":
      return {
        kind: "root-stop",
        ...base,
        output: "",
        attribution: { kind: "none" },
        tokenUsage: { kind: "unavailable" },
      };
    case "subagentStop":
      return {
        kind: "subagent-stop",
        ...base,
        output: event.summary,
        attribution: { kind: "none" },
        tokenUsage: { kind: "unavailable" },
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
