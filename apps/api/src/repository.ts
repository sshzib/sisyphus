import { createHash, randomUUID } from "node:crypto";
import {
  CloudSupervisionEnvelopeSchema,
  JudgeResultSchema,
  SignedPolicyBundleSchema,
  SkillDispositionTransitionSchema,
  type AdapterConfigurationDigest,
  type CloudSupervisionEnvelope,
  type JudgeResult,
  type SignedPolicyBundle,
  type SkillDispositionTransition,
} from "@sisyphus/domain";
import type {
  AuditEvent,
  DashboardQuery,
  DashboardSnapshot,
  RestoreSkillResponse,
} from "@sisyphus/ui/contracts";
import {
  createDemoSnapshot,
  createRestoredAuditEvent,
  filterDashboardSnapshot,
} from "@sisyphus/ui/demo";
import type { AuthContext, CredentialResolver } from "./auth.js";
import { canonicalJson } from "./canonical-json.js";
import type {
  JudgeConfigurationStore,
  JudgeRequestClaim,
} from "./judge.js";
import {
  applyDispositionTransition,
  projectAcceptedCloudRecords,
} from "./projection.js";
import {
  policyBundleExpiresAt,
  policyBundleRequiresRenewal,
  policyBundleStateDigest,
  policyEntries,
} from "./policy-bundle.js";
import {
  AesGcmSecretCipher,
  type EncryptedSecret,
  type SecretCipher,
} from "./secret-cipher.js";
import {
  cloudQuarantineReason,
  evaluateCloudQuarantineWindow,
  quarantineCandidateSkillVersionIds,
} from "./quarantine-window.js";

interface StoredIngestEvent {
  eventId: string;
  digest: string;
  sourceRecordId: string;
  deviceId: string;
  acceptedAt: string;
  record: CloudSupervisionEnvelope;
}

interface StoredPolicyBundleIssuance {
  revision: number;
  deviceId: string;
  adapterInstallationId: string;
  signingKeyId: string;
  contentDigest: string;
  issuedAt: string;
  expiresAt: string;
}

interface TenantState {
  name: string;
  snapshot: DashboardSnapshot;
  ingestEvents: Map<string, StoredIngestEvent>;
  dispositionTransitions: SkillDispositionTransition[];
  policyRevision: number;
  adapterConfigurationDigest: AdapterConfigurationDigest;
  policyBundleIssuances: Map<number, StoredPolicyBundleIssuance>;
  signedPolicyBundles: Map<number, SignedPolicyBundle>;
  judgeRequests: Map<
    string,
    {
      inputDigest: string;
      leaseId: string | null;
      leaseExpiresAt: string | null;
      result: JudgeResult | null;
    }
  >;
  judgeProvider?: {
    encryptedApiKey: EncryptedSecret;
    model: string;
  };
}

export interface ControlPlaneRepository extends CredentialResolver, JudgeConfigurationStore {
  readonly persistenceKind: "memory" | "postgres";
  health(): Promise<void>;
  close(): Promise<void>;
  dashboard(tenantId: string, query: DashboardQuery): Promise<DashboardSnapshot | undefined>;
  restoreSkill(input: {
    tenantId: string;
    actor: string;
    skillVersionId: string;
    reason: string;
  }): Promise<RestoreSkillResponse | undefined>;
  ingestBatch(input: {
    auth: Extract<AuthContext, { kind: "device" }>;
    records: CloudSupervisionEnvelope[];
  }): Promise<string[]>;
  configureJudgeProvider(input: {
    tenantId: string;
    apiKey: string;
    model: string;
  }): Promise<boolean>;
  issuePolicyBundle(input: {
    tenantId: string;
    deviceId: string;
    adapterInstallationId: string;
    signingKeyId: string;
    now: Date;
  }): Promise<PolicyBundleIssuance | undefined>;
  recordSignedPolicyBundle(input: {
    tenantId: string;
    bundle: SignedPolicyBundle;
  }): Promise<void>;
}

export interface PolicyBundleIssuance {
  tenantId: string;
  deviceId: string;
  adapterInstallationId: string;
  revision: number;
  issuedAt: string;
  adapterConfigurationDigest: AdapterConfigurationDigest;
  dispositionTransitions: SkillDispositionTransition[];
  snapshot: DashboardSnapshot;
}

