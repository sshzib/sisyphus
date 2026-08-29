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
const TextPartSchema = z.object({ type: z.literal("text"), text: z.string() });

export const OpenCodeChatMessageSchema = z.object({
  hook_event_name: z.literal("chat.message"),
  input: z.object({
    sessionID: z.string().trim().min(1),
    agent: z.string().trim().min(1).optional(),
    messageID: z.string().trim().min(1).optional(),
  }),
  output: z.object({
    message: JsonObjectSchema,
    parts: z.array(JsonValueSchema),
  }),
});

export const OpenCodeToolBeforeSchema = z.object({
  hook_event_name: z.literal("tool.execute.before"),
  input: z.object({
    tool: z.string().trim().min(1),
    sessionID: z.string().trim().min(1),
    callID: z.string().trim().min(1),
  }),
  output: z.object({ args: JsonValueSchema }),
});

export const OpenCodeToolAfterSchema = z.object({
  hook_event_name: z.literal("tool.execute.after"),
  input: z.object({
    tool: z.string().trim().min(1),
    sessionID: z.string().trim().min(1),
    callID: z.string().trim().min(1),
    args: JsonValueSchema,
  }),
  output: z.object({
    title: z.string(),
    output: z.string(),
    metadata: JsonValueSchema,
  }),
});

export const OpenCodeTextCompleteSchema = z.object({
  hook_event_name: z.literal("experimental.text.complete"),
  input: z.object({
    sessionID: z.string().trim().min(1),
    messageID: z.string().trim().min(1),
    partID: z.string().trim().min(1),
  }),
  output: z.object({ text: z.string() }),
});

export const OpenCodeHookEventSchema = z.discriminatedUnion("hook_event_name", [
  OpenCodeChatMessageSchema,
  OpenCodeToolBeforeSchema,
  OpenCodeToolAfterSchema,
  OpenCodeTextCompleteSchema,
]);

export type OpenCodeHookEvent = z.infer<typeof OpenCodeHookEventSchema>;

