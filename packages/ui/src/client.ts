import { z } from "zod";
import {
  ApiErrorSchema,
  DashboardSnapshotSchema,
  RestoreSkillResponseSchema,
} from "./contracts.js";
import {
  SisyphusApiError,
  type Fetcher,
  type SisyphusDataClient,
} from "./data-client.js";

export function createHttpDataClient(input: {
  baseUrl: string;
  token: string;
  fetcher?: Fetcher;
}): SisyphusDataClient {
  const baseUrl = input.baseUrl.replace(/\/$/u, "");
  const fetcher: Fetcher =
    input.fetcher ?? ((request, init) => globalThis.fetch(request, init));

  async function request<T>(options: {
    path: string;
    schema: z.ZodType<T>;
    method?: "GET" | "POST";
    body?: unknown;
  }): Promise<T> {
    const response = await fetcher(`${baseUrl}${options.path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const parsedError = ApiErrorSchema.safeParse(payload);
      throw new SisyphusApiError(
        parsedError.success ? parsedError.data.message : `Request failed (${response.status})`,
        response.status,
        parsedError.success ? parsedError.data.requestId : undefined,
      );
    }
    return options.schema.parse(payload);
  }

  return {
    dataSource: { kind: "remote-api" },
    async getDashboard(query) {
      const queryString =
        query.runtime === undefined
          ? ""
          : `?runtime=${encodeURIComponent(query.runtime)}`;
      return request({
        path: `/v1/dashboard${queryString}`,
        schema: DashboardSnapshotSchema,
      });
    },
    async restoreSkill(skillVersionId, restoreInput) {
      return request({
        path: `/v1/skills/${encodeURIComponent(skillVersionId)}/restore`,
        schema: RestoreSkillResponseSchema,
        method: "POST",
        body: restoreInput,
      });
    },
  };
}

export { createDemoDataClient } from "./demo-client.js";
export { createSessionDataClient } from "./session-client.js";
export { SisyphusApiError, type SisyphusDataClient } from "./data-client.js";