export class InvalidStateTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidStateTransitionError";
  }
}

export class IngestCollisionError extends Error {
  public constructor(public readonly eventId: string) {
    super(`Event ${eventId} was already ingested with a different payload.`);
    this.name = "IngestCollisionError";
  }
}

export class InactiveDeviceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InactiveDeviceError";
  }
}

export class RuntimeInstallationMismatchError extends Error {
  public constructor() {
    super(
      "The uploaded runtime installation does not match the authenticated device installation.",
    );
    this.name = "RuntimeInstallationMismatchError";
  }
}

export function assertRuntimeInstallationMatches(input: {
  readonly adapterInstallationId: string;
  readonly records: readonly CloudSupervisionEnvelope[];
}): void {
  if (
    input.records.some(
      (record) =>
        record.payload.runtimeInstallation.adapterInstallationId !==
        input.adapterInstallationId,
    )
  ) {
    throw new RuntimeInstallationMismatchError();
  }
}

export const demoCredentials = {
  acmeAdmin: "demo-admin",
  acmeViewer: "demo-viewer",
  acmeDevice: "device-delta-token",
  betaAdmin: "beta-admin",
  betaDevice: "device-beta-token",
} satisfies Record<string, string>;

function betaSnapshot(): DashboardSnapshot {
  const base = filterDashboardSnapshot(createDemoSnapshot(), {
    runtime: "claude-code",
  });
  return {
    ...base,
    workspace: {
      id: "tenant-beta",
      name: "Beta Labs",
      environment: "Demo workspace",
    },
    agents: base.agents.map((agent) => ({
      ...agent,
      id: `beta-${agent.id}`,
      name: "Beta Builder",
      runs: 41,
      conclusiveRuns: 40,
      scoredRuns: 39,
      retryRuns: 10,
      tokens: 288_400,
    })),
    skills: base.skills.map((skill) => ({
      ...skill,
      skillVersionId: `beta-${skill.skillVersionId}`,
      disposition: "active",
    })),
    runs: base.runs.map((run) => ({
      ...run,
      id: `beta-${run.id}`,
      agentName: "Beta Builder",
      project: "beta-platform",
      skillVersionId:
        run.skillVersionId === null ? null : `beta-${run.skillVersionId}`,
    })),
    devices: [
      {
        id: "device-beta",
        name: "Beta Linux runner",
        platform: "linux",
        status: "online",
        runtimes: ["claude-code"],
        lastSeenAt: "2026-08-29T09:45:00.000Z",
        pluginTrust: "verified",
        syncLagSeconds: 4,
      },
    ],
    audit: base.audit.map((event) => ({
      ...event,
      id: `beta-${event.id}`,
      actor: "beta-admin@sisyphus.local",
    })),
  };
}

function adapterConfigurationDigest(
  snapshot: DashboardSnapshot,
): AdapterConfigurationDigest {
  const configuration = snapshot.integrations
    .map((integration) => ({
      id: integration.id,
      runtime: integration.runtime,
      adapterInstallationId: integration.adapterInstallationId,
      profile: integration.profile,
      scope: integration.scope,
      adapterVersion: integration.adapterVersion,
      runtimeVersion: integration.runtimeVersion,
      capabilities: integration.capabilities,
    }))
    .sort((left, right) => {
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });
  return createHash("sha256")
    .update(canonicalJson(configuration))
    .digest("hex");
}

function payloadDigest(payload: CloudSupervisionEnvelope["payload"]): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function judgeRequestKey(eventId: string, policyVersionId: string): string {
  return `${eventId}\u0000${policyVersionId}`;
}

function tenantSeed(): Map<string, TenantState> {
  const acmeSnapshot = createDemoSnapshot();
  const beta = betaSnapshot();
  return new Map([
    [
      "tenant-acme",
      {
        name: "Acme Engineering",
        snapshot: acmeSnapshot,
        ingestEvents: new Map(),
        dispositionTransitions: [],
        policyRevision: 0,
        adapterConfigurationDigest: adapterConfigurationDigest(acmeSnapshot),
        policyBundleIssuances: new Map(),
        signedPolicyBundles: new Map(),
        judgeRequests: new Map(),
      },
    ],
    [
      "tenant-beta",
      {
        name: "Beta Labs",
        snapshot: beta,
        ingestEvents: new Map(),
        dispositionTransitions: [],
        policyRevision: 0,
        adapterConfigurationDigest: adapterConfigurationDigest(beta),
        policyBundleIssuances: new Map(),
        signedPolicyBundles: new Map(),
        judgeRequests: new Map(),
      },
    ],
  ]);
}

