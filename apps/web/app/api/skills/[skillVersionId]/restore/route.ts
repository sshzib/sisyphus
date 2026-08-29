import {
  RestoreSkillParamsSchema,
  RestoreSkillRequestSchema,
  RestoreSkillResponseSchema,
} from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";
import { requestControlPlane } from "../../../../../lib/control-plane";
import {
  readBoundedRequestBody,
  requestMediaType,
} from "../../../../../lib/request-body";
import { authenticatedMutation } from "../../../../../lib/hosted-session";
import {
  apiFailure,
  controlPlaneResponse,
} from "../../../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RestoreRouteContext {
  params: Promise<{ readonly skillVersionId: string }>;
}

export async function POST(request: NextRequest, context: RestoreRouteContext) {
  const authentication = authenticatedMutation(request);
  if (authentication.kind === "unavailable") {
    return apiFailure({
      status: 503,
      error: "hosted_auth_unavailable",
      message: "Hosted authentication is unavailable.",
    });
  }
  if (authentication.kind === "forbidden") {
    return apiFailure({
      status: 403,
      error: "csrf_rejected",
      message: "The restoration request failed its origin or CSRF check.",
    });
  }
  if (authentication.kind !== "authenticated") {
    return apiFailure({
      status: 401,
      error: "session_required",
      message: "An authenticated hosted session is required.",
    });
  }
  if (requestMediaType(request.headers) !== "application/json") {
    return apiFailure({
      status: 400,
      error: "invalid_restore_request",
      message: "The restoration request must use JSON.",
    });
  }
  const params = RestoreSkillParamsSchema.safeParse(await context.params);
  const encodedBody = await readBoundedRequestBody({
    request,
    maximumBytes: 2_048,
  });
  let rawBody: unknown;
  try {
    rawBody = encodedBody === undefined ? undefined : JSON.parse(encodedBody);
  } catch {
    rawBody = undefined;
  }
  const body = RestoreSkillRequestSchema.safeParse(rawBody);
  if (!params.success || !body.success) {
    return apiFailure({
      status: 400,
      error: "invalid_restore_request",
      message: "A skill version and a restoration reason are required.",
    });
  }
  const result = await requestControlPlane({
    configuration: authentication.configuration,
    bearerToken: authentication.session.bearerToken,
    path: `/v1/skills/${encodeURIComponent(params.data.skillVersionId)}/restore`,
    method: "POST",
    body: body.data,
    parse: (payload) => RestoreSkillResponseSchema.parse(payload),
  });
  return controlPlaneResponse(result);
}
