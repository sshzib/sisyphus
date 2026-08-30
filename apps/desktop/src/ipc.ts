import { z } from "zod";

export const desktopChannels = {
  authenticate: "sisyphus:authenticate",
  authenticationState: "sisyphus:authentication-state",
  hostContext: "sisyphus:host-context",
  localEvidence: "sisyphus:local-evidence",
  dataSource: "sisyphus:data-source",
  dashboard: "sisyphus:dashboard",
  createEngineeringTask: "sisyphus:create-engineering-task",
  skillRegistryList: "sisyphus:skill-registry-list",
  skillRegistryDetail: "sisyphus:skill-registry-detail",
  skillRegistrySync: "sisyphus:skill-registry-sync",
  skillRegistrySyncPreview: "sisyphus:skill-registry-sync-preview",
  skillRegistryCustom: "sisyphus:skill-registry-custom",
  skillRegistryProposal: "sisyphus:skill-registry-proposal",
  restoreSkill: "sisyphus:restore-skill",
} satisfies Record<string, string>;

export const DesktopLoginCredentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(128),
    password: z.string().min(1).max(128),
  })
  .strict();

export const DesktopAuthenticationStateSchema = z.enum([
  "authenticated",
  "login-required",
]);

export const LocalEvidenceResponseSchema = z
  .object({
    eventId: z.string().trim().min(1).max(512),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    evidence: z.string().max(8 * 1024 * 1024),
  })
  .strict();
export type LocalEvidenceResponse = z.infer<typeof LocalEvidenceResponseSchema>;
