import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  createActivationLeaseId,
  createSkillVersionId,
  createTimestamp,
  type ActivationLeaseId,
  type SkillVersionId,
  type Timestamp,
} from "@sisyphus/domain";

import { canonicalJson } from "./canonical-json.js";

const KEY_BYTES = 32;

export interface StoredActivationLease {
  readonly promptEventId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly skillVersionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly activationLeaseDigest: string;
  readonly consumedAt?: string;
}

export interface WorkerIssuedActivationLease {
  readonly activationLeaseId: ActivationLeaseId;
  readonly skillVersionId: SkillVersionId;
  readonly expiresAt: Timestamp;
}

interface IssueActivationLeaseInput {
  readonly promptEventId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly skillVersionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export function activationLeaseDigest(activationLeaseId: string): string {
  return createHash("sha256").update(activationLeaseId, "utf8").digest("hex");
}

function digestsMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export class ActivationLeaseAuthority {
  readonly #key: Buffer;

  constructor(input: { readonly key: Uint8Array }) {
    if (input.key.byteLength !== KEY_BYTES) {
      throw new Error(`Activation lease key must contain ${KEY_BYTES} bytes.`);
    }
    this.#key = Buffer.from(input.key);
  }

  issue(input: IssueActivationLeaseInput): {
    readonly record: StoredActivationLease;
    readonly lease: WorkerIssuedActivationLease;
  } {
    const issuedAt = createTimestamp(input.issuedAt);
    const expiresAt = createTimestamp(input.expiresAt);
    if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
      throw new Error("Activation lease expiry must follow its issue time.");
    }
    const unsigned = {
      promptEventId: input.promptEventId,
      runId: input.runId,
      workItemId: input.workItemId,
      skillVersionId: input.skillVersionId,
      issuedAt,
      expiresAt,
    };
    const activationLeaseId = this.#idFor(unsigned);
    const record: StoredActivationLease = {
      ...unsigned,
      activationLeaseDigest: activationLeaseDigest(activationLeaseId),
    };
    return { record, lease: this.leaseFor(record) };
  }

  leaseFor(record: StoredActivationLease): WorkerIssuedActivationLease {
    const activationLeaseId = this.#idFor(record);
    if (!digestsMatch(activationLeaseDigest(activationLeaseId), record.activationLeaseDigest)) {
      throw new Error("Stored activation lease binding failed integrity verification.");
    }
    return {
      activationLeaseId,
      skillVersionId: createSkillVersionId(record.skillVersionId),
      expiresAt: createTimestamp(record.expiresAt),
    };
  }

  digest(activationLeaseId: string): string {
    return activationLeaseDigest(activationLeaseId);
  }

  #idFor(input: Omit<StoredActivationLease, "activationLeaseDigest" | "consumedAt">): ActivationLeaseId {
    const payload = canonicalJson([
      "sisyphus-activation-lease-v1",
      input.promptEventId,
      input.runId,
      input.workItemId,
      input.skillVersionId,
      input.issuedAt,
      input.expiresAt,
    ]);
    const signature = createHmac("sha256", this.#key)
      .update(payload, "utf8")
      .digest("base64url");
    return createActivationLeaseId(`sisyphus-v1.${signature}`);
  }
}
