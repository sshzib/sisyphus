import {
  AdapterVersionSchema,
  RuntimeCapabilitySnapshotSchema,
  type AdapterVersion,
  type AgentRuntime,
  type RuntimeCapabilitySnapshot,
} from "@sisyphus/domain";
import { z } from "zod";

const RegisteredRuntimeInstallationSchema = z
  .object({
    adapterVersion: AdapterVersionSchema,
    capabilities: RuntimeCapabilitySnapshotSchema,
  })
  .strict();

export type RegisteredRuntimeInstallation = z.infer<
  typeof RegisteredRuntimeInstallationSchema
>;

export interface RuntimeInstallationIdentity {
  readonly runtime: AgentRuntime;
  readonly runtimeVersion: string;
  readonly adapterVersion: AdapterVersion;
}

export interface RuntimeInstallationRegistry {
  capabilitiesFor(
    identity: RuntimeInstallationIdentity,
  ): RuntimeCapabilitySnapshot | undefined;
}

function installationKey(identity: RuntimeInstallationIdentity): string {
  return JSON.stringify([
    identity.runtime,
    identity.runtimeVersion,
    identity.adapterVersion,
  ]);
}

export class StaticRuntimeInstallationRegistry implements RuntimeInstallationRegistry {
  readonly #installations = new Map<string, RuntimeCapabilitySnapshot>();

  constructor(input: readonly RegisteredRuntimeInstallation[]) {
    for (const candidate of input) {
      const installation = RegisteredRuntimeInstallationSchema.parse(candidate);
      const key = installationKey({
        runtime: installation.capabilities.runtime,
        runtimeVersion: installation.capabilities.runtimeVersion,
        adapterVersion: installation.adapterVersion,
      });
      if (this.#installations.has(key)) {
        throw new Error("Cannot register a duplicate runtime installation.");
      }
      this.#installations.set(key, installation.capabilities);
    }
  }

  capabilitiesFor(
    identity: RuntimeInstallationIdentity,
  ): RuntimeCapabilitySnapshot | undefined {
    return this.#installations.get(installationKey(identity));
  }
}

export function builtInCodexV1Installation(): RegisteredRuntimeInstallation {
  const supported = { kind: "supported" as const };
  return RegisteredRuntimeInstallationSchema.parse({
    adapterVersion: "0.1.0",
    capabilities: {
      runtime: "codex",
      runtimeVersion: "unknown",
      promptInterception: supported,
      skillSelectionControl: supported,
      rootStopContinuation: supported,
      subagentStopContinuation: supported,
      toolPrevention: supported,
      toolObservation: supported,
      stableTokenUsage: {
        kind: "unsupported",
        reason: "Codex lifecycle hooks do not report stable token counts.",
      },
      localEvidenceAccess: {
        kind: "partial",
        limitation: "Hook payloads are stable, but the optional transcript format is not.",
      },
    },
  });
}
