import {
  AdapterVersionSchema,
  RuntimeCapabilitySnapshotSchema,
  RuntimeInstallationIdentitySchema,
  type AdapterVersion,
  type AgentRuntime,
  type RuntimeCapabilitySnapshot,
  type RuntimeInstallationIdentity,
} from "@sisyphus/domain";
import { z } from "zod";

const RegisteredRuntimeInstallationSchema = z
  .object({
    installationIdentity: RuntimeInstallationIdentitySchema,
    adapterVersion: AdapterVersionSchema,
    capabilities: RuntimeCapabilitySnapshotSchema,
  })
  .strict();

export type RegisteredRuntimeInstallation = z.infer<
  typeof RegisteredRuntimeInstallationSchema
>;

export interface RuntimeInstallationLookup {
  readonly runtime: AgentRuntime;
  readonly runtimeVersion: string;
  readonly adapterVersion: AdapterVersion;
  readonly installationIdentity: RuntimeInstallationIdentity;
}

export interface RuntimeInstallationRegistry {
  capabilitiesFor(
    identity: RuntimeInstallationLookup,
  ): RuntimeCapabilitySnapshot | undefined;
}

function installationKey(identity: RuntimeInstallationLookup): string {
  return JSON.stringify([
    identity.installationIdentity.adapterInstallationId,
    identity.installationIdentity.profile,
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
        installationIdentity: installation.installationIdentity,
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
    identity: RuntimeInstallationLookup,
  ): RuntimeCapabilitySnapshot | undefined {
    return this.#installations.get(installationKey(identity));
  }
}
