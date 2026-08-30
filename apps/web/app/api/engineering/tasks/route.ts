import { EngineeringTaskSubmissionSchema, CreateEngineeringTaskResponseSchema } from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";
import { requestControlPlane } from "../../../../lib/control-plane";
import { readBoundedRequestBody, requestMediaType } from "../../../../lib/request-body";
import { authenticatedMutation } from "../../../../lib/hosted-session";
import { apiFailure, controlPlaneResponse } from "../../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authentication = await authenticatedMutation(request);
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
      message: "The engineering request failed its origin or CSRF check.",
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
      error: "invalid_engineering_task",
      message: "The engineering task request must use JSON.",
    });
  }
  const encodedBody = await readBoundedRequestBody({
    request,
    maximumBytes: 8_192,
  });
  let rawBody: unknown;
  try {
    rawBody = encodedBody === undefined ? undefined : JSON.parse(encodedBody);
  } catch {
    rawBody = undefined;
  }
  const body = EngineeringTaskSubmissionSchema.safeParse(rawBody);
  if (!body.success) {
    return apiFailure({
      status: 400,
      error: "invalid_engineering_task",
      message: "Describe the engineering task in between 20 and 4,000 characters.",
    });
  }
  const result = await requestControlPlane({
    configuration: authentication.configuration,
    credential: authentication.credential,
    path: "/v1/engineering/tasks",
    method: "POST",
    body: body.data,
    parse: (payload) => CreateEngineeringTaskResponseSchema.parse(payload),
  });
  return controlPlaneResponse(result);
}
