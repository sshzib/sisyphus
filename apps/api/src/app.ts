import cors from "@fastify/cors";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CloudSupervisionBatchSchema,
  JudgeResultSchema,
  PolicyVersionIdSchema,
  RuntimeEventIdSchema,
} from "@sisyphus/domain";
import {
  CreateEngineeringTaskResponseSchema,
  ClearEngineeringHistoryResponseSchema,
  DashboardQuerySchema,
  DashboardSnapshotSchema,
  EngineeringEventSummarySchema,
  EngineeringOperationSummarySchema,
  EngineeringTaskSubmissionSchema,
  CreateCustomSkillSchema,
  RestoreSkillRequestSchema,
  RestoreSkillResponseSchema,
  SkillRegistryDetailResponseSchema,
  SkillRegistryListResponseSchema,
  SkillRegistrySyncPreviewSchema,
  SkillRegistrySyncResponseSchema,
  ResolveSkillImprovementProposalSchema,
} from "@sisyphus/ui/contracts";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import { containsCredentialShapedString } from "./credential-screen.js";
import {
  InMemoryEngineeringTaskStore,
  type EngineeringTaskStore,
} from "./engineering-store.js";
import {
  FileSkillRegistry,
  SelectedSkillSchema,
  SkillExecutionInputSchema,
  SkillSelectionRequestSchema,
} from "./skill-registry.js";
import { isReadyPostgresControlPlaneRepository } from "./database/postgres-repository.js";
import {
  authenticated,
  bearerToken,
  sendApiError,
  type AuthContext,
  type CredentialResolver,
} from "./auth.js";
import {
  createInMemoryRepository,
  InactiveDeviceError,
  IngestCollisionError,
  InvalidStateTransitionError,
  RuntimeInstallationMismatchError,
  type ControlPlaneRepository,
} from "./repository.js";
import {
  JudgeBroker,
  JudgeIdempotencyCollisionError,
  OpenAiResponsesJudgeProvider,
  type JudgeProvider,
} from "./judge.js";
import {
  createSignedPolicyBundle,
  Ed25519PolicyBundleSigner,
  SignedPolicyBundleSchema,
  type PolicyBundleSigner,
} from "./policy-bundle.js";

const SkillParamsSchema = z.object({ skillVersionId: z.string().min(1).max(240) }).strict();
const JudgeRequestSchema = z
  .object({
    eventId: RuntimeEventIdSchema,
    policyVersionId: PolicyVersionIdSchema,
    redactedInput: z
      .string()
      .trim()
      .min(1)
      .max(60_000)
      .refine(
        (value) => !containsCredentialShapedString(value),
        "The judge input still contains a credential-shaped value.",
      ),
  })
  .strict();
const JudgeProviderConfigurationSchema = z
  .object({
    apiKey: z.string().trim().min(20).max(500),
    model: z.string().trim().min(1).max(120).default("gpt-5-mini"),
  })
  .strict();
const InternalEngineeringLeaseRequestSchema = z
  .object({ tenantId: z.string().trim().min(1).max(160) })
  .strict();
const InternalEngineeringTaskUpdateSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(160),
    leaseId: z.string().uuid(),
    operation: EngineeringOperationSummarySchema,
    events: z.array(EngineeringEventSummarySchema).max(100),
  })
  .strict();
const InternalEngineeringSkillSelectionSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(160),
    selection: SkillSelectionRequestSchema,
  })
  .strict();
const InternalEngineeringSkillExecutionSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(160),
    execution: SkillExecutionInputSchema,
  })
  .strict();

export interface CreateAppOptions {
  repository?: ControlPlaneRepository;
  externalCredentialResolver?: CredentialResolver;
  logger?: boolean;
  corsOrigins?: string[];
  judgeProvider?: JudgeProvider;
  judgeDeadlineMs?: number;
  policyBundleSigner?: PolicyBundleSigner;
  clock?: () => Date;
  engineeringTaskStore?: EngineeringTaskStore;
  skillRegistry?: FileSkillRegistry;
  orchestratorToken?: string;
}

function requireAuthentication(
  request: FastifyRequest,
  reply: FastifyReply,
): AuthContext | undefined {
  const auth = authenticated(request);
  if (auth === undefined) {
    sendApiError({
      request,
      reply,
      status: 401,
      error: "unauthorized",
      message: "A valid bearer credential is required.",
    });
  }
  return auth;
}

function validationFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
): void {
  sendApiError({
    request,
    reply,
    status: 400,
    error: "invalid_request",
    message,
  });
}

