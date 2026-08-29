import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  session,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from "electron";
import { z } from "zod";
import {
  createLocalChallengeNonce,
  verifyLocalChallenge,
} from "@sisyphus/local-protocol";
import {
  ApiErrorSchema,
  DashboardQuerySchema,
  DashboardSnapshotSchema,
  HostContextSchema,
  RestoreSkillRequestSchema,
  RestoreSkillResponseSchema,
  type HostContext,
} from "@sisyphus/ui/contracts";
import { DeviceSecretStore, type DeviceSecretCipher } from "./device-secrets.js";
import { LocalEvidenceResponseSchema, desktopChannels } from "./ipc.js";

const WorkerCredentialSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u)
  .refine((value) => Buffer.from(value, "base64url").byteLength >= 32, {
    message: "Worker credentials must encode at least 32 bytes.",
  });

const EnvironmentSchema = z
  .object({
    SISYPHUS_DESKTOP_DEV_URL: z.string().url().optional(),
    SISYPHUS_WORKER_URL: z.string().url().default("http://127.0.0.1:7331"),
    SISYPHUS_DESKTOP_MANAGE_WORKER: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    SISYPHUS_WORKER_ENTRYPOINT: z.string().trim().min(1).optional(),
    SISYPHUS_HOOK_TOKEN: WorkerCredentialSchema.optional(),
    SISYPHUS_MCP_TOKEN: WorkerCredentialSchema.optional(),
    SISYPHUS_DESKTOP_TOKEN: WorkerCredentialSchema.optional(),
    SISYPHUS_API_URL: z.string().url().optional(),
    SISYPHUS_DESKTOP_API_TOKEN: z.string().trim().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (
      (environment.SISYPHUS_API_URL === undefined) !==
      (environment.SISYPHUS_DESKTOP_API_TOKEN === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "SISYPHUS_API_URL and SISYPHUS_DESKTOP_API_TOKEN must be configured together.",
      });
    }
  })
  .parse(process.env);

let managedWorker: UtilityProcess | undefined;
let workerStartupError: string | undefined;
let workerDesktopToken: string | undefined;
let mainWindow: BrowserWindow | undefined;
let workerRestartAttempts = 0;
let workerRestartTimer: ReturnType<typeof setTimeout> | undefined;
let applicationIsQuitting = false;

const WorkerHealthSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("sisyphus-worker"),
    version: z.string().min(1),
  })
  .strict();

const EvidenceNotFoundSchema = z
  .object({ error: z.literal("evidence-not-found") })
  .strict();

async function workerAuthenticatesDesktop(): Promise<boolean> {
  if (workerDesktopToken === undefined) return false;
  try {
    const nonce = createLocalChallengeNonce();
    const url = new URL("/v1/challenge", EnvironmentSchema.SISYPHUS_WORKER_URL);
    url.searchParams.set("channel", "desktop");
    url.searchParams.set("nonce", nonce);
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    return verifyLocalChallenge({
      response: await response.json(),
      channel: "desktop",
      nonce,
      token: workerDesktopToken,
    });
  } catch {
    return false;
  }
}

async function evidenceBrokerIsAvailable(): Promise<boolean> {
  if (workerDesktopToken === undefined || !(await workerAuthenticatesDesktop())) {
    return false;
  }
  try {
    const response = await fetch(`${EnvironmentSchema.SISYPHUS_WORKER_URL}/v1/evidence`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerDesktopToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId: "sisyphus-desktop-capability-probe" }),
      signal: AbortSignal.timeout(1_500),
    });
    return (
      response.status === 404 &&
      EvidenceNotFoundSchema.safeParse(await response.json()).success
    );
  } catch {
    return false;
  }
}

