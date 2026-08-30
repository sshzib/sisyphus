import {
  ResolveSkillImprovementProposalSchema,
  SkillRegistryDetailResponseSchema,
} from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { requestControlPlane } from "../../../../../../lib/control-plane";
import { authenticatedMutation } from "../../../../../../lib/hosted-session";
import { readBoundedRequestBody, requestMediaType } from "../../../../../../lib/request-body";
import { apiFailure, controlPlaneResponse } from "../../../../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProposalRouteContext {
  params: Promise<{ readonly skillId: string; readonly proposalId: string }>;
}

export async function POST(request: NextRequest, context: ProposalRouteContext) {
  const authentication = await authenticatedMutation(request);
  if (authentication.kind === "unavailable") {
    return apiFailure({ status: 503, error: "hosted_auth_unavailable", message: "Hosted authentication is unavailable." });
  }
  if (authentication.kind === "forbidden") {
    return apiFailure({ status: 403, error: "csrf_rejected", message: "The skill improvement request failed its origin or CSRF check." });
  }
  if (authentication.kind !== "authenticated") {
    return apiFailure({ status: 401, error: "session_required", message: "An authenticated hosted session is required." });
  }
  if (requestMediaType(request.headers) !== "application/json") {
    return apiFailure({ status: 400, error: "invalid_improvement", message: "The skill improvement action must use JSON." });
  }
  const params = z.object({
    skillId: z.string().regex(/^[a-z0-9-]+$/u),
    proposalId: z.string().regex(/^proposal-[a-f0-9]{16}$/u),
  }).strict().safeParse(await context.params);
  const encodedBody = await readBoundedRequestBody({ request, maximumBytes: 2_048 });
  let rawBody: unknown;
  try {
    rawBody = encodedBody === undefined ? undefined : JSON.parse(encodedBody);
  } catch {
    rawBody = undefined;
  }
  const body = ResolveSkillImprovementProposalSchema.safeParse(rawBody);
  if (!params.success || !body.success) {
    return apiFailure({ status: 400, error: "invalid_improvement", message: "The skill improvement action is invalid." });
  }
  const result = await requestControlPlane({
    configuration: authentication.configuration,
    credential: authentication.credential,
    path: `/v1/skill-registry/${encodeURIComponent(params.data.skillId)}/proposals/${encodeURIComponent(params.data.proposalId)}`,
    method: "POST",
    body: body.data,
    parse: (payload) => SkillRegistryDetailResponseSchema.parse(payload),
  });
  return controlPlaneResponse(result);
}
