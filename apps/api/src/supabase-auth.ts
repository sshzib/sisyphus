import { TenantIdSchema } from "@sisyphus/domain";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";
import type { CredentialResolver, TenantRole } from "./auth.js";

const TenantRoleSchema = z.enum(["admin", "member", "viewer"]);
const TrustedAppMetadataSchema = z
  .object({
    sisyphus_tenant_id: TenantIdSchema.optional(),
    sisyphus_role: TenantRoleSchema.optional(),
  })
  .passthrough();
const SupabaseClaimsSchema = z
  .object({
    sub: z.uuid(),
    role: z.literal("authenticated"),
    app_metadata: TrustedAppMetadataSchema.default({}),
  })
  .passthrough();

export interface SupabaseCredentialResolverOptions {
  readonly projectUrl: string;
  readonly defaultTenantId?: string;
  readonly defaultRole?: TenantRole;
  readonly keyResolver?: JWTVerifyGetKey;
}

export function createSupabaseCredentialResolver(
  options: SupabaseCredentialResolverOptions,
): CredentialResolver {
  const projectUrl = new URL(options.projectUrl).origin;
  const issuer = `${projectUrl}/auth/v1`;
  const defaultTenantId =
    options.defaultTenantId === undefined
      ? undefined
      : TenantIdSchema.parse(options.defaultTenantId);
  const defaultRole = TenantRoleSchema.parse(options.defaultRole ?? "viewer");
  const keyResolver =
    options.keyResolver ??
    createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60 * 1_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });

  return {
    async resolveCredential(token) {
      try {
        const verified = await jwtVerify(token, keyResolver, {
          algorithms: ["ES256"],
          audience: "authenticated",
          issuer,
        });
        const claims = SupabaseClaimsSchema.parse(verified.payload);
        const tenantId =
          claims.app_metadata.sisyphus_tenant_id ?? defaultTenantId;
        if (tenantId === undefined) {
          return undefined;
        }
        return {
          kind: "user",
          tenantId,
          subjectId: claims.sub,
          role: claims.app_metadata.sisyphus_role ?? defaultRole,
        };
      } catch {
        return undefined;
      }
    },
  };
}
