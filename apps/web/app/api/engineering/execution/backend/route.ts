import {
  EngineeringExecutionBackendChangeSchema,
  EngineeringExecutionControlResponseSchema,
} from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";
import { requestControlPlane } from "../../../../../lib/control-plane";
import { authenticatedMutation } from "../../../../../lib/hosted-session";
import { readBoundedRequestBody, requestMediaType } from "../../../../../lib/request-body";
import { apiFailure, controlPlaneResponse } from "../../../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authentication = await authenticatedMutation(request);
  if (authentication.kind === "unavailable") {
    return apiFailure({ status: 503, error: "hosted_auth_unavailable", message: "Hosted authentication is unavailable." });
  }
  if (authentication.kind === "forbidden") {
    return apiFailure({ status: 403, error: "csrf_rejected", message: "The execution backend request failed its origin or CSRF check." });
  }
  if (authentication.kind !== "authenticated") {
    return apiFailure({ status: 401, error: "session_required", message: "An authenticated hosted session is required." });
  }
  if (requestMediaType(request.headers) !== "application/json") {
    return apiFailure({ status: 400, error: "invalid_execution_backend", message: "The execution backend request must use JSON." });
  }
  const encodedBody = await readBoundedRequestBody({ request, maximumBytes: 256 });
  let rawBody: unknown;
  try {
    rawBody = encodedBody === undefined ? undefined : JSON.parse(encodedBody);
  } catch {
    rawBody = undefined;
  }
  const body = EngineeringExecutionBackendChangeSchema.safeParse(rawBody);
  if (!body.success) {
    return apiFailure({ status: 400, error: "invalid_execution_backend", message: "Choose either the AWS sandbox or the local static fallback." });
  }
  return controlPlaneResponse(
    await requestControlPlane({
      configuration: authentication.configuration,
      credential: authentication.credential,
      path: "/v1/engineering/execution/backend",
      method: "POST",
      body: body.data,
      parse: (payload) => EngineeringExecutionControlResponseSchema.parse(payload),
    }),
  );
}
