import type {
  CreateEngineeringTaskResponse,
  ClearEngineeringHistoryResponse,
  CreateCustomSkill,
  DashboardQuery,
  DashboardSnapshot,
  EngineeringTaskSubmission,
  RestoreSkillRequest,
  RestoreSkillResponse,
  SkillRegistryDetailResponse,
  SkillRegistryListResponse,
  SkillRegistrySyncPreview,
  SkillRegistrySyncResponse,
  ResolveSkillImprovementProposal,
} from "./contracts.js";

export interface SisyphusDataClient {
  readonly dataSource:
    | { readonly kind: "demo" }
    | { readonly kind: "authenticated-session" }
    | { readonly kind: "remote-api" };
  getDashboard(query: DashboardQuery): Promise<DashboardSnapshot>;
  createEngineeringTask(
    input: EngineeringTaskSubmission,
  ): Promise<CreateEngineeringTaskResponse>;
  clearEngineeringHistory(): Promise<ClearEngineeringHistoryResponse>;
  restoreSkill(
    skillVersionId: string,
    input: RestoreSkillRequest,
  ): Promise<RestoreSkillResponse>;
  listSkillRegistry(): Promise<SkillRegistryListResponse>;
  getSkillRegistryDetail(skillId: string): Promise<SkillRegistryDetailResponse>;
  syncSkillRegistry(): Promise<SkillRegistrySyncResponse>;
  previewSkillRegistrySync(): Promise<SkillRegistrySyncPreview>;
  createCustomSkill(input: CreateCustomSkill): Promise<SkillRegistryDetailResponse>;
  resolveSkillImprovementProposal(
    skillId: string,
    proposalId: string,
    input: ResolveSkillImprovementProposal,
  ): Promise<SkillRegistryDetailResponse>;
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
