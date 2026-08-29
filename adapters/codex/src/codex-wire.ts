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
  transcript_path: z.string().nullable(),
  cwd: z.string().trim().min(1),
  model: z.string().trim().min(1),
  permission_mode: z.enum([
    "default",
    "acceptEdits",
    "plan",
    "dontAsk",
    "bypassPermissions",
  ]),
  turn_id: z.string().trim().min(1),
};

export const CodexUserPromptSubmitSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("UserPromptSubmit"),
  prompt: z.string().min(1),
});

export const CodexPreToolUseSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("PreToolUse"),
  tool_name: z.string().trim().min(1),
  tool_use_id: z.string().trim().min(1),
  tool_input: JsonValueSchema,
});

export const CodexPostToolUseSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("PostToolUse"),
  tool_name: z.string().trim().min(1),
  tool_use_id: z.string().trim().min(1),
  tool_input: JsonValueSchema,
  tool_response: JsonValueSchema,
});

export const CodexStopSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("Stop"),
  stop_hook_active: z.boolean(),
  last_assistant_message: z.string().nullable(),
});

export const CodexSubagentStopSchema = z.object({
  ...commonHookFields,
  hook_event_name: z.literal("SubagentStop"),
  agent_id: z.string().trim().min(1),
  agent_type: z.string().trim().min(1),
  agent_transcript_path: z.string().nullable(),
  stop_hook_active: z.boolean(),
  last_assistant_message: z.string().nullable(),
});

export const CodexHookEventSchema = z.discriminatedUnion("hook_event_name", [
  CodexUserPromptSubmitSchema,
  CodexPreToolUseSchema,
  CodexPostToolUseSchema,
  CodexStopSchema,
  CodexSubagentStopSchema,
]);

export type CodexHookEvent = z.infer<typeof CodexHookEventSchema>;
export type CodexHookEventName = CodexHookEvent["hook_event_name"];

export type CodexNormalizationOptions = {
  readonly adapterVersion: AdapterVersion;
  readonly capabilities: RuntimeCapabilitySnapshot;
  readonly now: () => Date;
};

export type InspectedCodexEvent = {
  readonly raw: CodexHookEvent;
  readonly observation: HookObservation;
  readonly identity: RuntimeIdentity;
  readonly activation: SkillActivationEvidence;
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

export function parseCodexHookEvent(input: unknown): CodexHookEvent {
  return CodexHookEventSchema.parse(input);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
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

export function stableDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function rootAgentId(sessionId: string) {
  return createAgentId(`codex-root:${sessionId}`);
}

export function deriveCodexIdentity(event: CodexHookEvent): RuntimeIdentity {
  const sessionId = createSessionId(event.session_id);
  if (event.hook_event_name === "SubagentStop") {
    return {
      sessionId,
      agent: {
        kind: "subagent",
        agentId: createAgentId(event.agent_id),
        parentAgentId: rootAgentId(event.session_id),
      },
    };
  }
  return {
    sessionId,
    agent: { kind: "root", agentId: rootAgentId(event.session_id) },
  };
}

export function verifyCodexSkillActivation(
  event: CodexHookEvent,
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

function eventDiscriminator(event: CodexHookEvent): unknown {
  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      return { prompt: event.prompt };
    case "PreToolUse":
    case "PostToolUse":
      return { toolUseId: event.tool_use_id };
    case "Stop":
      return {
        output: event.last_assistant_message,
        continued: event.stop_hook_active,
      };
    case "SubagentStop":
      return {
        agentId: event.agent_id,
        output: event.last_assistant_message,
        continued: event.stop_hook_active,
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function eventIdFor(event: CodexHookEvent) {
  return createEventId(
    `codex:${stableDigest({
      sessionId: event.session_id,
      turnId: event.turn_id,
      hook: event.hook_event_name,
      event: eventDiscriminator(event),
    })}`,
  );
}

function toolInputRecord(input: z.infer<typeof JsonValueSchema>): Record<string, unknown> {
  const record = JsonObjectSchema.safeParse(input);
  return record.success ? record.data : { value: input };
}

function toolSucceeded(response: z.infer<typeof JsonValueSchema>): boolean {
  const errorFlag = z.object({ isError: z.literal(true) }).safeParse(response);
  if (errorFlag.success) return false;

  const snakeExit = z.object({ exit_code: z.number() }).safeParse(response);
  if (snakeExit.success && snakeExit.data.exit_code !== 0) return false;

  const camelExit = z.object({ exitCode: z.number() }).safeParse(response);
  return !camelExit.success || camelExit.data.exitCode === 0;
}

function responseSummary(response: z.infer<typeof JsonValueSchema>): string {
  const full = typeof response === "string" ? response : canonicalJson(response);
  const limit = 8_000;
  return full.length <= limit ? full : `${full.slice(0, limit)}\n[tool response truncated]`;
}

function observationBase(event: CodexHookEvent, options: CodexNormalizationOptions) {
  const occurredAt = options.now();
  if (Number.isNaN(occurredAt.getTime())) throw new Error("now() returned an invalid date");
  return {
    eventId: eventIdFor(event),
    workItemId: createWorkItemId(`codex:${event.session_id}:${event.turn_id}`),
    runId: createRunId(`codex:${event.session_id}:${event.turn_id}`),
    occurredAt: createTimestamp(occurredAt.toISOString()),
    adapterVersion: options.adapterVersion,
    capabilities: options.capabilities,
    identity: deriveCodexIdentity(event),
  };
}

export function normalizeCodexEvent(
  event: CodexHookEvent,
  options: CodexNormalizationOptions,
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
          summary: responseSummary(event.tool_response),
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

export function inspectCodexEvent(
  input: unknown,
  options: CodexNormalizationOptions,
): InspectedCodexEvent {
  const raw = parseCodexHookEvent(input);
  return {
    raw,
    observation: normalizeCodexEvent(raw, options),
    identity: deriveCodexIdentity(raw),
    activation: verifyCodexSkillActivation(raw),
  };
}
