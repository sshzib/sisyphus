import { z } from "zod";

import {
  createAdapterVersion,
  createTimestamp,
  defaultRuntimeInstallationIdentity,
  type AdapterVersion,
  type DecisionFor,
  type HookObservation,
  type RuntimeCapabilitySnapshot,
  type RuntimeIdentity,
  type RuntimeInstallationIdentity,
  type SkillActivationEvidence,
} from "@sisyphus/domain";
import {
  AdapterInstallRequestSchema,
  AdapterUninstallRequestSchema,
  type AdapterInstallRequest,
  type AdapterInstallation,
  type AdapterUninstallRequest,
  type AgentRuntimeAdapter,
  type RuntimeResponse,
  type UnknownRuntimeEvent,
} from "@sisyphus/adapter-kit";

import {
  inspectCodexEvent,
  parseCodexHookEvent,
  stableDigest,
  deriveCodexIdentity,
  verifyCodexSkillActivation,
} from "./codex-wire.js";
import { renderCodexDecision } from "./responses.js";

const version = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.toLowerCase() !== "unknown", {
    message: "A concrete Codex runtime version is required.",
  });

export type CodexAdapterOptions = {
  readonly runtimeVersion: string;
  readonly adapterVersion?: string;
  readonly installationIdentity?: RuntimeInstallationIdentity;
  readonly now?: () => Date;
};

export function codexCapabilities(runtimeVersion: string): RuntimeCapabilitySnapshot {
  const supported: { readonly kind: "supported" } = { kind: "supported" };
  return {
    runtime: "codex",
    runtimeVersion: version.parse(runtimeVersion),
    promptInterception: supported,
    skillSelectionControl: supported,
    rootStopContinuation: supported,
    subagentStopContinuation: supported,
    toolPrevention: supported,
    toolObservation: supported,
    stableTokenUsage: {
      kind: "unsupported",
      reason: "Codex lifecycle hooks do not report stable token counts.",
    },
    localEvidenceAccess: {
      kind: "partial",
      limitation: "Hook payloads are stable, but the optional transcript format is not.",
    },
  };
}

export class CodexRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtime = "codex";
  readonly installationIdentity: RuntimeInstallationIdentity;

  readonly #adapterVersion: AdapterVersion;
  readonly #capabilities: RuntimeCapabilitySnapshot;
  readonly #now: () => Date;
  readonly #installations = new Map<string, AdapterInstallation>();
  readonly #installationRequestDigests = new Map<string, string>();

  constructor(input: CodexAdapterOptions) {
    this.#adapterVersion = createAdapterVersion(version.parse(input.adapterVersion ?? "0.1.0"));
    this.installationIdentity =
      input.installationIdentity ??
      defaultRuntimeInstallationIdentity({
        runtime: this.runtime,
        adapterVersion: this.#adapterVersion,
        profile: "local",
      });
    if (this.installationIdentity.profile !== "local") {
      throw new Error("Codex installation profile must be local.");
    }
    this.#now = input.now ?? (() => new Date());
    this.#capabilities = codexCapabilities(input.runtimeVersion);
  }

  normalizationOptions() {
    return {
      adapterVersion: this.#adapterVersion,
      runtimeInstallation: this.installationIdentity,
      capabilities: this.#capabilities,
      now: this.#now,
    };
  }

  async probe(): Promise<RuntimeCapabilitySnapshot> {
    return this.#capabilities;
  }

  async install(input: AdapterInstallRequest): Promise<AdapterInstallation> {
    const request = AdapterInstallRequestSchema.parse(input);
    if (request.adapterVersion !== this.#adapterVersion) {
      throw new Error("Codex install request does not match the adapter version.");
    }
    const installationId = this.installationIdentity.adapterInstallationId;
    const requestDigest = stableDigest(request);
    const existing = this.#installations.get(installationId);
    if (existing !== undefined) {
      if (this.#installationRequestDigests.get(installationId) !== requestDigest) {
        throw new Error("Codex installation identity belongs to another install request.");
      }
      return existing;
    }

    const installedAt = this.#now();
    if (Number.isNaN(installedAt.getTime())) throw new Error("now() returned an invalid date");
    const installation: AdapterInstallation = {
      installationId,
      profile: this.installationIdentity.profile,
      runtime: this.runtime,
      adapterVersion: request.adapterVersion,
      installedAt: createTimestamp(installedAt.toISOString()),
      scope: request.scope,
      capabilities: this.#capabilities,
    };
    this.#installations.set(installationId, installation);
    this.#installationRequestDigests.set(installationId, requestDigest);
    return installation;
  }

  async uninstall(input: AdapterUninstallRequest): Promise<void> {
    const request = AdapterUninstallRequestSchema.parse(input);
    this.#installations.delete(request.installationId);
    this.#installationRequestDigests.delete(request.installationId);
  }

  parseEvent(input: UnknownRuntimeEvent): HookObservation {
    return inspectCodexEvent(input, this.normalizationOptions()).observation;
  }

  renderDecision<E extends HookObservation>(
    _event: E,
    decision: DecisionFor<E>,
  ): RuntimeResponse {
    return renderCodexDecision(decision);
  }

  deriveIdentity(event: UnknownRuntimeEvent): RuntimeIdentity {
    return deriveCodexIdentity(parseCodexHookEvent(event));
  }

  verifySkillActivation(event: UnknownRuntimeEvent): SkillActivationEvidence {
    return verifyCodexSkillActivation(parseCodexHookEvent(event));
  }
}

export function createCodexAdapter(input: CodexAdapterOptions): CodexRuntimeAdapter {
  return new CodexRuntimeAdapter(input);
}
