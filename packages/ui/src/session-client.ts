import { z } from "zod";
import {
  ApiErrorSchema,
  DashboardSnapshotSchema,
  HostedCsrfTokenSchema,
  RestoreSkillResponseSchema,
} from "./contracts.js";
import {
  SisyphusApiError,
  type Fetcher,
  type SisyphusDataClient,
} from "./data-client.js";

export function createSessionDataClient(input: {
  csrfToken: string;
  fetcher?: Fetcher;
}): SisyphusDataClient {
  const csrfToken = HostedCsrfTokenSchema.parse(input.csrfToken);
  const fetcher: Fetcher =
    input.fetcher ?? ((request, init) => globalThis.fetch(request, init));

  async function request<T>(options: {
    path: string;
    schema: z.ZodType<T>;
    method?: "GET" | "POST";
    body?: unknown;
  }): Promise<T> {
    const method = options.method ?? "GET";
    const response = await fetcher(options.path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers:
        method === "POST"
          ? {
              "Content-Type": "application/json",
              "X-Sisyphus-CSRF": csrfToken,
            }
          : {},
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
    dataSource: { kind: "authenticated-session" },
    async getDashboard(query) {
      const queryString =
        query.runtime === undefined
          ? ""
          : `?runtime=${encodeURIComponent(query.runtime)}`;
      return request({
        path: `/api/dashboard${queryString}`,
        schema: DashboardSnapshotSchema,
      });
    },
    async restoreSkill(skillVersionId, restoreInput) {
      return request({
        path: `/api/skills/${encodeURIComponent(skillVersionId)}/restore`,
        schema: RestoreSkillResponseSchema,
        method: "POST",
        body: restoreInput,
      });
    },
  };
}
