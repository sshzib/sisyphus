import { NextResponse, type NextRequest } from "next/server";
import {
  createDevelopmentAdminSession,
  developmentAdminCredentialsAreValid,
  DEVELOPMENT_ADMIN_COOKIE_NAME,
  DEVELOPMENT_ADMIN_SESSION_TTL_SECONDS,
} from "../../../../lib/development-admin";
import {
  requestHasTrustedOrigin,
} from "../../../../lib/hosted-auth";
import { loadHostedConfiguration } from "../../../../lib/hosted-config";
import { authenticatedMutation } from "../../../../lib/hosted-session";
import {
  readBoundedRequestBody,
  requestMediaType,
} from "../../../../lib/request-body";
import { apiFailure } from "../../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
};

function configuredDevelopmentAdmin() {
  const configuration = loadHostedConfiguration();
  return configuration.kind === "configured" &&
    configuration.developmentAdmin.kind === "enabled"
    ? { configuration, developmentAdmin: configuration.developmentAdmin }
    : undefined;
}

export async function POST(request: NextRequest) {
  let mode;
  try {
    mode = configuredDevelopmentAdmin();
  } catch {
    return apiFailure({
      status: 503,
      error: "hosted_auth_unavailable",
      message: "Hosted authentication is unavailable.",
    });
  }
  if (mode === undefined) {
    return apiFailure({
      status: 404,
      error: "development_login_unavailable",
      message: "The local testing login is unavailable.",
    });
  }
  if (
    !requestHasTrustedOrigin({
      headers: request.headers,
      publicOrigin: mode.configuration.publicOrigin,
    })
  ) {
    return apiFailure({
      status: 403,
      error: "origin_rejected",
      message: "The local testing login rejected the request origin.",
    });
  }
  if (requestMediaType(request.headers) !== "application/json") {
    return invalidCredentials();
  }
  const encodedBody = await readBoundedRequestBody({
    request,
    maximumBytes: 1_024,
  });
  let body: unknown;
  try {
    body = encodedBody === undefined ? undefined : JSON.parse(encodedBody);
  } catch {
    body = undefined;
  }
  if (!developmentAdminCredentialsAreValid(body)) {
    return invalidCredentials();
  }

  const session = createDevelopmentAdminSession({
    publicOrigin: mode.configuration.publicOrigin,
    sessionSecret: mode.developmentAdmin.sessionSecret,
  });
  const response = NextResponse.json(
    { authenticated: true },
    { headers: privateHeaders },
  );
  response.cookies.set({
    name: DEVELOPMENT_ADMIN_COOKIE_NAME,
    value: session,
    httpOnly: true,
    maxAge: DEVELOPMENT_ADMIN_SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "strict",
    secure: new URL(mode.configuration.publicOrigin).protocol === "https:",
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  const authentication = await authenticatedMutation(request);
  if (
    authentication.kind !== "authenticated" ||
    authentication.sessionKind !== "development-admin"
  ) {
    return apiFailure({
      status: authentication.kind === "forbidden" ? 403 : 401,
      error:
        authentication.kind === "forbidden"
          ? "csrf_rejected"
          : "session_required",
      message:
        authentication.kind === "forbidden"
          ? "The sign-out request failed its origin or CSRF check."
          : "A local testing session is required.",
    });
  }
  const response = NextResponse.json(
    { authenticated: false },
    { headers: privateHeaders },
  );
  response.cookies.set({
    name: DEVELOPMENT_ADMIN_COOKIE_NAME,
    value: "",
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "strict",
    secure:
      new URL(authentication.configuration.publicOrigin).protocol === "https:",
  });
  return response;
}

function invalidCredentials() {
  return apiFailure({
    status: 401,
    error: "invalid_credentials",
    message: "The username or password is incorrect.",
  });
}
