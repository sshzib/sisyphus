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
  type AdapterInstallation,
  type AdapterInstallRequest,
  type AdapterUninstallRequest,
  type AgentRuntimeAdapter,
  type RuntimeResponse,
  type UnknownRuntimeEvent,
} from "@sisyphus/adapter-kit";

import {
  deriveOpenCodeIdentity,
  normalizeOpenCodeEvent,
  parseOpenCodeHookEvent,
  stableOpenCodeDigest,
  verifyOpenCodeSkillActivation,
} from "./opencode-wire.js";
import { renderOpenCodeDecision } from "./responses.js";

const VersionSchema = z.string().trim().min(1);

export type OpenCodeAdapterOptions = {
  readonly runtimeVersion?: string;
  readonly adapterVersion?: string;
  readonly now?: () => Date;
  readonly turnCorrelation?: OpenCodeTurnCorrelationStore;
};

type ParsedOpenCodeEvent = ReturnType<typeof parseOpenCodeHookEvent>;

export interface OpenCodeTurnCorrelationStore {
  scopeFor(event: ParsedOpenCodeEvent): string;
  close(input: { readonly sessionId: string; readonly workItemId: string }): void;
}

export class InMemoryOpenCodeTurnCorrelationStore implements OpenCodeTurnCorrelationStore {
  readonly #active = new Map<string, string>();
  readonly #sequences = new Map<string, number>();

  scopeFor(event: ParsedOpenCodeEvent): string {
    const sessionId = event.input.sessionID;
    if (event.hook_event_name === "chat.message") {
      const nextSequence = (this.#sequences.get(sessionId) ?? 0) + 1;
      this.#sequences.set(sessionId, nextSequence);
      const scope =
        event.input.messageID ??
        `turn-${nextSequence}-${stableOpenCodeDigest(event.output.parts).slice(0, 16)}`;
      this.#active.set(sessionId, scope);
      return scope;
    }
    if (
      event.hook_event_name === "tool.execute.after" &&
      event.input.tool.toLowerCase() === "task"
    ) {
      return `task-${event.input.callID}`;
    }
    const active = this.#active.get(sessionId);
    if (active !== undefined) return active;
    const scope =
      event.hook_event_name === "experimental.text.complete"
        ? `orphan-message-${event.input.messageID}`
        : `orphan-call-${event.input.callID}`;
    this.#active.set(sessionId, scope);
    return scope;
  }

  close(input: { readonly sessionId: string; readonly workItemId: string }): void {
    const active = this.#active.get(input.sessionId);
    if (active !== undefined && `opencode:${input.sessionId}:${active}` === input.workItemId) {
      this.#active.delete(input.sessionId);
    }
  }
}

export function openCodeCapabilities(runtimeVersion: string): RuntimeCapabilitySnapshot {
  const supported = { kind: "supported" } as const;
  return {
    runtime: "opencode",
    runtimeVersion: VersionSchema.parse(runtimeVersion),
    promptInterception: supported,
    skillSelectionControl: {
      kind: "partial",
      limitation: "chat.message can append context but OpenCode has no exclusive native skill router.",
    },
    rootStopContinuation: {
      kind: "unsupported",
      reason: "The documented plugin API has no supported root completion continuation path.",
    },
    subagentStopContinuation: {
      kind: "unsupported",
      reason: "The documented plugin API has no supported subagent continuation path.",
    },
    toolPrevention: supported,
    toolObservation: supported,
    stableTokenUsage: {
      kind: "unsupported",
      reason: "OpenCode plugin hooks do not report stable token counts.",
    },
    localEvidenceAccess: {
      kind: "partial",
      limitation: "Plugin callbacks expose message parts and tool evidence, not a stable full transcript contract.",
    },
  };
}

export class OpenCodeRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtime = "opencode";

  readonly #adapterVersion: AdapterVersion;
  readonly #capabilities: RuntimeCapabilitySnapshot;
  readonly #now: () => Date;
  readonly #turnCorrelation: OpenCodeTurnCorrelationStore;
  readonly #installations = new Map<string, AdapterInstallation>();

  constructor(input: OpenCodeAdapterOptions = {}) {
    this.#adapterVersion = createAdapterVersion(
      VersionSchema.parse(input.adapterVersion ?? "0.1.0"),
    );
    this.#capabilities = openCodeCapabilities(input.runtimeVersion ?? "unknown");
    this.#now = input.now ?? (() => new Date());
    this.#turnCorrelation =
      input.turnCorrelation ?? new InMemoryOpenCodeTurnCorrelationStore();
  }

  async probe(): Promise<RuntimeCapabilitySnapshot> {
    return this.#capabilities;
  }

  async install(input: AdapterInstallRequest): Promise<AdapterInstallation> {
    const request = AdapterInstallRequestSchema.parse(input);
    const installationId = createAdapterInstallationId(
      `opencode:${stableOpenCodeDigest({
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
    const event = parseOpenCodeHookEvent(input);
    return normalizeOpenCodeEvent(event, {
      adapterVersion: this.#adapterVersion,
      capabilities: this.#capabilities,
      now: this.#now,
      turnScope: this.#turnCorrelation.scopeFor(event),
    });
  }

  renderDecision<E extends HookObservation>(
    event: E,
    decision: DecisionFor<E>,
  ): RuntimeResponse {
    if (
      event.kind === "root-stop" &&
      decision.kind === "stop-decision" &&
      decision.action === "allow"
    ) {
      this.#turnCorrelation.close({
        sessionId: event.identity.sessionId,
        workItemId: event.workItemId,
      });
    }
    return renderOpenCodeDecision(decision);
  }

  deriveIdentity(event: UnknownRuntimeEvent): RuntimeIdentity {
    return deriveOpenCodeIdentity(parseOpenCodeHookEvent(event));
  }

  verifySkillActivation(event: UnknownRuntimeEvent): SkillActivationEvidence {
    return verifyOpenCodeSkillActivation(parseOpenCodeHookEvent(event));
  }
}

export function createOpenCodeAdapter(
  input: OpenCodeAdapterOptions = {},
): OpenCodeRuntimeAdapter {
  return new OpenCodeRuntimeAdapter(input);
}
