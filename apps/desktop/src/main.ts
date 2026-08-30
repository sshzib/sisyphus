import { createHash, timingSafeEqual } from "node:crypto";
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
  CreateCustomSkillSchema,
  CreateEngineeringTaskResponseSchema,
  EngineeringTaskSubmissionSchema,
  HostContextSchema,
  RestoreSkillRequestSchema,
  RestoreSkillResponseSchema,
  ResolveSkillImprovementProposalSchema,
  type HostContext,
} from "@sisyphus/ui/contracts";
import { DeviceSecretStore, type DeviceSecretCipher } from "./device-secrets.js";
import {
  localWorkerUrl,
  parseDevelopmentRendererUrl,
  rendererUrlIsTrusted,
} from "./desktop-boundaries.js";
import {
  managedWorkerChildEnvironment,
  parseManagedWorkerProvisioning,
  resolveManagedWorkerProvisioning,
  type ParsedManagedWorkerProvisioning,
} from "./managed-worker-provisioning.js";
import {
  DesktopLoginCredentialsSchema,
  LocalEvidenceResponseSchema,
  desktopChannels,
} from "./ipc.js";

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
    SISYPHUS_CODEX_RUNTIME_VERSION: z.string().trim().min(1).optional(),
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
const disabledManagedWorkerProvisioning: ParsedManagedWorkerProvisioning = {
  kind: "offline-default",
};
const ManagedWorkerProvisioningConfiguration =
  EnvironmentSchema.SISYPHUS_DESKTOP_MANAGE_WORKER
    ? parseManagedWorkerProvisioning(process.env)
    : disabledManagedWorkerProvisioning;

const developmentRendererUrl =
  EnvironmentSchema.SISYPHUS_DESKTOP_DEV_URL === undefined
    ? app.isPackaged
      ? undefined
      : parseDevelopmentRendererUrl("http://127.0.0.1:4173")
    : parseDevelopmentRendererUrl(EnvironmentSchema.SISYPHUS_DESKTOP_DEV_URL);
const packagedRendererUrl = new URL("../dist/index.html", import.meta.url).href;

let managedWorker: UtilityProcess | undefined;
let workerStartupError: string | undefined;
let workerDesktopToken: string | undefined;
let mainWindow: BrowserWindow | undefined;
let workerRestartAttempts = 0;
let workerRestartTimer: ReturnType<typeof setTimeout> | undefined;
let applicationIsQuitting = false;
const desktopDevelopmentAdminRequired =
  !app.isPackaged && process.env.NODE_ENV !== "production";