function requireOrchestratorCredential(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  configuredToken: string | undefined;
}): boolean {
  if (input.configuredToken === undefined) {
    sendApiError({
      request: input.request,
      reply: input.reply,
      status: 503,
      error: "orchestrator_not_configured",
      message: "The engineering orchestrator credential is not configured.",
    });
    return false;
  }
  const supplied = input.request.headers["x-sisyphus-orchestrator-token"];
  const suppliedBytes =
    typeof supplied === "string" ? Buffer.from(supplied, "utf8") : undefined;
  const configuredBytes = Buffer.from(input.configuredToken, "utf8");
  if (
    suppliedBytes === undefined ||
    suppliedBytes.length !== configuredBytes.length ||
    !timingSafeEqual(suppliedBytes, configuredBytes)
  ) {
    sendApiError({
      request: input.request,
      reply: input.reply,
      status: 401,
      error: "unauthorized",
      message: "A valid engineering orchestrator credential is required.",
    });
    return false;
  }
  return true;
}

async function tenantDashboard(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  repository: ControlPlaneRepository;
  engineeringTaskStore: EngineeringTaskStore;
}) {
  const auth = requireAuthentication(input.request, input.reply);
  if (auth === undefined) {
    return undefined;
  }
  const query = DashboardQuerySchema.safeParse(input.request.query);
  if (!query.success) {
    validationFailure(input.request, input.reply, "The runtime filter is invalid.");
    return undefined;
  }
  const snapshot = await input.repository.dashboard(auth.tenantId, query.data);
  if (snapshot === undefined) {
    sendApiError({
      request: input.request,
      reply: input.reply,
      status: 404,
      error: "tenant_not_found",
      message: "The authenticated tenant is unavailable.",
    });
    return undefined;
  }
  return DashboardSnapshotSchema.parse({
    ...snapshot,
    engineering: await input.engineeringTaskStore.dashboard(auth.tenantId),
  });
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  if (
    process.env.NODE_ENV === "production" &&
    (options.repository === undefined ||
      !isReadyPostgresControlPlaneRepository(options.repository))
  ) {
    throw new Error(
      "Production API startup requires a migrated, RLS-verified PostgreSQL ControlPlaneRepository; in-memory repositories and demo credentials are refused.",
    );
  }
  const repository = options.repository ?? createInMemoryRepository();
  const engineeringTaskStore =
    options.engineeringTaskStore ?? new InMemoryEngineeringTaskStore();
  const skillRegistry =
    options.skillRegistry ??
    new FileSkillRegistry(fileURLToPath(new URL("../../../skills", import.meta.url)));
  const judgeBroker = new JudgeBroker(
    repository,
    options.judgeProvider ?? new OpenAiResponsesJudgeProvider(),
    options.judgeDeadlineMs ?? 8000,
  );
  const policyBundleSigner =
    options.policyBundleSigner ?? Ed25519PolicyBundleSigner.generate();
  const clock = options.clock ?? (() => new Date());
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.corsOrigins ?? ["http://localhost:3000"],
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  app.addHook("onClose", async () => repository.close());

  app.decorateRequest("authContext", null);
  app.addHook("onRequest", async (request, reply) => {
    if (
      !request.url.startsWith("/v1/") ||
      request.url.startsWith("/v1/health") ||
      request.url.startsWith("/v1/internal/engineering/")
    ) {
      return;
    }
    const token = bearerToken(request);
    if (token === undefined) {
      sendApiError({
        request,
        reply,
        status: 401,
        error: "unauthorized",
        message: "A bearer credential is required.",
      });
      return;
    }
    const repositoryAuth = await repository.resolveCredential(token);
    const auth =
      repositoryAuth ??
      (await options.externalCredentialResolver?.resolveCredential(token));
    if (auth === undefined) {
      sendApiError({
        request,
        reply,
        status: 401,
        error: "unauthorized",
        message: "The bearer credential is invalid or revoked.",
      });
      return;
    }
    request.authContext = auth;
  });

  const health = async () => {
    await repository.health();
    return {
      status: "ok",
      service: "sisyphus-control-plane",
      version: "0.1.0",
    };
  };
  app.get("/health", health);
  app.get("/v1/health", health);

  app.get("/v1/dashboard", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send(snapshot);
    }
  });

  app.post("/v1/engineering/tasks", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) return;
    if (auth.kind !== "user" || auth.role === "viewer") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "forbidden",
        message: "Only workspace members can create an engineering task.",
      });
      return;
    }
    if (containsCredentialShapedString(request.body)) {
      validationFailure(
        request,
        reply,
        "The task request contains a credential-shaped value and was not stored.",
      );
      return;
    }
    const body = EngineeringTaskSubmissionSchema.safeParse(request.body);
    if (!body.success) {
      validationFailure(
        request,
        reply,
        "Describe the engineering task in between 20 and 4,000 characters.",
      );
      return;
    }
    const operation = await engineeringTaskStore.create({
      tenantId: auth.tenantId,
      actor: auth.subjectId,
      request: body.data.request,
      now: clock(),
    });
    return reply.status(202).send(
      CreateEngineeringTaskResponseSchema.parse({ operation }),
    );
  });

  app.delete("/v1/engineering/tasks/history", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) return;
    if (auth.kind !== "user" || auth.role === "viewer") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "forbidden",
        message: "Only workspace members can delete terminal engineering prompt logs.",
      });
      return;
    }
    const result = await engineeringTaskStore.clearHistory({ tenantId: auth.tenantId });
    return reply.send(ClearEngineeringHistoryResponseSchema.parse(result));
  });

  app.post("/v1/internal/engineering/tasks/lease", async (request, reply) => {
    if (
      !requireOrchestratorCredential({
        request,
        reply,
        configuredToken: options.orchestratorToken,
      })
    ) {
      return;
    }
    const body = InternalEngineeringLeaseRequestSchema.safeParse(request.body);
    if (!body.success) {
      validationFailure(request, reply, "A valid engineering tenant ID is required.");
      return;
    }
    const leaseId = randomUUID();
    const task = await engineeringTaskStore.lease({
      tenantId: body.data.tenantId,
      leaseId,
      now: clock(),
      leaseDurationMs: 30 * 60_000,
    });
    return reply.send({ task });
  });

  app.post(
    "/v1/internal/engineering/tasks/:taskId/update",
    async (request, reply) => {
      if (
        !requireOrchestratorCredential({
          request,
          reply,
          configuredToken: options.orchestratorToken,
        })
      ) {
        return;
      }
      const taskId = z.string().trim().min(1).max(160).safeParse(
        (request.params as { taskId?: unknown }).taskId,
      );
      const body = InternalEngineeringTaskUpdateSchema.safeParse(request.body);
      if (!taskId.success || !body.success || body.data.operation.id !== taskId.data) {
        validationFailure(request, reply, "The engineering task update is invalid.");
        return;
      }
      const updated = await engineeringTaskStore.updateLeasedTask({
        tenantId: body.data.tenantId,
        taskId: taskId.data,
        leaseId: body.data.leaseId,
        operation: body.data.operation,
        events: body.data.events,
        now: clock(),
      });
      if (!updated) {
        sendApiError({
          request,
          reply,
          status: 409,
          error: "invalid_engineering_lease",
          message: "The engineering task lease is no longer current.",
        });
        return;
      }
      return reply.send({ updated: true });
    },
  );

  app.post("/v1/internal/engineering/skills/select", async (request, reply) => {
    if (
      !requireOrchestratorCredential({
        request,
        reply,
        configuredToken: options.orchestratorToken,
      })
    ) {
      return;
    }
    const body = InternalEngineeringSkillSelectionSchema.safeParse(request.body);
    if (!body.success) {
      validationFailure(request, reply, "The skill selection request is invalid.");
      return;
    }
    return reply.send({
      items: (await skillRegistry.select(body.data.selection)).map((skill) =>
        SelectedSkillSchema.parse(skill),
      ),
    });
  });

  app.post("/v1/internal/engineering/skills/executions", async (request, reply) => {
    if (
      !requireOrchestratorCredential({
        request,
        reply,
        configuredToken: options.orchestratorToken,
      })
    ) {
      return;
    }
    const body = InternalEngineeringSkillExecutionSchema.safeParse(request.body);
    if (!body.success) {
      validationFailure(request, reply, "The skill execution record is invalid.");
      return;
    }
    await skillRegistry.recordExecution(body.data.execution);
    return reply.send({ recorded: true });
  });

  app.get("/v1/runs", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.runs });
    }
  });

  app.get("/v1/agents", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.agents });
    }
  });

  app.get("/v1/skills", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.skills });
    }
  });

  app.get("/v1/skill-registry", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) return;
    return reply.send(SkillRegistryListResponseSchema.parse({ items: await skillRegistry.list() }));
  });

  app.get("/v1/skill-registry/:skillId", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) return;
    const params = z.object({ skillId: z.string().regex(/^[a-z0-9-]+$/u) }).strict().safeParse(request.params);
    if (!params.success) {
      validationFailure(request, reply, "The skill identifier is invalid.");
      return;
    }
    const skill = await skillRegistry.detail(params.data.skillId);
    if (skill === undefined) {
      sendApiError({ request, reply, status: 404, error: "skill_not_found", message: "The requested skill is not in the registry." });
      return;
    }
    return reply.send(SkillRegistryDetailResponseSchema.parse({ skill }));
  });

  app.post("/v1/skill-registry/sync", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) return;
    if (auth.kind !== "user" || auth.role !== "admin") {
      sendApiError({ request, reply, status: 403, error: "forbidden", message: "Only administrators can synchronize the skill registry." });
      return;
    }
    return reply.send(SkillRegistrySyncResponseSchema.parse(await skillRegistry.sync()));
  });

  app.post("/v1/skill-registry/sync/preview", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) return;
    if (auth.kind !== "user" || auth.role !== "admin") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "forbidden",
        message: "Only administrators can review skill updates.",
      });
      return;
    }
    return reply.send(SkillRegistrySyncPreviewSchema.parse(await skillRegistry.previewSync()));
  });

  app.post("/v1/skill-registry/custom", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) return;
    if (auth.kind !== "user" || auth.role !== "admin") {
      sendApiError({ request, reply, status: 403, error: "forbidden", message: "Only administrators can create custom skills." });
      return;
    }
    const body = CreateCustomSkillSchema.safeParse(request.body);
    if (!body.success) {
      validationFailure(request, reply, "The custom skill is incomplete or invalid.");
      return;
    }
    try {
      const created = await skillRegistry.createCustom(body.data);
      const skill = await skillRegistry.detail(created.id);
      if (skill === undefined) throw new Error("The saved custom skill could not be read back.");
      return reply.send(SkillRegistryDetailResponseSchema.parse({ skill }));
    } catch (error: unknown) {
      sendApiError({ request, reply, status: 409, error: "skill_create_conflict", message: error instanceof Error ? error.message : "The custom skill could not be created." });
    }
  });

  app.post("/v1/skill-registry/:skillId/proposals/:proposalId", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) return;
    if (auth.kind !== "user" || auth.role !== "admin") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "forbidden",
        message: "Only administrators can resolve skill improvements.",
      });
      return;
    }
    const params = z.object({
      skillId: z.string().regex(/^[a-z0-9-]+$/u),
      proposalId: z.string().regex(/^proposal-[a-f0-9]{16}$/u),
    }).strict().safeParse(request.params);
    const body = ResolveSkillImprovementProposalSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      validationFailure(request, reply, "The skill improvement action is invalid.");
      return;
    }
    try {
      const skill = await skillRegistry.resolveImprovementProposal({
        skillId: params.data.skillId,
        proposalId: params.data.proposalId,
        action: body.data.action,
      });
      return reply.send(SkillRegistryDetailResponseSchema.parse({ skill }));
    } catch (error: unknown) {
      sendApiError({
        request,
        reply,
        status: 409,
        error: "skill_improvement_conflict",
        message: error instanceof Error ? error.message : "The skill improvement could not be resolved.",
      });
    }
  });

  app.get("/v1/conflicts", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.conflicts });
    }
  });

  app.get("/v1/integrations", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.integrations });
    }
  });

  app.get("/v1/policies", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.policies });
    }
  });

  app.get("/v1/audit", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.audit });
    }
  });

  app.get("/v1/devices", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository, engineeringTaskStore });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.devices });
    }
  });

  app.get("/v1/policy-bundle", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) {
      return;
    }
    if (auth.kind !== "device") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "device_credential_required",
        message: "Policy bundles are issued to enrolled device installations.",
      });
      return;
    }
    const issuance = await repository.issuePolicyBundle({
      tenantId: auth.tenantId,
      deviceId: auth.subjectId,
      adapterInstallationId: auth.adapterInstallationId,
      signingKeyId: policyBundleSigner.keyId,
      now: clock(),
    });
    if (issuance === undefined) {
      sendApiError({
        request,
        reply,
        status: 404,
        error: "tenant_not_found",
        message: "The authenticated tenant is unavailable.",
      });
      return;
    }
    const bundle = createSignedPolicyBundle({
      signer: policyBundleSigner,
      ...issuance,
      now: new Date(issuance.issuedAt),
    });
    await repository.recordSignedPolicyBundle({
      tenantId: auth.tenantId,
      bundle,
    });
    return reply.send(SignedPolicyBundleSchema.parse(bundle));
  });

  app.put("/v1/judge/provider", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) {
      return;
    }
    if (auth.kind !== "user" || auth.role !== "admin") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "forbidden",
        message: "Only tenant administrators can configure the judge provider.",
      });
      return;
    }
    const body = JudgeProviderConfigurationSchema.safeParse(request.body);
    if (!body.success) {
      validationFailure(
        request,
        reply,
        "A valid provider key and model are required.",
      );
      return;
    }
    const configured = await repository.configureJudgeProvider({
      tenantId: auth.tenantId,
      apiKey: body.data.apiKey,
      model: body.data.model,
    });
    if (!configured) {
      sendApiError({
        request,
        reply,
        status: 404,
        error: "tenant_not_found",
        message: "The authenticated tenant is unavailable.",
      });
      return;
    }
    return reply.send({ configured: true, provider: "openai", model: body.data.model });
  });

  app.post("/v1/judge", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) {
      return;
    }
    if (auth.kind !== "device") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "device_credential_required",
        message: "Judge requests require an enrolled device credential.",
      });
      return;
    }
    const body = JudgeRequestSchema.safeParse(request.body);
    if (!body.success) {
      validationFailure(
        request,
        reply,
        "The judge request must contain a clipped, locally redacted input.",
      );
      return;
    }
    try {
      const result = await judgeBroker.judge({
        tenantId: auth.tenantId,
        eventId: body.data.eventId,
        policyVersionId: body.data.policyVersionId,
        redactedInput: body.data.redactedInput,
      });
      return reply.send(JudgeResultSchema.parse(result));
    } catch (error: unknown) {
      if (error instanceof JudgeIdempotencyCollisionError) {
        sendApiError({
          request,
          reply,
          status: 409,
          error: "idempotency_collision",
          message: error.message,
        });
        return;
      }
      throw error;
    }
  });

  app.post("/v1/skills/:skillVersionId/restore", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) {
      return;
    }
    if (auth.kind !== "user" || auth.role !== "admin") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "forbidden",
        message: "Only tenant administrators can restore a skill version.",
      });
      return;
    }
    const params = SkillParamsSchema.safeParse(request.params);
    const body = RestoreSkillRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      validationFailure(
        request,
        reply,
        "A skill version and a restoration reason of at least eight characters are required.",
      );
      return;
    }
    try {
      const restored = await repository.restoreSkill({
        tenantId: auth.tenantId,
        actor: auth.subjectId,
        skillVersionId: params.data.skillVersionId,
        reason: body.data.reason,
      });
      if (restored === undefined) {
        sendApiError({
          request,
          reply,
          status: 404,
          error: "skill_not_found",
          message: "The skill version does not exist in this tenant.",
        });
        return;
      }
      return reply.send(RestoreSkillResponseSchema.parse(restored));
    } catch (error: unknown) {
      if (error instanceof InvalidStateTransitionError) {
        sendApiError({
          request,
          reply,
          status: 409,
          error: "invalid_transition",
          message: error.message,
        });
        return;
      }
      throw error;
    }
  });

  app.post("/v1/events/batch", async (request, reply) => {
    const auth = requireAuthentication(request, reply);
    if (auth === undefined) {
      return;
    }
    if (auth.kind !== "device") {
      sendApiError({
        request,
        reply,
        status: 403,
        error: "device_credential_required",
        message: "Worker event batches require an enrolled device credential.",
      });
      return;
    }
    if (containsCredentialShapedString(request.body)) {
      validationFailure(
        request,
        reply,
        "The event batch contains a credential-shaped value and was not uploaded.",
      );
      return;
    }
    const body = CloudSupervisionBatchSchema.safeParse(request.body);
    if (!body.success) {
      validationFailure(
        request,
        reply,
        "A batch must contain between one and one hundred strict event records.",
      );
      return;
    }
    try {
      const acceptedIds = await repository.ingestBatch({ auth, records: body.data.records });
      return reply.status(202).send({ acceptedIds });
    } catch (error: unknown) {
      if (error instanceof IngestCollisionError) {
        sendApiError({
          request,
          reply,
          status: 409,
          error: "idempotency_collision",
          message: error.message,
        });
        return;
      }
      if (error instanceof InactiveDeviceError) {
        sendApiError({
          request,
          reply,
          status: 403,
          error: "device_inactive",
          message: error.message,
        });
        return;
      }
      if (error instanceof RuntimeInstallationMismatchError) {
        sendApiError({
          request,
          reply,
          status: 403,
          error: "runtime_installation_mismatch",
          message: error.message,
        });
        return;
      }
      throw error;
    }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error, requestId: request.id }, "Unhandled API error");
    sendApiError({
      request,
      reply,
      status: 500,
      error: "internal_error",
      message: "The control plane could not complete the request.",
    });
  });

  return app;
}
