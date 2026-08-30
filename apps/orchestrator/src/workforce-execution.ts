import { createHash, randomUUID } from "node:crypto";
import type {
  AgentReviewVerification,
  EngineeringActivity,
  EngineeringEventType,
  EngineeringRequirement,
} from "@sisyphus/domain";
import {
  EngineeringEventSummarySchema,
  EngineeringOperationSummarySchema,
  type EngineeringAgentSummary,
  type EngineeringEvidence,
  type EngineeringEventSummary,
  type EngineeringOperationSummary,
  type EngineeringScore,
} from "@sisyphus/ui/contracts";
import {
  EngineeringExecutionStoppedError,
  type ExecutionResult,
  type ProjectExecution,
  type ProjectExecutor,
} from "./execution.js";
import {
  ControlPlaneClient,
  type LeasedEngineeringTask,
  type SelectedEngineeringSkill,
} from "./control-plane-client.js";
import { OpenRouterClient } from "./openrouter.js";
import { TaskOperationCoordinator } from "./operation-coordinator.js";
import { scanWorkspace } from "./safety-gate.js";
import { WorkspaceManager, type TaskWorkspace } from "./workspaces.js";
import {
  assignmentPhase,
  deriveProductContract,
  validateProposalPolicy,
} from "./workforce-policy.js";

interface PreparedAssignment {
  readonly agentId: string;
  readonly role: string;
  readonly requirement: EngineeringRequirement;
  readonly skills: readonly SelectedEngineeringSkill[];
  readonly phase: "build" | "review";
}

type AssignmentResult =
  | {
      readonly kind: "completed";
      readonly agentId: string;
      readonly branch: string;
      readonly verification?: AgentReviewVerification;
    }
  | { readonly kind: "failed"; readonly agentId: string; readonly message: string };

interface IntegratedWorkspace {
  readonly workspace: string;
  readonly commitId: string;
}

interface FailedAssignment {
  readonly agentId: string;
  readonly requirementId: string;
  readonly message: string;
  readonly check: string;
  readonly confidence: number | null;
}

interface ReviewFailure {
  readonly reviewerAgentId: string;
  readonly targetRequirementId: string;
  readonly criterion: string;
  readonly evidence: string;
  readonly correction: string;
}

type ReviewRemediation =
  | { readonly kind: "integrated"; readonly integration: IntegratedWorkspace }
  | { readonly kind: "accepted-with-warning"; readonly integration: IntegratedWorkspace }
  | { readonly kind: "blocked" };

export class WorkforceExecution {
  public constructor(
    private readonly dependencies: {
      readonly controlPlane: ControlPlaneClient;
      readonly workspaces: WorkspaceManager;
      readonly openRouter: OpenRouterClient;
      readonly executor: ProjectExecutor;
      readonly isExecutionPermitted: () => Promise<boolean>;
      readonly publish: (
        task: LeasedEngineeringTask,
        operation: EngineeringOperationSummary,
        events: readonly EngineeringEventSummary[],
      ) => Promise<void>;
      readonly recordSkillOutcome: (input: {
        readonly task: LeasedEngineeringTask;
        readonly agent: EngineeringAgentSummary;
        readonly requirementId: string;
        readonly skills: readonly SelectedEngineeringSkill[];
        readonly outcome: "passed" | "failed";
        readonly durationMs: number;
        readonly evidence: string;
        readonly score: EngineeringScore;
      }) => Promise<void>;
    },
  ) {}

