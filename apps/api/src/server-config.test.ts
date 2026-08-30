import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createInMemoryRepository } from "./repository.js";
import { AesGcmSecretCipher } from "./secret-cipher.js";
import {
  parseServerEnvironment,
  selectServerRepository,
} from "./server-config.js";

describe("production repository selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  const postgresEnvironment = {
    NODE_ENV: "production",
    SISYPHUS_REPOSITORY_MODE: "postgres",
    SISYPHUS_DATABASE_URL:
      "postgres://sisyphus_app:secret@127.0.0.1:5432/sisyphus",
    SISYPHUS_MIGRATION_DATABASE_URL:
      "postgres://sisyphus_migrator:secret@127.0.0.1:5432/sisyphus",
    SISYPHUS_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    SISYPHUS_POLICY_SIGNING_KEY: "cGVyc2lzdGVudC1wZW0=",
  } as const;

  it("refuses an explicit in-memory production repository", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        SISYPHUS_REPOSITORY_MODE: "memory",
      }),
    ).toThrow(/Production cannot use the in-memory demo repository/u);
  });

  it("requires the Sisyphus database environment variable", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        SISYPHUS_REPOSITORY_MODE: "postgres",
      }),
    ).toThrow(/SISYPHUS_DATABASE_URL/u);
  });

  it("requires a separate migration role and stable production keys", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        SISYPHUS_REPOSITORY_MODE: "postgres",
        SISYPHUS_DATABASE_URL: postgresEnvironment.SISYPHUS_DATABASE_URL,
      }),
    ).toThrow(/SISYPHUS_MIGRATION_DATABASE_URL/u);
    expect(() =>
      parseServerEnvironment({
        ...postgresEnvironment,
        SISYPHUS_SECRET_ENCRYPTION_KEY: undefined,
      }),
    ).toThrow(/SISYPHUS_SECRET_ENCRYPTION_KEY/u);
    expect(() =>
      parseServerEnvironment({
        ...postgresEnvironment,
        SISYPHUS_POLICY_SIGNING_KEY: undefined,
      }),
    ).toThrow(/SISYPHUS_POLICY_SIGNING_KEY/u);
  });

  it("rejects non-PostgreSQL connection URL schemes", () => {
    expect(() =>
      parseServerEnvironment({
        ...postgresEnvironment,
        SISYPHUS_DATABASE_URL: "https://db.example.test/sisyphus",
      }),
    ).toThrow(/postgres/u);
  });

  it("parses optional Supabase user authentication without weakening repository mode", () => {
    const environment = parseServerEnvironment({
      NODE_ENV: "development",
      SISYPHUS_SUPABASE_URL: "https://project-ref.supabase.co/",
      SISYPHUS_SUPABASE_DEFAULT_TENANT_ID: "tenant-acme",
      SISYPHUS_SUPABASE_DEFAULT_ROLE: "viewer",
    });

    expect(environment.supabaseAuth).toEqual({
      kind: "enabled",
      projectUrl: "https://project-ref.supabase.co",
      defaultTenantId: "tenant-acme",
      defaultRole: "viewer",
    });
    expect(environment.repository).toEqual({ kind: "memory" });
  });

  it("rejects partial or insecure Supabase authentication settings", () => {
    expect(() =>
      parseServerEnvironment({
        SISYPHUS_SUPABASE_DEFAULT_TENANT_ID: "tenant-acme",
      }),
    ).toThrow(/SISYPHUS_SUPABASE_URL/u);
    expect(() =>
      parseServerEnvironment({
        SISYPHUS_SUPABASE_URL: "http://project-ref.supabase.co",
      }),
    ).toThrow(/HTTPS/u);
  });

  it("passes the restricted and migration URLs to the PostgreSQL factory", async () => {
    const environment = parseServerEnvironment(postgresEnvironment);
    const repository = createInMemoryRepository();
    const postgresFactory = vi.fn(async () => repository);

    await expect(
      selectServerRepository({
        environment,
        secretCipher: new AesGcmSecretCipher(),
        postgresFactory,
      }),
    ).resolves.toBe(repository);
    expect(postgresFactory).toHaveBeenCalledWith({
      applicationDatabaseUrl: postgresEnvironment.SISYPHUS_DATABASE_URL,
      migrationDatabaseUrl:
        postgresEnvironment.SISYPHUS_MIGRATION_DATABASE_URL,
      secretCipher: expect.any(AesGcmSecretCipher),
    });
  });

  it("propagates PostgreSQL readiness failure without a memory fallback", async () => {
    const environment = parseServerEnvironment(postgresEnvironment);
    await expect(
      selectServerRepository({
        environment,
        secretCipher: new AesGcmSecretCipher(),
        postgresFactory: async () => {
          throw new Error("forced RLS readiness failed");
        },
      }),
    ).rejects.toThrow(/forced RLS readiness failed/u);
  });

  it("does not let production createApp construct its demo repository", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(createApp()).rejects.toThrow(
      /requires a migrated, RLS-verified PostgreSQL/u,
    );
    await expect(
      createApp({ repository: createInMemoryRepository() }),
    ).rejects.toThrow(/in-memory repositories and demo credentials are refused/u);
  });
});
