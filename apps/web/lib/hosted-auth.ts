import { createHash, timingSafeEqual } from "node:crypto";
import { HostedCsrfTokenSchema } from "@sisyphus/ui/contracts";
import { SupabaseAccessTokenSchema } from "./auth-input";

export {
  loadHostedConfiguration,
  parseHostedConfiguration,
  type HostedConfiguration,
} from "./hosted-config";

export function csrfTokenForAccessToken(accessToken: string): string {
  const token = SupabaseAccessTokenSchema.parse(accessToken);
  return createHash("sha256")
    .update("sisyphus-hosted-csrf:v2\0", "utf8")
    .update(token, "utf8")
    .digest("hex");
}

export function requestPassesMutationGuards(input: {
  headers: Headers;
  publicOrigin: string;
  csrfToken: string;
}): boolean {
  if (!requestHasTrustedOrigin(input)) {
    return false;
  }
  const providedToken = input.headers.get("x-sisyphus-csrf");
  const expected = HostedCsrfTokenSchema.safeParse(input.csrfToken);
  const provided = HostedCsrfTokenSchema.safeParse(providedToken);
  if (!expected.success || !provided.success) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected.data, "hex"),
    Buffer.from(provided.data, "hex"),
  );
}

export function requestHasTrustedOrigin(input: {
  headers: Headers;
  publicOrigin: string;
}): boolean {
  const origin = input.headers.get("origin");
  const fetchSite = input.headers.get("sec-fetch-site");
  if (origin === input.publicOrigin) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }
  return (
    (origin === null || origin === "null") && fetchSite === "same-origin"
  );
}