  public async run(task: LeasedEngineeringTask): Promise<void> {
    let workspace: TaskWorkspace | undefined;
    let coordinator: TaskOperationCoordinator | undefined;
    try {
      await this.#assertExecutionPermitted();
      const planned = await this.dependencies.openRouter.plan(task.request);
      const operation = EngineeringOperationSummarySchema.parse({
        ...task.operation,
        status: "working",
        requirements: planned.plan.requirements.map((requirement) => ({
          id: requirement.id,
          title: requirement.title,
          acceptanceCriteria: requirement.acceptanceCriteria,
          status: "in-progress",
          ownerAgentId: null,
        })),
      });
      const assignments = planned.plan.requirements.map((requirement) =>
        newAgent({
          role: requirement.specialistRole,
          model: this.dependencies.openRouter.modelForRole(requirement.specialistRole),
          requirementId: requirement.id,
          activity: "planning-work",
          detail: "Waiting for an isolated workspace.",
        }),
      );
      const initial = EngineeringOperationSummarySchema.parse({
        ...operation,
        requirements: operation.requirements.map((requirement, index) => ({
          ...requirement,
          ownerAgentId: assignments[index]?.id ?? null,
        })),
        agents: assignments,
      });
      coordinator = new TaskOperationCoordinator({
        initial,
        publish: async (next, events) => this.dependencies.publish(task, next, events),
      });
      await coordinator.transition({
        reduce: (current) => current,
        events: (current) => [
          event(current.id, "SPECIFICATION_CREATED", "Sisyphus created a requirement specification from the request."),
          event(
            current.id,
            "AGENTS_HIRED",
            `Sisyphus assigned ${assignments.length} specialist agents from the requirement plan.`,
          ),
        ],
      });

      workspace = await this.dependencies.workspaces.createTaskWorkspace(initial.id);
      const prepared = await Promise.all(
        coordinator.current().agents.map(async (agent) => {
          const requirement = coordinator
            ?.current()
            .requirements.find((candidate) => candidate.id === agent.requirementIds[0]);
          if (requirement === undefined) {
            throw new Error("An engineering assignment is missing its requirement.");
          }
          return this.#prepareAssignment({ task, coordinator: coordinator!, agent, requirement });
        }),
      );
      const preparedByAgentId = new Map(prepared.map((item) => [item.agentId, item]));
      const reviewAssignments = prepared.filter((assignment) => assignment.phase === "review");
      const buildAssignments = prepared.filter((assignment) => assignment.phase === "build");
      if (buildAssignments.length === 0) {
        throw new Error("The workforce plan did not assign an implementation specialist.");
      }
      if (reviewAssignments.length > 0) {
        await coordinator.transition({
          reduce: (current) => ({
            ...current,
            agents: current.agents.map((agent) =>
              reviewAssignments.some((assignment) => assignment.agentId === agent.id)
                ? {
                    ...agent,
                    status: "waiting",
                    activity: "waiting-for-integration",
                    activityDetail: "Waiting for a real integrated project snapshot before review.",
                    updatedAt: new Date().toISOString(),
                  }
                : agent,
            ),
          }),
          events: [],
        });
      }

      const buildResults = await this.#runParallelAssignments({
        task,
        workspace,
        coordinator,
        assignments: buildAssignments,
      });
      const failedBuilds = failuresFromResults(buildResults, preparedByAgentId);
      if (failedBuilds.length > 0) {
        await this.#blockAssignments({ task, coordinator, preparedByAgentId, failures: failedBuilds });
        return;
      }
      let integration = await this.#integrateAssignments({
        task,
        workspace,
        coordinator,
        preparedByAgentId,
        results: completedResults(buildResults),
      });
      if (integration === undefined) return;

      if (reviewAssignments.length > 0) {
        const reviewedIntegration = await this.#runReviewCycle({
          task,
          workspace,
          coordinator,
          preparedByAgentId,
          buildAssignments,
          reviewAssignments,
          integration,
        });
        if (reviewedIntegration === undefined) return;
        integration = reviewedIntegration;
      }

      await coordinator.transition({
        reduce: (current) => ({
          ...current,
          status: "safety-review",
          safety: { status: "running", findings: 0 },
        }),
        events: (current) => [
          event(current.id, "SAFETY_SCAN_STARTED", "Sisyphus started the generated-project safety gate."),
        ],
      });
      const safety = await scanWorkspace(integration.workspace);
      if (!safety.passed) {
        await coordinator.transition({
          reduce: (current) => ({
            ...block(
              current,
              evidence({
                check: "Safety gate",
                outcome: "failed",
                detail:
                  safety.findings.find((finding) => finding.severity === "critical")?.detail ??
                  "The safety policy rejected the generated project.",
                primaryAgentId: null,
                confidence: null,
              }),
            ),
            safety: { status: "failed", findings: safety.findings.length },
          }),
          events: (current) => [
            event(current.id, "SAFETY_SCAN_FAILED", "The safety gate blocked generated project execution."),
            event(current.id, "WORKFLOW_BLOCKED", "The safety gate blocked generated project execution."),
          ],
        });
        return;
      }

      const archive = await this.dependencies.workspaces.archiveIntegration(integration.workspace);
      await coordinator.transition({
        reduce: (current) => ({
          ...current,
          status: "sandbox-running",
          safety: { status: "passed", findings: safety.findings.length },
          sandbox: { status: "queued", buildId: null, detectedPort: null },
          evidence: [
            ...current.evidence,
            evidence({
              check: "Generated source archive",
              outcome: "passed",
              detail: `Saved the integrated source to ${archive.directory}.`,
            }),
          ].slice(-50),
        }),
        events: (current) => [
          event(current.id, "SAFETY_SCAN_PASSED", "The generated project passed the static safety gate."),
          event(current.id, "FILE_CHANGED", `Saved generated source to execution folder ${archive.slot}.`),
        ],
      });
      const execution = await this.dependencies.executor.execute({
        taskId: coordinator.current().id,
        integrationCommit: integration.commitId,
        workspace: integration.workspace,
        expectedPlan: safety.executionPlan,
        shouldContinue: () => this.dependencies.isExecutionPermitted(),
        onExecutionStarted: async ({ backend, executionId, detectedPort }) => {
          await coordinator!.transition({
            reduce: (current) => ({
              ...current,
              sandbox: { status: "running", buildId: executionId, detectedPort },
            }),
            events: (current) => [
              backend === "local-static"
                ? event(current.id, "LOCAL_EXECUTION_STARTED", `Local static executor ${executionId} started a guarded loopback verification run.`)
                : event(current.id, "AWS_SANDBOX_STARTED", `CodeBuild ${executionId} accepted the isolated source artifact.`),
              backend === "local-static"
                ? event(current.id, "BUILD_STARTED", "The local executor is verifying the generated static artifact without running generated commands.")
                : event(current.id, "BUILD_STARTED", "The trusted sandbox runner started dependency installation and the project build."),
              backend === "local-static"
                ? event(current.id, "TEST_STARTED", "The local static executor records only deterministic delivery and health checks.")
                : event(current.id, "TEST_STARTED", "The trusted sandbox runner will execute the project's declared automated tests."),
            ],
          });
        },
      });
      await coordinator.transition({
        reduce: (current) => projectExecutionResult(current, execution),
        events: (current) => executionEvents(current.id, execution),
      });
      await this.#recordExecutionSkillOutcomes({ task, coordinator, preparedByAgentId, result: execution.result });
    } catch (error: unknown) {
      if (error instanceof EngineeringExecutionStoppedError) {
        return;
      }
      const message = error instanceof Error ? error.message : "The engineering orchestrator encountered an unknown failure.";
      if (coordinator === undefined) {
        const operation = block(
          task.operation,
          evidence({
            check: "Engineering orchestrator",
            outcome: "failed",
            detail: message.slice(0, 500),
            primaryAgentId: null,
            confidence: null,
          }),
        );
        await this.dependencies.publish(task, operation, [
          event(task.operation.id, "WORKFLOW_BLOCKED", "The orchestration workflow could not complete."),
        ]);
      } else {
        await coordinator.transition({
          reduce: (current) =>
            block(
              current,
              evidence({
                check: "Engineering orchestrator",
                outcome: "failed",
                detail: message.slice(0, 500),
                primaryAgentId: null,
                confidence: null,
              }),
            ),
          events: (current) => [
            event(current.id, "WORKFLOW_BLOCKED", "The orchestration workflow could not complete."),
          ],
        });
      }
    } finally {
      if (workspace !== undefined) {
        await this.dependencies.workspaces.cleanup(workspace).catch(() => undefined);
      }
    }
  }

  async #prepareAssignment(input: {
    readonly task: LeasedEngineeringTask;
    readonly coordinator: TaskOperationCoordinator;
    readonly agent: EngineeringAgentSummary;
    readonly requirement: EngineeringRequirement;
  }): Promise<PreparedAssignment> {
    await this.#assertExecutionPermitted();
    const phase = assignmentPhase(input.agent.role);
    let selectedSkills: readonly SelectedEngineeringSkill[] = [];
    let selectionFailure: string | undefined;
    try {
      selectedSkills = await this.dependencies.controlPlane.selectSkills({
        tenantId: input.task.tenantId,
        request: input.task.request,
        role: input.agent.role,
        requirement: input.requirement,
        phase,
      });
    } catch (error: unknown) {
      selectionFailure = error instanceof Error ? error.message.slice(0, 240) : "The skill registry did not return a response.";
    }
    await input.coordinator.transition({
      reduce: (current) =>
        replaceAgent(current, {
          ...(current.agents.find((agent) => agent.id === input.agent.id) ?? input.agent),
          selectedSkills: selectedSkills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            skillVersionId: skill.skillVersionId,
            contentHash: skill.contentHash,
          })),
          activityDetail:
            selectionFailure === undefined
              ? `${selectedSkills.length} relevant skill instruction${selectedSkills.length === 1 ? "" : "s"} selected for this requirement.`
              : "Skill selection was unavailable; the assignment will continue with Sisyphus safety policy only.",
          updatedAt: new Date().toISOString(),
        }),
      events: (current) => [
        event(
          current.id,
          "SKILLS_SELECTED",
          selectionFailure === undefined
            ? `${input.agent.role} received ${selectedSkills.length} relevant skill instruction${selectedSkills.length === 1 ? "" : "s"} for ${input.requirement.id}.`
            : `${input.agent.role} could not load a skill instruction for ${input.requirement.id}: ${selectionFailure}`,
        ),
      ],
    });
    return {
      agentId: input.agent.id,
      role: input.agent.role,
      requirement: input.requirement,
      skills: selectedSkills,
      phase,
    };
  }

  async #runParallelAssignments(input: {
    readonly task: LeasedEngineeringTask;
    readonly workspace: TaskWorkspace;
    readonly coordinator: TaskOperationCoordinator;
    readonly assignments: readonly PreparedAssignment[];
    readonly baseCommit?: string;
    readonly projectContext?: readonly { readonly path: string; readonly content: string }[];
    readonly reviewableRequirements?: readonly EngineeringRequirement[];
    readonly startAttempts?: ReadonlyMap<string, number>;
    readonly feedbackByAgentId?: ReadonlyMap<string, string>;
  }): Promise<readonly AssignmentResult[]> {
    const settled = await Promise.allSettled(
      input.assignments.map((assignment) => {
        const startAttempt = input.startAttempts?.get(assignment.agentId);
        const feedback = input.feedbackByAgentId?.get(assignment.agentId);
        return this.#runAssignment({
          task: input.task,
          workspace: input.workspace,
          coordinator: input.coordinator,
          assignment,
          ...(input.baseCommit === undefined ? {} : { baseCommit: input.baseCommit }),
          ...(input.projectContext === undefined ? {} : { projectContext: input.projectContext }),
          ...(input.reviewableRequirements === undefined
            ? {}
            : { reviewableRequirements: input.reviewableRequirements }),
          ...(startAttempt === undefined ? {} : { startAttempt }),
          ...(feedback === undefined ? {} : { feedback }),
        });
      }),
    );
    return settled.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      const assignment = input.assignments[index];
      if (assignment === undefined) throw new Error("A concurrent assignment result could not be matched to its agent.");
      return {
        kind: "failed",
        agentId: assignment.agentId,
        message: result.reason instanceof Error ? result.reason.message.slice(0, 300) : "The assignment failed before reporting a result.",
      };
    });
  }

  async #runReviewCycle(input: {
    readonly task: LeasedEngineeringTask;
    readonly workspace: TaskWorkspace;
    readonly coordinator: TaskOperationCoordinator;
    readonly preparedByAgentId: ReadonlyMap<string, PreparedAssignment>;
    readonly buildAssignments: readonly PreparedAssignment[];
    readonly reviewAssignments: readonly PreparedAssignment[];
    readonly integration: IntegratedWorkspace;
  }): Promise<IntegratedWorkspace | undefined> {
    let integration = input.integration;
    let pendingReviews = [...input.reviewAssignments];
    let startAttempts: ReadonlyMap<string, number> | undefined;
    const reviewableRequirements = input.buildAssignments.map((assignment) => assignment.requirement);

    while (pendingReviews.length > 0) {
      const projectContext = await this.dependencies.workspaces.readProjectContext(integration.workspace);
      const reviewResults = await this.#runParallelAssignments({
        task: input.task,
        workspace: input.workspace,
        coordinator: input.coordinator,
        assignments: pendingReviews,
        baseCommit: integration.commitId,
        projectContext,
        reviewableRequirements,
        ...(startAttempts === undefined ? {} : { startAttempts }),
      });
      const failedReviews = failuresFromResults(reviewResults, input.preparedByAgentId);
      if (failedReviews.length > 0) {
        await this.#blockAssignments({
          task: input.task,
          coordinator: input.coordinator,
          preparedByAgentId: input.preparedByAgentId,
          failures: failedReviews,
        });
        return undefined;
      }
      const reviewedIntegration = await this.#integrateAssignments({
        task: input.task,
        workspace: input.workspace,
        coordinator: input.coordinator,
        preparedByAgentId: input.preparedByAgentId,
        results: completedResults(reviewResults),
        baseCommit: integration.commitId,
        projectContext,
      });
      if (reviewedIntegration === undefined) return undefined;
      integration = reviewedIntegration;

      const reviewFailures = reviewFailuresFromResults(reviewResults);
      if (reviewFailures.length === 0) return integration;
      const remediated = await this.#remediateReviewFailures({
        task: input.task,
        workspace: input.workspace,
        coordinator: input.coordinator,
        preparedByAgentId: input.preparedByAgentId,
        buildAssignments: input.buildAssignments,
        integration,
        failures: reviewFailures,
      });
      if (remediated.kind === "blocked") return undefined;
      integration = remediated.integration;
      if (remediated.kind === "accepted-with-warning") return integration;

      const affectedReviewerIds = new Set(reviewFailures.map((failure) => failure.reviewerAgentId));
      pendingReviews = input.reviewAssignments.filter((assignment) => affectedReviewerIds.has(assignment.agentId));
      startAttempts = new Map(
        pendingReviews.map((assignment) => [
          assignment.agentId,
          (input.coordinator.current().agents.find((agent) => agent.id === assignment.agentId)?.iteration ?? 1) + 1,
        ]),
      );
    }
    return integration;
  }

  async #remediateReviewFailures(input: {
    readonly task: LeasedEngineeringTask;
    readonly workspace: TaskWorkspace;
    readonly coordinator: TaskOperationCoordinator;
    readonly preparedByAgentId: ReadonlyMap<string, PreparedAssignment>;
    readonly buildAssignments: readonly PreparedAssignment[];
    readonly integration: IntegratedWorkspace;
    readonly failures: readonly ReviewFailure[];
  }): Promise<ReviewRemediation> {
    const buildersByRequirementId = new Map(
      input.buildAssignments.map((assignment) => [assignment.requirement.id, assignment]),
    );
    const failuresByBuilder = new Map<string, ReviewFailure[]>();
    for (const failure of input.failures) {
      const builder = buildersByRequirementId.get(failure.targetRequirementId);
      if (builder === undefined) {
        throw new Error(`A review finding targeted the unknown implementation requirement ${failure.targetRequirementId}.`);
      }
      const existing = failuresByBuilder.get(builder.agentId) ?? [];
      failuresByBuilder.set(builder.agentId, [...existing, failure]);
    }

    const exhausted = [...failuresByBuilder.entries()].flatMap(([agentId, failures]) => {
      const agent = input.coordinator.current().agents.find((candidate) => candidate.id === agentId);
      const prepared = input.preparedByAgentId.get(agentId);
      if (agent === undefined || prepared === undefined || agent.iteration < 3) return [];
      return [
        {
          agentId,
          requirementId: prepared.requirement.id,
          message: `Review evidence still found ${failures.length} unresolved requirement issue${failures.length === 1 ? "" : "s"} after the third implementation attempt.`,
          check: "Review verification",
          confidence: 0.8,
        } satisfies FailedAssignment,
      ];
    });
    if (exhausted.length > 0) {
      if (hasSecurityReviewFailure(input.failures, input.preparedByAgentId)) {
        await this.#blockAssignments({
          task: input.task,
          coordinator: input.coordinator,
          preparedByAgentId: input.preparedByAgentId,
          failures: exhausted,
        });
        return { kind: "blocked" };
      }
      await this.#recordReviewWarning({
        coordinator: input.coordinator,
        failures: input.failures,
        exhausted,
      });
      return { kind: "accepted-with-warning", integration: input.integration };
    }

    const retryAssignments = [...failuresByBuilder.keys()].flatMap((agentId) => {
      const assignment = input.preparedByAgentId.get(agentId);
      return assignment === undefined ? [] : [assignment];
    });
    const feedbackByAgentId = new Map(
      retryAssignments.map((assignment) => {
        const failures = failuresByBuilder.get(assignment.agentId) ?? [];
        return [
          assignment.agentId,
          failures
            .map(
              (failure) =>
                `Requirement ${failure.targetRequirementId} failed ${failure.criterion}. Evidence: ${failure.evidence} Required correction: ${failure.correction}`,
            )
            .join(" "),
        ] as const;
      }),
    );
    const startAttempts = new Map(
      retryAssignments.map((assignment) => [
        assignment.agentId,
        (input.coordinator.current().agents.find((agent) => agent.id === assignment.agentId)?.iteration ?? 1) + 1,
      ]),
    );
    await input.coordinator.transition({
      reduce: (current) => ({
        ...current,
        status: "retrying",
        agents: current.agents.map((agent) => {
          const failures = failuresByBuilder.get(agent.id);
          return failures === undefined
            ? agent
            : {
                ...agent,
                status: "retrying",
                activity: "preparing-retry",
                activityDetail: `Applying targeted corrections for ${failures.length} review finding${failures.length === 1 ? "" : "s"}.`,
                updatedAt: new Date().toISOString(),
              };
        }),
        evidence: [
          ...current.evidence,
          ...retryAssignments.flatMap((assignment) =>
            (failuresByBuilder.get(assignment.agentId) ?? []).map((failure) =>
              evidence({
                check: "Review verification",
                outcome: "failed",
                detail: `${failure.criterion}: ${failure.evidence}`.slice(0, 500),
                requirementId: failure.targetRequirementId,
                primaryAgentId: assignment.agentId,
                confidence: 0.8,
              }),
            ),
          ),
        ].slice(-50),
      }),
      events: (current) => [
        event(current.id, "TEST_FAILED", "Source inspection found a failed acceptance criterion before sandbox execution."),
        ...retryAssignments.flatMap((assignment) => [
          event(current.id, "FAILURE_ATTRIBUTED", `Sisyphus attributed the review finding to ${assignment.role}'s requirement ownership.`),
          event(current.id, "FEEDBACK_GENERATED", `Sisyphus generated precise corrective feedback for ${assignment.requirement.id}.`),
          event(current.id, "AGENT_RETRYING", `${assignment.role} is retrying only ${assignment.requirement.id}.`),
        ]),
      ],
    });

    const projectContext = await this.dependencies.workspaces.readProjectContext(input.integration.workspace);
    const retryResults = await this.#runParallelAssignments({
      task: input.task,
      workspace: input.workspace,
      coordinator: input.coordinator,
      assignments: retryAssignments,
      baseCommit: input.integration.commitId,
      projectContext,
      startAttempts,
      feedbackByAgentId,
    });
    const failedRetries = failuresFromResults(retryResults, input.preparedByAgentId);
    if (failedRetries.length > 0) {
      await this.#blockAssignments({
        task: input.task,
        coordinator: input.coordinator,
        preparedByAgentId: input.preparedByAgentId,
        failures: failedRetries,
      });
      return { kind: "blocked" };
    }
    const integration = await this.#integrateAssignments({
      task: input.task,
      workspace: input.workspace,
      coordinator: input.coordinator,
      preparedByAgentId: input.preparedByAgentId,
      results: completedResults(retryResults),
      baseCommit: input.integration.commitId,
      projectContext,
    });
    return integration === undefined ? { kind: "blocked" } : { kind: "integrated", integration };
  }

  async #recordReviewWarning(input: {
    readonly coordinator: TaskOperationCoordinator;
    readonly failures: readonly ReviewFailure[];
    readonly exhausted: readonly FailedAssignment[];
  }): Promise<void> {
    const affectedBuilderIds = new Set(input.exhausted.map((failure) => failure.agentId));
    const reviewerIds = new Set(input.failures.map((failure) => failure.reviewerAgentId));
    const detail = input.failures
      .map((failure) => `${failure.criterion}: ${failure.evidence}`)
      .join(" ")
      .slice(0, 500);
    await input.coordinator.transition({
      reduce: (current) => ({
        ...current,
        status: "integrating",
        agents: current.agents.map((agent) => {
          if (affectedBuilderIds.has(agent.id)) {
            return {
              ...agent,
              status: "completed",
              activity: "waiting-for-integration",
              activityDetail: "Review retries reached the limit; continuing to deterministic local verification.",
              score: reviewWarningScore(),
              updatedAt: new Date().toISOString(),
            };
          }
          if (reviewerIds.has(agent.id)) {
            return {
              ...agent,
              status: "completed",
              score: reviewFindingScore(),
              updatedAt: new Date().toISOString(),
            };
          }
          return agent;
        }),
        evidence: [
          ...current.evidence,
          evidence({
            check: "Review warning",
            outcome: "failed",
            detail: `Review retries reached the limit. Sisyphus is continuing to the safety and local verification gates. ${detail}`.slice(0, 500),
            requirementId: input.exhausted[0]?.requirementId ?? null,
            primaryAgentId: input.exhausted[0]?.agentId ?? null,
            confidence: 0.8,
          }),
        ].slice(-50),
      }),
      events: (current) => [
        ...input.exhausted.map((failure) =>
          event(current.id, "FAILURE_ATTRIBUTED", `Sisyphus recorded a non-terminal review warning for ${failure.requirementId}.`),
        ),
        event(current.id, "REVIEW_WARNING_RECORDED", "Review retries reached their limit; proceeding to deterministic safety and local verification."),
        event(current.id, "SCORE_UPDATED", "Sisyphus updated scores from the recorded review evidence."),
      ],
    });
  }

  async #runAssignment(input: {
    readonly task: LeasedEngineeringTask;
    readonly workspace: TaskWorkspace;
    readonly coordinator: TaskOperationCoordinator;
    readonly assignment: PreparedAssignment;
    readonly baseCommit?: string;
    readonly projectContext?: readonly { readonly path: string; readonly content: string }[];
    readonly reviewableRequirements?: readonly EngineeringRequirement[];
    readonly startAttempt?: number;
    readonly feedback?: string;
  }): Promise<AssignmentResult> {
    const startedAt = Date.now();
    let feedback = input.feedback;
    const initiallyAssigned = input.coordinator.current().agents.find((agent) => agent.id === input.assignment.agentId);
    if (initiallyAssigned === undefined) {
      throw new Error("The assignment agent is no longer present in the operation snapshot.");
    }
    const firstAttempt = input.startAttempt ?? initiallyAssigned.iteration;
    for (let attempt = firstAttempt; attempt <= 3; attempt += 1) {
      const useFallbackModel =
        attempt === 3 && this.dependencies.openRouter.hasFallbackModel(input.assignment.role);
      const currentAgent = input.coordinator.current().agents.find((agent) => agent.id === input.assignment.agentId) ?? initiallyAssigned;
      const workingAgent: EngineeringAgentSummary = {
        ...currentAgent,
        model: this.dependencies.openRouter.modelForRole(currentAgent.role, useFallbackModel),
        iteration: attempt,
        status: "working",
        activity: input.assignment.phase === "review" ? "reviewing-failure" : "editing-files",
        activityDetail:
          input.assignment.phase === "review"
            ? `Reviewing the integrated project for ${input.assignment.requirement.id}.`
            : `Working on ${input.assignment.requirement.id} in an isolated branch.`,
        updatedAt: new Date().toISOString(),
      };
      await input.coordinator.transition({
        reduce: (current) => ({ ...replaceAgent(current, workingAgent), status: "working" }),
        events: (current) => [
          ...(useFallbackModel
            ? [event(current.id, "AGENT_REASSIGNED", `${workingAgent.role} moved to its configured fallback model for the final attempt.`)]
            : []),
          event(current.id, "AGENT_STARTED", `${workingAgent.role} started iteration ${attempt} for ${input.assignment.requirement.id}.`),
        ],
      });
      try {
        await this.#assertExecutionPermitted();
        const proposal = await this.dependencies.openRouter.proposePatch({
          request: input.task.request,
          requirement: input.assignment.requirement,
          role: workingAgent.role,
          iteration: attempt,
          skills: input.assignment.skills,
          ...(feedback === undefined ? {} : { feedback }),
          ...(input.projectContext === undefined ? {} : { projectContext: input.projectContext }),
          ...(input.reviewableRequirements === undefined
            ? {}
            : { reviewableRequirements: input.reviewableRequirements }),
          ...(useFallbackModel ? { reassigned: true } : {}),
        });
        const policyFailures = validateProposalPolicy({
          role: workingAgent.role,
          proposal: proposal.proposal,
          productContract: deriveProductContract(input.task.request),
        });
        if (policyFailures.length > 0) {
          throw new Error(policyFailures.join(" "));
        }
        const verificationFailures = validateReviewVerification({
          phase: input.assignment.phase,
          verification: proposal.proposal.verification,
          reviewableRequirements: input.reviewableRequirements ?? [],
        });
        if (verificationFailures.length > 0) {
          throw new Error(verificationFailures.join(" "));
        }
        const change = await this.dependencies.workspaces.applyAgentProposal({
          task: input.workspace,
          assignmentId: workingAgent.id,
          role: workingAgent.role,
          iteration: attempt,
          proposal: proposal.proposal,
          ...(input.baseCommit === undefined ? {} : { baseCommit: input.baseCommit }),
        });
        const completedAgent: EngineeringAgentSummary = {
          ...workingAgent,
          model: proposal.model,
          branch: change.branch,
          status: "completed",
          activity: proposal.proposal.safeActivity,
          activityDetail: proposal.proposal.safeActivityDetail,
          filesChanged: [...change.filesChanged],
          commitId: change.commitId,
          updatedAt: new Date().toISOString(),
        };
        await input.coordinator.transition({
          reduce: (current) => replaceAgent(current, completedAgent),
          events: (current) => [
            event(current.id, "FILE_CHANGED", `${completedAgent.role} committed ${change.filesChanged.length} changed files for ${input.assignment.requirement.id}.`),
            event(current.id, "AGENT_COMPLETED", `${completedAgent.role} completed its isolated assignment.`),
          ],
        });
        return {
          kind: "completed",
          agentId: completedAgent.id,
          branch: change.branch,
          ...(proposal.proposal.verification === undefined
            ? {}
            : { verification: proposal.proposal.verification }),
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message.slice(0, 300) : "The agent did not return an accepted file proposal.";
        const failedAgent = input.coordinator.current().agents.find((agent) => agent.id === input.assignment.agentId) ?? workingAgent;
        const finalAttempt = attempt === 3;
        await input.coordinator.transition({
          reduce: (current) => ({
            ...replaceAgent(current, {
              ...failedAgent,
              iteration: attempt,
              status: finalAttempt ? "failed" : "retrying",
              activity: "preparing-retry",
              activityDetail: finalAttempt ? "The three-attempt limit was reached." : "Preparing targeted corrective feedback.",
              updatedAt: new Date().toISOString(),
            }),
            status: finalAttempt ? current.status : "retrying",
          }),
          events: (current) =>
            finalAttempt
              ? [event(current.id, "FAILURE_ATTRIBUTED", `${failedAgent.role} exhausted the targeted attempt limit for ${input.assignment.requirement.id}.`)]
              : [
                  event(current.id, "FEEDBACK_GENERATED", `Sisyphus generated focused feedback for ${input.assignment.requirement.id}: ${message}`),
                  event(current.id, "AGENT_RETRYING", `${failedAgent.role} is retrying only ${input.assignment.requirement.id}.`),
                ],
        });
        if (finalAttempt) {
          await this.dependencies.recordSkillOutcome({
            task: input.task,
            agent: {
              ...failedAgent,
              iteration: attempt,
              status: "failed",
              activity: "preparing-retry",
              activityDetail: "The three-attempt limit was reached.",
            },
            requirementId: input.assignment.requirement.id,
            skills: input.assignment.skills,
            outcome: "failed",
            durationMs: Date.now() - startedAt,
            evidence: message,
            score: rejectedBeforeSandboxScore(),
          });
          return { kind: "failed", agentId: input.assignment.agentId, message };
        }
        feedback = message;
      }
    }
    return { kind: "failed", agentId: input.assignment.agentId, message: "The assignment did not produce a result." };
  }

  async #integrateAssignments(input: {
    readonly task: LeasedEngineeringTask;
    readonly workspace: TaskWorkspace;
    readonly coordinator: TaskOperationCoordinator;
    readonly preparedByAgentId: ReadonlyMap<string, PreparedAssignment>;
    readonly results: readonly Extract<AssignmentResult, { readonly kind: "completed" }>[];
    readonly baseCommit?: string;
    readonly projectContext?: readonly { readonly path: string; readonly content: string }[];
  }): Promise<IntegratedWorkspace | undefined> {
    let baseCommit = input.baseCommit;
    let pending = [...input.results];
    while (pending.length > 0) {
      await input.coordinator.transition({
        reduce: (current) => ({ ...current, status: "integrating" }),
        events: (current) => [
          event(current.id, "INTEGRATION_STARTED", "Sisyphus began merging specialist branches into an isolated integration workspace."),
        ],
      });
      const integration = await this.dependencies.workspaces.integrate({
        task: input.workspace,
        branches: pending.map((result) => result.branch),
        ...(baseCommit === undefined ? {} : { baseCommit }),
      });
      if (integration.kind === "integrated") {
        return { workspace: integration.workspace, commitId: integration.commitId };
      }
      const conflictIndex = pending.findIndex((result) => result.branch === integration.branch);
      const result = conflictIndex < 0 ? undefined : pending[conflictIndex];
      const prepared = result === undefined ? undefined : input.preparedByAgentId.get(result.agentId);
      const agent = result === undefined
        ? undefined
        : input.coordinator.current().agents.find((candidate) => candidate.id === result.agentId);
      const detail = `Git reported a merge conflict in ${integration.conflictingFiles.join(", ") || "an overlapping file"}. ${integration.detail}`;
      if (result === undefined || prepared === undefined || agent === undefined || agent.iteration >= 3) {
        await this.#blockAssignments({
          task: input.task,
          coordinator: input.coordinator,
          preparedByAgentId: input.preparedByAgentId,
          failures: [
            {
              agentId: agent?.id ?? "unknown-agent",
              requirementId: prepared?.requirement.id ?? "integration",
              message: detail,
              check: "Integration conflict",
              confidence: agent === undefined ? null : 0.95,
            },
          ],
        });
        return undefined;
      }
      await input.coordinator.transition({
        reduce: (current) => ({
          ...replaceAgent(current, {
            ...agent,
            status: "retrying",
            activity: "resolving-conflict",
            activityDetail: `Resolving an integration conflict in ${integration.conflictingFiles.join(", ") || "the shared workspace"}.`,
            updatedAt: new Date().toISOString(),
          }),
          status: "retrying",
          evidence: [
            ...current.evidence,
            evidence({
              check: "Integration conflict",
              outcome: "failed",
              detail,
              requirementId: prepared.requirement.id,
              primaryAgentId: agent.id,
              confidence: 0.95,
            }),
          ].slice(-50),
        }),
        events: (current) => [
          event(current.id, "INTEGRATION_CONFLICT", `The integration workspace found a real Git conflict in ${integration.conflictingFiles.join(", ") || "an overlapping file"}.`),
          event(current.id, "FAILURE_ATTRIBUTED", `Sisyphus traced the conflict to ${agent.role}'s branch and changed-file evidence.`),
          event(current.id, "FEEDBACK_GENERATED", `Sisyphus generated scoped conflict feedback for ${prepared.requirement.id}.`),
          event(current.id, "AGENT_RETRYING", `${agent.role} is retrying only the conflicting requirement on the integration base.`),
        ],
      });
      const retried = await this.#runAssignment({
        task: input.task,
        workspace: input.workspace,
        coordinator: input.coordinator,
        assignment: prepared,
        baseCommit: integration.baseCommit,
        startAttempt: agent.iteration + 1,
        feedback: `${detail} Do not modify the conflicting file. Preserve accepted work already present in the integration base and stay within your specialist ownership boundary.`,
        ...(input.projectContext === undefined ? {} : { projectContext: input.projectContext }),
      });
      if (retried.kind === "failed") {
        await this.#blockAssignments({
          task: input.task,
          coordinator: input.coordinator,
          preparedByAgentId: input.preparedByAgentId,
          failures: [
            {
              agentId: retried.agentId,
              requirementId: prepared.requirement.id,
              message: retried.message,
              check: "Integration conflict correction",
              confidence: 0.95,
            },
          ],
        });
        return undefined;
      }
      baseCommit = integration.baseCommit;
      pending = [retried, ...pending.slice(conflictIndex + 1)];
    }
    throw new Error("The integration stage completed without any branches to merge.");
  }

  async #blockAssignments(input: {
    readonly task: LeasedEngineeringTask;
    readonly coordinator: TaskOperationCoordinator;
    readonly preparedByAgentId: ReadonlyMap<string, PreparedAssignment>;
    readonly failures: readonly FailedAssignment[];
  }): Promise<void> {
    const failureByAgentId = new Map(input.failures.map((failure) => [failure.agentId, failure]));
    await input.coordinator.transition({
      reduce: (current) => ({
        ...current,
        status: "blocked",
        agents: current.agents.map((agent) => {
          const failure = failureByAgentId.get(agent.id);
          return failure === undefined
            ? agent
            : { ...agent, status: "failed", score: rejectedBeforeSandboxScore(), updatedAt: new Date().toISOString() };
        }),
        evidence: [
          ...current.evidence,
          ...input.failures.map((failure) =>
            evidence({
              check: failure.check,
              outcome: "failed",
              detail: failure.message,
              requirementId: failure.requirementId,
              primaryAgentId: failureByAgentId.has(failure.agentId) ? failure.agentId : null,
              confidence: failure.confidence,
            }),
          ),
        ].slice(-50),
      }),
      events: (current) => [
        ...input.failures.flatMap((failure) => [
          event(current.id, "FAILURE_ATTRIBUTED", `The failed requirement ${failure.requirementId} was traced to its responsible assignment.`),
          event(current.id, "SCORE_UPDATED", "Sisyphus updated the responsible agent score from execution evidence."),
        ]),
        event(current.id, "WORKFLOW_BLOCKED", "The project needs attention after exhausting targeted recovery for an affected requirement."),
      ],
    });
    await Promise.all(
      input.failures.map(async (failure) => {
        const prepared = input.preparedByAgentId.get(failure.agentId);
        const agent = input.coordinator.current().agents.find((candidate) => candidate.id === failure.agentId);
        if (prepared === undefined || agent === undefined) return;
        await this.dependencies.recordSkillOutcome({
          task: input.task,
          agent,
          requirementId: prepared.requirement.id,
          skills: prepared.skills,
          outcome: "failed",
          durationMs: 0,
          evidence: failure.message,
          score: rejectedBeforeSandboxScore(),
        });
      }),
    );
  }

  async #recordExecutionSkillOutcomes(input: {
    readonly task: LeasedEngineeringTask;
    readonly coordinator: TaskOperationCoordinator;
    readonly preparedByAgentId: ReadonlyMap<string, PreparedAssignment>;
    readonly result: ExecutionResult | undefined;
  }): Promise<void> {
    const operation = input.coordinator.current();
    const attributedAgentId = operation.evidence
      .toReversed()
      .find((item) => item.outcome === "failed" && item.primaryAgentId !== null)
      ?.primaryAgentId;
    const durationMs = input.result?.checks.reduce((total, check) => total + check.durationMs, 0) ?? 0;
    if (input.result?.passed) {
      await Promise.all(
        operation.agents.map(async (agent) => {
          const prepared = input.preparedByAgentId.get(agent.id);
          if (prepared === undefined) return;
          await this.dependencies.recordSkillOutcome({
            task: input.task,
            agent,
            requirementId: prepared.requirement.id,
            skills: prepared.skills,
            outcome: "passed",
            durationMs,
            evidence: "The integrated project passed the isolated sandbox acceptance pipeline.",
            score: scoreFromExecution(input.result!),
          });
        }),
      );
      return;
    }
    if (attributedAgentId === undefined || attributedAgentId === null) return;
    const agent = operation.agents.find((candidate) => candidate.id === attributedAgentId);
    const prepared = input.preparedByAgentId.get(attributedAgentId);
    if (agent === undefined || prepared === undefined) return;
    await this.dependencies.recordSkillOutcome({
      task: input.task,
      agent,
      requirementId: prepared.requirement.id,
      skills: prepared.skills,
      outcome: "failed",
      durationMs,
      evidence: "Execution evidence was attributed to this agent with recorded confidence.",
      score: input.result === undefined ? rejectedBeforeSandboxScore() : scoreFromExecution(input.result),
    });
  }

  async #assertExecutionPermitted(): Promise<void> {
    if (!(await this.dependencies.isExecutionPermitted())) {
      throw new EngineeringExecutionStoppedError();
    }
  }
}

