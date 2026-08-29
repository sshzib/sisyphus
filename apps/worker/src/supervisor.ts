import { performance } from "node:perf_hooks";

import {
  AdapterVersionSchema,
  AgentRuntimeSchema,
  RuntimeCapabilitySnapshotSchema,
  RuntimeEventIdSchema,
  RuntimeIdentitySchema,
  SkillActivationEvidenceSchema,
  createTimestamp,
  parseHookObservation,
  type EvaluationConstraint,
  type HookObservation,
  type RuntimeCapabilitySnapshot,
  type RuntimeIdentity,
  type StopObservation,
  type SupervisionDecision,
} from "@sisyphus/domain";
import { z } from "zod";

import {
  ActivationLeaseAuthority,
  type StoredActivationLease,
  type WorkerIssuedActivationLease,
} from "./activation-lease.js";
import { canonicalSha256 } from "./canonical-json.js";
import { projectCloudSupervisionRecord } from "./cloud-projection.js";
import type { EvidenceRecord } from "./evidence-vault.js";
import {
  JournalEventCollisionError,
  type LocalJournal,
  type RecordedDecision,
} from "./journal.js";
import { redactEvidence } from "./redaction.js";
import type { RuntimeInstallationRegistry } from "./runtime-installation-registry.js";

const ACTIVATION_LEASE_LIFETIME_MILLISECONDS = 5 * 60 * 1_000;

export const WorkerSupervisionEnvelopeSchema = z
  .object({
    runtime: AgentRuntimeSchema,
    adapterVersion: AdapterVersionSchema,
    eventId: RuntimeEventIdSchema,
    event: z.unknown(),
    nativeEvent: z.unknown().optional(),
    identity: RuntimeIdentitySchema,
    activation: SkillActivationEvidenceSchema,
  })
  .strict();
export type WorkerSupervisionEnvelope = z.infer<typeof WorkerSupervisionEnvelopeSchema>;

const ClaimedCapabilitiesSourceSchema = z
  .object({ capabilities: z.unknown() })
  .passthrough();

export interface WorkerSupervisionResponse {
  readonly decision: unknown;
  readonly activationLease?: WorkerIssuedActivationLease;
}

export interface SupervisionKernelPort {
  supervise(
    event: HookObservation,
    constraint: EvaluationConstraint,
  ): Promise<SupervisionDecision>;
}

export interface EvidenceVaultPort {
  store(input: {
    readonly evidence: string;
    readonly redactedExcerpt: string;
  }): Promise<EvidenceRecord>;
}

export interface PolicyProvider {
  constraintFor(event: HookObservation): Promise<EvaluationConstraint>;
}

interface WorkerSupervisorInput {
  readonly journal: LocalJournal;
  readonly kernel: SupervisionKernelPort;
  readonly evidenceVault: EvidenceVaultPort;
  readonly policyProvider: PolicyProvider;
  readonly leaseAuthority: ActivationLeaseAuthority;
  readonly runtimeInstallations: RuntimeInstallationRegistry;
  readonly now?: (() => Date) | undefined;
  readonly activationLeaseLifetimeMilliseconds?: number | undefined;
  readonly maximumCloudExcerptCharacters?: number | undefined;
  readonly evaluatorVersion?: string | undefined;
}

export class WorkerRequestError extends Error {}

function identitiesMatch(left: RuntimeIdentity, right: RuntimeIdentity): boolean {
  if (left.sessionId !== right.sessionId || left.agent.kind !== right.agent.kind) return false;
  if (left.agent.agentId !== right.agent.agentId) return false;
  if (left.agent.kind === "root" && right.agent.kind === "root") return true;
  return (
    left.agent.kind === "subagent" &&
    right.agent.kind === "subagent" &&
    left.agent.parentAgentId === right.agent.parentAgentId
  );
}

function isStop(event: HookObservation): event is StopObservation {
  return event.kind === "root-stop" || event.kind === "subagent-stop";
}

function envelopeDigest(
  envelope: WorkerSupervisionEnvelope,
  event: HookObservation,
): string {
  try {
    const { occurredAt: _synthesizedOccurredAt, ...eventWithoutOccurredAt } = event;
    const nativeEventDigest = canonicalSha256(
      envelope.nativeEvent ?? eventWithoutOccurredAt,
    );
    return canonicalSha256({
      runtime: envelope.runtime,
      adapterVersion: envelope.adapterVersion,
      eventId: envelope.eventId,
      identity: envelope.identity,
      activation: envelope.activation,
      normalizedEvent: eventWithoutOccurredAt,
      capabilitySnapshot: event.capabilities,
      nativeEventPresent: envelope.nativeEvent !== undefined,
      nativeEventDigest,
    });
  } catch (error: unknown) {
    throw new WorkerRequestError("Supervision envelope is not canonical JSON.", {
      cause: error,
    });
  }
}

