import { SkillRegistryDetailResponseSchema } from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { requestControlPlane } from "../../../../lib/control-plane";
import { authenticateHostedRequest } from "../../../../lib/hosted-session";
import { apiFailure, controlPlaneResponse } from "../../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SkillDetailRouteContext {
  params: Promise<{ readonly skillId: string }>;
}

export async function GET(_request: NextRequest, context: SkillDetailRouteContext) {
  const authentication = await authenticateHostedRequest();
  if (authentication.kind === "unavailable") {
    return apiFailure({ status: 503, error: "hosted_auth_unavailable", message: "Hosted authentication is unavailable." });
  }
  if (authentication.kind !== "authenticated") {
    return apiFailure({ status: 401, error: "session_required", message: "An authenticated hosted session is required." });
  }
  const params = z.object({ skillId: z.string().regex(/^[a-z0-9-]+$/u) }).strict().safeParse(await context.params);
  if (!params.success) {
    return apiFailure({ status: 400, error: "invalid_skill", message: "The skill identifier is invalid." });
  }
  const result = await requestControlPlane({
    configuration: authentication.configuration,
    credential: authentication.credential,
    path: `/v1/skill-registry/${encodeURIComponent(params.data.skillId)}`,
    parse: (payload) => SkillRegistryDetailResponseSchema.parse(payload),
  });
  return controlPlaneResponse(result);
}
