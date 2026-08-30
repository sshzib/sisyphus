import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createSupabaseCredentialResolver,
  type SupabaseCredentialResolverOptions,
} from "./supabase-auth.js";

const projectUrl = "https://project-ref.supabase.co";
const issuer = `${projectUrl}/auth/v1`;
const subjectId = "22d1178b-9879-4a76-8874-65810a098b35";

let privateKey: CryptoKey;
let keyResolver: SupabaseCredentialResolverOptions["keyResolver"];

beforeAll(async () => {
  const keyPair = await generateKeyPair("ES256", { extractable: true });
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  keyResolver = createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "ES256", kid: "test-key", use: "sig" }],
  });
});

function testKeyResolver() {
  if (keyResolver === undefined) {
    throw new Error("The test JWKS has not been initialized.");
  }
  return keyResolver;
}

async function accessToken(input: {
  issuer?: string;
  audience?: string;
  appMetadata?: unknown;
  userMetadata?: unknown;
}) {
  return new SignJWT({
    role: "authenticated",
    app_metadata: input.appMetadata ?? {},
    user_metadata: input.userMetadata ?? {},
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key", typ: "JWT" })
    .setIssuer(input.issuer ?? issuer)
    .setAudience(input.audience ?? "authenticated")
    .setSubject(subjectId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("Supabase user credential resolution", () => {
  it("maps trusted app metadata into the existing tenant-scoped user context", async () => {
    const resolver = createSupabaseCredentialResolver({
      projectUrl,
      keyResolver: testKeyResolver(),
    });

    await expect(
      resolver.resolveCredential(
        await accessToken({
          appMetadata: {
            sisyphus_tenant_id: "tenant-beta",
            sisyphus_role: "admin",
          },
        }),
      ),
    ).resolves.toEqual({
      kind: "user",
      tenantId: "tenant-beta",
      subjectId,
      role: "admin",
    });
  });

  it("uses an explicit server default and never trusts user metadata", async () => {
    const resolver = createSupabaseCredentialResolver({
      projectUrl,
      defaultTenantId: "tenant-acme",
      defaultRole: "viewer",
      keyResolver: testKeyResolver(),
    });

    await expect(
      resolver.resolveCredential(
        await accessToken({
          userMetadata: {
            sisyphus_tenant_id: "tenant-attacker",
            sisyphus_role: "admin",
          },
        }),
      ),
    ).resolves.toEqual({
      kind: "user",
      tenantId: "tenant-acme",
      subjectId,
      role: "viewer",
    });
  });

  it("fails closed without a trusted tenant mapping", async () => {
    const resolver = createSupabaseCredentialResolver({
      projectUrl,
      keyResolver: testKeyResolver(),
    });

    await expect(
      resolver.resolveCredential(await accessToken({})),
    ).resolves.toBeUndefined();
  });

  it("rejects the wrong issuer, audience, signature, and malformed trusted role", async () => {
    const resolver = createSupabaseCredentialResolver({
      projectUrl,
      defaultTenantId: "tenant-acme",
      keyResolver: testKeyResolver(),
    });
    const otherKeyPair = await generateKeyPair("ES256");
    const wrongSignature = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setSubject(subjectId)
      .setExpirationTime("5m")
      .sign(otherKeyPair.privateKey);

    await expect(
      resolver.resolveCredential(
        await accessToken({ issuer: "https://attacker.example/auth/v1" }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolver.resolveCredential(await accessToken({ audience: "anon" })),
    ).resolves.toBeUndefined();
    await expect(
      resolver.resolveCredential(wrongSignature),
    ).resolves.toBeUndefined();
    await expect(
      resolver.resolveCredential(
        await accessToken({
          appMetadata: {
            sisyphus_tenant_id: "tenant-acme",
            sisyphus_role: "owner",
          },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
