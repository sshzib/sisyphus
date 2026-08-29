import { z } from "zod";
import {
  ApiErrorSchema,
  DashboardSnapshotSchema,
  RestoreSkillResponseSchema,
  type DashboardQuery,
  type DashboardSnapshot,
  type RestoreSkillRequest,
  type RestoreSkillResponse,
} from "./contracts.js";
import {
  createDemoSnapshot,
  createRestoredAuditEvent,
  filterDashboardSnapshot,
} from "./demo-data.js";

export interface SisyphusDataClient {
  getDashboard(query: DashboardQuery): Promise<DashboardSnapshot>;
  restoreSkill(
    skillVersionId: string,
    input: RestoreSkillRequest,
  ): Promise<RestoreSkillResponse>;
}

export class SisyphusApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly requestId: string | undefined,
  ) {
    super(message);
    this.name = "SisyphusApiError";
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

export function createDemoDataClient(): SisyphusDataClient {
  let snapshot = createDemoSnapshot();

  return {
    async getDashboard(query) {
      return filterDashboardSnapshot(snapshot, query);
    },
    async restoreSkill(skillVersionId, input) {
      const skill = snapshot.skills.find(
        (candidate) => candidate.skillVersionId === skillVersionId,
      );
      if (skill === undefined) {
        throw new SisyphusApiError("Skill version not found", 404, undefined);
      }

      const restoredSkill: DashboardSnapshot["skills"][number] = {
        ...skill,
        disposition: "probation",
        lastChangedAt: "2026-08-29T09:55:00.000Z",
      };
      const auditEvent = createRestoredAuditEvent({
        skillName: skill.name,
        runtime: skill.runtime,
        reason: input.reason,
      });
      snapshot = {
        ...snapshot,
        skills: snapshot.skills.map((candidate) =>
          candidate.skillVersionId === skillVersionId ? restoredSkill : candidate,
        ),
        audit: [auditEvent, ...snapshot.audit],
      };
      return RestoreSkillResponseSchema.parse({ skill: restoredSkill, auditEvent });
    },
  };
}
