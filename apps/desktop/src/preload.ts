import { contextBridge, ipcRenderer } from "electron";
import { HostContextSchema } from "@sisyphus/ui/contracts";
import {
  LocalEvidenceResponseSchema,
  desktopChannels,
  type LocalEvidenceResponse,
} from "./ipc.js";

export interface SisyphusDesktopApi {
  getHostContext(): Promise<ReturnType<typeof HostContextSchema.parse>>;
  getLocalEvidence(eventId: string): Promise<LocalEvidenceResponse>;
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
};

contextBridge.exposeInMainWorld("sisyphusDesktop", desktopApi);