async function localEvidence(eventId: string) {
  if (workerDesktopToken === undefined) {
    throw new Error("The desktop evidence credential is unavailable.");
  }
  if (!(await workerAuthenticatesDesktop())) {
    throw new Error("The local worker failed device authentication.");
  }
  const response = await fetch(`${EnvironmentSchema.SISYPHUS_WORKER_URL}/v1/evidence`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${workerDesktopToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ eventId: z.string().trim().min(1).max(512).parse(eventId) }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "No local evidence is stored for this event."
        : `The local worker returned HTTP ${response.status}.`,
    );
  }
  const evidence = LocalEvidenceResponseSchema.parse(await response.json());
  const digest = createHash("sha256").update(evidence.evidence, "utf8").digest("hex");
  if (digest !== evidence.digest) {
    throw new Error("Local evidence failed its integrity check.");
  }
  return evidence;
}

async function workerHostContext(): Promise<HostContext> {
  const adapterAccess = [
    EnvironmentSchema.SISYPHUS_HOOK_TOKEN !== undefined &&
    EnvironmentSchema.SISYPHUS_MCP_TOKEN !== undefined
      ? { kind: "paired" as const, runtime: "codex" as const }
      : {
          kind: "setup-required" as const,
          runtime: "codex" as const,
          reason:
            "Launch the desktop app and Codex with the same SISYPHUS_HOOK_TOKEN and SISYPHUS_MCP_TOKEN values.",
        },
  ];
  try {
    const response = await fetch(`${EnvironmentSchema.SISYPHUS_WORKER_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return {
        kind: "desktop",
        worker: { kind: "offline", reason: `Worker returned HTTP ${response.status}.` },
        localEvidence: { kind: "unsupported", reason: "The local worker is offline." },
        adapterAccess,
      };
    }
    const health = WorkerHealthSchema.parse(await response.json());
    if (!(await workerAuthenticatesDesktop())) {
      return {
        kind: "desktop",
        worker: {
          kind: "offline",
          reason: "The process on the worker port failed device authentication.",
        },
        localEvidence: {
          kind: "unsupported",
          reason: "The worker could not be authenticated.",
        },
        adapterAccess,
      };
    }
    const evidenceAvailable = await evidenceBrokerIsAvailable();
    return HostContextSchema.parse({
      kind: "desktop",
      worker: {
        kind: "online",
        version: health.version,
        pendingUploads: 0,
      },
      localEvidence: evidenceAvailable
        ? { kind: "supported" }
        : {
            kind: "unsupported",
            reason: "The authenticated desktop evidence broker is unavailable.",
          },
      adapterAccess,
    });
  } catch (error: unknown) {
    return {
      kind: "desktop",
      worker: {
        kind: "offline",
        reason:
          workerStartupError ??
          (error instanceof Error ? error.message : "The local worker is unavailable."),
      },
      localEvidence: { kind: "unsupported", reason: "The local worker is offline." },
      adapterAccess,
    };
  }
}

function workerNetworkConfiguration(): {
  readonly host: "127.0.0.1" | "::1" | "localhost";
  readonly port: string;
} {
  const endpoint = new URL(EnvironmentSchema.SISYPHUS_WORKER_URL);
  if (endpoint.protocol !== "http:") {
    throw new Error("The managed worker URL must use loopback HTTP.");
  }
  const host = endpoint.hostname === "[::1]" ? "::1" : endpoint.hostname;
  const parsedHost = z.enum(["127.0.0.1", "::1", "localhost"]).safeParse(host);
  if (!parsedHost.success || endpoint.pathname !== "/" || endpoint.search !== "") {
    throw new Error("The managed worker URL must be an origin on a loopback host.");
  }
  return {
    host: parsedHost.data,
    port: String(endpoint.port === "" ? 80 : Number(endpoint.port)),
  };
}

function safeStorageCipher(): DeviceSecretCipher {
  return {
    isEncryptionAvailable() {
      if (!safeStorage.isEncryptionAvailable()) return false;
      return !(
        process.platform === "linux" &&
        ["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend())
      );
    },
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value),
  };
}

function childEnvironment(overrides: Readonly<Record<string, string>>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        !entry[0].startsWith("SISYPHUS_") && entry[1] !== undefined,
    ),
  );
  return { ...inherited, ...overrides };
}

function assertDesktopSender(event: IpcMainInvokeEvent): void {
  if (
    mainWindow === undefined ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("Desktop IPC is limited to the Sisyphus renderer.");
  }
}

function desktopApiOrigin(): string | undefined {
  const configured = EnvironmentSchema.SISYPHUS_API_URL;
  if (configured === undefined) return undefined;
  const endpoint = new URL(configured);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    throw new Error("The desktop control plane must use HTTPS or loopback HTTP.");
  }
  if (
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error(
      "The desktop control-plane URL must not contain credentials, a query, or a fragment.",
    );
  }
  return endpoint.toString().replace(/\/$/u, "");
}

async function desktopApiRequest(input: {
  readonly path: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
}): Promise<unknown> {
  const origin = desktopApiOrigin();
  const token = EnvironmentSchema.SISYPHUS_DESKTOP_API_TOKEN;
  if (origin === undefined || token === undefined) {
    throw new Error("The desktop control-plane connection is not configured.");
  }
  const response = await fetch(`${origin}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    throw new Error(
      parsed.success ? parsed.data.message : `Control plane returned HTTP ${response.status}.`,
    );
  }
  return payload;
}

async function workerIsOnline(): Promise<boolean> {
  try {
    const response = await fetch(`${EnvironmentSchema.SISYPHUS_WORKER_URL}/health`, {
      signal: AbortSignal.timeout(500),
    });
    return (
      response.ok &&
      WorkerHealthSchema.safeParse(await response.json()).success &&
      (await workerAuthenticatesDesktop())
    );
  } catch {
    return false;
  }
}

async function waitForWorker(): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (await workerIsOnline()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The managed worker did not become healthy.");
}

async function startManagedWorker(): Promise<void> {
  const userData = app.getPath("userData");
  const secretStore = new DeviceSecretStore({
    directory: join(userData, "secrets"),
    cipher: safeStorageCipher(),
  });
  workerDesktopToken =
    EnvironmentSchema.SISYPHUS_DESKTOP_TOKEN ??
    (await secretStore.loadOrCreate("desktop-token"));
  if (!EnvironmentSchema.SISYPHUS_DESKTOP_MANAGE_WORKER || (await workerIsOnline())) return;
  const workerEntrypoint =
    EnvironmentSchema.SISYPHUS_WORKER_ENTRYPOINT ??
    (app.isPackaged
      ? join(process.resourcesPath, "worker", "index.js")
      : fileURLToPath(new URL("../dist-worker/index.js", import.meta.url)));
  await access(workerEntrypoint);
  const [evidenceKey, storedHookToken, storedMcpToken] = await Promise.all([
    secretStore.loadOrCreate("evidence-key"),
    EnvironmentSchema.SISYPHUS_HOOK_TOKEN === undefined
      ? secretStore.loadOrCreate("hook-token")
      : Promise.resolve(undefined),
    EnvironmentSchema.SISYPHUS_MCP_TOKEN === undefined
      ? secretStore.loadOrCreate("mcp-token")
      : Promise.resolve(undefined),
  ]);
  const hookToken = EnvironmentSchema.SISYPHUS_HOOK_TOKEN ?? storedHookToken;
  const mcpToken = EnvironmentSchema.SISYPHUS_MCP_TOKEN ?? storedMcpToken;
  if (hookToken === undefined || mcpToken === undefined) {
    throw new Error("Worker credentials could not be provisioned.");
  }
  if (new Set([hookToken, mcpToken, workerDesktopToken]).size !== 3) {
    throw new Error("Worker credentials must be distinct.");
  }
  const network = workerNetworkConfiguration();
  managedWorker = utilityProcess.fork(workerEntrypoint, [], {
    cwd: userData,
    env: childEnvironment({
      SISYPHUS_DATA_DIR: join(userData, "worker"),
      SISYPHUS_EVIDENCE_KEY: evidenceKey,
      SISYPHUS_HOOK_TOKEN: hookToken,
      SISYPHUS_MCP_TOKEN: mcpToken,
      SISYPHUS_DESKTOP_TOKEN: workerDesktopToken,
      SISYPHUS_WORKER_HOST: network.host,
      SISYPHUS_WORKER_PORT: network.port,
    }),
    serviceName: "Sisyphus local worker",
    stdio: "ignore",
  });
  managedWorker.once("exit", (code) => {
    managedWorker = undefined;
    if (code !== 0) workerStartupError = `The managed worker exited with code ${code}.`;
    if (
      !applicationIsQuitting &&
      EnvironmentSchema.SISYPHUS_DESKTOP_MANAGE_WORKER &&
      workerRestartAttempts < 3
    ) {
      workerRestartAttempts += 1;
      const delay = 500 * 2 ** (workerRestartAttempts - 1);
      workerRestartTimer = setTimeout(() => {
        workerRestartTimer = undefined;
        void startManagedWorker().catch((error: unknown) => {
          workerStartupError =
            error instanceof Error
              ? `Worker restart failed: ${error.message}`
              : "Worker restart failed.";
        });
      }, delay);
    }
  });
  await waitForWorker();
  workerStartupError = undefined;
}

function createWindow(): BrowserWindow {
  const browserWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#090d12",
    title: "Sisyphus",
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.js", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  browserWindow.once("ready-to-show", () => browserWindow.show());
  browserWindow.once("closed", () => {
    if (mainWindow === browserWindow) mainWindow = undefined;
  });
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const allowedUrl = EnvironmentSchema.SISYPHUS_DESKTOP_DEV_URL;
    if (
      allowedUrl === undefined ||
      new URL(targetUrl).origin !== new URL(allowedUrl).origin
    ) {
      event.preventDefault();
    }
  });

  if (EnvironmentSchema.SISYPHUS_DESKTOP_DEV_URL !== undefined) {
    void browserWindow.loadURL(EnvironmentSchema.SISYPHUS_DESKTOP_DEV_URL);
  } else {
    void browserWindow.loadFile(fileURLToPath(new URL("../dist/index.html", import.meta.url)));
  }
  mainWindow = browserWindow;
  return browserWindow;
}

