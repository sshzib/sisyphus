import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ApiError } from "@sisyphus/ui/contracts";
import type { ControlPlaneResult } from "./control-plane";

const privateHeaders = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
};

export function apiFailure(input: {
  status: number;
  error: string;
  message: string;
}): NextResponse<ApiError> {
  return NextResponse.json(
    {
      error: input.error,
      message: input.message,
      requestId: randomUUID(),
    },
    { status: input.status, headers: privateHeaders },
  );
}

export function controlPlaneResponse<T>(
  result: ControlPlaneResult<T>,
): NextResponse<T | ApiError> {
  return result.kind === "success"
    ? NextResponse.json(result.data, { headers: privateHeaders })
    : NextResponse.json(result.error, {
        status: result.status,
        headers: privateHeaders,
      });
}
