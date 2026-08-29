import {
  DashboardQuerySchema,
  DashboardSnapshotSchema,
} from "@sisyphus/ui/contracts";
import type { NextRequest } from "next/server";
import { requestControlPlane } from "../../../lib/control-plane";
import { authenticateHostedRequest } from "../../../lib/hosted-session";
import {
  apiFailure,
  controlPlaneResponse,
} from "../../../lib/route-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authentication = authenticateHostedRequest(request);
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
  const runtimeFilter = request.nextUrl.searchParams.get("runtime");
  const query = DashboardQuerySchema.safeParse(
    runtimeFilter === null ? {} : { runtime: runtimeFilter },
  );
  if (!query.success) {
    return apiFailure({
      status: 400,
      error: "invalid_runtime",
      message: "The runtime filter is invalid.",
    });
  }
  const queryString =
    query.data.runtime === undefined
      ? ""
      : `?runtime=${encodeURIComponent(query.data.runtime)}`;
  const result = await requestControlPlane({
    configuration: authentication.configuration,
    bearerToken: authentication.session.bearerToken,
    path: `/v1/dashboard${queryString}`,
    parse: (payload) => DashboardSnapshotSchema.parse(payload),
  });
  return controlPlaneResponse(result);
}