function serializeEvidence(
  envelope: WorkerSupervisionEnvelope,
  event: HookObservation,
): string {
  const serialized = JSON.stringify({
    normalizedEvent: event,
    nativeEvent: envelope.nativeEvent ?? event,
    submittedActivation: envelope.activation,
  });
  if (serialized === undefined) {
    throw new WorkerRequestError("Supervision evidence is not JSON serializable.");
  }
  return serialized;
}

export class WorkerSupervisor {
  readonly #journal: LocalJournal;
  readonly #kernel: SupervisionKernelPort;
  readonly #evidenceVault: EvidenceVaultPort;
  readonly #policyProvider: PolicyProvider;
  readonly #leaseAuthority: ActivationLeaseAuthority;
  readonly #runtimeInstallations: RuntimeInstallationRegistry;
  readonly #now: () => Date;
  readonly #activationLeaseLifetimeMilliseconds: number;
  readonly #maximumCloudExcerptCharacters: number;
  readonly #evaluatorVersion: string;

  constructor(input: WorkerSupervisorInput) {
    this.#journal = input.journal;
    this.#kernel = input.kernel;
    this.#evidenceVault = input.evidenceVault;
    this.#policyProvider = input.policyProvider;
    this.#leaseAuthority = input.leaseAuthority;
    this.#runtimeInstallations = input.runtimeInstallations;
    this.#now = input.now ?? (() => new Date());
    this.#activationLeaseLifetimeMilliseconds =
      input.activationLeaseLifetimeMilliseconds ??
      ACTIVATION_LEASE_LIFETIME_MILLISECONDS;
    if (
      !Number.isSafeInteger(this.#activationLeaseLifetimeMilliseconds) ||
      this.#activationLeaseLifetimeMilliseconds <= 0
    ) {
      throw new Error("Activation lease lifetime must be a positive integer.");
    }
    this.#maximumCloudExcerptCharacters = input.maximumCloudExcerptCharacters ?? 2_000;
    this.#evaluatorVersion = z
      .string()
      .trim()
      .min(1)
      .max(160)
      .parse(input.evaluatorVersion ?? "sisyphus-kernel@0.1.0");
  }

  async supervise(input: unknown): Promise<WorkerSupervisionResponse> {
    const envelope = WorkerSupervisionEnvelopeSchema.parse(input);
    const claimedCapabilitiesSource = ClaimedCapabilitiesSourceSchema.parse(
      envelope.event,
    ).capabilities;
    const claimedCapabilities = RuntimeCapabilitySnapshotSchema.strict().parse(
      claimedCapabilitiesSource,
    );
    if (
      canonicalSha256(claimedCapabilitiesSource) !==
      canonicalSha256(claimedCapabilities)
    ) {
      throw new WorkerRequestError(
        "Event capabilities contain fields outside the registered snapshot contract.",
      );
    }
    const parsedEvent = parseHookObservation(envelope.event);
    this.#assertConsistent(envelope, parsedEvent);
    this.#assertRegistered(parsedEvent, claimedCapabilities);
    const digest = envelopeDigest(envelope, parsedEvent);
    const receiptCandidate = this.#now();
    if (Number.isNaN(receiptCandidate.getTime())) {
      throw new Error("Worker clock is invalid.");
    }
    let receivedAt: string;
    try {
      receivedAt = this.#journal.recordEventReceipt({
        eventId: parsedEvent.eventId,
        envelopeDigest: digest,
        receivedAt: receiptCandidate.toISOString(),
      }).receivedAt;
    } catch (error: unknown) {
      if (error instanceof JournalEventCollisionError) {
        throw new WorkerRequestError(error.message, { cause: error });
      }
      throw error;
    }
    const receivedEvent: HookObservation = {
      ...parsedEvent,
      occurredAt: createTimestamp(receivedAt),
    };

    const replay = this.#journal.decisionFor(parsedEvent.eventId);
    if (replay !== undefined) {
      this.#assertReplayMatches(replay, digest);
      return this.#responseFor(replay);
    }