export type OpenCodeNormalizationOptions = {
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

export function parseOpenCodeHookEvent(input: unknown): OpenCodeHookEvent {
  return OpenCodeHookEventSchema.parse(input);
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

export function stableOpenCodeDigest(value: unknown): string {
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

function sessionIdOf(event: OpenCodeHookEvent): string {
  return event.input.sessionID;
}

function rootAgentId(sessionId: string) {
  return createAgentId(`opencode-root:${sessionId}`);
}

function isTaskCompletion(
  event: z.infer<typeof OpenCodeToolAfterSchema>,
): boolean {
  return event.input.tool.toLowerCase() === "task";
}

export function deriveOpenCodeIdentity(event: OpenCodeHookEvent): RuntimeIdentity {
  const rawSessionId = sessionIdOf(event);
  const sessionId = createSessionId(rawSessionId);
  if (event.hook_event_name === "tool.execute.after" && isTaskCompletion(event)) {
    return {
      sessionId,
      agent: {
        kind: "subagent",
        agentId: createAgentId(`opencode-subagent:${rawSessionId}:${event.input.callID}`),
        parentAgentId: rootAgentId(rawSessionId),
      },
    };
  }
  return { sessionId, agent: { kind: "root", agentId: rootAgentId(rawSessionId) } };
}

function activationOutput(event: z.infer<typeof OpenCodeToolAfterSchema>): unknown {
  const metadata = ActivationMarkerOutputSchema.safeParse(event.output.metadata);
  if (metadata.success) return metadata.data;
  return parseJsonText(event.output.output);
}

export function verifyOpenCodeSkillActivation(
  event: OpenCodeHookEvent,
): SkillActivationEvidence {
  if (
    event.hook_event_name !== "tool.execute.after" ||
    ![
      "sisyphus.activate_skill",
      "sisyphus_activate_skill",
      "mcp__sisyphus__activate_skill",
    ].includes(event.input.tool)
  ) {
    return { kind: "none" };
  }
  const input = ActivationMarkerInputSchema.safeParse(event.input.args);
  if (!input.success) return { kind: "none" };
  const output = ActivationMarkerOutputSchema.safeParse(activationOutput(event));
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

function promptText(event: z.infer<typeof OpenCodeChatMessageSchema>): string {
  const text = event.output.parts
    .flatMap((part) => {
      const parsed = TextPartSchema.safeParse(part);
      return parsed.success ? [parsed.data.text] : [];
    })
    .join("\n")
    .trim();
  return z.string().min(1).parse(text);
}

function eventDiscriminator(event: OpenCodeHookEvent): unknown {
  switch (event.hook_event_name) {
    case "chat.message":
      return { messageId: event.input.messageID, prompt: promptText(event) };
    case "tool.execute.before":
    case "tool.execute.after":
      return { callId: event.input.callID };
    case "experimental.text.complete":
      return { messageId: event.input.messageID, partId: event.input.partID };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function eventIdFor(event: OpenCodeHookEvent, turnScope: string) {
  return createEventId(
    `opencode:${stableOpenCodeDigest({
      sessionId: sessionIdOf(event),
      turnScope,
      hook: event.hook_event_name,
      event: eventDiscriminator(event),
    })}`,
  );
}

function inputRecord(input: z.infer<typeof JsonValueSchema>): Record<string, unknown> {
  const parsed = JsonObjectSchema.safeParse(input);
  return parsed.success ? parsed.data : { value: input };
}

function toolSucceeded(event: z.infer<typeof OpenCodeToolAfterSchema>): boolean {
  const metadataError = z.object({ isError: z.literal(true) }).safeParse(event.output.metadata);
  if (metadataError.success) return false;
  const exitCode = z.object({ exitCode: z.number() }).safeParse(event.output.metadata);
  return !exitCode.success || exitCode.data.exitCode === 0;
}

function summaryOf(output: string): string {
  return output.length <= 8_000 ? output : `${output.slice(0, 8_000)}\n[tool response truncated]`;
}

function observationBase(event: OpenCodeHookEvent, options: OpenCodeNormalizationOptions) {
  const occurredAt = options.now();
  if (Number.isNaN(occurredAt.getTime())) throw new Error("now() returned an invalid date");
  const sessionId = sessionIdOf(event);
  const scope = z.string().trim().min(1).parse(options.turnScope);
  return {
    eventId: eventIdFor(event, scope),
    workItemId: createWorkItemId(`opencode:${sessionId}:${scope}`),
    runId: createRunId(`opencode:${sessionId}:${scope}`),
    occurredAt: createTimestamp(occurredAt.toISOString()),
    adapterVersion: options.adapterVersion,
    capabilities: options.capabilities,
    identity: deriveOpenCodeIdentity(event),
  };
}

export function normalizeOpenCodeEvent(
  event: OpenCodeHookEvent,
  options: OpenCodeNormalizationOptions,
): HookObservation {
  const base = observationBase(event, options);
  switch (event.hook_event_name) {
    case "chat.message":
      return { kind: "prompt", ...base, prompt: promptText(event) };
    case "tool.execute.before":
      return {
        kind: "tool-request",
        ...base,
        toolCallId: createToolCallId(event.input.callID),
        toolName: event.input.tool,
        input: inputRecord(event.output.args),
      };
    case "tool.execute.after":
      if (isTaskCompletion(event)) {
        return {
          kind: "subagent-stop",
          ...base,
          output: event.output.output,
          attribution: { kind: "none" },
          tokenUsage: { kind: "unavailable" },
        };
      }
      return {
        kind: "tool-result",
        ...base,
        toolCallId: createToolCallId(event.input.callID),
        toolName: event.input.tool,
        outcome: {
          kind: toolSucceeded(event) ? "succeeded" : "failed",
          summary: summaryOf(event.output.output),
        },
      };
    case "experimental.text.complete":
      return {
        kind: "root-stop",
        ...base,
        output: event.output.text,
        attribution: { kind: "none" },
        tokenUsage: { kind: "unavailable" },
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
