import { describe, expect, it } from "vitest";
import { createAdapterVersion } from "@sisyphus/domain";

import {
  StaticRuntimeInstallationRegistry,
  builtInCodexV1Installation,
} from "./runtime-installation-registry.js";

describe("StaticRuntimeInstallationRegistry", () => {
  it("resolves only an exact runtime, runtime version, and adapter version", () => {
    const registry = new StaticRuntimeInstallationRegistry([
      builtInCodexV1Installation(),
    ]);

    expect(
      registry.capabilitiesFor({
        runtime: "codex",
        runtimeVersion: "unknown",
        adapterVersion: createAdapterVersion("0.1.0"),
      }),
    ).toMatchObject({ runtime: "codex", runtimeVersion: "unknown" });
    expect(
      registry.capabilitiesFor({
        runtime: "codex",
        runtimeVersion: "upgraded-forged-version",
        adapterVersion: createAdapterVersion("0.1.0"),
      }),
    ).toBeUndefined();
    expect(
      registry.capabilitiesFor({
        runtime: "codex",
        runtimeVersion: "unknown",
        adapterVersion: createAdapterVersion("forged-adapter"),
      }),
    ).toBeUndefined();
  });

  it("rejects duplicate installation identities", () => {
    const installation = builtInCodexV1Installation();
    expect(
      () => new StaticRuntimeInstallationRegistry([installation, installation]),
    ).toThrow("duplicate runtime installation");
  });
});
