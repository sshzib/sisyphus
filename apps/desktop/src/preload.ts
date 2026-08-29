import { contextBridge, ipcRenderer } from "electron";
import {
  DashboardQuerySchema,
  DashboardSnapshotSchema,
  HostContextSchema,
  RestoreSkillRequestSchema,
  RestoreSkillResponseSchema,
  type DashboardQuery,
  type DashboardSnapshot,
  type RestoreSkillRequest,
  type RestoreSkillResponse,
} from "@sisyphus/ui/contracts";
import { z } from "zod";
import {
  LocalEvidenceResponseSchema,
  desktopChannels,
  type LocalEvidenceResponse,
} from "./ipc.js";

export interface SisyphusDesktopApi {
  getHostContext(): Promise<ReturnType<typeof HostContextSchema.parse>>;
  getLocalEvidence(eventId: string): Promise<LocalEvidenceResponse>;
  getDataSource(): Promise<"demo" | "remote-api">;
  getDashboard(query: DashboardQuery): Promise<DashboardSnapshot>;
  restoreSkill(
    skillVersionId: string,
    input: RestoreSkillRequest,
  ): Promise<RestoreSkillResponse>;
}

const desktopApi: SisyphusDesktopApi = {
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
    return z.enum(["demo", "remote-api"]).parse(response);
  },
  async getDashboard(query) {
    const response: unknown = await ipcRenderer.invoke(
      desktopChannels.dashboard,
      DashboardQuerySchema.parse(query),
    );
    return DashboardSnapshotSchema.parse(response);
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
