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
    method?: "GET" | "POST" | "DELETE";
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
    async createEngineeringTask(input) {
      return request({
        path: "/v1/engineering/tasks",
        schema: CreateEngineeringTaskResponseSchema,
        method: "POST",
        body: EngineeringTaskSubmissionSchema.parse(input),
      });
    },
    async clearEngineeringHistory() {
      return request({
        path: "/v1/engineering/tasks/history",
        schema: ClearEngineeringHistoryResponseSchema,
        method: "DELETE",
      });
    },
    async startEngineeringExecution() {
      return request({
        path: "/v1/engineering/execution/start",
        schema: EngineeringExecutionControlResponseSchema,
        method: "POST",
      });
    },
    async stopEngineeringExecution() {
      return request({
        path: "/v1/engineering/execution/stop",
        schema: EngineeringExecutionControlResponseSchema,
        method: "POST",
      });
    },
    async setEngineeringExecutionBackend(input) {
      return request({
        path: "/v1/engineering/execution/backend",
        schema: EngineeringExecutionControlResponseSchema,
        method: "POST",
        body: EngineeringExecutionBackendChangeSchema.parse(input),
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
    async listSkillRegistry() {
      return request({ path: "/v1/skill-registry", schema: SkillRegistryListResponseSchema });
    },
    async getSkillRegistryDetail(skillId) {
      return request({ path: `/v1/skill-registry/${encodeURIComponent(skillId)}`, schema: SkillRegistryDetailResponseSchema });
    },
    async syncSkillRegistry() {
      return request({ path: "/v1/skill-registry/sync", schema: SkillRegistrySyncResponseSchema, method: "POST" });
    },
    async previewSkillRegistrySync() {
      return request({ path: "/v1/skill-registry/sync/preview", schema: SkillRegistrySyncPreviewSchema, method: "POST" });
    },
    async createCustomSkill(input) {
      return request({ path: "/v1/skill-registry/custom", schema: SkillRegistryDetailResponseSchema, method: "POST", body: CreateCustomSkillSchema.parse(input) });
    },
    async resolveSkillImprovementProposal(skillId, proposalId, input) {
      return request({
        path: `/v1/skill-registry/${encodeURIComponent(skillId)}/proposals/${encodeURIComponent(proposalId)}`,
        schema: SkillRegistryDetailResponseSchema,
        method: "POST",
        body: ResolveSkillImprovementProposalSchema.parse(input),
      });
    },
  };
}

export { createDemoDataClient } from "./demo-client.js";
export { createSessionDataClient } from "./session-client.js";
export { SisyphusApiError, type SisyphusDataClient } from "./data-client.js";
