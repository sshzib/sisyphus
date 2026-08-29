import { z } from "zod";

export const AgentRuntimeSchema = z.enum(["codex", "claude-code", "cursor", "opencode"]);
export type AgentRuntime = z.infer<typeof AgentRuntimeSchema>;

export const CapabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("supported") }).strict(),
  z
    .object({ kind: z.literal("partial"), limitation: z.string().trim().min(1) })
    .strict(),
  z
    .object({ kind: z.literal("unsupported"), reason: z.string().trim().min(1) })
    .strict(),
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilityNameSchema = z.enum([
  "promptInterception",
  "skillSelectionControl",
  "rootStopContinuation",
  "subagentStopContinuation",
  "toolPrevention",
  "toolObservation",
  "stableTokenUsage",
  "localEvidenceAccess",
]);
export type CapabilityName = z.infer<typeof CapabilityNameSchema>;

export const RuntimeCapabilitySnapshotSchema = z
  .object({
    runtime: AgentRuntimeSchema,
    runtimeVersion: z.string().trim().min(1),
    promptInterception: CapabilitySchema,
    skillSelectionControl: CapabilitySchema,
    rootStopContinuation: CapabilitySchema,
    subagentStopContinuation: CapabilitySchema,
    toolPrevention: CapabilitySchema,
    toolObservation: CapabilitySchema,
    stableTokenUsage: CapabilitySchema,
    localEvidenceAccess: CapabilitySchema,
  })
  .strict();
export type RuntimeCapabilitySnapshot = z.infer<typeof RuntimeCapabilitySnapshotSchema>;

export function parseRuntimeCapabilitySnapshot(input: unknown): RuntimeCapabilitySnapshot {
  return RuntimeCapabilitySnapshotSchema.parse(input);
}

export function getCapability(
  snapshot: RuntimeCapabilitySnapshot,
  name: CapabilityName,
): Capability {
  return snapshot[name];
}

export function supportsCapability(
  snapshot: RuntimeCapabilitySnapshot,
  name: CapabilityName,
): boolean {
  return getCapability(snapshot, name).kind === "supported";
}

export const EnforcementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enforced") }).strict(),
  z
    .object({
      kind: z.literal("observation"),
      reason: z.string().trim().min(1),
      missingCapabilities: z.array(CapabilityNameSchema),
    })
    .strict(),
]);
export type Enforcement = z.infer<typeof EnforcementSchema>;

export function enforcementFor(
  snapshot: RuntimeCapabilitySnapshot,
  required: readonly CapabilityName[],
): Enforcement {
  const missingCapabilities = required.filter(
    (capability) => !supportsCapability(snapshot, capability),
  );
  if (missingCapabilities.length === 0) {
    return { kind: "enforced" };
  }

  const reasons = missingCapabilities.map((name) => {
    const capability = getCapability(snapshot, name);
    switch (capability.kind) {
      case "partial":
        return `${name}: ${capability.limitation}`;
      case "unsupported":
        return `${name}: ${capability.reason}`;
      case "supported":
        return name;
      default: {
        const exhaustive: never = capability;
        return exhaustive;
      }
    }
  });

  return {
    kind: "observation",
    reason: reasons.join("; "),
    missingCapabilities,
  };
}
