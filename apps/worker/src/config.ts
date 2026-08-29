import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  AdapterConfigurationDigestSchema,
  createAdapterInstallationId,
  createDeviceId,
  createTenantId,
  EvaluationConstraintSchema,
  type EvaluationConstraint,
} from "@sisyphus/domain";
import { z } from "zod";

import {
  CommandEvaluatorInputSchema,
  CompletionGuardInputSchema,
  type CommandEvaluatorInput,
  type CompletionGuardInput,
} from "./evaluators.js";
import {
  bearerTokensMatch,
  parseLocalBearerToken,
  type LocalBearerToken,
} from "./local-auth.js";
import {
  defaultEvaluationConstraint,
  type WorkerPolicyIdentity,
} from "./policy.js";
import {
  ManagedSkillCatalogConfigurationSchema,
  type ManagedSkillCatalogConfiguration,
} from "./managed-catalog.js";

const WorkerPolicyFileSchema = z
  .object({
    constraint: EvaluationConstraintSchema.default(defaultEvaluationConstraint()),
    deterministicChecks: z.array(CommandEvaluatorInputSchema).default([]),
    completionGuards: CompletionGuardInputSchema.default({ requiredEvidencePatterns: [] }),
    managedCatalog: ManagedSkillCatalogConfigurationSchema.default({
      skills: [],
      administratorPriorities: [],
      wrappers: [],
    }),
  })
  .strict();

export interface WorkerPolicyConfiguration {
  readonly constraint: EvaluationConstraint;
  readonly deterministicChecks: readonly CommandEvaluatorInput[];
  readonly completionGuards: CompletionGuardInput;
  readonly managedCatalog: ManagedSkillCatalogConfiguration;
}

export interface WorkerControlPlaneConfiguration {
  readonly endpoint: string;
  readonly deviceToken: string;
  readonly trustedPolicyKeys: Readonly<Record<string, string>>;
  readonly policyIdentity?: WorkerPolicyIdentity;
}

export interface WorkerConfiguration {
  readonly dataDirectory: string;
  readonly host: "127.0.0.1" | "::1" | "localhost";
  readonly port: number;
  readonly hookToken: LocalBearerToken;
  readonly mcpToken: LocalBearerToken;
  readonly desktopToken?: LocalBearerToken;
  readonly policy: WorkerPolicyConfiguration;
  readonly controlPlane?: WorkerControlPlaneConfiguration;
}

function parseRequiredToken(
  environmentName: "SISYPHUS_HOOK_TOKEN" | "SISYPHUS_MCP_TOKEN",
  source: string | undefined,
): LocalBearerToken {
  if (source === undefined) {
    throw new Error(`${environmentName} is required.`);
  }
  try {
    return parseLocalBearerToken(source);
  } catch (error: unknown) {
    throw new Error(
      `${environmentName} must encode at least 32 random bytes as base64url.`,
      { cause: error },
    );
  }
}

interface LoadWorkerConfigurationInput {
  readonly environment: Readonly<Record<string, string | undefined>>;
}

function parsePort(source: string | undefined): number {
  if (source === undefined) return 7331;
  return z.coerce.number().int().min(1).max(65_535).parse(source);
}

function parseHost(
  source: string | undefined,
): "127.0.0.1" | "::1" | "localhost" {
  return z.enum(["127.0.0.1", "::1", "localhost"]).parse(source ?? "127.0.0.1");
}

function parseTrustedKeys(source: string | undefined): Readonly<Record<string, string>> {
  if (source === undefined || source.trim() === "") return {};
  const decoded: unknown = JSON.parse(source);
  return z.record(z.string().min(1), z.string().min(1)).parse(decoded);
}

function requiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name:
    | "SISYPHUS_TENANT_ID"
    | "SISYPHUS_DEVICE_ID"
    | "SISYPHUS_ADAPTER_INSTALLATION_ID"
    | "SISYPHUS_ADAPTER_CONFIGURATION_DIGEST",
): string {
  const value = environment[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required when signed policy synchronization is enabled.`);
  }
  return value;
}

function parsePolicyIdentity(
  environment: Readonly<Record<string, string | undefined>>,
  trustedPolicyKeys: Readonly<Record<string, string>>,
): WorkerPolicyIdentity | undefined {
  if (Object.keys(trustedPolicyKeys).length === 0) return undefined;
  return {
    tenantId: createTenantId(requiredEnvironment(environment, "SISYPHUS_TENANT_ID")),
    deviceId: createDeviceId(requiredEnvironment(environment, "SISYPHUS_DEVICE_ID")),
    adapterInstallationId: createAdapterInstallationId(
      requiredEnvironment(environment, "SISYPHUS_ADAPTER_INSTALLATION_ID"),
    ),
    adapterConfigurationDigest: AdapterConfigurationDigestSchema.parse(
      requiredEnvironment(environment, "SISYPHUS_ADAPTER_CONFIGURATION_DIGEST"),
    ),
    profile: z
      .enum(["local", "cloud-agent"])
      .parse(environment["SISYPHUS_RUNTIME_PROFILE"] ?? "local"),
  };
}

async function loadPolicy(path: string | undefined): Promise<WorkerPolicyConfiguration> {
  if (path === undefined || path.trim() === "") {
    return WorkerPolicyFileSchema.parse({});
  }
  const source = await readFile(resolve(path), "utf8");
  return WorkerPolicyFileSchema.parse(JSON.parse(source) as unknown);
}

export async function loadWorkerConfiguration(
  input: LoadWorkerConfigurationInput,
): Promise<WorkerConfiguration> {
  const hookToken = parseRequiredToken(
    "SISYPHUS_HOOK_TOKEN",
    input.environment["SISYPHUS_HOOK_TOKEN"],
  );
  const mcpToken = parseRequiredToken(
    "SISYPHUS_MCP_TOKEN",
    input.environment["SISYPHUS_MCP_TOKEN"],
  );
  if (bearerTokensMatch(hookToken, mcpToken)) {
    throw new Error("SISYPHUS_HOOK_TOKEN and SISYPHUS_MCP_TOKEN must differ.");
  }
  const desktopTokenSource = input.environment["SISYPHUS_DESKTOP_TOKEN"];
  const desktopToken =
    desktopTokenSource === undefined
      ? undefined
      : parseLocalBearerToken(desktopTokenSource);
  if (
    desktopToken !== undefined &&
    (bearerTokensMatch(desktopToken, hookToken) ||
      bearerTokensMatch(desktopToken, mcpToken))
  ) {
    throw new Error("SISYPHUS_DESKTOP_TOKEN must differ from hook and MCP credentials.");
  }
  const endpoint = input.environment["SISYPHUS_CONTROL_PLANE_URL"];
  const deviceToken = input.environment["SISYPHUS_DEVICE_TOKEN"];
  if ((endpoint === undefined) !== (deviceToken === undefined)) {
    throw new Error(
      "SISYPHUS_CONTROL_PLANE_URL and SISYPHUS_DEVICE_TOKEN must be configured together.",
    );
  }
  const configuredDataDirectory = input.environment["SISYPHUS_DATA_DIR"];
  const dataDirectory = resolve(
    configuredDataDirectory === undefined || configuredDataDirectory.trim() === ""
      ? join(homedir(), ".sisyphus")
      : configuredDataDirectory,
  );
  const common = {
    dataDirectory,
    host: parseHost(input.environment["SISYPHUS_WORKER_HOST"]),
    port: parsePort(input.environment["SISYPHUS_WORKER_PORT"]),
    hookToken,
    mcpToken,
    ...(desktopToken === undefined ? {} : { desktopToken }),
    policy: await loadPolicy(input.environment["SISYPHUS_POLICY_FILE"]),
  };
  if (endpoint === undefined || deviceToken === undefined) return common;
  const trustedPolicyKeys = parseTrustedKeys(
    input.environment["SISYPHUS_POLICY_PUBLIC_KEYS"],
  );
  const policyIdentity = parsePolicyIdentity(input.environment, trustedPolicyKeys);
  return {
    ...common,
    controlPlane: {
      endpoint: z.string().url().parse(endpoint),
      deviceToken: z.string().trim().min(1).parse(deviceToken),
      trustedPolicyKeys,
      ...(policyIdentity === undefined ? {} : { policyIdentity }),
    },
  };
}
