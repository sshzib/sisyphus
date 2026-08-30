import { resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { z } from "zod";
import {
  createOpenRouterTierPolicy,
  type OpenRouterTierPolicy,
} from "./model-tier-policy.js";

const AbsoluteHttpUrlSchema = z
  .string()
  .url()
  .transform((value) => new URL(value))
  .superRefine((url, context) => {
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      context.addIssue({ code: "custom", message: "Expected an HTTP(S) URL." });
    }
    if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
      context.addIssue({
        code: "custom",
        message: "The URL cannot contain credentials, a query, or a fragment.",
      });
    }
  });

const RawEnvironmentSchema = z.object({
  SISYPHUS_API_URL: AbsoluteHttpUrlSchema,
  SISYPHUS_ORCHESTRATOR_TOKEN: z.string().min(32).max(512),
  SISYPHUS_ORCHESTRATOR_TENANT_ID: z.string().trim().min(1).max(160),
  SISYPHUS_ORCHESTRATOR_POLL_MS: z.coerce.number().int().min(500).max(60_000).default(2_000),
  SISYPHUS_ORCHESTRATOR_MAX_AGENTS: z.coerce.number().int().min(1).max(12).default(12),
  SISYPHUS_ORCHESTRATOR_MAX_SKILLS_PER_AGENT: z.coerce.number().int().min(1).max(4).default(3),
  SISYPHUS_ORCHESTRATOR_WORKSPACE_ROOT: z.string().trim().min(1).optional(),
  SISYPHUS_EXECUTION_ARCHIVE_ROOT: z.string().trim().min(1).optional(),
  SISYPHUS_OPENROUTER_API_KEY: z.string().trim().min(20).max(2_000).optional(),
  SISYPHUS_OPENROUTER_MODEL: z.string().trim().min(1).max(200).optional(),
  SISYPHUS_OPENROUTER_FALLBACK_MODEL: z.string().trim().min(1).max(200).optional(),
  SISYPHUS_OPENROUTER_ROLE_MODELS: z.string().trim().max(10_000).optional(),
  SISYPHUS_EXECUTION_MODE: z.enum(["local-static", "codebuild"]).optional(),
  AWS_REGION: z.string().trim().min(1).max(80).optional(),
  SISYPHUS_CODEBUILD_PROJECT: z.string().trim().min(1).max(255).optional(),
  SISYPHUS_ARTIFACT_BUCKET: z.string().trim().min(3).max(63).optional(),
  SISYPHUS_ARTIFACT_INPUT_PREFIX: z.string().trim().min(1).max(500).default("engineering/input"),
  SISYPHUS_ARTIFACT_RESULT_PREFIX: z.string().trim().min(1).max(500).default("engineering/results"),
});

const RoleModelsSchema = z.record(
  z.string().trim().min(2).max(80),
  z.string().trim().min(1).max(200),
);
type RawEnvironment = z.infer<typeof RawEnvironmentSchema>;

export type OrchestratorConfiguration = {
  apiUrl: string;
  orchestratorToken: string;
  tenantId: string;
  pollMilliseconds: number;
  maxAgents: number;
  maxSkillsPerAgent: number;
  workspaceRoot: string;
  executionArchiveRoot: string;
  openRouter:
    | { kind: "disabled" }
    | {
        kind: "enabled";
        apiKey: string;
        tierPolicy: OpenRouterTierPolicy;
      };
  codebuild:
    | {
        kind: "codebuild";
        region: string;
        projectName: string;
        artifactBucket: string;
        inputPrefix: string;
        resultPrefix: string;
      }
    | undefined;
};

