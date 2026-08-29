import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PromptObservationSchema,
  SignedPolicyBundlePayloadSchema,
  createAdapterInstallationId,
  createDeviceId,
  createSkillVersionId,
  createTenantId,
  createTimestamp,
  type SignedPolicyBundlePayload,
  type SkillDispositionTransition,
} from "@sisyphus/domain";
import { describe, expect, it } from "vitest";

import {
  MutablePolicyProvider,
  PolicyBundleSynchronizer,
  canonicalJson,
  defaultEvaluationConstraint,
  verifyPolicyBundle,
  type AppliedPolicyBundleState,
  type WorkerPolicyIdentity,
} from "./policy.js";
import { LocalJournal } from "./journal.js";

const adapterConfigurationDigest = "a".repeat(64);
const identity: WorkerPolicyIdentity = {
  tenantId: createTenantId("tenant-acme"),
  deviceId: createDeviceId("device-delta"),
  adapterInstallationId: createAdapterInstallationId("installation-codex-local"),
  adapterConfigurationDigest,
  profile: "local",
};

const observation = PromptObservationSchema.parse({
  kind: "prompt",
  eventId: "policy-prompt",
  workItemId: "policy-work",
  retryBudgetId: "policy-budget",
  runId: "policy-run",
  occurredAt: "2026-08-29T12:00:00.000Z",
  adapterVersion: "0.1.0",
  runtimeInstallation: {
    adapterInstallationId: "installation-codex-local",
    profile: "local",
  },
  capabilities: {
    runtime: "codex",
    runtimeVersion: "0.99.0",
    promptInterception: { kind: "supported" },
    skillSelectionControl: { kind: "supported" },
    rootStopContinuation: { kind: "supported" },
    subagentStopContinuation: { kind: "supported" },
    toolPrevention: { kind: "supported" },
    toolObservation: { kind: "supported" },
    stableTokenUsage: { kind: "unsupported", reason: "not reported" },
    localEvidenceAccess: { kind: "partial", limitation: "transcript optional" },
  },
  identity: {
    sessionId: "policy-session",
    agent: { kind: "root", agentId: "policy-agent" },
  },
  prompt: "apply policy",
});

function payload(input: {
  revision?: number;
  tenantId?: string;
  transitions?: SkillDispositionTransition[];
} = {}): SignedPolicyBundlePayload {
  const constraint = {
    ...defaultEvaluationConstraint(),
    toolPolicy: { kind: "deny" as const, reason: "blocked by signed team policy" },
  };
  return SignedPolicyBundlePayloadSchema.parse({
    tenantId: input.tenantId ?? identity.tenantId,
    audience: {
      deviceId: identity.deviceId,
      adapterInstallationId: identity.adapterInstallationId,
    },
    revision: input.revision ?? 1,
    issuedAt: "2026-08-29T10:00:00.000Z",
    expiresAt: "2026-08-30T10:00:00.000Z",
    adapterConfigurationDigest,
    policies: [
      {
        order: 0,
        runtime: "codex",
        profile: "local",
        passThreshold: 0.8,
        retryLimit: 2,
        requiredCapabilities: [],
        skillRouting: {
          kind: "unavailable",
          reason: "No managed wrapper is installed for this fixture.",
        },
        constraint,
      },
    ],
    dispositionTransitions: input.transitions ?? [],
  });
}

function signedBundle(value: SignedPolicyBundlePayload) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    bundle: {
      keyId: "team-key-1",
      payload: value,
      signature: sign(null, Buffer.from(canonicalJson(value)), privateKey).toString(
        "base64",
      ),
    },
    publicKeys: {
      "team-key-1": publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
  };
}

