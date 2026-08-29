import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = 1;

export interface EvidenceRecord {
  readonly handle: string;
  readonly digest: string;
  readonly redactedExcerpt: string;
}

interface StoreEvidenceInput {
  readonly evidence: string;
  readonly redactedExcerpt: string;
}

interface EncryptedEvidenceVaultInput {
  readonly directory: string;
  readonly key: Uint8Array;
}

export class EncryptedEvidenceVault {
  readonly #directory: string;
  readonly #key: Buffer;

  constructor(input: EncryptedEvidenceVaultInput) {
    if (input.key.byteLength !== KEY_BYTES) {
      throw new Error(`Evidence key must contain ${KEY_BYTES} bytes.`);
    }
    this.#directory = input.directory;
    this.#key = Buffer.from(input.key);
  }

  async store(input: StoreEvidenceInput): Promise<EvidenceRecord> {
    await mkdir(this.#directory, { recursive: true });
    const handle = randomUUID();
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(Buffer.from(handle, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(input.evidence, "utf8"),
      cipher.final(),
    ]);
    const payload = Buffer.concat([
      Buffer.from([FORMAT_VERSION]),
      nonce,
      cipher.getAuthTag(),
      ciphertext,
    ]);
    const destination = this.#path(handle);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);

    return {
      handle,
      digest: createHash("sha256").update(input.evidence).digest("hex"),
      redactedExcerpt: input.redactedExcerpt,
    };
  }

  async read(handle: string): Promise<string> {
    const payload = await readFile(this.#path(handle));
    const version = payload.at(0);
    if (version !== FORMAT_VERSION) throw new Error("Unsupported evidence format.");
    const nonce = payload.subarray(1, 1 + NONCE_BYTES);
    const tag = payload.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(1 + NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
    decipher.setAAD(Buffer.from(handle, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  #path(handle: string): string {
    if (!/^[0-9a-f-]{36}$/u.test(handle)) throw new Error("Invalid evidence handle.");
    return join(this.#directory, `${handle}.evidence`);
  }
}