export function parseOrchestratorConfiguration(
  input: NodeJS.ProcessEnv,
): OrchestratorConfiguration {
  const environment = RawEnvironmentSchema.parse(input);
  const providerConfigured =
    environment.SISYPHUS_OPENROUTER_API_KEY !== undefined ||
    environment.SISYPHUS_OPENROUTER_MODEL !== undefined ||
    environment.SISYPHUS_OPENROUTER_FALLBACK_MODEL !== undefined ||
    environment.SISYPHUS_OPENROUTER_ROLE_MODELS !== undefined;
  if (
    providerConfigured &&
    environment.SISYPHUS_OPENROUTER_API_KEY === undefined
  ) {
    throw new Error(
      "SISYPHUS_OPENROUTER_API_KEY is required when OpenRouter model settings are configured.",
    );
  }
  const codeBuildConfigured =
    environment.AWS_REGION !== undefined ||
    environment.SISYPHUS_CODEBUILD_PROJECT !== undefined ||
    environment.SISYPHUS_ARTIFACT_BUCKET !== undefined;
  const executionMode = environment.SISYPHUS_EXECUTION_MODE;
  if (
    (codeBuildConfigured || executionMode === "codebuild") &&
    (environment.AWS_REGION === undefined ||
      environment.SISYPHUS_CODEBUILD_PROJECT === undefined ||
      environment.SISYPHUS_ARTIFACT_BUCKET === undefined)
  ) {
    throw new Error(
      "AWS_REGION, SISYPHUS_CODEBUILD_PROJECT, and SISYPHUS_ARTIFACT_BUCKET must be configured together.",
    );
  }
  const roleModels =
    environment.SISYPHUS_OPENROUTER_ROLE_MODELS === undefined
      ? {}
      : RoleModelsSchema.parse(JSON.parse(environment.SISYPHUS_OPENROUTER_ROLE_MODELS));
  const codebuild = codeBuildConfiguration(environment);
  return {
    apiUrl: environment.SISYPHUS_API_URL.toString().replace(/\/$/u, ""),
    orchestratorToken: environment.SISYPHUS_ORCHESTRATOR_TOKEN,
    tenantId: environment.SISYPHUS_ORCHESTRATOR_TENANT_ID,
    pollMilliseconds: environment.SISYPHUS_ORCHESTRATOR_POLL_MS,
    maxAgents: environment.SISYPHUS_ORCHESTRATOR_MAX_AGENTS,
    maxSkillsPerAgent: environment.SISYPHUS_ORCHESTRATOR_MAX_SKILLS_PER_AGENT,
    workspaceRoot:
      environment.SISYPHUS_ORCHESTRATOR_WORKSPACE_ROOT ??
      resolve(tmpdir(), "sisyphus-engineering-workspaces"),
    executionArchiveRoot:
      environment.SISYPHUS_EXECUTION_ARCHIVE_ROOT ??
      resolve(homedir(), "Desktop", "Sisyphus Executions"),
    openRouter:
      environment.SISYPHUS_OPENROUTER_API_KEY === undefined
        ? { kind: "disabled" }
        : {
            kind: "enabled",
            apiKey: environment.SISYPHUS_OPENROUTER_API_KEY,
            tierPolicy: createOpenRouterTierPolicy({
              plannerModel: environment.SISYPHUS_OPENROUTER_MODEL,
              specialistModel: environment.SISYPHUS_OPENROUTER_FALLBACK_MODEL,
              roleModels,
            }),
          },
    codebuild,
  };
}

function codeBuildConfiguration(
  environment: RawEnvironment,
): OrchestratorConfiguration["codebuild"] {
  if (environment.AWS_REGION === undefined) return undefined;
  const region = environment.AWS_REGION;
  const projectName = environment.SISYPHUS_CODEBUILD_PROJECT;
  const artifactBucket = environment.SISYPHUS_ARTIFACT_BUCKET;
  if (region === undefined || projectName === undefined || artifactBucket === undefined) {
    throw new Error(
      "AWS_REGION, SISYPHUS_CODEBUILD_PROJECT, and SISYPHUS_ARTIFACT_BUCKET must be configured together.",
    );
  }
  return {
    kind: "codebuild",
    region,
    projectName,
    artifactBucket,
    inputPrefix: environment.SISYPHUS_ARTIFACT_INPUT_PREFIX,
    resultPrefix: environment.SISYPHUS_ARTIFACT_RESULT_PREFIX,
  };
}