describe("signed policy bundles", () => {
  it("verifies the audience and selects the ordered runtime policy", async () => {
    const signed = signedBundle(payload());
    const verified = verifyPolicyBundle(signed.bundle, {
      publicKeys: signed.publicKeys,
      identity,
      now: new Date("2026-08-29T12:00:00.000Z"),
    });
    const provider = new MutablePolicyProvider(defaultEvaluationConstraint());
    provider.replaceBundle(verified);

    await expect(provider.constraintFor(observation)).resolves.toMatchObject({
      toolPolicy: { kind: "deny", reason: "blocked by signed team policy" },
    });
  });

  it("rejects tampering and cross-tenant reuse", () => {
    const original = payload();
    const signed = signedBundle(original);
    expect(() =>
      verifyPolicyBundle(
        {
          ...signed.bundle,
          payload: {
            ...original,
            policies: original.policies.map((entry) => ({
              ...entry,
              constraint: {
                ...entry.constraint,
                toolPolicy: { kind: "allow" as const },
              },
            })),
          },
        },
        {
          publicKeys: signed.publicKeys,
          identity,
          now: new Date("2026-08-29T12:00:00.000Z"),
        },
      ),
    ).toThrow("signature");

    const otherTenant = signedBundle(payload({ tenantId: "tenant-other" }));
    expect(() =>
      verifyPolicyBundle(otherTenant.bundle, {
        publicKeys: otherTenant.publicKeys,
        identity,
        now: new Date("2026-08-29T12:00:00.000Z"),
      }),
    ).toThrow("different tenant");
  });

  it("applies transitions once and persists the monotonic bundle revision", async () => {
    const transition: SkillDispositionTransition = {
      kind: "restoration",
      skillVersionId: createSkillVersionId("skill-version-1"),
      reason: "Administrator reviewed and restored this version.",
      actor: "admin@example.test",
      occurredAt: createTimestamp("2026-08-29T11:00:00.000Z"),
      revision: 1,
    };
    const signed = signedBundle(payload({ revision: 2, transitions: [transition] }));
    const provider = new MutablePolicyProvider(defaultEvaluationConstraint());
    let state: AppliedPolicyBundleState | undefined;
    const applied: SkillDispositionTransition[] = [];
    const synchronizer = new PolicyBundleSynchronizer({
      endpoint: "http://127.0.0.1:7332",
      deviceToken: "device-token",
      provider,
      publicKeys: signed.publicKeys,
      identity,
      stateStore: {
        policyBundleState: () => state,
        recordPolicyBundleState: (next) => {
          state = next;
        },
      },
      transitionApplier: {
        async applyDispositionTransition(next) {
          applied.push(next);
        },
      },
      now: () => new Date("2026-08-29T12:00:00.000Z"),
      fetchImplementation: async (url, init) => {
        expect(String(url)).toBe("http://127.0.0.1:7332/v1/policy-bundle");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer device-token",
        );
        return new Response(JSON.stringify(signed.bundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await synchronizer.refresh();
    await synchronizer.refresh();

    expect(applied).toEqual([transition]);
    expect(state).toMatchObject({ revision: 2, dispositionRevision: 1 });
    await expect(provider.constraintFor(observation)).resolves.toMatchObject({
      toolPolicy: { kind: "deny" },
    });
  });

  it("restores and re-verifies the exact signed bundle before an offline restart serves work", async () => {
    const signed = signedBundle(payload({ revision: 3 }));
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-policy-restart-"));
    const databasePath = join(directory, "worker.db");
    const firstJournal = new LocalJournal({ path: databasePath });
    const firstProvider = new MutablePolicyProvider(defaultEvaluationConstraint());
    const first = new PolicyBundleSynchronizer({
      endpoint: "http://127.0.0.1:7332",
      deviceToken: "device-token",
      provider: firstProvider,
      publicKeys: signed.publicKeys,
      identity,
      stateStore: firstJournal,
      transitionApplier: { applyDispositionTransition: async () => undefined },
      now: () => new Date("2026-08-29T12:00:00.000Z"),
      fetchImplementation: async () =>
        new Response(JSON.stringify(signed.bundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await first.refresh();
    firstJournal.close();

    const restartedJournal = new LocalJournal({ path: databasePath });
    const restartedProvider = new MutablePolicyProvider(defaultEvaluationConstraint());
    const restarted = new PolicyBundleSynchronizer({
      endpoint: "http://127.0.0.1:7332",
      deviceToken: "device-token",
      provider: restartedProvider,
      publicKeys: signed.publicKeys,
      identity,
      stateStore: restartedJournal,
      transitionApplier: { applyDispositionTransition: async () => undefined },
      now: () => new Date("2026-08-29T12:01:00.000Z"),
      fetchImplementation: async () => {
        throw new Error("offline");
      },
    });

    await expect(restarted.restore()).resolves.toMatchObject({ revision: 3 });
    await expect(restartedProvider.constraintFor(observation)).resolves.toMatchObject({
      passThreshold: 0.8,
      retryLimit: 2,
      toolPolicy: { kind: "deny", reason: "blocked by signed team policy" },
    });
    await expect(restarted.refresh()).rejects.toThrow("offline");
    restartedJournal.close();
  });

  it("rejects rollback below the persisted revision", async () => {
    const signed = signedBundle(payload({ revision: 1 }));
    const synchronizer = new PolicyBundleSynchronizer({
      endpoint: "http://127.0.0.1:7332",
      deviceToken: "device-token",
      provider: new MutablePolicyProvider(defaultEvaluationConstraint()),
      publicKeys: signed.publicKeys,
      identity,
      stateStore: {
        policyBundleState: () => ({
          revision: 2,
          payloadDigest: "b".repeat(64),
          dispositionRevision: 0,
        }),
        recordPolicyBundleState: () => undefined,
      },
      transitionApplier: { applyDispositionTransition: async () => undefined },
      now: () => new Date("2026-08-29T12:00:00.000Z"),
      fetchImplementation: async () =>
        new Response(JSON.stringify(signed.bundle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(synchronizer.refresh()).rejects.toThrow("older");
  });
});
