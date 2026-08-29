import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { EnvironmentDeviceKeyProvider } from "./device-key.js";

describe("EnvironmentDeviceKeyProvider", () => {
  it("loads an exact 32-byte base64 key", async () => {
    const source = randomBytes(32);
    const provider = new EnvironmentDeviceKeyProvider({
      environment: { SISYPHUS_EVIDENCE_KEY: source.toString("base64") },
    });

    await expect(provider.load()).resolves.toEqual(source);
  });

  it("refuses to start without a protected key", async () => {
    const provider = new EnvironmentDeviceKeyProvider({ environment: {} });
    await expect(provider.load()).rejects.toThrow("SISYPHUS_EVIDENCE_KEY");
  });

  it("rejects malformed and short keys", async () => {
    const provider = new EnvironmentDeviceKeyProvider({
      environment: { SISYPHUS_EVIDENCE_KEY: Buffer.from("too-short").toString("base64") },
    });
    await expect(provider.load()).rejects.toThrow("32 bytes");
  });
});

