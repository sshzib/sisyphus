import { z } from "zod";
import { createPostgresControlPlaneRepository } from "./database/postgres-repository.js";
import type { ControlPlaneRepository } from "./repository.js";
import { createInMemoryRepository } from "./repository.js";
import type { SecretCipher } from "./secret-cipher.js";

const PostgresConnectionUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    },
    "Expected a postgres:// or postgresql:// connection URL.",
  );

const RawServerEnvironmentSchema = z.object({
  SISYPHUS_API_HOST: z.string().min(1).default("127.0.0.1"),
  SISYPHUS_API_PORT: z.coerce.number().int().min(1).max(65_535).default(7330),
  SISYPHUS_WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  SISYPHUS_REPOSITORY_MODE: z.enum(["memory", "postgres"]).optional(),
  SISYPHUS_DATABASE_URL: PostgresConnectionUrlSchema.optional(),
  SISYPHUS_MIGRATION_DATABASE_URL: PostgresConnectionUrlSchema.optional(),
  SISYPHUS_SECRET_ENCRYPTION_KEY: z.string().min(1).optional(),
  SISYPHUS_POLICY_SIGNING_KEY: z.string().min(1).optional(),
  SISYPHUS_POLICY_KEY_ID: z.string().min(1).default("sisyphus-dev-ed25519"),
  SISYPHUS_ORCHESTRATOR_TOKEN: z.string().min(32).max(512).optional(),
  SISYPHUS_SUPABASE_URL: z.string().url().optional(),
  SISYPHUS_SUPABASE_DEFAULT_TENANT_ID: z.string().trim().min(1).optional(),
  SISYPHUS_SUPABASE_DEFAULT_ROLE: z
    .enum(["admin", "member", "viewer"])
    .optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export class ServerConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ServerConfigurationError";
  }
}

export type ServerEnvironment = {
  host: string;
  port: number;
  webOrigin: string;
  nodeEnvironment: "development" | "test" | "production";
  secretEncryptionKey: string | undefined;
  policySigningKey: string | undefined;
  policyKeyId: string;
  orchestratorToken: string | undefined;
  supabaseAuth:
    | { kind: "disabled" }
    | {
        kind: "enabled";
        projectUrl: string;
        defaultTenantId: string | undefined;
        defaultRole: "admin" | "member" | "viewer";
      };
  repository:
    | { kind: "memory" }
    | {
        kind: "postgres";
        databaseUrl: string;
        migrationDatabaseUrl: string;
      };
};

export function parseServerEnvironment(
  input: NodeJS.ProcessEnv,
): ServerEnvironment {
  const environment = RawServerEnvironmentSchema.parse(input);
  const repositoryMode =
    environment.SISYPHUS_REPOSITORY_MODE ??
    (environment.NODE_ENV === "production" ? "postgres" : "memory");
  const hasSupabaseDefaults =
    environment.SISYPHUS_SUPABASE_DEFAULT_TENANT_ID !== undefined ||
    environment.SISYPHUS_SUPABASE_DEFAULT_ROLE !== undefined;
  if (environment.SISYPHUS_SUPABASE_URL === undefined && hasSupabaseDefaults) {
    throw new ServerConfigurationError(
      "SISYPHUS_SUPABASE_URL is required when Supabase tenant defaults are configured.",
    );
  }
  let supabaseAuth: ServerEnvironment["supabaseAuth"] = { kind: "disabled" };
  if (environment.SISYPHUS_SUPABASE_URL !== undefined) {
    const projectUrl = new URL(environment.SISYPHUS_SUPABASE_URL);
    if (projectUrl.protocol !== "https:") {
      throw new ServerConfigurationError(
        "SISYPHUS_SUPABASE_URL must use HTTPS.",
      );
    }
    if (
      projectUrl.username.length > 0 ||
      projectUrl.password.length > 0 ||
      projectUrl.search.length > 0 ||
      projectUrl.hash.length > 0
    ) {
      throw new ServerConfigurationError(
        "SISYPHUS_SUPABASE_URL cannot contain credentials, a query, or a fragment.",
      );
    }
    supabaseAuth = {
      kind: "enabled",
      projectUrl: projectUrl.origin,
      defaultTenantId: environment.SISYPHUS_SUPABASE_DEFAULT_TENANT_ID,
      defaultRole: environment.SISYPHUS_SUPABASE_DEFAULT_ROLE ?? "viewer",
    };
  }
  if (environment.NODE_ENV === "production" && repositoryMode === "memory") {
    throw new ServerConfigurationError(
      "Production cannot use the in-memory demo repository. Set SISYPHUS_REPOSITORY_MODE=postgres and SISYPHUS_DATABASE_URL.",
    );
  }
  const base = {
    host: environment.SISYPHUS_API_HOST,
    port: environment.SISYPHUS_API_PORT,
    webOrigin: environment.SISYPHUS_WEB_ORIGIN,
    nodeEnvironment: environment.NODE_ENV,
    secretEncryptionKey: environment.SISYPHUS_SECRET_ENCRYPTION_KEY,
    policySigningKey: environment.SISYPHUS_POLICY_SIGNING_KEY,
    policyKeyId: environment.SISYPHUS_POLICY_KEY_ID,
    orchestratorToken: environment.SISYPHUS_ORCHESTRATOR_TOKEN,
    supabaseAuth,
  };
  if (repositoryMode === "memory") {
    return { ...base, repository: { kind: "memory" } };
  }
  if (environment.SISYPHUS_DATABASE_URL === undefined) {
    throw new ServerConfigurationError(
      "SISYPHUS_DATABASE_URL is required when SISYPHUS_REPOSITORY_MODE=postgres.",
    );
  }
  if (environment.SISYPHUS_MIGRATION_DATABASE_URL === undefined) {
    throw new ServerConfigurationError(
      "SISYPHUS_MIGRATION_DATABASE_URL is required for a separate schema-owner role when SISYPHUS_REPOSITORY_MODE=postgres.",
    );
  }
  if (
    environment.NODE_ENV === "production" &&
    environment.SISYPHUS_SECRET_ENCRYPTION_KEY === undefined
  ) {
    throw new ServerConfigurationError(
      "SISYPHUS_SECRET_ENCRYPTION_KEY is required in production so encrypted judge credentials survive restarts.",
    );
  }
  if (
    environment.NODE_ENV === "production" &&
    environment.SISYPHUS_POLICY_SIGNING_KEY === undefined
  ) {
    throw new ServerConfigurationError(
      "SISYPHUS_POLICY_SIGNING_KEY is required in production so policy-bundle trust is stable across restarts.",
    );
  }
  return {
    ...base,
    repository: {
      kind: "postgres",
      databaseUrl: environment.SISYPHUS_DATABASE_URL,
      migrationDatabaseUrl: environment.SISYPHUS_MIGRATION_DATABASE_URL,
    },
  };
}

export function selectServerRepository(input: {
  environment: ServerEnvironment;
  secretCipher: SecretCipher;
  postgresFactory?: typeof createPostgresControlPlaneRepository;
}): Promise<ControlPlaneRepository> {
  if (input.environment.repository.kind === "memory") {
    return Promise.resolve(
      createInMemoryRepository({
        secretCipher: input.secretCipher,
        seed: "live",
      }),
    );
  }
  const factory = input.postgresFactory ?? createPostgresControlPlaneRepository;
  return factory({
    applicationDatabaseUrl: input.environment.repository.databaseUrl,
    migrationDatabaseUrl: input.environment.repository.migrationDatabaseUrl,
    secretCipher: input.secretCipher,
  });
}