    const event = this.#authoritativeAttribution(receivedEvent);
    const serializedEvidence = serializeEvidence(envelope, event);
    const redacted = redactEvidence({
      source: serializedEvidence,
      maximumCharacters: this.#maximumCloudExcerptCharacters,
    });
    const evidence = await this.#evidenceVault.store({
      evidence: serializedEvidence,
      redactedExcerpt: redacted.text,
    });
    const constraint = await this.#policyProvider.constraintFor(event);
    const attempts = isStop(event)
      ? this.#journal.recordCompletionAttempt({
          eventId: event.eventId,
          runId: event.runId,
          workItemId: event.workItemId,
        })
      : 1;
    const evaluationStartedAt = performance.now();
    const decision = await this.#kernel.supervise(event, constraint);
    const latencyMs = Math.max(0, Math.round(performance.now() - evaluationStartedAt));
    const activationLease = this.#issueActivationLease(event, decision);
    const localDispositionRevision =
      decision.kind === "stop-decision" &&
      decision.sanction.kind === "quarantined"
        ? this.#journal.recordLocalDispositionRevision({
            eventId: event.eventId,
            skillVersionId: decision.sanction.skillVersionId,
          })
        : undefined;
    const cloudRecord = projectCloudSupervisionRecord({
      event,
      decision,
      constraint,
      evidence,
      nativeEvent: envelope.nativeEvent ?? event,
      attempts,
      latencyMs,
      evaluatorVersion: this.#evaluatorVersion,
      ...(localDispositionRevision === undefined
        ? {}
        : { localDispositionRevision }),
    });
    let recorded: RecordedDecision;
    try {
      recorded = this.#journal.recordDecision({
        eventId: event.eventId,
        envelopeDigest: digest,
        receivedAt,
        decision,
        evidence: { handle: evidence.handle, digest: evidence.digest },
        cloudEvent: cloudRecord,
        ...(activationLease === undefined
          ? {}
          : { activationLease: activationLease.record }),
      });
    } catch (error: unknown) {
      if (error instanceof JournalEventCollisionError) {
        throw new WorkerRequestError(error.message, { cause: error });
      }
      throw error;
    }
    return this.#responseFor(recorded);
  }

  #authoritativeAttribution(event: HookObservation): HookObservation {
    if (!isStop(event)) return event;
    const consumed = this.#journal.activationFor({
      runId: event.runId,
      workItemId: event.workItemId,
    });
    if (consumed === undefined) {
      return { ...event, attribution: { kind: "none" } };
    }
    const lease = this.#leaseAuthority.leaseFor(consumed);
    return {
      ...event,
      attribution: {
        kind: "verified",
        skillVersionId: lease.skillVersionId,
        activationLeaseId: lease.activationLeaseId,
        method: "activation-marker",
      },
    };
  }

  #issueActivationLease(
    event: HookObservation,
    decision: SupervisionDecision,
  ):
    | {
        readonly record: StoredActivationLease;
        readonly lease: WorkerIssuedActivationLease;
      }
    | undefined {
    if (
      event.kind !== "prompt" ||
      decision.kind !== "prompt-decision" ||
      decision.resolution.kind !== "selected"
    ) {
      return undefined;
    }
    const now = this.#now();
    if (Number.isNaN(now.getTime())) throw new Error("Worker clock is invalid.");
    const issuedAt = createTimestamp(now.toISOString());
    const expiresAt = createTimestamp(
      new Date(now.getTime() + this.#activationLeaseLifetimeMilliseconds).toISOString(),
    );
    return this.#leaseAuthority.issue({
      promptEventId: event.eventId,
      runId: event.runId,
      workItemId: event.workItemId,
      skillVersionId: decision.resolution.selected.skillVersionId,
      issuedAt,
      expiresAt,
    });
  }

  #responseFor(recorded: RecordedDecision): WorkerSupervisionResponse {
    return {
      decision: recorded.decision,
      ...(recorded.activationLease === undefined
        ? {}
        : { activationLease: this.#leaseAuthority.leaseFor(recorded.activationLease) }),
    };
  }

  #assertReplayMatches(recorded: RecordedDecision, digest: string): void {
    if (recorded.envelopeDigest !== digest) {
      throw new WorkerRequestError(
        `Event ID ${recorded.eventId} belongs to a different envelope.`,
      );
    }
  }

  #assertRegistered(
    event: HookObservation,
    claimedCapabilities: RuntimeCapabilitySnapshot,
  ): void {
    const authoritative = this.#runtimeInstallations.capabilitiesFor({
      runtime: event.capabilities.runtime,
      runtimeVersion: event.capabilities.runtimeVersion,
      adapterVersion: event.adapterVersion,
    });
    if (authoritative === undefined) {
      throw new WorkerRequestError("No registered runtime installation matches this event.");
    }
    if (canonicalSha256(authoritative) !== canonicalSha256(claimedCapabilities)) {
      throw new WorkerRequestError(
        "Event capabilities do not match the registered capability snapshot.",
      );
    }
  }

  #assertConsistent(
    envelope: WorkerSupervisionEnvelope,
    event: HookObservation,
  ): void {
    if (envelope.eventId !== event.eventId) {
      throw new WorkerRequestError("Envelope eventId does not match the normalized event.");
    }
    if (envelope.adapterVersion !== event.adapterVersion) {
      throw new WorkerRequestError(
        "Envelope adapterVersion does not match the normalized event.",
      );
    }
    if (envelope.runtime !== event.capabilities.runtime) {
      throw new WorkerRequestError("Envelope runtime does not match the capability snapshot.");
    }
    if (!identitiesMatch(envelope.identity, event.identity)) {
      throw new WorkerRequestError("Envelope identity does not match the normalized event.");
    }
  }
}