ipcMain.handle(desktopChannels.hostContext, async (event: IpcMainInvokeEvent) => {
  assertDesktopSender(event);
  return workerHostContext();
});
ipcMain.handle(desktopChannels.dataSource, (event: IpcMainInvokeEvent) => {
  assertDesktopSender(event);
  return EnvironmentSchema.SISYPHUS_API_URL === undefined ? "demo" : "remote-api";
});
ipcMain.handle(
  desktopChannels.dashboard,
  async (event: IpcMainInvokeEvent, input: unknown) => {
    assertDesktopSender(event);
    const query = DashboardQuerySchema.parse(input);
    const suffix =
      query.runtime === undefined ? "" : `?runtime=${encodeURIComponent(query.runtime)}`;
    return DashboardSnapshotSchema.parse(
      await desktopApiRequest({ path: `/v1/dashboard${suffix}` }),
    );
  },
);
ipcMain.handle(
  desktopChannels.restoreSkill,
  async (
    event: IpcMainInvokeEvent,
    skillVersionId: unknown,
    input: unknown,
  ) => {
    assertDesktopSender(event);
    const skill = z.string().trim().min(1).max(512).parse(skillVersionId);
    const restore = RestoreSkillRequestSchema.parse(input);
    return RestoreSkillResponseSchema.parse(
      await desktopApiRequest({
        path: `/v1/skills/${encodeURIComponent(skill)}/restore`,
        method: "POST",
        body: restore,
      }),
    );
  },
);
ipcMain.handle(
  desktopChannels.localEvidence,
  async (event: IpcMainInvokeEvent, eventId: unknown) => {
    assertDesktopSender(event);
    return localEvidence(z.string().trim().min(1).max(512).parse(eventId));
  },
);

await app.whenReady();
try {
  await startManagedWorker();
} catch (error: unknown) {
  workerStartupError =
    error instanceof Error ? error.message : "The managed worker could not start.";
}
session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
  callback(false);
});
createWindow();

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  applicationIsQuitting = true;
  if (workerRestartTimer !== undefined) clearTimeout(workerRestartTimer);
  managedWorker?.kill();
  managedWorker = undefined;
});
