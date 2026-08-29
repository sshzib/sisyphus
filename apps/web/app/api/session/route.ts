import {
  DashboardSnapshotSchema,
  HostedBearerCredentialSchema,
} from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  createHostedSession,
  hostedSessionCookieName,
  loadHostedConfiguration,
  requestHasTrustedOrigin,
  type HostedConfiguration,
} from "../../../lib/hosted-auth";
import { requestControlPlane } from "../../../lib/control-plane";
import {
  readBoundedRequestBody,
  requestMediaType,
} from "../../../lib/request-body";
import { apiFailure } from "../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function invalidCredentialRedirect(
  configuration: Extract<HostedConfiguration, { kind: "configured" }>,
) {
  const response = NextResponse.redirect(
    new URL("/?authError=invalid", configuration.publicOrigin),
    303,
  );
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function POST(request: NextRequest) {
  let configuration: HostedConfiguration;
  try {
    configuration = loadHostedConfiguration();
  } catch {
    return apiFailure({
      status: 503,
      error: "hosted_auth_misconfigured",
      message: "Hosted authentication is misconfigured.",
    });
  }
  if (configuration.kind === "demo") {
    return apiFailure({
      status: 503,
      error: "hosted_auth_unavailable",
      message: "Hosted authentication is not configured.",
    });
  }
  if (
    !requestHasTrustedOrigin({
      headers: request.headers,
      publicOrigin: configuration.publicOrigin,
    })
  ) {
    return apiFailure({
      status: 403,
      error: "origin_rejected",
      message: "The session request did not come from the configured origin.",
    });
  }
  if (requestMediaType(request.headers) !== "application/x-www-form-urlencoded") {
    return apiFailure({
      status: 400,
      error: "invalid_session_request",
      message: "Submit one access token using the session form.",
    });
  }

  const encodedForm = await readBoundedRequestBody({
    request,
    maximumBytes: 4_096,
  });
  if (encodedForm === undefined) {
    return apiFailure({
      status: 400,
      error: "invalid_session_request",
      message: "The session form could not be read.",
    });
  }
  const submittedTokens = new URLSearchParams(encodedForm).getAll("token");
  const submittedToken = submittedTokens.length === 1 ? submittedTokens[0] : undefined;
  const credential = HostedBearerCredentialSchema.safeParse({
    token: submittedToken,
  });
  if (!credential.success) {
    return invalidCredentialRedirect(configuration);
  }

  const validation = await requestControlPlane({
    configuration,
    bearerToken: credential.data.token,
    path: "/v1/dashboard",
    parse: (payload) => DashboardSnapshotSchema.parse(payload),
  });
  if (validation.kind === "error") {
    return invalidCredentialRedirect(configuration);
  }

  const hostedSession = createHostedSession({
    bearerToken: credential.data.token,
    configuration,
  });
  const response = NextResponse.redirect(
    new URL("/", configuration.publicOrigin),
    303,
  );
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Pragma", "no-cache");
  response.cookies.set({
    name: hostedSessionCookieName(configuration),
    value: hostedSession.cookieValue,
    expires: new Date(hostedSession.session.expiresAt),
    httpOnly: true,
    path: "/",
    priority: "high",
    sameSite: "strict",
    secure: configuration.secureCookie,
  });
  return response;
}
