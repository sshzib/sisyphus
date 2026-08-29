import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  EvaluationConstraintSchema,
  SignedPolicyBundlePayloadSchema,
  SignedPolicyBundleSchema,
  type RuntimePolicyEntry,
  type SignedPolicyBundle,
  type SkillDispositionTransition,
} from "@sisyphus/domain";
import type { DashboardSnapshot } from "@sisyphus/ui/contracts";
import { canonicalJson } from "./canonical-json.js";

export { SignedPolicyBundleSchema } from "@sisyphus/domain";
export type { SignedPolicyBundle } from "@sisyphus/domain";

export const POLICY_BUNDLE_VALIDITY_MS = 15 * 60 * 1000;
export const POLICY_BUNDLE_RENEWAL_LEAD_MS = 60 * 1000;

export interface PolicyBundleSigner {
  readonly keyId: string;
  sign(payload: SignedPolicyBundle["payload"]): string;
}

export class Ed25519PolicyBundleSigner implements PolicyBundleSigner {
  readonly #privateKey: KeyObject;
  public readonly publicKeyPem: string;

  public constructor(
    public readonly keyId: string,
    privateKey: KeyObject,
  ) {
    this.#privateKey = privateKey;
    this.publicKeyPem = createPublicKey(privateKey).export({
      type: "spki",
      format: "pem",
    }).toString();
  }

  public static generate(keyId = "sisyphus-dev-ed25519"): Ed25519PolicyBundleSigner {
    const keyPair = generateKeyPairSync("ed25519");
    return new Ed25519PolicyBundleSigner(keyId, keyPair.privateKey);
  }

  public static fromPem(input: {
    keyId: string;
    privateKeyPem: string;
  }): Ed25519PolicyBundleSigner {
    return new Ed25519PolicyBundleSigner(
      input.keyId,
      createPrivateKey(input.privateKeyPem),
    );
  }

  public sign(payload: SignedPolicyBundle["payload"]): string {
    return sign(
      null,
      Buffer.from(canonicalJson(payload), "utf8"),
      this.#privateKey,
    ).toString("base64");
  }
}

export function policyEntries(
  snapshot: DashboardSnapshot,
): RuntimePolicyEntry[] {
  return snapshot.policies
    .filter((policy) => policy.enabled)
    .sort((left, right) => {
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    })
    .map((policy, order) => ({
      order,
      runtime: policy.runtime,
      profile: "any",
      passThreshold: policy.passThreshold / 100,
      retryLimit: policy.retryLimit,
      requiredCapabilities: policy.requiredCapabilities,
      skillRouting: {
        kind: "unavailable",
        reason:
          "Managed catalog wrapper availability is not connected to the hosted control plane.",
      },
      constraint: EvaluationConstraintSchema.parse({
        policyId: policy.id,
        policyVersionId: `${policy.id}@${policy.updatedAt}`,
        requiredCapabilities: policy.requiredCapabilities,
        skillCandidates: [],
        toolPolicy: { kind: "allow" },
      }),
    }));
}

export function policyBundleStateDigest(input: {
  signingKeyId: string;
  tenantId: string;
  audience: { deviceId: string; adapterInstallationId: string };
  adapterConfigurationDigest: string;
  policies: SignedPolicyBundle["payload"]["policies"];
  dispositionTransitions: SignedPolicyBundle["payload"]["dispositionTransitions"];
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        signingKeyId: input.signingKeyId,
        tenantId: input.tenantId,
        audience: input.audience,
        adapterConfigurationDigest: input.adapterConfigurationDigest,
        policies: input.policies,
        dispositionTransitions: input.dispositionTransitions,
      }),
      "utf8",
    )
    .digest("hex");
}

export function policyBundleExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + POLICY_BUNDLE_VALIDITY_MS);
}

export function policyBundleRequiresRenewal(input: {
  expiresAt: Date;
  now: Date;
}): boolean {
  return (
    input.expiresAt.getTime() <=
    input.now.getTime() + POLICY_BUNDLE_RENEWAL_LEAD_MS
  );
}

export function createSignedPolicyBundle(input: {
  snapshot: DashboardSnapshot;
  signer: PolicyBundleSigner;
  tenantId: string;
  deviceId: string;
  adapterInstallationId: string;
  revision: number;
  adapterConfigurationDigest: string;
  dispositionTransitions: SkillDispositionTransition[];
  now?: Date;
}): SignedPolicyBundle {
  const issuedAt = input.now ?? new Date();
  const payload = SignedPolicyBundlePayloadSchema.parse({
    tenantId: input.tenantId,
    audience: {
      deviceId: input.deviceId,
      adapterInstallationId: input.adapterInstallationId,
    },
    revision: input.revision,
    issuedAt: issuedAt.toISOString(),
    expiresAt: policyBundleExpiresAt(issuedAt).toISOString(),
    adapterConfigurationDigest: input.adapterConfigurationDigest,
    policies: policyEntries(input.snapshot),
    dispositionTransitions: input.dispositionTransitions,
  });
  return SignedPolicyBundleSchema.parse({
    keyId: input.signer.keyId,
    payload,
    signature: input.signer.sign(payload),
  });
}