function completedResults(
  results: readonly AssignmentResult[],
): readonly Extract<AssignmentResult, { readonly kind: "completed" }>[] {
  return results.filter(
    (result): result is Extract<AssignmentResult, { readonly kind: "completed" }> => result.kind === "completed",
  );
}

function failuresFromResults(
  results: readonly AssignmentResult[],
  preparedByAgentId: ReadonlyMap<string, PreparedAssignment>,
): readonly FailedAssignment[] {
  return results.flatMap((result) => {
    if (result.kind === "completed") return [];
    const prepared = preparedByAgentId.get(result.agentId);
    return [
      {
        agentId: result.agentId,
        requirementId: prepared?.requirement.id ?? "assignment",
        message: result.message,
        check: "Agent assignment",
        confidence: 1,
      },
    ];
  });
}

function reviewFailuresFromResults(results: readonly AssignmentResult[]): readonly ReviewFailure[] {
  return results.flatMap((result) => {
    if (result.kind !== "completed" || result.verification?.verdict !== "failed") return [];
    return result.verification.findings.map((finding) => ({
      reviewerAgentId: result.agentId,
      targetRequirementId: finding.requirementId,
      criterion: finding.criterion,
      evidence: finding.evidence,
      correction: finding.correction,
    }));
  });
}