function credentialSeed(): Map<string, AuthContext> {
  return new Map<string, AuthContext>([
    [
      demoCredentials.acmeAdmin,
      {
        kind: "user",
        tenantId: "tenant-acme",
        subjectId: "admin@acme.test",
        role: "admin",
      },
    ],
    [
      demoCredentials.acmeViewer,
      {
        kind: "user",
        tenantId: "tenant-acme",
        subjectId: "viewer@acme.test",
        role: "viewer",
      },
    ],
    [
      demoCredentials.acmeDevice,
      {
        kind: "device",
        tenantId: "tenant-acme",
        subjectId: "device-delta",
        adapterInstallationId: "installation-codex-local",
        role: "device",
      },
    ],
    [
      demoCredentials.betaAdmin,
      {
        kind: "user",
        tenantId: "tenant-beta",
        subjectId: "admin@beta.test",
        role: "admin",
      },
    ],
    [
      demoCredentials.betaDevice,
      {
        kind: "device",
        tenantId: "tenant-beta",
        subjectId: "device-beta",
        adapterInstallationId: "installation-claude-local",
        role: "device",
      },
    ],
  ]);
}

export class InMemoryControlPlaneRepository implements ControlPlaneRepository {
  public readonly persistenceKind = "memory" as const;
  readonly #tenants: Map<string, TenantState>;
  readonly #credentials: Map<string, AuthContext>;
  readonly #secretCipher: SecretCipher;

  public constructor(input?: {
    tenants?: Map<string, TenantState>;
    credentials?: Map<string, AuthContext>;
    secretCipher?: SecretCipher;
  }) {
    this.#tenants = input?.tenants ?? tenantSeed();
    this.#credentials = input?.credentials ?? credentialSeed();
    this.#secretCipher = input?.secretCipher ?? new AesGcmSecretCipher();
  }

  public async resolveCredential(token: string): Promise<AuthContext | undefined> {
    return this.#credentials.get(token);
  }

  public async health(): Promise<void> {}

  public async close(): Promise<void> {}

  public async dashboard(
    tenantId: string,
    query: DashboardQuery,
  ): Promise<DashboardSnapshot | undefined> {
    const tenant = this.#tenants.get(tenantId);
    if (tenant === undefined) {
      return undefined;
    }
    return filterDashboardSnapshot(structuredClone(tenant.snapshot), query);
  }

  public async restoreSkill(input: {
    tenantId: string;
    actor: string;
    skillVersionId: string;
    reason: string;
  }): Promise<RestoreSkillResponse | undefined> {
    const tenant = this.#tenants.get(input.tenantId);
    if (tenant === undefined) {
      return undefined;
    }
    const skill = tenant.snapshot.skills.find(
      (candidate) => candidate.skillVersionId === input.skillVersionId,
    );
    if (skill === undefined) {
      return undefined;
    }
    if (skill.disposition !== "quarantined") {
      throw new InvalidStateTransitionError(
        `${skill.name} is ${skill.disposition} and cannot be restored.`,
      );
    }

    const now = new Date().toISOString();
    const restoredSkill: DashboardSnapshot["skills"][number] = {
      ...skill,
      disposition: "probation",
      lastChangedAt: now,
    };
    const demoAudit = createRestoredAuditEvent({
      skillName: skill.name,
      runtime: skill.runtime,
      reason: input.reason,
    });
    const auditEvent: AuditEvent = {
      ...demoAudit,
      id: randomUUID(),
      occurredAt: now,
      actor: input.actor,
    };
    tenant.snapshot = {
      ...tenant.snapshot,
      generatedAt: now,
      skills: tenant.snapshot.skills.map((candidate) =>
        candidate.skillVersionId === skill.skillVersionId ? restoredSkill : candidate,
      ),
      audit: [auditEvent, ...tenant.snapshot.audit],
    };
    const previousRevision = tenant.dispositionTransitions.at(-1)?.revision ?? 0;
    tenant.dispositionTransitions.push(
      SkillDispositionTransitionSchema.parse({
        kind: "restoration",
        skillVersionId: skill.skillVersionId,
        reason: input.reason,
        actor: input.actor,
        occurredAt: now,
        revision: previousRevision + 1,
      }),
    );
    return { skill: restoredSkill, auditEvent };
  }

