import { describe, expect, it } from "vitest";
import {
  createAdapterVersion,
  createRuntimeInstallationIdentity,
  type RuntimeCapabilitySnapshot,
} from "@sisyphus/domain";

import { StaticRuntimeInstallationRegistry } from "./runtime-installation-registry.js";

const capabilities: RuntimeCapabilitySnapshot = {
  runtime: "codex",
  runtimeVersion: "0.99.0",
  promptInterception: { kind: "supported" },
  skillSelectionControl: { kind: "supported" },
  rootStopContinuation: { kind: "supported" },
  subagentStopContinuation: { kind: "supported" },
  toolPrevention: { kind: "supported" },
  toolObservation: { kind: "supported" },
  stableTokenUsage: { kind: "unsupported", reason: "not reported" },
  localEvidenceAccess: { kind: "supported" },
};

function installation() {
  return {
    installationIdentity: createRuntimeInstallationIdentity({
      adapterInstallationId: "codex-installation-1",
      profile: "local",
    }),
    adapterVersion: createAdapterVersion("0.1.0"),
    capabilities,
  };
}

describe("StaticRuntimeInstallationRegistry", () => {
  it("resolves only an exact runtime, runtime version, and adapter version", () => {
    const registry = new StaticRuntimeInstallationRegistry([installation()]);

    expect(
      registry.capabilitiesFor({
        runtime: "codex",
        runtimeVersion: "0.99.0",
        adapterVersion: createAdapterVersion("0.1.0"),
        installationIdentity: createRuntimeInstallationIdentity({
          adapterInstallationId: "codex-installation-1",
          profile: "local",
        }),
      }),
    ).toMatchObject({ runtime: "codex", runtimeVersion: "0.99.0" });
    expect(
      registry.capabilitiesFor({
        runtime: "codex",
        runtimeVersion: "upgraded-forged-version",
        adapterVersion: createAdapterVersion("0.1.0"),
        installationIdentity: createRuntimeInstallationIdentity({
          adapterInstallationId: "codex-installation-1",
          profile: "local",
        }),
      }),
    ).toBeUndefined();
    expect(
      registry.capabilitiesFor({
        runtime: "codex",
        runtimeVersion: "0.99.0",
        adapterVersion: createAdapterVersion("forged-adapter"),
        installationIdentity: createRuntimeInstallationIdentity({
          adapterInstallationId: "codex-installation-1",
          profile: "local",
        }),
      }),
    ).toBeUndefined();
    expect(
      registry.capabilitiesFor({
        runtime: "codex",
        runtimeVersion: "0.99.0",
        adapterVersion: createAdapterVersion("0.1.0"),
        installationIdentity: createRuntimeInstallationIdentity({
          adapterInstallationId: "codex-installation-1",
          profile: "cloud-agent",
        }),
      }),
    ).toBeUndefined();
    expect(
      registry.capabilitiesFor({
        runtime: "codex",
        runtimeVersion: "0.99.0",
        adapterVersion: createAdapterVersion("0.1.0"),
        installationIdentity: createRuntimeInstallationIdentity({
          adapterInstallationId: "different-installation",
          profile: "local",
        }),
      }),
    ).toBeUndefined();
  });

  it("rejects duplicate installation identities", () => {
    const candidate = installation();
    expect(
      () => new StaticRuntimeInstallationRegistry([candidate, candidate]),
    ).toThrow("duplicate runtime installation");
  });
});
