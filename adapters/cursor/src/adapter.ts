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
  type AdapterInstallation,
  type AdapterInstallRequest,
  type AdapterUninstallRequest,
  type AgentRuntimeAdapter,
  type RuntimeResponse,
  type UnknownRuntimeEvent,
} from "@sisyphus/adapter-kit";

import {
  deriveCursorIdentity,
  normalizeCursorEvent,
  parseCursorHookEvent,
  stableCursorDigest,
  verifyCursorSkillActivation,
} from "./cursor-wire.js";
import { renderCursorDecision } from "./responses.js";

const VersionSchema = z.string().trim().min(1);
export const CursorExecutionProfileSchema = z.enum(["local", "cloud"]);
export type CursorExecutionProfile = z.infer<typeof CursorExecutionProfileSchema>;

export type CursorAdapterOptions = {
  readonly profile?: CursorExecutionProfile;
  readonly runtimeVersion?: string;
  readonly adapterVersion?: string;
  readonly installationIdentity?: RuntimeInstallationIdentity;
  readonly now?: () => Date;
};

export function cursorCapabilities(
  profile: CursorExecutionProfile,
  runtimeVersion: string,
): RuntimeCapabilitySnapshot {
  const version = VersionSchema.parse(runtimeVersion);
  const stableTokenUsage = {
    kind: "unsupported" as const,
    reason: "Cursor lifecycle hooks do not report stable token counts.",
  };
  const skillSelectionControl = {
    kind: "partial" as const,
    limitation: "beforeSubmitPrompt can gate a prompt but cannot inject selected skill context.",
  };
  const subagentStopContinuation = {
    kind: "partial" as const,
    limitation: "subagentStop follow-up messages are consumed only for completed subagents.",
  };
  if (profile === "cloud") {
    const readOnlyGap =
      "Cloud agents do not run hooks during early read-only exploratory turns.";
    return {
      runtime: "cursor",
      runtimeVersion: version,
      promptInterception: { kind: "partial", limitation: readOnlyGap },
      skillSelectionControl: {
        kind: "partial",
        limitation: `${skillSelectionControl.limitation} ${readOnlyGap}`,
      },
      rootStopContinuation: { kind: "partial", limitation: readOnlyGap },
      subagentStopContinuation: {
        kind: "partial",
        limitation: `${subagentStopContinuation.limitation} ${readOnlyGap}`,
      },
      toolPrevention: { kind: "partial", limitation: readOnlyGap },
      toolObservation: { kind: "partial", limitation: readOnlyGap },
      stableTokenUsage,
      localEvidenceAccess: {
        kind: "unsupported",
        reason: "Cloud runner transcripts are not device-local evidence.",
      },
    };
  }
  const supported = { kind: "supported" } as const;
  return {
    runtime: "cursor",
    runtimeVersion: version,
    promptInterception: supported,
    skillSelectionControl,
    rootStopContinuation: supported,
    subagentStopContinuation,
    toolPrevention: supported,
    toolObservation: supported,
    stableTokenUsage,
    localEvidenceAccess: {
      kind: "partial",
      limitation: "The transcript path is null when Cursor transcripts are disabled.",
    },
  };
}

export class CursorRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtime = "cursor";
  readonly profile: CursorExecutionProfile;
  readonly installationIdentity: RuntimeInstallationIdentity;

  readonly #adapterVersion: AdapterVersion;
  readonly #probeCapabilities: RuntimeCapabilitySnapshot;
  readonly #now: () => Date;
  readonly #installations = new Map<string, AdapterInstallation>();
  readonly #installationRequestDigests = new Map<string, string>();

  constructor(input: CursorAdapterOptions = {}) {
    this.profile = CursorExecutionProfileSchema.parse(input.profile ?? "local");
    this.#adapterVersion = createAdapterVersion(
      VersionSchema.parse(input.adapterVersion ?? "0.1.0"),
    );
    const runtimeProfile = this.profile === "cloud" ? "cloud-agent" : "local";
    this.installationIdentity =
      input.installationIdentity ??
      defaultRuntimeInstallationIdentity({
        runtime: this.runtime,
        adapterVersion: this.#adapterVersion,
        profile: runtimeProfile,
      });
    if (this.installationIdentity.profile !== runtimeProfile) {
      throw new Error("Cursor installation profile does not match the adapter profile.");
    }
    this.#probeCapabilities = cursorCapabilities(
      this.profile,
      input.runtimeVersion ?? "unknown",
    );
    this.#now = input.now ?? (() => new Date());
  }

  async probe(): Promise<RuntimeCapabilitySnapshot> {
    return this.#probeCapabilities;
  }

  async install(input: AdapterInstallRequest): Promise<AdapterInstallation> {
    const request = AdapterInstallRequestSchema.parse(input);
    if (request.adapterVersion !== this.#adapterVersion) {
      throw new Error("Cursor install request does not match the adapter version.");
    }
    const installationId = this.installationIdentity.adapterInstallationId;
    const requestDigest = stableCursorDigest(request);
    const existing = this.#installations.get(installationId);
    if (existing !== undefined) {
      if (this.#installationRequestDigests.get(installationId) !== requestDigest) {
        throw new Error("Cursor installation identity belongs to another install request.");
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
      capabilities: this.#probeCapabilities,
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
    return normalizeCursorEvent(parseCursorHookEvent(input), {
      adapterVersion: this.#adapterVersion,
      capabilitiesForVersion: (runtimeVersion) =>
        cursorCapabilities(this.profile, runtimeVersion),
      runtimeInstallation: this.installationIdentity,
      now: this.#now,
    });
  }

  renderDecision<E extends HookObservation>(
    _event: E,
    decision: DecisionFor<E>,
  ): RuntimeResponse {
    return renderCursorDecision(decision);
  }

  deriveIdentity(event: UnknownRuntimeEvent): RuntimeIdentity {
    return deriveCursorIdentity(parseCursorHookEvent(event));
  }

  verifySkillActivation(event: UnknownRuntimeEvent): SkillActivationEvidence {
    return verifyCursorSkillActivation(parseCursorHookEvent(event));
  }
}

export function createCursorAdapter(input: CursorAdapterOptions = {}): CursorRuntimeAdapter {
  return new CursorRuntimeAdapter(input);
}
