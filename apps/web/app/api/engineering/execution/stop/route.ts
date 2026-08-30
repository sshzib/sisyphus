import { EngineeringExecutionControlResponseSchema } from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";
import { requestControlPlane } from "../../../../../lib/control-plane";
import { authenticatedMutation } from "../../../../../lib/hosted-session";
import { apiFailure, controlPlaneResponse } from "../../../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authentication = await authenticatedMutation(request);
  if (authentication.kind === "unavailable") {
    return apiFailure({ status: 503, error: "hosted_auth_unavailable", message: "Hosted authentication is unavailable." });
  }
  if (authentication.kind === "forbidden") {
    return apiFailure({ status: 403, error: "csrf_rejected", message: "The execution stop request failed its origin or CSRF check." });
  }
  if (authentication.kind !== "authenticated") {
    return apiFailure({ status: 401, error: "session_required", message: "An authenticated hosted session is required." });
  }
  return controlPlaneResponse(
    await requestControlPlane({
      configuration: authentication.configuration,
      credential: authentication.credential,
      path: "/v1/engineering/execution/stop",
      method: "POST",
      parse: (payload) => EngineeringExecutionControlResponseSchema.parse(payload),
    }),
  );
}
