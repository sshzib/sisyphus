import { z } from "zod";

import { AgentRuntimeSchema, CapabilityNameSchema } from "./capabilities.js";
import { EvaluationConstraintSchema } from "./evaluation.js";
import {
  AdapterInstallationIdSchema,
  DeviceIdSchema,
  TenantIdSchema,
  TimestampSchema,
} from "./identifiers.js";
import { SkillDispositionTransitionSchema } from "./skills.js";

export const AdapterConfigurationDigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u);
export type AdapterConfigurationDigest = z.infer<
  typeof AdapterConfigurationDigestSchema
>;

export const PolicyBundleAudienceSchema = z
  .object({
    deviceId: DeviceIdSchema,
    adapterInstallationId: AdapterInstallationIdSchema,
  })
  .strict();
export type PolicyBundleAudience = z.infer<typeof PolicyBundleAudienceSchema>;

export const RuntimePolicyEntrySchema = z
  .object({
    order: z.number().int().nonnegative(),
    runtime: AgentRuntimeSchema.nullable(),
    profile: z.enum(["local", "cloud-agent", "any"]),
    passThreshold: z.number().min(0).max(1),
    retryLimit: z.number().int().min(0).max(2),
    requiredCapabilities: z.array(CapabilityNameSchema),
    skillRouting: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("available") }).strict(),
      z
        .object({
          kind: z.literal("unavailable"),
          reason: z.string().trim().min(1).max(500),
        })
        .strict(),
    ]),
    constraint: EvaluationConstraintSchema,
  })
  .strict();
export type RuntimePolicyEntry = z.infer<typeof RuntimePolicyEntrySchema>;

export const SignedPolicyBundlePayloadSchema = z
  .object({
    tenantId: TenantIdSchema,
    audience: PolicyBundleAudienceSchema,
    revision: z.number().int().positive(),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    adapterConfigurationDigest: AdapterConfigurationDigestSchema,
    policies: z.array(RuntimePolicyEntrySchema),
    dispositionTransitions: z.array(SkillDispositionTransitionSchema),
  })
  .strict()
  .superRefine((payload, context) => {
    if (Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)) {
      context.addIssue({
        code: "custom",
        message: "Policy bundle expiry must be after issuance.",
        path: ["expiresAt"],
      });
    }
    let previousRevision = 0;
    const revokedSkills = new Set<string>();
    for (const [index, transition] of payload.dispositionTransitions.entries()) {
      if (transition.revision <= previousRevision) {
        context.addIssue({
          code: "custom",
          message: "Disposition transition revisions must be strictly increasing.",
          path: ["dispositionTransitions", index, "revision"],
        });
      }
      previousRevision = transition.revision;
      if (
        revokedSkills.has(transition.skillVersionId) &&
        transition.kind !== "revocation"
      ) {
        context.addIssue({
          code: "custom",
          message: "A revoked skill version cannot transition back to service.",
          path: ["dispositionTransitions", index],
        });
      }
      if (transition.kind === "revocation") {
        revokedSkills.add(transition.skillVersionId);
      }
    }
    for (const [index, policy] of payload.policies.entries()) {
      if (policy.order !== index) {
        context.addIssue({
          code: "custom",
          message: "Policy entries must use contiguous bundle order.",
          path: ["policies", index, "order"],
        });
      }
      if (
        policy.skillRouting.kind === "unavailable" &&
        policy.constraint.skillCandidates.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Unavailable skill routing cannot contain candidates.",
          path: ["policies", index, "constraint", "skillCandidates"],
        });
      }
      if (
        policy.skillRouting.kind === "available" &&
        policy.constraint.skillCandidates.length === 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Available skill routing requires at least one managed candidate.",
          path: ["policies", index, "constraint", "skillCandidates"],
        });
      }
      if (
        policy.requiredCapabilities.length !==
          policy.constraint.requiredCapabilities.length ||
        policy.requiredCapabilities.some(
          (capability, capabilityIndex) =>
            capability !==
            policy.constraint.requiredCapabilities[capabilityIndex],
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Policy applicability capabilities must match the evaluation constraint.",
          path: ["policies", index, "requiredCapabilities"],
        });
      }
      if (
        policy.constraint.passThreshold !== undefined &&
        policy.constraint.passThreshold !== policy.passThreshold
      ) {
        context.addIssue({
          code: "custom",
          message: "Constraint pass threshold must match the runtime policy entry.",
          path: ["policies", index, "constraint", "passThreshold"],
        });
      }
      if (
        policy.constraint.retryLimit !== undefined &&
        policy.constraint.retryLimit !== policy.retryLimit
      ) {
        context.addIssue({
          code: "custom",
          message: "Constraint retry limit must match the runtime policy entry.",
          path: ["policies", index, "constraint", "retryLimit"],
        });
      }
    }
  });
export type SignedPolicyBundlePayload = z.infer<
  typeof SignedPolicyBundlePayloadSchema
>;

export const SignedPolicyBundleSchema = z
  .object({
    keyId: z.string().trim().min(1).max(160),
    payload: SignedPolicyBundlePayloadSchema,
    signature: z
      .string()
      .min(1)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  })
  .strict();
export type SignedPolicyBundle = z.infer<typeof SignedPolicyBundleSchema>;