function hasSecurityReviewFailure(
  failures: readonly ReviewFailure[],
  preparedByAgentId: ReadonlyMap<string, PreparedAssignment>,
): boolean {
  return failures.some((failure) => {
    const reviewer = preparedByAgentId.get(failure.reviewerAgentId);
    return reviewer !== undefined && /\bsecurity\b/iu.test(reviewer.role);
  });
}

function validateReviewVerification(input: {
  readonly phase: PreparedAssignment["phase"];
  readonly verification: AgentReviewVerification | undefined;
  readonly reviewableRequirements: readonly EngineeringRequirement[];
}): readonly string[] {
  if (input.phase !== "review") return [];
  if (input.verification === undefined) {
    return ["The review assignment did not return the required structured verification verdict."];
  }
  if (input.verification.verdict === "passed") return [];
  const allowedRequirementIds = new Set(input.reviewableRequirements.map((requirement) => requirement.id));
  if (allowedRequirementIds.size === 0) {
    return ["The review assignment has no implementation requirement available for failure attribution."];
  }
  return input.verification.findings.flatMap((finding) =>
    allowedRequirementIds.has(finding.requirementId)
      ? []
      : [`Review finding ${finding.criterion} must target an implementation requirement, not the review assignment.`],
  );
}

function newAgent(input: {
  role: string;
  model: string;
  requirementId: string;
  activity: EngineeringActivity;
  detail: string;
}): EngineeringAgentSummary {
  return {
    id: `agent-${randomUUID()}`,
    role: input.role,
    model: input.model,
    requirementIds: [input.requirementId],
    branch: "pending",
    iteration: 1,
    status: "planned",
    activity: input.activity,
    activityDetail: input.detail,
    selectedSkills: [],
    score: null,
    filesChanged: [],
    commitId: null,
    updatedAt: new Date().toISOString(),
  };
}

