import { createHash, createPublicKey, verify } from "node:crypto";

import {
  SignedPolicyBundleSchema,
  parseEvaluationConstraint,
  supportsCapability,
  type AdapterConfigurationDigest,
  type AdapterInstallationId,
  type DeviceId,
  type EvaluationConstraint,
  type HookObservation,
  type SignedPolicyBundlePayload,
  type SignedPolicyBundle,
  type SkillDispositionTransition,
  type TenantId,
} from "@sisyphus/domain";

import { controlPlaneEndpoint } from "./control-plane-endpoint.js";
import type { PolicyProvider } from "./supervisor.js";

export type RuntimeProfile = "local" | "cloud-agent";

export interface WorkerPolicyIdentity {
  readonly tenantId: TenantId;
  readonly deviceId: DeviceId;
  readonly adapterInstallationId: AdapterInstallationId;
  readonly adapterConfigurationDigest: AdapterConfigurationDigest;
  readonly profile: RuntimeProfile;
}

export interface AppliedPolicyBundleState {
  readonly revision: number;
  readonly payloadDigest: string;
  readonly dispositionRevision: number;
  readonly signedBundle?: SignedPolicyBundle;
}

export interface PolicyBundleStateStore {
  policyBundleState(): AppliedPolicyBundleState | undefined;
  recordPolicyBundleState(state: AppliedPolicyBundleState): void;
}

export interface DispositionTransitionApplier {
  applyDispositionTransition(transition: SkillDispositionTransition): Promise<unknown>;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).toSorted(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Policy payload is not canonical JSON.");
}

function payloadDigest(payload: SignedPolicyBundlePayload): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

export function defaultEvaluationConstraint(): EvaluationConstraint {
  return parseEvaluationConstraint({
    policyId: "local-default",
    policyVersionId: "local-default-v1",
    passThreshold: 0.8,
    retryLimit: 2,
    requiredCapabilities: [],
    skillCandidates: [],
    toolPolicy: { kind: "allow" },
  });
}

interface VerifyPolicyBundleInput {
  readonly publicKeys: Readonly<Record<string, string>>;
  readonly identity: WorkerPolicyIdentity;
  readonly now: Date;
}

export function verifyPolicyBundle(
  input: unknown,
  verification: VerifyPolicyBundleInput,
): SignedPolicyBundlePayload {
  const bundle = SignedPolicyBundleSchema.parse(input);
  const publicKeySource = verification.publicKeys[bundle.keyId];
  if (publicKeySource === undefined) throw new Error("Policy bundle key is not trusted.");
  if (Number.isNaN(verification.now.getTime())) throw new Error("Policy clock is invalid.");
  const issuedAt = new Date(bundle.payload.issuedAt);
  const expiresAt = new Date(bundle.payload.expiresAt);
  if (issuedAt > verification.now) throw new Error("Policy bundle is not active yet.");
  if (expiresAt <= verification.now) throw new Error("Policy bundle has expired.");
  if (expiresAt <= issuedAt) throw new Error("Policy bundle lifetime is invalid.");
  if (bundle.payload.tenantId !== verification.identity.tenantId) {
    throw new Error("Policy bundle belongs to a different tenant.");
  }
  if (bundle.payload.audience.deviceId !== verification.identity.deviceId) {
    throw new Error("Policy bundle belongs to a different device.");
  }
  if (
    bundle.payload.audience.adapterInstallationId !==
    verification.identity.adapterInstallationId
  ) {
    throw new Error("Policy bundle belongs to a different adapter installation.");
  }
  if (
    bundle.payload.adapterConfigurationDigest !==
    verification.identity.adapterConfigurationDigest
  ) {
    throw new Error("Policy bundle adapter configuration does not match enrollment.");
  }

  const signature = Buffer.from(bundle.signature, "base64");
  if (signature.length === 0) throw new Error("Policy bundle signature is invalid.");
  const valid = verify(
    null,
    Buffer.from(canonicalJson(bundle.payload), "utf8"),
    createPublicKey(publicKeySource),
    signature,
  );
  if (!valid) throw new Error("Policy bundle signature is invalid.");
  return bundle.payload;
}

export class MutablePolicyProvider implements PolicyProvider {
  readonly #localConstraint: EvaluationConstraint;
  readonly #profile: RuntimeProfile;
  #bundle: SignedPolicyBundlePayload | undefined;

  public constructor(
    initial: EvaluationConstraint,
    input: { readonly profile?: RuntimeProfile } = {},
  ) {
    this.#localConstraint = parseEvaluationConstraint(initial);
    this.#profile = input.profile ?? "local";
  }