let desktopAuthenticated = !desktopDevelopmentAdminRequired;

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
    const url = localWorkerUrl(
      EnvironmentSchema.SISYPHUS_WORKER_URL,
      "/v1/challenge",
    );
    url.searchParams.set("channel", "desktop");
    url.searchParams.set("nonce", nonce);
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
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
    const response = await fetch(localWorkerUrl(
      EnvironmentSchema.SISYPHUS_WORKER_URL,
      "/v1/evidence",
    ), {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerDesktopToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId: "sisyphus-desktop-capability-probe" }),
      redirect: "error",
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
  const response = await fetch(localWorkerUrl(
    EnvironmentSchema.SISYPHUS_WORKER_URL,
    "/v1/evidence",
  ), {
    method: "POST",
    headers: {
      authorization: `Bearer ${workerDesktopToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ eventId: z.string().trim().min(1).max(512).parse(eventId) }),
    redirect: "error",
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
    const response = await fetch(localWorkerUrl(
      EnvironmentSchema.SISYPHUS_WORKER_URL,
      "/health",
    ), {
      redirect: "error",
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
        policyMode: EnvironmentSchema.SISYPHUS_DESKTOP_MANAGE_WORKER
          ? ManagedWorkerProvisioningConfiguration.kind
          : "external",
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
  readonly host: "127.0.0.1" | "::1";
  readonly port: string;
} {
  const endpoint = localWorkerUrl(EnvironmentSchema.SISYPHUS_WORKER_URL, "/");
  if (endpoint.protocol !== "http:") {
    throw new Error("The managed worker URL must use loopback HTTP.");
  }
  const host = endpoint.hostname === "[::1]" ? "::1" : endpoint.hostname;
  const parsedHost = z.enum(["127.0.0.1", "::1"]).parse(host);
  return {
    host: parsedHost,
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
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !rendererUrlIsTrusted({
      candidateUrl: event.senderFrame.url,
      packaged: app.isPackaged,
      packagedRendererUrl,
      ...(developmentRendererUrl === undefined
        ? {}
        : { developmentRendererUrl: developmentRendererUrl.href }),
    })
  ) {
    throw new Error("Desktop IPC is limited to the Sisyphus renderer.");
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function assertDesktopAuthenticated(): void {
  if (!desktopAuthenticated) {
    throw new Error("Desktop authentication is required.");
  }
}

function desktopApiOrigin(): string | undefined {
  const configured =
    EnvironmentSchema.SISYPHUS_API_URL ??
    (desktopDevelopmentAdminRequired ? "http://127.0.0.1:7330" : undefined);
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

function desktopApiToken(): string | undefined {
  return (
    EnvironmentSchema.SISYPHUS_DESKTOP_API_TOKEN ??
    (desktopDevelopmentAdminRequired ? "demo-admin" : undefined)
  );
}

async function desktopApiRequest(input: {
  readonly path: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
}): Promise<unknown> {
  const origin = desktopApiOrigin();
  const token = desktopApiToken();
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
    redirect: "error",
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
    const response = await fetch(localWorkerUrl(
      EnvironmentSchema.SISYPHUS_WORKER_URL,
      "/health",
    ), {
      redirect: "error",
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
  if (!EnvironmentSchema.SISYPHUS_DESKTOP_MANAGE_WORKER) return;
  const provisioning = await resolveManagedWorkerProvisioning({
    configuration: ManagedWorkerProvisioningConfiguration,
    loadDeviceToken: () => secretStore.loadProvisioned("device-token"),
    persistDeviceToken: (value) =>
      secretStore.persistProvisioned("device-token", value),
  });
  if (provisioning.kind !== "offline-default") {
    await access(provisioning.policyFile);
  }
  if (await workerIsOnline()) return;
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
      ...managedWorkerChildEnvironment(provisioning),
      ...(EnvironmentSchema.SISYPHUS_CODEX_RUNTIME_VERSION === undefined
        ? {}
        : {
            SISYPHUS_CODEX_RUNTIME_VERSION:
              EnvironmentSchema.SISYPHUS_CODEX_RUNTIME_VERSION,
          }),
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
  const navigationIsTrusted = (targetUrl: string): boolean =>
    rendererUrlIsTrusted({
      candidateUrl: targetUrl,
      packaged: app.isPackaged,
      packagedRendererUrl,
      ...(developmentRendererUrl === undefined
        ? {}
        : { developmentRendererUrl: developmentRendererUrl.href }),
    });
  browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!navigationIsTrusted(targetUrl)) {
      event.preventDefault();
    }
  });
  browserWindow.webContents.on("will-redirect", (event, targetUrl) => {
    if (!navigationIsTrusted(targetUrl)) {
      event.preventDefault();
    }
  });

  if (developmentRendererUrl !== undefined) {
    void browserWindow.loadURL(developmentRendererUrl.href);
  } else {
    void browserWindow.loadURL(packagedRendererUrl);
  }
  mainWindow = browserWindow;
  return browserWindow;
}

ipcMain.handle(
  desktopChannels.authenticationState,
  (event: IpcMainInvokeEvent) => {
    assertDesktopSender(event);
    return desktopAuthenticated ? "authenticated" : "login-required";
  },
);
ipcMain.handle(
  desktopChannels.authenticate,
  (event: IpcMainInvokeEvent, input: unknown) => {
    assertDesktopSender(event);
    if (!desktopDevelopmentAdminRequired) {
      return false;
    }
    const credentials = DesktopLoginCredentialsSchema.parse(input);
    desktopAuthenticated =
      safeEqual(credentials.username, "admin") &&
      safeEqual(credentials.password, "admin");
    return desktopAuthenticated;
  },
);
ipcMain.handle(desktopChannels.hostContext, async (event: IpcMainInvokeEvent) => {
  assertDesktopSender(event);
  assertDesktopAuthenticated();
  return workerHostContext();
});
ipcMain.handle(desktopChannels.dataSource, (event: IpcMainInvokeEvent) => {
  assertDesktopSender(event);
  assertDesktopAuthenticated();
  return desktopApiOrigin() === undefined
    ? "unavailable"
    : "remote-api";
});
ipcMain.handle(
  desktopChannels.dashboard,
  async (event: IpcMainInvokeEvent, input: unknown) => {
    assertDesktopSender(event);
    assertDesktopAuthenticated();
    const query = DashboardQuerySchema.parse(input);
    const suffix =
      query.runtime === undefined ? "" : `?runtime=${encodeURIComponent(query.runtime)}`;
    return DashboardSnapshotSchema.parse(
      await desktopApiRequest({ path: `/v1/dashboard${suffix}` }),
    );
  },
);
ipcMain.handle(
  desktopChannels.createEngineeringTask,
  async (event: IpcMainInvokeEvent, input: unknown) => {
    assertDesktopSender(event);
    assertDesktopAuthenticated();
    const task = EngineeringTaskSubmissionSchema.parse(input);
    return CreateEngineeringTaskResponseSchema.parse(
      await desktopApiRequest({
        path: "/v1/engineering/tasks",
        method: "POST",
        body: task,
      }),
    );
  },
);
ipcMain.handle(desktopChannels.skillRegistryList, async (event: IpcMainInvokeEvent) => {
  assertDesktopSender(event);
  assertDesktopAuthenticated();
  return desktopApiRequest({ path: "/v1/skill-registry" });
});
ipcMain.handle(
  desktopChannels.skillRegistryDetail,
  async (event: IpcMainInvokeEvent, skillId: unknown) => {
    assertDesktopSender(event);
    assertDesktopAuthenticated();
    const skill = z.string().regex(/^[a-z0-9-]+$/u).parse(skillId);
    return desktopApiRequest({ path: `/v1/skill-registry/${encodeURIComponent(skill)}` });
  },
);
ipcMain.handle(desktopChannels.skillRegistrySync, async (event: IpcMainInvokeEvent) => {
  assertDesktopSender(event);
  assertDesktopAuthenticated();
  return desktopApiRequest({ path: "/v1/skill-registry/sync", method: "POST" });
});
ipcMain.handle(desktopChannels.skillRegistrySyncPreview, async (event: IpcMainInvokeEvent) => {
  assertDesktopSender(event);
  assertDesktopAuthenticated();
  return desktopApiRequest({ path: "/v1/skill-registry/sync/preview", method: "POST" });
});
ipcMain.handle(
  desktopChannels.skillRegistryCustom,
  async (event: IpcMainInvokeEvent, input: unknown) => {
    assertDesktopSender(event);
    assertDesktopAuthenticated();
    return desktopApiRequest({
      path: "/v1/skill-registry/custom",
      method: "POST",
      body: CreateCustomSkillSchema.parse(input),
    });
  },
);
ipcMain.handle(
  desktopChannels.skillRegistryProposal,
  async (event: IpcMainInvokeEvent, skillId: unknown, proposalId: unknown, input: unknown) => {
    assertDesktopSender(event);
    assertDesktopAuthenticated();
    const skill = z.string().regex(/^[a-z0-9-]+$/u).parse(skillId);
    const proposal = z.string().regex(/^proposal-[a-f0-9]{16}$/u).parse(proposalId);
    return desktopApiRequest({
      path: `/v1/skill-registry/${encodeURIComponent(skill)}/proposals/${encodeURIComponent(proposal)}`,
      method: "POST",
      body: ResolveSkillImprovementProposalSchema.parse(input),
    });
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
    assertDesktopAuthenticated();
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
    assertDesktopAuthenticated();
    return localEvidence(z.string().trim().min(1).max(512).parse(eventId));
  },
);

await app.whenReady();
if (app.isPackaged && developmentRendererUrl !== undefined) {
  throw new Error(
    "SISYPHUS_DESKTOP_DEV_URL is not permitted in a packaged application.",
  );
}
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
