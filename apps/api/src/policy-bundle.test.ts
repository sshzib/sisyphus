import { SkillDispositionTransitionSchema } from "@sisyphus/domain";
import { createDemoSnapshot } from "@sisyphus/ui/demo";
import { describe, expect, it } from "vitest";
import {
  POLICY_BUNDLE_RENEWAL_LEAD_MS,
  POLICY_BUNDLE_VALIDITY_MS,
  policyBundleExpiresAt,
  policyBundleRequiresRenewal,
  policyBundleStateDigest,
  policyEntries,
} from "./policy-bundle.js";

function digest(input?: {
  adapterConfigurationDigest?: string;
  policyThresholdDelta?: number;
  transition?: boolean;
}): string {
  const snapshot = createDemoSnapshot();
  const policies = policyEntries({
    ...snapshot,
    policies: snapshot.policies.map((policy, index) =>
      index === 0 && input?.policyThresholdDelta !== undefined
        ? {
            ...policy,
            passThreshold:
              policy.passThreshold + input.policyThresholdDelta,
          }
        : policy,
    ),
  });
  return policyBundleStateDigest({
    signingKeyId: "policy-key",
    tenantId: "tenant-acme",
    audience: {
      deviceId: "device-delta",
      adapterInstallationId: "installation-codex-local",
    },
    adapterConfigurationDigest:
      input?.adapterConfigurationDigest ?? "a".repeat(64),
    policies,
    dispositionTransitions:
      input?.transition === true
        ? [
            SkillDispositionTransitionSchema.parse({
              kind: "quarantine",
              skillVersionId: "skill-ts-review@4.2.1",
              reason: "Verified failure threshold reached.",
              actor: "device:device-delta",
              occurredAt: "2026-08-29T10:10:00.000Z",
              revision: 1,
            }),
          ]
        : [],
  });
}

describe("policy bundle issuance state", () => {
  it("changes its digest only for authoritative signed content", () => {
    const baseline = digest();
    expect(digest()).toBe(baseline);
    expect(digest({ adapterConfigurationDigest: "b".repeat(64) })).not.toBe(
      baseline,
    );
    expect(digest({ policyThresholdDelta: -1 })).not.toBe(baseline);
    expect(digest({ transition: true })).not.toBe(baseline);
  });

  it("renews at the lead-time boundary", () => {
    const issuedAt = new Date("2026-08-29T10:00:00.000Z");
    const expiresAt = policyBundleExpiresAt(issuedAt);
    expect(expiresAt.getTime() - issuedAt.getTime()).toBe(
      POLICY_BUNDLE_VALIDITY_MS,
    );
    expect(
      policyBundleRequiresRenewal({
        expiresAt,
        now: new Date(
          expiresAt.getTime() - POLICY_BUNDLE_RENEWAL_LEAD_MS - 1,
        ),
      }),
    ).toBe(false);
    expect(
      policyBundleRequiresRenewal({
        expiresAt,
        now: new Date(
          expiresAt.getTime() - POLICY_BUNDLE_RENEWAL_LEAD_MS,
        ),
      }),
    ).toBe(true);
  });
});
