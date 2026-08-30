import { z } from "zod";
import {
  EngineeringEventSummarySchema,
  EngineeringOperationSummarySchema,
  type EngineeringEventSummary,
  type EngineeringOperationSummary,
} from "@sisyphus/ui/contracts";

const LeaseSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    request: z.string().trim().min(20).max(4_000),
    leaseId: z.string().uuid(),
    operation: EngineeringOperationSummarySchema,
  })
  .strict();
const LeaseResponseSchema = z.object({ task: LeaseSchema.nullable() }).strict();
const UpdateResponseSchema = z.object({ updated: z.literal(true) }).strict();
const SelectedSkillSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    name: z.string().min(1),
    description: z.string().min(1),
    skillVersionId: z.string().min(1),
    stableVersionKey: z.string().min(1),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    instructions: z.string().min(1).max(300_000),
  })
  .strict();
const SkillSelectionResponseSchema = z.object({ items: z.array(SelectedSkillSchema).max(4) }).strict();
const SkillExecutionRecordSchema = z
  .object({
    executionId: z.string().trim().min(1).max(240),
    skillIds: z.array(z.string().regex(/^[a-z0-9-]+$/u)).min(1).max(8),
    skillVersions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/u),
            skillVersionId: z.string().min(1).max(240),
            contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    taskId: z.string().trim().min(1).max(160),
    agentId: z.string().trim().min(1).max(160),
    requirementId: z.string().trim().min(1).max(160),
    model: z.string().trim().min(1).max(200),
    outcome: z.enum(["passed", "failed"]),
    attempts: z.number().int().min(1).max(3),
    durationMs: z.number().int().nonnegative().max(86_400_000),
    evidence: z.string().trim().min(1).max(1_000),
    score: z
      .object({
        total: z.number().min(0).max(100),
        functional: z.number().min(0).max(100),
        contractTests: z.number().min(0).max(100),
        security: z.number().min(0).max(100),
        requirementCompliance: z.number().min(0).max(100),
        codeQuality: z.number().min(0).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const versionIds = new Set(value.skillVersions.map((skill) => skill.id));
    if (value.skillIds.some((skillId) => !versionIds.has(skillId))) {
      context.addIssue({ code: "custom", path: ["skillVersions"], message: "Every skill requires version evidence." });
    }
  });
const SkillExecutionRecordResponseSchema = z.object({ recorded: z.literal(true) }).strict();

export type LeasedEngineeringTask = z.infer<typeof LeaseSchema>;
export type SelectedEngineeringSkill = z.infer<typeof SelectedSkillSchema>;

export class ControlPlaneClient {
  public constructor(
    private readonly apiUrl: string,
    private readonly orchestratorToken: string,
    private readonly maxSkillsPerAgent: number,
  ) {}

  public async lease(tenantId: string): Promise<LeasedEngineeringTask | undefined> {
    return this.#request({
      path: "/v1/internal/engineering/tasks/lease",
      body: { tenantId },
      schema: LeaseResponseSchema,
    }).then((response) => response.task ?? undefined);
  }

  public async update(input: {
    tenantId: string;
    taskId: string;
    leaseId: string;
    operation: EngineeringOperationSummary;
    events: readonly EngineeringEventSummary[];
  }): Promise<void> {
    await this.#request({
      path: `/v1/internal/engineering/tasks/${encodeURIComponent(input.taskId)}/update`,
      body: {
        tenantId: input.tenantId,
        leaseId: input.leaseId,
        operation: EngineeringOperationSummarySchema.parse(input.operation),
        events: input.events.map((event) => EngineeringEventSummarySchema.parse(event)),
      },
      schema: UpdateResponseSchema,
    });
  }

  public async selectSkills(input: {
    tenantId: string;
    request: string;
    role: string;
    requirement: {
      readonly title: string;
      readonly acceptanceCriteria: readonly string[];
    };
    phase: "build" | "review";
  }): Promise<readonly SelectedEngineeringSkill[]> {
    const contextualRequest = [
      input.request,
      `Requirement: ${input.requirement.title}`,
      `Acceptance criteria: ${input.requirement.acceptanceCriteria.join("; ")}`,
      `Phase: ${input.phase}`,
    ]
      .join("\n")
      .slice(0, 4_000);
    const response = await this.#request({
      path: "/v1/internal/engineering/skills/select",
      body: {
        tenantId: z.string().trim().min(1).max(160).parse(input.tenantId),
        selection: {
          request: z.string().trim().min(20).max(4_000).parse(contextualRequest),
          role: z.string().trim().min(2).max(80).parse(input.role),
          phase: input.phase,
          limit: this.maxSkillsPerAgent,
        },
      },
      schema: SkillSelectionResponseSchema,
    });
    return response.items;
  }

  public async recordSkillExecution(input: {
    tenantId: string;
    execution: z.input<typeof SkillExecutionRecordSchema>;
  }): Promise<void> {
    await this.#request({
      path: "/v1/internal/engineering/skills/executions",
      body: {
        tenantId: z.string().trim().min(1).max(160).parse(input.tenantId),
        execution: SkillExecutionRecordSchema.parse(input.execution),
      },
      schema: SkillExecutionRecordResponseSchema,
    });
  }

  async #request<T>(input: {
    path: string;
    body: unknown;
    schema: z.ZodType<T>;
  }): Promise<T> {
    const response = await fetch(`${this.apiUrl}${input.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sisyphus-Orchestrator-Token": this.orchestratorToken,
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = z
        .object({ message: z.string().min(1) })
        .passthrough()
        .safeParse(payload);
      throw new Error(
        message.success
          ? `Control plane rejected the orchestrator request: ${message.data.message}`
          : `Control plane rejected the orchestrator request (${response.status}).`,
      );
    }
    return input.schema.parse(payload);
  }
}
