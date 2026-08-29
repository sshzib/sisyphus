import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DeviceSecretStore, type DeviceSecretCipher } from "./device-secrets.js";

class TestCipher implements DeviceSecretCipher {
  public constructor(private readonly available = true) {}

  public isEncryptionAvailable(): boolean {
    return this.available;
  }

  public encryptString(value: string): Buffer {
    return Buffer.from(
      `encrypted:${Buffer.from(value, "utf8").toString("base64")}`,
      "utf8",
    );
  }

  public decryptString(value: Buffer): string {
    const source = value.toString("utf8");
    if (!source.startsWith("encrypted:")) throw new Error("encrypted secret is corrupt");
    return Buffer.from(source.slice("encrypted:".length), "base64").toString(
      "utf8",
    );
  }
}

describe("DeviceSecretStore", () => {
  it("creates an encrypted secret once and reuses it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-desktop-secrets-"));
    let fill = 7;
    const store = new DeviceSecretStore({
      directory,
      cipher: new TestCipher(),
      random: (size) => Buffer.alloc(size, fill++),
    });

    const first = await store.loadOrCreate("hook-token");
    const second = await store.loadOrCreate("hook-token");

    expect(second).toBe(first);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
  });

  it("refuses plaintext fallback when OS encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-desktop-secrets-"));
    const store = new DeviceSecretStore({
      directory,
      cipher: new TestCipher(false),
    });

    await expect(store.loadOrCreate("evidence-key")).rejects.toThrow(
      "Operating-system secret encryption is unavailable",
    );
  });

  it("does not silently replace a corrupt persisted key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-desktop-secrets-"));
    await writeFile(join(directory, "evidence-key.bin"), "corrupt", "utf8");
    const store = new DeviceSecretStore({ directory, cipher: new TestCipher() });

    await expect(store.loadOrCreate("evidence-key")).rejects.toThrow("corrupt");
  });

  it("encrypts a provisioned device token and reloads it without generating one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-desktop-secrets-"));
    const store = new DeviceSecretStore({ directory, cipher: new TestCipher() });

    expect(await store.loadProvisioned("device-token")).toBeUndefined();
    await store.persistProvisioned("device-token", "device-token-from-enrollment");

    expect(await store.loadProvisioned("device-token")).toBe(
      "device-token-from-enrollment",
    );
    expect(
      (await readFile(join(directory, "device-token.bin"), "utf8")),
    ).not.toContain("device-token-from-enrollment");
  });
});