  public async constraintFor(event: HookObservation): Promise<EvaluationConstraint> {
    const applicable = this.#bundle?.policies.filter((policy) => {
      if (policy.runtime !== null && policy.runtime !== event.capabilities.runtime) {
        return false;
      }
      if (policy.profile !== "any" && policy.profile !== this.#profile) return false;
      return true;
    });
    const capable = applicable?.find((policy) =>
      policy.requiredCapabilities.every((capability) =>
        supportsCapability(event.capabilities, capability),
      ),
    );
    const selected = capable ?? applicable?.[0];
    if (selected === undefined) return this.#localConstraint;
    return parseEvaluationConstraint({
      ...selected.constraint,
      passThreshold: selected.passThreshold,
      retryLimit: selected.retryLimit,
    });
  }

  public replaceBundle(payload: SignedPolicyBundlePayload): void {
    this.#bundle = payload;
  }
}

interface PolicyBundleSynchronizerInput {
  readonly endpoint: string;
  readonly deviceToken: string;
  readonly provider: MutablePolicyProvider;
  readonly publicKeys: Readonly<Record<string, string>>;
  readonly identity: WorkerPolicyIdentity;
  readonly stateStore: PolicyBundleStateStore;
  readonly transitionApplier: DispositionTransitionApplier;
  readonly now?: (() => Date) | undefined;
  readonly fetchImplementation?: typeof fetch;
}

function policyBundleUrl(endpoint: string): URL {
  return controlPlaneEndpoint({
    baseUrl: endpoint,
    pathname: "/v1/policy-bundle",
    purpose: "Policy control plane",
  });
}

export class PolicyBundleSynchronizer {
  readonly #endpoint: URL;
  readonly #deviceToken: string;
  readonly #provider: MutablePolicyProvider;
  readonly #publicKeys: Readonly<Record<string, string>>;
  readonly #identity: WorkerPolicyIdentity;
  readonly #stateStore: PolicyBundleStateStore;
  readonly #transitionApplier: DispositionTransitionApplier;
  readonly #now: () => Date;
  readonly #fetch: typeof fetch;

  public constructor(input: PolicyBundleSynchronizerInput) {
    if (input.deviceToken.trim() === "") throw new Error("A device token is required.");
    if (Object.keys(input.publicKeys).length === 0) {
      throw new Error("At least one trusted policy key is required.");
    }
    this.#endpoint = policyBundleUrl(input.endpoint);
    this.#deviceToken = input.deviceToken;
    this.#provider = input.provider;
    this.#publicKeys = input.publicKeys;
    this.#identity = input.identity;
    this.#stateStore = input.stateStore;
    this.#transitionApplier = input.transitionApplier;
    this.#now = input.now ?? (() => new Date());
    this.#fetch = input.fetchImplementation ?? fetch;
  }

  public async restore(): Promise<SignedPolicyBundlePayload | undefined> {
    const stored = this.#stateStore.policyBundleState();
    if (stored?.signedBundle === undefined) return undefined;
    const payload = verifyPolicyBundle(stored.signedBundle, {
      publicKeys: this.#publicKeys,
      identity: this.#identity,
      now: this.#now(),
    });
    if (payload.revision !== stored.revision || payloadDigest(payload) !== stored.payloadDigest) {
      throw new Error("Stored policy bundle does not match its persisted state.");
    }
    const maximumTransitionRevision = payload.dispositionTransitions.at(-1)?.revision ?? 0;
    if (maximumTransitionRevision !== stored.dispositionRevision) {
      throw new Error("Stored policy disposition revision does not match its payload.");
    }
    this.#provider.replaceBundle(payload);
    return payload;
  }

  public async refresh(): Promise<SignedPolicyBundlePayload> {
    const response = await this.#fetch(this.#endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${this.#deviceToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Policy control plane returned HTTP ${response.status}.`);
    }
    const signedBundle = SignedPolicyBundleSchema.parse(await response.json());
    const payload = verifyPolicyBundle(signedBundle, {
      publicKeys: this.#publicKeys,
      identity: this.#identity,
      now: this.#now(),
    });
    const digest = payloadDigest(payload);
    const previous = this.#stateStore.policyBundleState();
    if (previous !== undefined && payload.revision < previous.revision) {
      throw new Error("Policy bundle revision is older than the applied revision.");
    }
    if (
      previous !== undefined &&
      payload.revision === previous.revision &&
      digest !== previous.payloadDigest
    ) {
      throw new Error("Policy bundle revision was reused with different content.");
    }

    let dispositionRevision = previous?.dispositionRevision ?? 0;
    for (const transition of payload.dispositionTransitions) {
      if (transition.revision <= dispositionRevision) continue;
      if (transition.revision !== dispositionRevision + 1) {
        throw new Error("Policy bundle is missing a disposition transition revision.");
      }
      await this.#transitionApplier.applyDispositionTransition(transition);
      dispositionRevision = transition.revision;
    }
    this.#stateStore.recordPolicyBundleState({
      revision: payload.revision,
      payloadDigest: digest,
      dispositionRevision,
      signedBundle,
    });
    this.#provider.replaceBundle(payload);
    return payload;
  }
}
