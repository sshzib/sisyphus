import { z } from "zod";

export const desktopChannels = {
  hostContext: "sisyphus:host-context",
  localEvidence: "sisyphus:local-evidence",
} satisfies Record<string, string>;

export const LocalEvidenceResponseSchema = z
  .object({
    eventId: z.string().trim().min(1).max(512),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    evidence: z.string().max(8 * 1024 * 1024),
  })
  .strict();
export type LocalEvidenceResponse = z.infer<typeof LocalEvidenceResponseSchema>;
