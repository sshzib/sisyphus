import type {
  DashboardQuery,
  DashboardSnapshot,
  RestoreSkillRequest,
  RestoreSkillResponse,
} from "./contracts.js";

export interface SisyphusDataClient {
  readonly dataSource:
    | { readonly kind: "demo" }
    | { readonly kind: "authenticated-session" }
    | { readonly kind: "remote-api" };
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

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
