import { z } from "zod";

import {
  createAdapterInstallationId,
  createAdapterVersion,
  createTimestamp,
  type AdapterVersion,
  type DecisionFor,
  type HookObservation,
  type RuntimeCapabilitySnapshot,
  type RuntimeIdentity,
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

const version = z.string().trim().min(1);

export type CodexAdapterOptions = {
  readonly runtimeVersion?: string;
  readonly adapterVersion?: string;
  readonly now?: () => Date;
};

export class CodexRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtime = "codex";

  readonly #adapterVersion: AdapterVersion;
  readonly #capabilities: RuntimeCapabilitySnapshot;
  readonly #now: () => Date;
  readonly #installations = new Map<string, AdapterInstallation>();

  constructor(input: CodexAdapterOptions = {}) {
    const runtimeVersion = version.parse(input.runtimeVersion ?? "unknown");
    this.#adapterVersion = createAdapterVersion(version.parse(input.adapterVersion ?? "0.1.0"));
    this.#now = input.now ?? (() => new Date());
    const supported: { readonly kind: "supported" } = { kind: "supported" };
    this.#capabilities = {
      runtime: "codex",
      runtimeVersion,
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

  normalizationOptions() {
    return {
      adapterVersion: this.#adapterVersion,
      capabilities: this.#capabilities,
      now: this.#now,
    };
  }

  async probe(): Promise<RuntimeCapabilitySnapshot> {
    return this.#capabilities;
  }

  async install(input: AdapterInstallRequest): Promise<AdapterInstallation> {
    const request = AdapterInstallRequestSchema.parse(input);
    const installationId = createAdapterInstallationId(
      `codex:${stableDigest({
        deviceId: request.deviceId,
        adapterVersion: request.adapterVersion,
        workerEndpoint: request.workerEndpoint,
        scope: request.scope,
      })}`,
    );
    const existing = this.#installations.get(installationId);
    if (existing !== undefined) return existing;

    const installedAt = this.#now();
    if (Number.isNaN(installedAt.getTime())) throw new Error("now() returned an invalid date");
    const installation: AdapterInstallation = {
      installationId,
      runtime: this.runtime,
      adapterVersion: request.adapterVersion,
      installedAt: createTimestamp(installedAt.toISOString()),
      scope: request.scope,
      capabilities: this.#capabilities,
    };
    this.#installations.set(installationId, installation);
    return installation;
  }

  async uninstall(input: AdapterUninstallRequest): Promise<void> {
    const request = AdapterUninstallRequestSchema.parse(input);
    this.#installations.delete(request.installationId);
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

export function createCodexAdapter(input: CodexAdapterOptions = {}): CodexRuntimeAdapter {
  return new CodexRuntimeAdapter(input);
}
