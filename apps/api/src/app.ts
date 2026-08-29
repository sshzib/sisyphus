import cors from "@fastify/cors";
import {
  CloudSupervisionBatchSchema,
  JudgeResultSchema,
  PolicyVersionIdSchema,
  RuntimeEventIdSchema,
} from "@sisyphus/domain";
import {
  DashboardQuerySchema,
  DashboardSnapshotSchema,
  RestoreSkillRequestSchema,
  RestoreSkillResponseSchema,
} from "@sisyphus/ui/contracts";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";
import { containsCredentialShapedString } from "./credential-screen.js";
import { isReadyPostgresControlPlaneRepository } from "./database/postgres-repository.js";
import {
  authenticated,
  bearerToken,
  sendApiError,
  type AuthContext,
} from "./auth.js";
import {
  createInMemoryRepository,
  IngestCollisionError,
  InvalidStateTransitionError,
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

export interface CreateAppOptions {
  repository?: ControlPlaneRepository;
  logger?: boolean;
  corsOrigins?: string[];
  judgeProvider?: JudgeProvider;
  judgeDeadlineMs?: number;
  policyBundleSigner?: PolicyBundleSigner;
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

async function tenantDashboard(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  repository: ControlPlaneRepository;
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
  return DashboardSnapshotSchema.parse(snapshot);
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
  const judgeBroker = new JudgeBroker(
    repository,
    options.judgeProvider ?? new OpenAiResponsesJudgeProvider(),
    options.judgeDeadlineMs ?? 8000,
  );
  const policyBundleSigner =
    options.policyBundleSigner ?? Ed25519PolicyBundleSigner.generate();
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.corsOrigins ?? ["http://localhost:3000"],
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "PUT", "OPTIONS"],
  });

  app.addHook("onClose", async () => repository.close());

  app.decorateRequest("authContext", null);
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/") || request.url.startsWith("/v1/health")) {
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
    const auth = await repository.resolveCredential(token);
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
    const snapshot = await tenantDashboard({ request, reply, repository });
    if (snapshot !== undefined) {
      return reply.send(snapshot);
    }
  });

  app.get("/v1/runs", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.runs });
    }
  });

  app.get("/v1/agents", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.agents });
    }
  });

  app.get("/v1/skills", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.skills });
    }
  });

  app.get("/v1/conflicts", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.conflicts });
    }
  });

  app.get("/v1/integrations", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.integrations });
    }
  });

  app.get("/v1/policies", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.policies });
    }
  });

  app.get("/v1/audit", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository });
    if (snapshot !== undefined) {
      return reply.send({ items: snapshot.audit });
    }
  });

  app.get("/v1/devices", async (request, reply) => {
    const snapshot = await tenantDashboard({ request, reply, repository });
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
