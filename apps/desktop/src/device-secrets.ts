import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

export const DeviceSecretKindSchema = z.enum([
  "evidence-key",
  "hook-token",
  "mcp-token",
  "desktop-token",
]);
export type DeviceSecretKind = z.infer<typeof DeviceSecretKindSchema>;

export interface DeviceSecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface DeviceSecretStoreInput {
  readonly directory: string;
  readonly cipher: DeviceSecretCipher;
  readonly random?: (size: number) => Buffer;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function createSecret(kind: DeviceSecretKind, random: (size: number) => Buffer): string {
  const bytes = random(32);
  if (bytes.byteLength !== 32) throw new Error("Device secret generator returned the wrong size.");
  return bytes.toString(kind === "evidence-key" ? "base64" : "base64url");
}

function validateSecret(kind: DeviceSecretKind, value: string): string {
  if (kind === "evidence-key") {
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(value) || Buffer.from(value, "base64").byteLength !== 32) {
      throw new Error("Stored evidence key is invalid.");
    }
    return value;
  }
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value) || Buffer.from(value, "base64url").byteLength !== 32) {
    throw new Error(`Stored ${kind} is invalid.`);
  }
  return value;
}

export class DeviceSecretStore {
  readonly #directory: string;
  readonly #cipher: DeviceSecretCipher;
  readonly #random: (size: number) => Buffer;

  public constructor(input: DeviceSecretStoreInput) {
    this.#directory = input.directory;
    this.#cipher = input.cipher;
    this.#random = input.random ?? randomBytes;
  }

  public async loadOrCreate(input: DeviceSecretKind): Promise<string> {
    const kind = DeviceSecretKindSchema.parse(input);
    if (!this.#cipher.isEncryptionAvailable()) {
      throw new Error("Operating-system secret encryption is unavailable.");
    }
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const path = join(this.#directory, `${kind}.bin`);
    try {
      return validateSecret(kind, this.#cipher.decryptString(await readFile(path)));
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
    }

    const created = createSecret(kind, this.#random);
    const encrypted = this.#cipher.encryptString(created);
    try {
      await writeFile(path, encrypted, { flag: "wx", mode: 0o600 });
      return created;
    } catch (error: unknown) {
      if (!isMissingFile(error) && !(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      return validateSecret(kind, this.#cipher.decryptString(await readFile(path)));
    }
  }
}
