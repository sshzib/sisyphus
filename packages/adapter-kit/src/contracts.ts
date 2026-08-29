import { z } from "zod";

import {
  AdapterInstallationIdSchema,
  AdapterVersionSchema,
  AgentRuntimeSchema,
  DeviceIdSchema,
  RuntimeCapabilitySnapshotSchema,
  SkillActivationEvidenceSchema,
  TimestampSchema,
  type AgentRuntime,
  type DecisionFor,
  type HookObservation,
  type PromptObservation,
  type RootStopObservation,
  type RuntimeCapabilitySnapshot,
  type RuntimeIdentity,
  type SkillActivationEvidence,
  type SubagentStopObservation,
  type ToolRequestObservation,
  type ToolResultObservation,
} from "@sisyphus/domain";

export type UnknownRuntimeEvent = unknown;
export type RuntimeResponse = unknown;

export const AdapterInstallationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("project"), projectPath: z.string().trim().min(1) }),
]);
export type AdapterInstallationScope = z.infer<typeof AdapterInstallationScopeSchema>;

export const AdapterInstallRequestSchema = z.object({
  deviceId: DeviceIdSchema,
  adapterVersion: AdapterVersionSchema,
  workerEndpoint: z.string().url(),
  scope: AdapterInstallationScopeSchema,
});
export type AdapterInstallRequest = z.infer<typeof AdapterInstallRequestSchema>;

export const AdapterInstallationSchema = z.object({
  installationId: AdapterInstallationIdSchema,
  runtime: AgentRuntimeSchema,
  adapterVersion: AdapterVersionSchema,
  installedAt: TimestampSchema,
  scope: AdapterInstallationScopeSchema,
  capabilities: RuntimeCapabilitySnapshotSchema,
});
export type AdapterInstallation = z.infer<typeof AdapterInstallationSchema>;

export const AdapterUninstallRequestSchema = z.object({
  installationId: AdapterInstallationIdSchema,
});
export type AdapterUninstallRequest = z.infer<typeof AdapterUninstallRequestSchema>;

export interface AgentRuntimeAdapter {
  readonly runtime: AgentRuntime;

  probe(): Promise<RuntimeCapabilitySnapshot>;
  install(input: AdapterInstallRequest): Promise<AdapterInstallation>;
  uninstall(input: AdapterUninstallRequest): Promise<void>;

  parseEvent(input: UnknownRuntimeEvent): HookObservation;
  renderDecision<E extends HookObservation>(event: E, decision: DecisionFor<E>): RuntimeResponse;
  deriveIdentity(event: UnknownRuntimeEvent): RuntimeIdentity;
  verifySkillActivation(event: UnknownRuntimeEvent): SkillActivationEvidence;
}

export type AdapterConformanceCase =
  | {
      readonly kind: "prompt";
      readonly rawEvent: unknown;
      readonly decision: DecisionFor<PromptObservation>;
    }
  | {
      readonly kind: "tool-request";
      readonly rawEvent: unknown;
      readonly decision: DecisionFor<ToolRequestObservation>;
    }
  | {
      readonly kind: "tool-result";
      readonly rawEvent: unknown;
      readonly decision: DecisionFor<ToolResultObservation>;
    }
  | {
      readonly kind: "root-stop";
      readonly rawEvent: unknown;
      readonly decision: DecisionFor<RootStopObservation>;
      readonly retryResponseAccepted: (response: unknown) => boolean;
    }
  | {
      readonly kind: "subagent-stop";
      readonly rawEvent: unknown;
      readonly decision: DecisionFor<SubagentStopObservation>;
      readonly retryResponseAccepted: (response: unknown) => boolean;
    };

export type AdapterConformanceFixture = {
  readonly installRequest: AdapterInstallRequest;
  readonly uninstallAfterRun: boolean;
  readonly forbiddenNormalizedKeys: readonly string[];
  readonly cases: readonly AdapterConformanceCase[];
};

export type AdapterConformanceCheck = {
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly detail: string;
};

export type AdapterConformanceReport = {
  readonly runtime: AgentRuntime;
  readonly capabilities: RuntimeCapabilitySnapshot;
  readonly installation: AdapterInstallation;
  readonly checks: readonly AdapterConformanceCheck[];
};

export function parseAdapterInstallRequest(input: unknown): AdapterInstallRequest {
  return AdapterInstallRequestSchema.parse(input);
}

export function parseAdapterInstallation(input: unknown): AdapterInstallation {
  return AdapterInstallationSchema.parse(input);
}

export function parseSkillActivationEvidence(input: unknown): SkillActivationEvidence {
  return SkillActivationEvidenceSchema.parse(input);
}
