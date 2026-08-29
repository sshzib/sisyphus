import { createHash } from "node:crypto";

import type { EncryptedEvidenceVault } from "./evidence-vault.js";
import type { LocalJournal } from "./journal.js";

export interface LocalEvidenceResult {
  readonly eventId: string;
  readonly digest: string;
  readonly evidence: string;
}

export interface LocalEvidenceBrokerPort {
  evidenceFor(eventId: string): Promise<LocalEvidenceResult | undefined>;
}

export class LocalEvidenceBroker implements LocalEvidenceBrokerPort {
  readonly #journal: LocalJournal;
  readonly #vault: EncryptedEvidenceVault;

  public constructor(input: {
    readonly journal: LocalJournal;
    readonly vault: EncryptedEvidenceVault;
  }) {
    this.#journal = input.journal;
    this.#vault = input.vault;
  }

  public async evidenceFor(eventId: string): Promise<LocalEvidenceResult | undefined> {
    const reference = this.#journal.evidenceFor(eventId);
    if (reference === undefined) return undefined;
    const evidence = await this.#vault.read(reference.handle);
    const digest = createHash("sha256").update(evidence, "utf8").digest("hex");
    if (digest !== reference.digest) {
      throw new Error("Decrypted evidence does not match its journal digest.");
    }
    return { eventId, digest, evidence };
  }
}
