import { z } from "zod";

import {
  SkillVersionIdSchema,
  SkillVersionKeySchema,
  TimestampSchema,
  TriggerIdSchema,
} from "./identifiers.js";

export const SkillDispositionSchema = z.enum([
  "active",
  "probation",
  "quarantined",
  "revoked",
]);
export type SkillDisposition = z.infer<typeof SkillDispositionSchema>;

const dispositionTransitionBase = {
  skillVersionId: SkillVersionIdSchema,
  reason: z.string().trim().min(8).max(500),
  actor: z.string().trim().min(1).max(240),
  occurredAt: TimestampSchema,
  revision: z.number().int().positive(),
};

export const SkillDispositionTransitionSchema = z.discriminatedUnion("kind", [
  z.object({ ...dispositionTransitionBase, kind: z.literal("quarantine") }).strict(),
  z.object({ ...dispositionTransitionBase, kind: z.literal("probation") }).strict(),
  z.object({ ...dispositionTransitionBase, kind: z.literal("restoration") }).strict(),
  z.object({ ...dispositionTransitionBase, kind: z.literal("revocation") }).strict(),
]);
export type SkillDispositionTransition = z.infer<
  typeof SkillDispositionTransitionSchema
>;

export const SkillTriggerSchema = z.object({
  triggerId: TriggerIdSchema,
  kind: z.enum(["exact", "prefix", "contains", "regex"]),
  pattern: z.string().min(1),
});
export type SkillTrigger = z.infer<typeof SkillTriggerSchema>;

export const SkillMatchCandidateSchema = z.object({
  skillVersionId: SkillVersionIdSchema,
  stableVersionKey: SkillVersionKeySchema,
  displayName: z.string().trim().min(1),
  administratorPriority: z.number().int(),
  specificity: z.number().int().nonnegative(),
  disposition: SkillDispositionSchema,
  activationAvailability: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("available") }).strict(),
      z
        .object({
          kind: z.literal("unavailable"),
          reason: z.string().trim().min(1).max(500),
        })
        .strict(),
    ])
    .optional(),
  trigger: SkillTriggerSchema,
});
export type SkillMatchCandidate = z.infer<typeof SkillMatchCandidateSchema>;

export const CandidateRejectionReasonSchema = z.enum([
  "quarantined",
  "revoked",
  "wrapper-unavailable",
  "lower-priority",
  "lower-specificity",
  "lexical-tiebreak",
]);
export type CandidateRejectionReason = z.infer<typeof CandidateRejectionReasonSchema>;

export const ResolvedCandidateSchema = z.object({
  candidate: SkillMatchCandidateSchema,
  outcome: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("selected") }),
    z.object({
      kind: z.literal("rejected"),
      reason: CandidateRejectionReasonSchema,
    }),
  ]),
});
export type ResolvedCandidate = z.infer<typeof ResolvedCandidateSchema>;

export const SkillResolutionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("none"),
    candidates: z.array(ResolvedCandidateSchema),
  }),
  z.object({
    kind: z.literal("selected"),
    selected: SkillMatchCandidateSchema,
    candidates: z.array(ResolvedCandidateSchema),
  }),
]);
export type SkillResolution = z.infer<typeof SkillResolutionSchema>;

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCandidates(left: SkillMatchCandidate, right: SkillMatchCandidate): number {
  const priority = right.administratorPriority - left.administratorPriority;
  if (priority !== 0) return priority;

  const specificity = right.specificity - left.specificity;
  if (specificity !== 0) return specificity;

  return compareCodeUnits(left.skillVersionId, right.skillVersionId);
}

function rejectionAgainstWinner(
  candidate: SkillMatchCandidate,
  winner: SkillMatchCandidate,
): CandidateRejectionReason {
  if (candidate.administratorPriority < winner.administratorPriority) {
    return "lower-priority";
  }
  if (candidate.specificity < winner.specificity) {
    return "lower-specificity";
  }
  return "lexical-tiebreak";
}

export function resolveSkill(candidates: readonly SkillMatchCandidate[]): SkillResolution {
  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.disposition !== "quarantined" &&
        candidate.disposition !== "revoked" &&
        candidate.activationAvailability?.kind !== "unavailable",
    )
    .toSorted(compareCandidates);
  const winner = eligible[0];

  const resolved = candidates.map((candidate): ResolvedCandidate => {
    if (candidate.disposition === "quarantined") {
      return { candidate, outcome: { kind: "rejected", reason: "quarantined" } };
    }
    if (candidate.disposition === "revoked") {
      return { candidate, outcome: { kind: "rejected", reason: "revoked" } };
    }
    if (candidate.activationAvailability?.kind === "unavailable") {
      return {
        candidate,
        outcome: { kind: "rejected", reason: "wrapper-unavailable" },
      };
    }
    if (winner === undefined) {
      return { candidate, outcome: { kind: "rejected", reason: "lexical-tiebreak" } };
    }
    if (candidate.skillVersionId === winner.skillVersionId) {
      return { candidate, outcome: { kind: "selected" } };
    }
    return {
      candidate,
      outcome: { kind: "rejected", reason: rejectionAgainstWinner(candidate, winner) },
    };
  });

  if (winner === undefined) {
    return { kind: "none", candidates: resolved };
  }
  return { kind: "selected", selected: winner, candidates: resolved };
}