function replaceAgent(
  operation: EngineeringOperationSummary,
  nextAgent: EngineeringAgentSummary,
): EngineeringOperationSummary {
  return {
    ...operation,
    agents: operation.agents.map((agent) => (agent.id === nextAgent.id ? nextAgent : agent)),
  };
}

function evidence(input: {
  check: string;
  outcome: EngineeringEvidence["outcome"];
  detail: string;
  requirementId?: string | null;
  primaryAgentId?: string | null;
  confidence?: number | null;
}): EngineeringEvidence {
  return {
    requirementId: input.requirementId ?? null,
    check: input.check,
    outcome: input.outcome,
    detail: input.detail,
    primaryAgentId: input.primaryAgentId ?? null,
    attributionConfidence: input.confidence ?? null,
  };
}

function block(
  operation: EngineeringOperationSummary,
  failedEvidence: EngineeringEvidence,
): EngineeringOperationSummary {
  return {
    ...operation,
    status: "blocked",
    agents: operation.agents.map((agent) =>
      agent.id === failedEvidence.primaryAgentId
        ? { ...agent, score: rejectedBeforeSandboxScore(), status: "failed" }
        : agent,
    ),
    evidence: [...operation.evidence, failedEvidence].slice(-50),
  };
}

function projectExecutionResult(
  operation: EngineeringOperationSummary,
  execution: ProjectExecution,
): EngineeringOperationSummary {
  const { executionId, result } = execution;
  if (result === undefined) {
    return block(
      {
        ...operation,
        sandbox: { status: "failed", buildId: executionId, detectedPort: null },
      },
      evidence({
        check: `${execution.backend} result artifact`,
        outcome: "failed",
        detail: `${execution.backend} completed without a structured execution result artifact.`,
      }),
    );
  }
  const primary = operation.agents.find((agent) => !/(?:qa|test)/iu.test(agent.role));
  const sandboxEvidence = result.checks
    .filter((check) => check.status !== "skipped")
    .map((check) =>
      evidence({
        requirementId: check.status === "failed" ? primary?.requirementIds[0] ?? null : null,
        check: check.name,
        outcome: check.status === "passed" ? "passed" : "failed",
        detail:
          check.status === "passed"
            ? `${check.name} completed in ${check.durationMs} ms.`
            : `${check.name} failed with exit code ${check.exitCode ?? "unavailable"}.`,
        primaryAgentId: check.status === "failed" ? primary?.id ?? null : null,
        confidence: check.status === "failed" && primary !== undefined ? 0.45 : null,
      }),
    );
  return {
    ...operation,
    status: result.passed ? "approved" : "blocked",
    requirements: operation.requirements.map((requirement) => ({
      ...requirement,
      status: result.passed ? "passed" : requirement.status,
    })),
    agents: operation.agents.map((agent) => ({
      ...agent,
      score: result.passed || agent.id === primary?.id ? scoreFromExecution(result) : agent.score,
    })),
    sandbox: {
      status: result.passed ? "passed" : "failed",
      buildId: executionId,
      detectedPort: result.detectedPort,
    },
    evidence: [...operation.evidence, ...sandboxEvidence].slice(-50),
  };
}

