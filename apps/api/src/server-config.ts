import { z } from "zod";
import type { ControlPlaneRepository } from "./repository.js";
import { createInMemoryRepository } from "./repository.js";
import type { SecretCipher } from "./secret-cipher.js";

const RawServerEnvironmentSchema = z.object({
  SISYPHUS_API_HOST: z.string().min(1).default("127.0.0.1"),
  SISYPHUS_API_PORT: z.coerce.number().int().min(1).max(65_535).default(7330),
  SISYPHUS_WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  SISYPHUS_REPOSITORY_MODE: z.enum(["memory", "postgres"]).optional(),
  SISYPHUS_DATABASE_URL: z.string().url().optional(),
  SISYPHUS_SECRET_ENCRYPTION_KEY: z.string().min(1).optional(),
  SISYPHUS_POLICY_SIGNING_KEY: z.string().min(1).optional(),
  SISYPHUS_POLICY_KEY_ID: z.string().min(1).default("sisyphus-dev-ed25519"),
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
  repository:
    | { kind: "memory" }
    | { kind: "postgres"; databaseUrl: string };
};

export function parseServerEnvironment(
  input: NodeJS.ProcessEnv,
): ServerEnvironment {
  const environment = RawServerEnvironmentSchema.parse(input);
  const repositoryMode =
    environment.SISYPHUS_REPOSITORY_MODE ??
    (environment.NODE_ENV === "production" ? "postgres" : "memory");
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
  };
  if (repositoryMode === "memory") {
    return { ...base, repository: { kind: "memory" } };
  }
  if (environment.SISYPHUS_DATABASE_URL === undefined) {
    throw new ServerConfigurationError(
      "SISYPHUS_DATABASE_URL is required when SISYPHUS_REPOSITORY_MODE=postgres.",
    );
  }
  return {
    ...base,
    repository: {
      kind: "postgres",
      databaseUrl: environment.SISYPHUS_DATABASE_URL,
    },
  };
}

export function selectServerRepository(input: {
  environment: ServerEnvironment;
  secretCipher: SecretCipher;
}): ControlPlaneRepository {
  if (input.environment.repository.kind === "memory") {
    return createInMemoryRepository({ secretCipher: input.secretCipher });
  }
  throw new ServerConfigurationError(
    "PostgreSQL ControlPlaneRepository wiring is incomplete. Production startup refused instead of falling back to demo credentials or volatile state.",
  );
}
