import "server-only";

import { randomUUID } from "node:crypto";
import {
  ApiErrorSchema,
  type ApiError,
} from "@sisyphus/ui/contracts";
import { SupabaseAccessTokenSchema } from "./auth-input";
import type { HostedConfiguration } from "./hosted-config";

type ConfiguredHostedMode = Extract<HostedConfiguration, { kind: "configured" }>;

export type ControlPlaneCredential =
  | {
      readonly kind: "supabase";
      readonly token: string;
    }
  | {
      readonly kind: "development-admin";
      readonly token: "demo-admin";
    };

export type ControlPlaneResult<T> =
  | { readonly kind: "success"; readonly data: T }
  | {
      readonly kind: "error";
      readonly status: number;
      readonly error: ApiError;
    };

function localError(input: {
  status: number;
  error: string;
  message: string;
}): ControlPlaneResult<never> {
  return {
    kind: "error",
    status: input.status,
    error: {
      error: input.error,
      message: input.message,
      requestId: randomUUID(),
    },
  };
}

export async function requestControlPlane<T>(input: {
  configuration: ConfiguredHostedMode;
  credential: ControlPlaneCredential;
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  parse: (payload: unknown) => T;
}): Promise<ControlPlaneResult<T>> {
  const credential =
    input.credential.kind === "supabase"
      ? SupabaseAccessTokenSchema.parse(input.credential.token)
      : input.credential.token;
  let response: Response;
  try {
    response = await fetch(`${input.configuration.apiUrl}${input.path}`, {
      method: input.method ?? "GET",
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + credential,
        Accept: "application/json",
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return localError({
      status: 502,
      error: "control_plane_unavailable",
      message: "The control plane is unavailable.",
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return localError({
      status: 502,
      error: "invalid_control_plane_response",
      message: "The control plane returned an invalid response.",
    });
  }
  if (!response.ok) {
    const parsedError = ApiErrorSchema.safeParse(payload);
    if (!parsedError.success) {
      return localError({
        status: response.status >= 400 && response.status < 500 ? response.status : 502,
        error: "control_plane_error",
        message: "The control plane rejected the request.",
      });
    }
    return {
      kind: "error",
      status: response.status >= 400 && response.status < 500 ? response.status : 502,
      error: parsedError.data,
    };
  }

  try {
    return { kind: "success", data: input.parse(payload) };
  } catch {
    return localError({
      status: 502,
      error: "invalid_control_plane_response",
      message: "The control plane returned data that does not match the dashboard contract.",
    });
  }
}
