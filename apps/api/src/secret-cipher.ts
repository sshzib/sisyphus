import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

export const EncryptedSecretSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal("aes-256-gcm"),
    iv: z.string().min(1),
    tag: z.string().min(1),
    ciphertext: z.string().min(1),
  })
  .strict();
export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;

export interface SecretCipher {
  encrypt(plaintext: string, context: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret, context: string): string;
}

export class AesGcmSecretCipher implements SecretCipher {
  readonly #key: Buffer;

  public constructor(key: Uint8Array = randomBytes(32)) {
    if (key.byteLength !== 32) {
      throw new Error("The secret encryption key must contain exactly 32 bytes.");
    }
    this.#key = Buffer.from(key);
  }

  public static fromBase64(encodedKey: string): AesGcmSecretCipher {
    return new AesGcmSecretCipher(Buffer.from(encodedKey, "base64"));
  }

  public encrypt(plaintext: string, context: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  public decrypt(secret: EncryptedSecret, context: string): string {
    const parsed = EncryptedSecretSchema.parse(secret);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#key,
      Buffer.from(parsed.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