  public async ingestBatch(input: {
    auth: Extract<AuthContext, { kind: "device" }>;
    records: CloudSupervisionEnvelope[];
  }): Promise<string[]> {
    const records = CloudSupervisionEnvelopeSchema.array()
      .min(1)
      .max(100)
      .parse(input.records);
    assertRuntimeInstallationMatches({
      adapterInstallationId: input.auth.adapterInstallationId,
      records,
    });
    const tenant = this.#tenants.get(input.auth.tenantId);
    if (tenant === undefined) {
      return [];
    }

    const prospective = new Map<string, string>();
    for (const record of records) {
      const digest = payloadDigest(record.payload);
      const stored = tenant.ingestEvents.get(record.eventId);
      const earlierInBatch = prospective.get(record.eventId);
      if (
        (stored !== undefined && stored.digest !== digest) ||
        (earlierInBatch !== undefined && earlierInBatch !== digest)
      ) {
        throw new IngestCollisionError(record.eventId);
      }
      prospective.set(record.eventId, digest);
    }

    const acceptedAt = new Date().toISOString();
    const acceptedRecords: CloudSupervisionEnvelope[] = [];
    for (const record of records) {
      if (!tenant.ingestEvents.has(record.eventId)) {
        const digest = payloadDigest(record.payload);
        tenant.ingestEvents.set(record.eventId, {
          eventId: record.eventId,
          digest,
          sourceRecordId: record.id,
          deviceId: input.auth.subjectId,
          acceptedAt,
          record,
        });
        acceptedRecords.push(record);
      }
    }
    if (acceptedRecords.length > 0) {
      tenant.snapshot = projectAcceptedCloudRecords({
        snapshot: tenant.snapshot,
        deviceId: input.auth.subjectId,
        records: acceptedRecords,
      });
      const history = [...tenant.ingestEvents.values()].map(
        (event) => event.record,
      );
      for (const skillVersionId of quarantineCandidateSkillVersionIds(
        acceptedRecords,
      )) {
        const skill = tenant.snapshot.skills.find(
          (candidate) => candidate.skillVersionId === skillVersionId,
        );
        if (
          skill === undefined ||
          skill.disposition === "revoked" ||
          skill.disposition === "quarantined"
        ) {
          continue;
        }
        const window = evaluateCloudQuarantineWindow({
          records: history,
          transitions: tenant.dispositionTransitions,
          skillVersionId,
        });
        if (
          !window.shouldQuarantine ||
          window.latestOccurredAt === null ||
          window.latestRuntime === null
        ) {
          continue;
        }
        const revision =
          (tenant.dispositionTransitions.at(-1)?.revision ?? 0) + 1;
        const reason = cloudQuarantineReason(window);
        const transition = SkillDispositionTransitionSchema.parse({
          kind: "quarantine",
          skillVersionId,
          reason,
          actor: `device:${input.auth.subjectId}`,
          occurredAt: window.latestOccurredAt,
          revision,
        });
        tenant.dispositionTransitions.push(transition);
        tenant.snapshot = {
          ...applyDispositionTransition({
            snapshot: tenant.snapshot,
            transition,
          }),
          audit: [
            {
              id: `audit-quarantine-${revision}`,
              occurredAt: window.latestOccurredAt,
              actor: `device:${input.auth.subjectId}`,
              action: "skill.quarantined",
              summary: `${skill.name} quarantined. ${reason}`,
              runtime: window.latestRuntime,
            },
            ...tenant.snapshot.audit,
          ],
        };
      }
    }
    return records.map((record) => record.id);
  }