function executionEvents(
  taskId: string,
  execution: ProjectExecution,
): EngineeringEventSummary[] {
  const { executionId, result } = execution;
  if (result === undefined) {
    return [
      execution.backend === "local-static"
        ? event(taskId, "LOCAL_EXECUTION_STARTED", `Local static executor ${executionId} started a guarded verification run.`)
        : event(taskId, "AWS_SANDBOX_STARTED", `CodeBuild ${executionId} started the isolated sandbox run.`),
      event(taskId, "BUILD_FAILED", `${execution.backend} did not publish the required structured result artifact.`),
      event(taskId, "WORKFLOW_BLOCKED", "The project needs execution evidence before it can be approved."),
    ];
  }
  const events = [
    event(taskId, result.passed ? "BUILD_PASSED" : "BUILD_FAILED", `The ${execution.backend} execution ${result.passed ? "passed" : "reported a failure"}.`),
    ...result.checks.flatMap((check) => {
      if (check.name === "health-check") {
        return [
          event(taskId, "DEV_SERVER_STARTED", execution.backend === "local-static" ? "The local executor started a guarded loopback static server." : "The sandbox started a supervised development server for runtime verification."),
          event(taskId, check.status === "passed" ? "HEALTH_CHECK_PASSED" : "HEALTH_CHECK_FAILED", `Health check ${check.status}.`),
        ];
      }
      if (check.name === "tests" && check.status === "failed") {
        return [event(taskId, "TEST_FAILED", "Automated tests reported a real sandbox failure.")];
      }
      if (check.name === "dependency-security" && check.status === "failed") {
        return [event(taskId, "SECURITY_FAILED", "Dependency security checks failed in the sandbox.")];
      }
      return [];
    }),
  ];
  events.push(
    event(taskId, "SCORE_UPDATED", "Sisyphus updated agent scores from execution evidence."),
    event(taskId, result.passed ? "PROJECT_APPROVED" : "WORKFLOW_BLOCKED", result.passed ? "The integrated project passed the execution acceptance pipeline." : "The project needs attention after execution evidence reported a failure."),
  );
  return events;
}

