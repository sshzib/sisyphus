import "server-only";

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SupabaseAccessTokenSchema } from "./auth-input";
import type { ControlPlaneCredential } from "./control-plane";
import {
  csrfTokenForDevelopmentAdminSession,
  DEVELOPMENT_ADMIN_COOKIE_NAME,
  verifyDevelopmentAdminSession,
} from "./development-admin";
import {
  csrfTokenForAccessToken,
  requestPassesMutationGuards,
} from "./hosted-auth";
import {
  loadHostedConfiguration,
  type HostedConfiguration,
} from "./hosted-config";
import { createSupabaseServerClient } from "./supabase/server";

type ConfiguredHostedMode = Extract<HostedConfiguration, { kind: "configured" }>;

export type HostedPageState =
  | { readonly kind: "setup" }
  | {
      readonly kind: "login";
      readonly developmentAdminEnabled: boolean;
    }
  | { readonly kind: "misconfigured" }
  | {
      readonly kind: "authenticated";
      readonly accountLabel: string | undefined;
      readonly csrfToken: string;
      readonly sessionKind: "development-admin" | "supabase";
    };

export type HostedRequestAuthentication =
  | {
      readonly kind: "authenticated";
      readonly configuration: ConfiguredHostedMode;
      readonly credential: ControlPlaneCredential;
      readonly csrfToken: string;
      readonly sessionKind: "development-admin" | "supabase";
      readonly subjectId: string;
    }
  | { readonly kind: "unavailable" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" };

async function verifiedSupabaseSession(
  configuration: ConfiguredHostedMode,
): Promise<
  | {
      readonly accessToken: string;
      readonly subjectId: string;
      readonly email: string | undefined;
    }
  | undefined
> {
  const supabase = await createSupabaseServerClient(configuration);
  const claimsResult = await supabase.auth.getClaims();
  if (claimsResult.data === null || claimsResult.error !== null) {
    return undefined;
  }
  const subjectId = claimsResult.data.claims.sub;
  if (typeof subjectId !== "string" || subjectId.length === 0) {
    return undefined;
  }
  const sessionResult = await supabase.auth.getSession();
  const accessToken = SupabaseAccessTokenSchema.safeParse(
    sessionResult.data.session?.access_token,
  );
  if (!accessToken.success) {
    return undefined;
  }
  const email = claimsResult.data.claims.email;
  return {
    accessToken: accessToken.data,
    subjectId,
    email: typeof email === "string" ? email : undefined,
  };
}

async function verifiedDevelopmentAdminSession(
  configuration: ConfiguredHostedMode,
): Promise<
  | {
      readonly csrfToken: string;
      readonly sessionId: string;
    }
  | undefined
> {
  if (configuration.developmentAdmin.kind === "disabled") {
    return undefined;
  }
  const cookieStore = await cookies();
  const session = verifyDevelopmentAdminSession(
    cookieStore.get(DEVELOPMENT_ADMIN_COOKIE_NAME)?.value,
    {
      publicOrigin: configuration.publicOrigin,
      sessionSecret: configuration.developmentAdmin.sessionSecret,
    },
  );
  if (session === undefined) {
    return undefined;
  }
  return {
    csrfToken: csrfTokenForDevelopmentAdminSession({
      sessionId: session.sessionId,
      sessionSecret: configuration.developmentAdmin.sessionSecret,
    }),
    sessionId: session.sessionId,
  };
}

function configuredMode():
  | { readonly kind: "configured"; readonly value: ConfiguredHostedMode }
  | { readonly kind: "setup" }
  | { readonly kind: "misconfigured" } {
  let configuration: HostedConfiguration;
  try {
    configuration = loadHostedConfiguration();
  } catch {
    return { kind: "misconfigured" };
  }
  return configuration.kind === "unconfigured"
    ? { kind: "setup" }
    : { kind: "configured", value: configuration };
}

export async function hostedPageState(): Promise<HostedPageState> {
  const mode = configuredMode();
  if (mode.kind !== "configured") {
    return mode;
  }
  const developmentSession = await verifiedDevelopmentAdminSession(mode.value);
  if (developmentSession !== undefined) {
    return {
      kind: "authenticated",
      accountLabel: "admin · Local testing",
      csrfToken: developmentSession.csrfToken,
      sessionKind: "development-admin",
    };
  }
  const session = await verifiedSupabaseSession(mode.value);
  if (session === undefined) {
    return {
      kind: "login",
      developmentAdminEnabled:
        mode.value.developmentAdmin.kind === "enabled",
    };
  }
  return {
    kind: "authenticated",
    accountLabel: session.email,
    csrfToken: csrfTokenForAccessToken(session.accessToken),
    sessionKind: "supabase",
  };
}

export async function authenticateHostedRequest(): Promise<HostedRequestAuthentication> {
  const mode = configuredMode();
  if (mode.kind !== "configured") {
    return { kind: "unavailable" };
  }
  const developmentSession = await verifiedDevelopmentAdminSession(mode.value);
  if (
    developmentSession !== undefined &&
    mode.value.developmentAdmin.kind === "enabled"
  ) {
    return {
      kind: "authenticated",
      configuration: mode.value,
      credential: {
        kind: "development-admin",
        token: mode.value.developmentAdmin.apiToken,
      },
      csrfToken: developmentSession.csrfToken,
      sessionKind: "development-admin",
      subjectId: "local-admin",
    };
  }
  const session = await verifiedSupabaseSession(mode.value);
  if (session === undefined) {
    return { kind: "unauthorized" };
  }
  return {
    kind: "authenticated",
    configuration: mode.value,
    credential: { kind: "supabase", token: session.accessToken },
    csrfToken: csrfTokenForAccessToken(session.accessToken),
    sessionKind: "supabase",
    subjectId: session.subjectId,
  };
}

export async function authenticatedMutation(
  request: NextRequest,
): Promise<HostedRequestAuthentication> {
  const authentication = await authenticateHostedRequest();
  if (authentication.kind !== "authenticated") {
    return authentication;
  }
  return requestPassesMutationGuards({
    headers: request.headers,
    publicOrigin: authentication.configuration.publicOrigin,
    csrfToken: authentication.csrfToken,
  })
    ? authentication
    : { kind: "forbidden" };
}
