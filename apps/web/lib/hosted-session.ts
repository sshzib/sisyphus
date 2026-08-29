import "server-only";

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { HostedSessionPayload } from "@sisyphus/ui/contracts";
import {
  hostedSessionCookieName,
  loadHostedConfiguration,
  openHostedSession,
  requestPassesMutationGuards,
  type HostedConfiguration,
} from "./hosted-auth";

type ConfiguredHostedMode = Extract<HostedConfiguration, { kind: "configured" }>;

export type HostedPageState =
  | { readonly kind: "demo" }
  | { readonly kind: "login" }
  | { readonly kind: "misconfigured" }
  | { readonly kind: "authenticated"; readonly csrfToken: string };

export type HostedRequestAuthentication =
  | {
      readonly kind: "authenticated";
      readonly configuration: ConfiguredHostedMode;
      readonly session: HostedSessionPayload;
    }
  | { readonly kind: "unavailable" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" };

export async function hostedPageState(): Promise<HostedPageState> {
  let configuration: HostedConfiguration;
  try {
    configuration = loadHostedConfiguration();
  } catch {
    return { kind: "misconfigured" };
  }
  if (configuration.kind === "demo") {
    return { kind: "demo" };
  }
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(hostedSessionCookieName(configuration))?.value;
  if (cookieValue === undefined) {
    return { kind: "login" };
  }
  const session = openHostedSession({ cookieValue, configuration });
  return session === undefined
    ? { kind: "login" }
    : { kind: "authenticated", csrfToken: session.csrfToken };
}

export function authenticateHostedRequest(
  request: NextRequest,
): HostedRequestAuthentication {
  let configuration: HostedConfiguration;
  try {
    configuration = loadHostedConfiguration();
  } catch {
    return { kind: "unavailable" };
  }
  if (configuration.kind === "demo") {
    return { kind: "unavailable" };
  }
  const cookieValue = request.cookies.get(
    hostedSessionCookieName(configuration),
  )?.value;
  if (cookieValue === undefined) {
    return { kind: "unauthorized" };
  }
  const session = openHostedSession({ cookieValue, configuration });
  return session === undefined
    ? { kind: "unauthorized" }
    : { kind: "authenticated", configuration, session };
}

export function authenticatedMutation(
  request: NextRequest,
): HostedRequestAuthentication {
  const authentication = authenticateHostedRequest(request);
  if (authentication.kind !== "authenticated") {
    return authentication;
  }
  return requestPassesMutationGuards({
    headers: request.headers,
    publicOrigin: authentication.configuration.publicOrigin,
    csrfToken: authentication.session.csrfToken,
  })
    ? authentication
    : { kind: "forbidden" };
}