function event(
  taskId: string,
  type: EngineeringEventType,
  summary: string,
): EngineeringEventSummary {
  return EngineeringEventSummarySchema.parse({
    id: `engineering-event-${randomUUID()}`,
    taskId,
    type,
    occurredAt: new Date().toISOString(),
    summary: summary.slice(0, 500),
    payloadDigest: createHash("sha256").update(`${taskId}\u0000${type}\u0000${summary}`, "utf8").digest("hex"),
  });
}

function scoreFromExecution(result: ExecutionResult): EngineeringScore {
  const status = (names: readonly string[]): number => {
    const checks = result.checks.filter((check) => names.includes(check.name));
    if (checks.length === 0) return 50;
    return Math.round(
      checks.reduce((total, check) => {
        if (check.status === "passed") return total + 100;
        if (check.status === "failed") return total;
        return total + 50;
      }, 0) / checks.length,
    );
  };
  const functional = status(["build", "health-check"]);
  const contractTests = status(["tests"]);
  const security = status(["dependency-security"]);
  const requirementCompliance = result.passed ? 100 : 0;
  const codeQuality = status(["lint", "typecheck", "static-check"]);
  const total = Math.round(
    functional * 0.4 +
      contractTests * 0.25 +
      security * 0.2 +
      requirementCompliance * 0.1 +
      codeQuality * 0.05,
  );
  return { total, functional, contractTests, security, requirementCompliance, codeQuality };
}

function rejectedBeforeSandboxScore(): EngineeringScore {
  return {
    total: 0,
    functional: 0,
    contractTests: 0,
    security: 0,
    requirementCompliance: 0,
    codeQuality: 0,
  };
}

function reviewWarningScore(): EngineeringScore {
  return {
    total: 65,
    functional: 70,
    contractTests: 60,
    security: 80,
    requirementCompliance: 55,
    codeQuality: 65,
  };
}

function reviewFindingScore(): EngineeringScore {
  return {
    total: 80,
    functional: 80,
    contractTests: 85,
    security: 80,
    requirementCompliance: 80,
    codeQuality: 75,
  };
}
