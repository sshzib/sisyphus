import { describe, expect, it } from "vitest";
import { AesGcmSecretCipher } from "./secret-cipher.js";

describe("AesGcmSecretCipher", () => {
  it("encrypts provider keys with tenant-bound authenticated data", () => {
    const cipher = new AesGcmSecretCipher(new Uint8Array(32).fill(7));
    const apiKey = "sk-private-provider-key-abcdefghijklmnopqrstuvwxyz";
    const encrypted = cipher.encrypt(apiKey, "judge-provider:tenant-acme");

    expect(JSON.stringify(encrypted)).not.toContain(apiKey);
    expect(cipher.decrypt(encrypted, "judge-provider:tenant-acme")).toBe(apiKey);
    expect(() => cipher.decrypt(encrypted, "judge-provider:tenant-beta")).toThrow();
  });
});
