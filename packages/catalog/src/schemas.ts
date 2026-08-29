import { z } from "zod";

import {
  AgentRuntimeSchema,
  SkillIdSchema,
  SkillVersionIdSchema,
  SkillVersionKeySchema,
  TimestampSchema,
  TriggerIdSchema,
} from "@sisyphus/domain";

export const ContentHashSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/)
  .brand<"ContentHash">();
export type ContentHash = z.infer<typeof ContentHashSchema>;
export const createContentHash = ContentHashSchema.parse;

export const WrapperIdSchema = z.string().trim().min(1).brand<"WrapperId">();
export type WrapperId = z.infer<typeof WrapperIdSchema>;
export const createWrapperId = WrapperIdSchema.parse;

export const CanonicalSkillSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().trim().min(1) }).strict(),
  z
    .object({ kind: z.literal("package-resource"), locator: z.string().trim().min(1) })
    .strict(),
]);
export type CanonicalSkillSource = z.infer<typeof CanonicalSkillSourceSchema>;

export const CanonicalTriggerInputSchema = z
  .object({
    kind: z.enum(["exact", "prefix", "contains", "regex"]),
    pattern: z.string().trim().min(1).max(512),
  })
  .strict();
export type CanonicalTriggerInput = z.infer<typeof CanonicalTriggerInputSchema>;

export const CanonicalSkillImportSchema = z
  .object({
    skillId: SkillIdSchema,
    displayName: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2_000),
    canonicalContent: z.string().min(1),
    source: CanonicalSkillSourceSchema,
    triggers: z.array(CanonicalTriggerInputSchema).min(1),
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, trigger] of input.triggers.entries()) {
      const key = `${trigger.kind}\u0000${trigger.pattern}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["triggers", index],
          message: "duplicate trigger",
        });
      }
      seen.add(key);
      if (trigger.kind === "regex") {
        try {
          new RegExp(trigger.pattern, "iu");
        } catch (error: unknown) {
          context.addIssue({
            code: "custom",
            path: ["triggers", index, "pattern"],
            message: `invalid regular expression: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          });
        }
      }
    }
  });
export type CanonicalSkillImport = z.infer<typeof CanonicalSkillImportSchema>;

export const CanonicalTriggerSchema = z
  .object({
    triggerId: TriggerIdSchema,
    kind: z.enum(["exact", "prefix", "contains", "regex"]),
    pattern: z.string().min(1),
    specificity: z.number().int().nonnegative(),
  })
  .strict();
export type CanonicalTrigger = z.infer<typeof CanonicalTriggerSchema>;

export const SkillVersionLineageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("initial") }).strict(),
  z
    .object({
      kind: z.literal("successor"),
      previousVersionId: SkillVersionIdSchema,
    })
    .strict(),
]);
export type SkillVersionLineage = z.infer<typeof SkillVersionLineageSchema>;

export const CanonicalSkillVersionSchema = z
  .object({
    skillId: SkillIdSchema,
    skillVersionId: SkillVersionIdSchema,
    stableVersionKey: SkillVersionKeySchema,
    contentHash: ContentHashSchema,
    definitionHash: ContentHashSchema,
    displayName: z.string().trim().min(1),
    description: z.string().trim().min(1),
    canonicalContent: z.string().min(1),
    source: CanonicalSkillSourceSchema,
    triggers: z.array(CanonicalTriggerSchema).min(1),
    lineage: SkillVersionLineageSchema,
    importedAt: TimestampSchema,
  })
  .strict();
export type CanonicalSkillVersion = z.infer<typeof CanonicalSkillVersionSchema>;

export const WrapperReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("file"),
      path: z.string().trim().min(1),
      contentHash: ContentHashSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("plugin-resource"),
      locator: z.string().trim().min(1),
      contentHash: ContentHashSchema,
    })
    .strict(),
]);
export type WrapperReference = z.infer<typeof WrapperReferenceSchema>;

export const RegisterRuntimeWrapperSchema = z
  .object({
    runtime: AgentRuntimeSchema,
    skillVersionId: SkillVersionIdSchema,
    reference: WrapperReferenceSchema,
    registeredAt: TimestampSchema,
  })
  .strict();
export type RegisterRuntimeWrapper = z.infer<typeof RegisterRuntimeWrapperSchema>;

export const RuntimeSkillWrapperSchema = z
  .object({
    wrapperId: WrapperIdSchema,
    runtime: AgentRuntimeSchema,
    skillVersionId: SkillVersionIdSchema,
    reference: WrapperReferenceSchema,
    registeredAt: TimestampSchema,
  })
  .strict();
export type RuntimeSkillWrapper = z.infer<typeof RuntimeSkillWrapperSchema>;

export const MatchPromptInputSchema = z
  .object({ prompt: z.string().trim().min(1) })
  .strict();
export type MatchPromptInput = z.infer<typeof MatchPromptInputSchema>;

export const SetAdministratorPrioritySchema = z
  .object({
    skillId: SkillIdSchema,
    priority: z.number().int(),
  })
  .strict();
export type SetAdministratorPriority = z.infer<typeof SetAdministratorPrioritySchema>;

export const parseCanonicalSkillImport = CanonicalSkillImportSchema.parse;
export const parseRegisterRuntimeWrapper = RegisterRuntimeWrapperSchema.parse;
export const parseMatchPromptInput = MatchPromptInputSchema.parse;
