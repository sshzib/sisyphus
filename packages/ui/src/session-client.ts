import { z } from "zod";
import {
  ApiErrorSchema,
  ClearEngineeringHistoryResponseSchema,
  EngineeringExecutionBackendChangeSchema,
  EngineeringExecutionControlResponseSchema,
  CreateEngineeringTaskResponseSchema,
  CreateCustomSkillSchema,
  DashboardSnapshotSchema,
  EngineeringTaskSubmissionSchema,
  HostedCsrfTokenSchema,
  RestoreSkillResponseSchema,
  SkillRegistryDetailResponseSchema,
  SkillRegistryListResponseSchema,
  SkillRegistrySyncPreviewSchema,
  SkillRegistrySyncResponseSchema,
  ResolveSkillImprovementProposalSchema,
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
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
  }): Promise<T> {
    const method = options.method ?? "GET";
    const response = await fetcher(options.path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers:
        method === "GET"
          ? {}
          : {
              "X-Sisyphus-CSRF": csrfToken,
              ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
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
    async createEngineeringTask(input) {
      return request({
        path: "/api/engineering/tasks",
        schema: CreateEngineeringTaskResponseSchema,
        method: "POST",
        body: EngineeringTaskSubmissionSchema.parse(input),
      });
    },
    async clearEngineeringHistory() {
      return request({
        path: "/api/engineering/tasks/history",
        schema: ClearEngineeringHistoryResponseSchema,
        method: "DELETE",
      });
    },
    async startEngineeringExecution() {
      return request({
        path: "/api/engineering/execution/start",
        schema: EngineeringExecutionControlResponseSchema,
        method: "POST",
      });
    },
    async stopEngineeringExecution() {
      return request({
        path: "/api/engineering/execution/stop",
        schema: EngineeringExecutionControlResponseSchema,
        method: "POST",
      });
    },
    async setEngineeringExecutionBackend(input) {
      return request({
        path: "/api/engineering/execution/backend",
        schema: EngineeringExecutionControlResponseSchema,
        method: "POST",
        body: EngineeringExecutionBackendChangeSchema.parse(input),
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
    async listSkillRegistry() {
      return request({ path: "/api/skill-registry", schema: SkillRegistryListResponseSchema });
    },
    async getSkillRegistryDetail(skillId) {
      return request({ path: `/api/skill-registry/${encodeURIComponent(skillId)}`, schema: SkillRegistryDetailResponseSchema });
    },
    async syncSkillRegistry() {
      return request({ path: "/api/skill-registry/sync", schema: SkillRegistrySyncResponseSchema, method: "POST" });
    },
    async previewSkillRegistrySync() {
      return request({ path: "/api/skill-registry/sync/preview", schema: SkillRegistrySyncPreviewSchema, method: "POST" });
    },
    async createCustomSkill(input) {
      return request({ path: "/api/skill-registry/custom", schema: SkillRegistryDetailResponseSchema, method: "POST", body: CreateCustomSkillSchema.parse(input) });
    },
    async resolveSkillImprovementProposal(skillId, proposalId, input) {
      return request({
        path: `/api/skill-registry/${encodeURIComponent(skillId)}/proposals/${encodeURIComponent(proposalId)}`,
        schema: SkillRegistryDetailResponseSchema,
        method: "POST",
        body: ResolveSkillImprovementProposalSchema.parse(input),
      });
    },
  };
}