  public async configureJudgeProvider(input: {
    tenantId: string;
    apiKey: string;
    model: string;
  }): Promise<boolean> {
    const tenant = this.#tenants.get(input.tenantId);
    if (tenant === undefined) {
      return false;
    }
    tenant.judgeProvider = {
      encryptedApiKey: this.#secretCipher.encrypt(
        input.apiKey,
        `judge-provider:${input.tenantId}`,
      ),
      model: input.model,
    };
    return true;
  }

  public async judgeProviderConfiguration(
    tenantId: string,
  ): Promise<{ apiKey: string; model: string } | undefined> {
    const tenant = this.#tenants.get(tenantId);
    if (tenant?.judgeProvider === undefined) {
      return undefined;
    }
    return {
      apiKey: this.#secretCipher.decrypt(
        tenant.judgeProvider.encryptedApiKey,
        `judge-provider:${tenantId}`,
      ),
      model: tenant.judgeProvider.model,
    };
  }

  public async claimJudgeRequest(
    input: Parameters<JudgeConfigurationStore["claimJudgeRequest"]>[0],
  ): Promise<JudgeRequestClaim> {
    const tenant = this.#tenants.get(input.tenantId);
    if (tenant === undefined) {
      throw new Error("The judge request tenant is unavailable.");
    }
    const key = judgeRequestKey(input.eventId, input.policyVersionId);
    const stored = tenant.judgeRequests.get(key);
    if (stored !== undefined) {
      if (stored.inputDigest !== input.inputDigest) {
        return { kind: "collision" };
      }
      if (stored.result !== null) {
        return { kind: "completed", result: stored.result };
      }
      if (
        stored.leaseExpiresAt !== null &&
        Date.parse(stored.leaseExpiresAt) > Date.now()
      ) {
        return { kind: "pending" };
      }
    }
    tenant.judgeRequests.set(key, {
      inputDigest: input.inputDigest,
      leaseId: input.leaseId,
      leaseExpiresAt: input.leaseExpiresAt,
      result: null,
    });
    return { kind: "owner" };
  }

  public async completeJudgeRequest(
    input: Parameters<JudgeConfigurationStore["completeJudgeRequest"]>[0],
  ): Promise<JudgeResult> {
    const tenant = this.#tenants.get(input.tenantId);
    const key = judgeRequestKey(input.eventId, input.policyVersionId);
    const stored = tenant?.judgeRequests.get(key);
    if (stored === undefined || stored.inputDigest !== input.inputDigest) {
      throw new Error("The judge request completion does not match its claim.");
    }
    if (stored.result !== null) {
      return stored.result;
    }
    if (stored.leaseId !== input.leaseId) {
      throw new Error("The judge request lease is no longer owned by this caller.");
    }
    const result = JudgeResultSchema.parse(input.result);
    tenant?.judgeRequests.set(key, {
      ...stored,
      leaseId: null,
      leaseExpiresAt: null,
      result,
    });
    return result;
  }

  public async judgeRequestResult(
    input: Parameters<JudgeConfigurationStore["judgeRequestResult"]>[0],
  ): Promise<JudgeResult | "pending" | "collision" | undefined> {
    const stored = this.#tenants
      .get(input.tenantId)
      ?.judgeRequests.get(judgeRequestKey(input.eventId, input.policyVersionId));
    if (stored === undefined) {
      return undefined;
    }
    if (stored.inputDigest !== input.inputDigest) {
      return "collision";
    }
    return stored.result ?? "pending";
  }

  public async issuePolicyBundle(input: {
    tenantId: string;
    deviceId: string;
    adapterInstallationId: string;
    signingKeyId: string;
    now: Date;
  }): Promise<PolicyBundleIssuance | undefined> {
    const tenant = this.#tenants.get(input.tenantId);
    if (tenant === undefined) {
      return undefined;
    }
    const audienceValid = [...this.#credentials.values()].some(
      (credential) =>
        credential.kind === "device" &&
        credential.tenantId === input.tenantId &&
        credential.subjectId === input.deviceId &&
        credential.adapterInstallationId === input.adapterInstallationId,
    );
    if (!audienceValid) {
      throw new Error(
        "The policy bundle audience is not an enrolled installation.",
      );
    }
    tenant.adapterConfigurationDigest = adapterConfigurationDigest(
      tenant.snapshot,
    );
    const dispositionTransitions = structuredClone(
      tenant.dispositionTransitions,
    );
    const snapshot = structuredClone(tenant.snapshot);
    const contentDigest = policyBundleStateDigest({
      signingKeyId: input.signingKeyId,
      tenantId: input.tenantId,
      audience: {
        deviceId: input.deviceId,
        adapterInstallationId: input.adapterInstallationId,
      },
      adapterConfigurationDigest: tenant.adapterConfigurationDigest,
      policies: policyEntries(snapshot),
      dispositionTransitions,
    });
    const previous = [...tenant.policyBundleIssuances.values()]
      .filter(
        (issuance) =>
          issuance.deviceId === input.deviceId &&
          issuance.adapterInstallationId === input.adapterInstallationId,
      )
      .sort((left, right) => right.revision - left.revision)[0];
    if (
      previous !== undefined &&
      previous.signingKeyId === input.signingKeyId &&
      previous.contentDigest === contentDigest &&
      !policyBundleRequiresRenewal({
        expiresAt: new Date(previous.expiresAt),
        now: input.now,
      })
    ) {
      return {
        tenantId: input.tenantId,
        deviceId: input.deviceId,
        adapterInstallationId: input.adapterInstallationId,
        revision: previous.revision,
        issuedAt: previous.issuedAt,
        adapterConfigurationDigest: tenant.adapterConfigurationDigest,
        dispositionTransitions,
        snapshot,
      };
    }
    tenant.policyRevision += 1;
    const issuedAt = new Date(input.now);
    const expiresAt = policyBundleExpiresAt(issuedAt);
    tenant.policyBundleIssuances.set(tenant.policyRevision, {
      revision: tenant.policyRevision,
      deviceId: input.deviceId,
      adapterInstallationId: input.adapterInstallationId,
      signingKeyId: input.signingKeyId,
      contentDigest,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    return {
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      adapterInstallationId: input.adapterInstallationId,
      revision: tenant.policyRevision,
      issuedAt: issuedAt.toISOString(),
      adapterConfigurationDigest: tenant.adapterConfigurationDigest,
      dispositionTransitions,
      snapshot,
    };
  }

  public async recordSignedPolicyBundle(input: {
    tenantId: string;
    bundle: SignedPolicyBundle;
  }): Promise<void> {
    const bundle = SignedPolicyBundleSchema.parse(input.bundle);
    const tenant = this.#tenants.get(input.tenantId);
    if (
      tenant === undefined ||
      bundle.payload.tenantId !== input.tenantId
    ) {
      throw new Error("The signed policy bundle tenant does not match repository state.");
    }
    const audienceValid = [...this.#credentials.values()].some(
      (credential) =>
        credential.kind === "device" &&
        credential.tenantId === input.tenantId &&
        credential.subjectId === bundle.payload.audience.deviceId &&
        credential.adapterInstallationId ===
          bundle.payload.audience.adapterInstallationId,
    );
    if (!audienceValid) {
      throw new Error(
        "The signed policy bundle audience is not an enrolled installation.",
      );
    }
    const issuance = tenant.policyBundleIssuances.get(bundle.payload.revision);
    const contentDigest = policyBundleStateDigest({
      signingKeyId: bundle.keyId,
      tenantId: bundle.payload.tenantId,
      audience: bundle.payload.audience,
      adapterConfigurationDigest: bundle.payload.adapterConfigurationDigest,
      policies: bundle.payload.policies,
      dispositionTransitions: bundle.payload.dispositionTransitions,
    });
    if (
      issuance === undefined ||
      issuance.deviceId !== bundle.payload.audience.deviceId ||
      issuance.adapterInstallationId !==
        bundle.payload.audience.adapterInstallationId ||
      issuance.signingKeyId !== bundle.keyId ||
      issuance.contentDigest !== contentDigest ||
      issuance.issuedAt !== bundle.payload.issuedAt ||
      issuance.expiresAt !== bundle.payload.expiresAt
    ) {
      throw new Error(
        "The signed policy bundle does not match its allocated issuance.",
      );
    }
    const existing = tenant.signedPolicyBundles.get(bundle.payload.revision);
    if (
      existing !== undefined &&
      canonicalJson(existing) !== canonicalJson(bundle)
    ) {
      throw new Error(
        "The policy bundle revision already contains different signed content.",
      );
    }
    tenant.signedPolicyBundles.set(bundle.payload.revision, bundle);
  }
}

export function createInMemoryRepository(input?: {
  secretCipher?: SecretCipher;
}): ControlPlaneRepository {
  return new InMemoryControlPlaneRepository(input);
}
