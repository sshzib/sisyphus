import { SkillRegistryListResponseSchema } from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";

import { requestControlPlane } from "../../../lib/control-plane";
import { authenticateHostedRequest } from "../../../lib/hosted-session";
import { apiFailure, controlPlaneResponse } from "../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const authentication = await authenticateHostedRequest();
  if (authentication.kind === "unavailable") {
    return apiFailure({
      status: 503,
      error: "hosted_auth_unavailable",
      message: "Hosted authentication is unavailable.",
    });
  }
  if (authentication.kind !== "authenticated") {
    return apiFailure({
      status: 401,
      error: "session_required",
      message: "An authenticated hosted session is required.",
    });
  }
  const result = await requestControlPlane({
    configuration: authentication.configuration,
    credential: authentication.credential,
    path: "/v1/skill-registry",
    parse: (payload) => SkillRegistryListResponseSchema.parse(payload),
  });
  return controlPlaneResponse(result);
}
