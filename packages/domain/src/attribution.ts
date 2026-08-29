import { z } from "zod";

import { ActivationLeaseIdSchema, SkillVersionIdSchema } from "./identifiers.js";

export const SkillActivationEvidenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("verified"),
      skillVersionId: SkillVersionIdSchema,
      activationLeaseId: ActivationLeaseIdSchema,
      method: z.enum(["activation-marker", "managed-invocation"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("inferred"),
      skillVersionId: SkillVersionIdSchema,
      reason: z.string().trim().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);
export type SkillActivationEvidence = z.infer<typeof SkillActivationEvidenceSchema>;
export type SkillAttribution = SkillActivationEvidence;
export const SkillAttributionSchema = SkillActivationEvidenceSchema;

export function isSanctionableAttribution(
  attribution: SkillAttribution,
): attribution is Extract<SkillAttribution, { kind: "verified" }> {
  return attribution.kind === "verified";
}
