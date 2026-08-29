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
  deriveClaudeIdentity,
  normalizeClaudeEvent,
  parseClaudeHookEvent,
  stableClaudeDigest,
  verifyClaudeSkillActivation,
} from "./claude-wire.js";
import { renderClaudeDecision } from "./responses.js";

const VersionSchema = z.string().trim().min(1);

export type ClaudeCodeAdapterOptions = {
  readonly runtimeVersion?: string;
  readonly adapterVersion?: string;
  readonly installationIdentity?: RuntimeInstallationIdentity;
  readonly now?: () => Date;
  readonly turnCorrelation?: ClaudeTurnCorrelationStore;
};

export interface ClaudeTurnCorrelationStore {
  scopeFor(event: ReturnType<typeof parseClaudeHookEvent>): string;
  close(input: { readonly sessionId: string; readonly retryBudgetId: string }): void;
}

export class InMemoryClaudeTurnCorrelationStore implements ClaudeTurnCorrelationStore {
  readonly #active = new Map<string, string>();
  readonly #sequences = new Map<string, number>();

  scopeFor(event: ReturnType<typeof parseClaudeHookEvent>): string {
    const sessionId = event.session_id;
    if (event.hook_event_name === "UserPromptSubmit") {
      const nextSequence = (this.#sequences.get(sessionId) ?? 0) + 1;
      this.#sequences.set(sessionId, nextSequence);
      const scope =
        event.prompt_id ??
        `turn-${nextSequence}-${stableClaudeDigest({ prompt: event.prompt }).slice(0, 16)}`;
      this.#active.set(sessionId, scope);
      return scope;
    }
    if (event.prompt_id !== undefined) {
      this.#active.set(sessionId, event.prompt_id);
      return event.prompt_id;
    }
    const active = this.#active.get(sessionId);
    if (active !== undefined) return active;
    const orphan = `orphan-${stableClaudeDigest({
      transcriptPath: event.transcript_path,
      sessionId,
    }).slice(0, 16)}`;
    this.#active.set(sessionId, orphan);
    return orphan;
  }

  close(input: { readonly sessionId: string; readonly retryBudgetId: string }): void {
    const active = this.#active.get(input.sessionId);
    if (
      active !== undefined &&
      `claude-code:${input.sessionId}:${active}` === input.retryBudgetId
    ) {
      this.#active.delete(input.sessionId);
    }
  }
}

export function claudeCodeCapabilities(runtimeVersion: string): RuntimeCapabilitySnapshot {
  const supported = { kind: "supported" } as const;
  return {
    runtime: "claude-code",
    runtimeVersion: VersionSchema.parse(runtimeVersion),
    promptInterception: supported,
    skillSelectionControl: supported,
    rootStopContinuation: supported,
    subagentStopContinuation: supported,
    toolPrevention: supported,
    toolObservation: supported,
    stableTokenUsage: {
      kind: "unsupported",
      reason: "Claude Code lifecycle hooks do not report stable token counts.",
    },
    localEvidenceAccess: {
      kind: "partial",
      limitation: "Transcript files can lag the in-memory conversation at hook time.",
    },
  };
}

export class ClaudeCodeRuntimeAdapter implements AgentRuntimeAdapter {
  readonly runtime = "claude-code";
  readonly installationIdentity: RuntimeInstallationIdentity;

  readonly #adapterVersion: AdapterVersion;
  readonly #capabilities: RuntimeCapabilitySnapshot;
  readonly #now: () => Date;
  readonly #turnCorrelation: ClaudeTurnCorrelationStore;
  readonly #installations = new Map<string, AdapterInstallation>();
  readonly #installationRequestDigests = new Map<string, string>();

  constructor(input: ClaudeCodeAdapterOptions = {}) {
    this.#adapterVersion = createAdapterVersion(
      VersionSchema.parse(input.adapterVersion ?? "0.1.0"),
    );
    this.installationIdentity =
      input.installationIdentity ??
      defaultRuntimeInstallationIdentity({
        runtime: this.runtime,
        adapterVersion: this.#adapterVersion,
        profile: "local",
      });
    if (this.installationIdentity.profile !== "local") {
      throw new Error("Claude Code installation profile must be local.");
    }
    this.#capabilities = claudeCodeCapabilities(input.runtimeVersion ?? "unknown");
    this.#now = input.now ?? (() => new Date());
    this.#turnCorrelation =
      input.turnCorrelation ?? new InMemoryClaudeTurnCorrelationStore();
  }

  async probe(): Promise<RuntimeCapabilitySnapshot> {
    return this.#capabilities;
  }

  async install(input: AdapterInstallRequest): Promise<AdapterInstallation> {
    const request = AdapterInstallRequestSchema.parse(input);
    if (request.adapterVersion !== this.#adapterVersion) {
      throw new Error("Claude Code install request does not match the adapter version.");
    }
    const installationId = this.installationIdentity.adapterInstallationId;
    const requestDigest = stableClaudeDigest(request);
    const existing = this.#installations.get(installationId);
    if (existing !== undefined) {
      if (this.#installationRequestDigests.get(installationId) !== requestDigest) {
        throw new Error(
          "Claude Code installation identity belongs to another install request.",
        );
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
    const event = parseClaudeHookEvent(input);
    return normalizeClaudeEvent(event, {
      adapterVersion: this.#adapterVersion,
      capabilities: this.#capabilities,
      runtimeInstallation: this.installationIdentity,
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
        retryBudgetId: event.retryBudgetId,
      });
    }
    return renderClaudeDecision(decision);
  }

  deriveIdentity(event: UnknownRuntimeEvent): RuntimeIdentity {
    return deriveClaudeIdentity(parseClaudeHookEvent(event));
  }

  verifySkillActivation(event: UnknownRuntimeEvent): SkillActivationEvidence {
    return verifyClaudeSkillActivation(parseClaudeHookEvent(event));
  }
}

export function createClaudeCodeAdapter(
  input: ClaudeCodeAdapterOptions = {},
): ClaudeCodeRuntimeAdapter {
  return new ClaudeCodeRuntimeAdapter(input);
}
