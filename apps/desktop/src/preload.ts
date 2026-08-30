import { contextBridge, ipcRenderer } from "electron";
import {
  CreateEngineeringTaskResponseSchema,
  ClearEngineeringHistoryResponseSchema,
  EngineeringExecutionBackendChangeSchema,
  EngineeringExecutionControlResponseSchema,
  CreateCustomSkillSchema,
  DashboardQuerySchema,
  DashboardSnapshotSchema,
  EngineeringTaskSubmissionSchema,
  HostContextSchema,
  RestoreSkillRequestSchema,
  RestoreSkillResponseSchema,
  SkillRegistryDetailResponseSchema,
  SkillRegistryListResponseSchema,
  SkillRegistrySyncPreviewSchema,
  SkillRegistrySyncResponseSchema,
  ResolveSkillImprovementProposalSchema,
  type DashboardQuery,
  type DashboardSnapshot,
  type RestoreSkillRequest,
  type RestoreSkillResponse,
} from "@sisyphus/ui/contracts";
import { z } from "zod";
import {
  DesktopAuthenticationStateSchema,
  DesktopLoginCredentialsSchema,
  LocalEvidenceResponseSchema,
  desktopChannels,
  type LocalEvidenceResponse,
} from "./ipc.js";

export interface SisyphusDesktopApi {
  authenticate(input: {
    username: string;
    password: string;
  }): Promise<boolean>;
  getAuthenticationState(): Promise<"authenticated" | "login-required">;
  getHostContext(): Promise<ReturnType<typeof HostContextSchema.parse>>;
  getLocalEvidence(eventId: string): Promise<LocalEvidenceResponse>;
  getDataSource(): Promise<"unavailable" | "remote-api">;
  getDashboard(query: DashboardQuery): Promise<DashboardSnapshot>;
  createEngineeringTask(input: { request: string }): Promise<
    ReturnType<typeof CreateEngineeringTaskResponseSchema.parse>
  >;
  clearEngineeringHistory(): Promise<ReturnType<typeof ClearEngineeringHistoryResponseSchema.parse>>;
  startEngineeringExecution(): Promise<ReturnType<typeof EngineeringExecutionControlResponseSchema.parse>>;
  stopEngineeringExecution(): Promise<ReturnType<typeof EngineeringExecutionControlResponseSchema.parse>>;
  setEngineeringExecutionBackend(input: unknown): Promise<ReturnType<typeof EngineeringExecutionControlResponseSchema.parse>>;
  listSkillRegistry(): Promise<ReturnType<typeof SkillRegistryListResponseSchema.parse>>;
  getSkillRegistryDetail(skillId: string): Promise<ReturnType<typeof SkillRegistryDetailResponseSchema.parse>>;
  syncSkillRegistry(): Promise<ReturnType<typeof SkillRegistrySyncResponseSchema.parse>>;
  previewSkillRegistrySync(): Promise<ReturnType<typeof SkillRegistrySyncPreviewSchema.parse>>;
  createCustomSkill(input: unknown): Promise<ReturnType<typeof SkillRegistryDetailResponseSchema.parse>>;
  resolveSkillImprovementProposal(skillId: string, proposalId: string, input: unknown): Promise<ReturnType<typeof SkillRegistryDetailResponseSchema.parse>>;
  restoreSkill(
    skillVersionId: string,
    input: RestoreSkillRequest,
  ): Promise<RestoreSkillResponse>;
}

const desktopApi: SisyphusDesktopApi = {
  async authenticate(input) {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.authenticate,
      DesktopLoginCredentialsSchema.parse(input),
    );
    return z.boolean().parse(response);
  },
  async getAuthenticationState() {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.authenticationState,
    );
    return DesktopAuthenticationStateSchema.parse(response);
  },
  async getHostContext() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.hostContext);
    return HostContextSchema.parse(response);
  },
  async getLocalEvidence(eventId) {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.localEvidence,
      eventId,
    );
    return LocalEvidenceResponseSchema.parse(response);
  },
  async getDataSource() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.dataSource);
    return z.enum(["unavailable", "remote-api"]).parse(response);
  },
  async getDashboard(query) {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.dashboard,
      DashboardQuerySchema.parse(query),
    );
    return DashboardSnapshotSchema.parse(response);
  },
  async createEngineeringTask(input) {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.createEngineeringTask,
      EngineeringTaskSubmissionSchema.parse(input),
    );
    return CreateEngineeringTaskResponseSchema.parse(response);
  },
  async clearEngineeringHistory() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.clearEngineeringHistory);
    return ClearEngineeringHistoryResponseSchema.parse(response);
  },
  async startEngineeringExecution() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.startEngineeringExecution);
    return EngineeringExecutionControlResponseSchema.parse(response);
  },
  async stopEngineeringExecution() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.stopEngineeringExecution);
    return EngineeringExecutionControlResponseSchema.parse(response);
  },
  async setEngineeringExecutionBackend(input) {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.setEngineeringExecutionBackend,
      EngineeringExecutionBackendChangeSchema.parse(input),
    );
    return EngineeringExecutionControlResponseSchema.parse(response);
  },
  async listSkillRegistry() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.skillRegistryList);
    return SkillRegistryListResponseSchema.parse(response);
  },
  async getSkillRegistryDetail(skillId) {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.skillRegistryDetail, z.string().regex(/^[a-z0-9-]+$/u).parse(skillId));
    return SkillRegistryDetailResponseSchema.parse(response);
  },
  async syncSkillRegistry() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.skillRegistrySync);
    return SkillRegistrySyncResponseSchema.parse(response);
  },
  async previewSkillRegistrySync() {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.skillRegistrySyncPreview);
    return SkillRegistrySyncPreviewSchema.parse(response);
  },
  async createCustomSkill(input) {
    const response: unknown = await ipcRenderer.invoke(desktopChannels.skillRegistryCustom, CreateCustomSkillSchema.parse(input));
    return SkillRegistryDetailResponseSchema.parse(response);
  },
  async resolveSkillImprovementProposal(skillId, proposalId, input) {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.skillRegistryProposal,
      z.string().regex(/^[a-z0-9-]+$/u).parse(skillId),
      z.string().regex(/^proposal-[a-f0-9]{16}$/u).parse(proposalId),
      ResolveSkillImprovementProposalSchema.parse(input),
    );
    return SkillRegistryDetailResponseSchema.parse(response);
  },
  async restoreSkill(skillVersionId, input) {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.restoreSkill,
      z.string().trim().min(1).parse(skillVersionId),
      RestoreSkillRequestSchema.parse(input),
    );
    return RestoreSkillResponseSchema.parse(response);
  },
};

contextBridge.exposeInMainWorld("sisyphusDesktop", desktopApi);
