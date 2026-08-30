import { createHash, randomUUID } from "node:crypto";
import type {
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
import { CodeBuildSandbox } from "./codebuild.js";
import type { OrchestratorConfiguration } from "./config.js";
import {
  ControlPlaneClient,
  type LeasedEngineeringTask,
  type SelectedEngineeringSkill,
} from "./control-plane-client.js";
import { OpenRouterClient } from "./openrouter.js";
import { scanWorkspace } from "./safety-gate.js";
import { WorkspaceManager, type TaskWorkspace } from "./workspaces.js";
import { WorkforceExecution } from "./workforce-execution.js";
import type { ExecutionResult, ProjectExecutor } from "./execution.js";
import { LocalStaticExecutor } from "./local-static-executor.js";

export class EngineeringOrchestrator {
  readonly #controlPlane: ControlPlaneClient;
  readonly #workspaces: WorkspaceManager;
  readonly #openRouter: OpenRouterClient | undefined;
  readonly #sandbox: CodeBuildSandbox | undefined;
  readonly #localExecutor: LocalStaticExecutor;

  public constructor(private readonly configuration: OrchestratorConfiguration) {
    this.#controlPlane = new ControlPlaneClient(
      configuration.apiUrl,
      configuration.orchestratorToken,
      configuration.maxSkillsPerAgent,
    );
    this.#workspaces = new WorkspaceManager(
      configuration.workspaceRoot,
      configuration.executionArchiveRoot,
    );
    this.#openRouter =
      configuration.openRouter.kind === "enabled"
        ? new OpenRouterClient(
            configuration.openRouter.apiKey,
            configuration.openRouter.defaultModel,
            configuration.openRouter.fallbackModel,
            configuration.openRouter.roleModels,
            configuration.maxAgents,
          )
        : undefined;
    this.#sandbox =
      configuration.codebuild === undefined
        ? undefined
        : new CodeBuildSandbox(configuration.codebuild);
    this.#localExecutor = new LocalStaticExecutor();
  }

  public async runOnce(): Promise<boolean> {
    const task = await this.#controlPlane.lease(this.configuration.tenantId);
    if (task === undefined) return false;
    await this.#runTask(task);
    return true;
  }

  async #runTask(task: LeasedEngineeringTask): Promise<void> {
    if (!(await this.#isExecutionPermitted(task))) return;
    const executor = this.#executorFor(task);
    if (executor === undefined) {
      await this.#blockUnavailableCodeBuild(task);
      return;
    }
    if (this.#openRouter === undefined) {
      await this.#runLegacyTask(task);
      return;
    }
    await new WorkforceExecution({
      controlPlane: this.#controlPlane,
      workspaces: this.#workspaces,
      openRouter: this.#openRouter,
      executor,
      isExecutionPermitted: () => this.#isExecutionPermitted(task),
      publish: async (nextTask, operation, events) => this.#publish(nextTask, operation, events),
      recordSkillOutcome: async (input) => this.#recordSkillOutcome(input),
    }).run(task);
  }

  #executorFor(task: LeasedEngineeringTask): ProjectExecutor | undefined {
    switch (task.executionBackend) {
      case "codebuild":
        return this.#sandbox;
      case "local-static":
        return this.#localExecutor;
      default: {
        const exhaustive: never = task.executionBackend;
        return exhaustive;
      }
    }
  }

  async #blockUnavailableCodeBuild(task: LeasedEngineeringTask): Promise<void> {
    const operation = EngineeringOperationSummarySchema.parse({
      ...task.operation,
      status: "blocked",
      safety: { status: "blocked", findings: task.operation.safety.findings },
      sandbox: { status: "blocked", buildId: null, detectedPort: null },
      evidence: [
        ...task.operation.evidence,
        evidence({
          check: "AWS CodeBuild configuration",
          outcome: "blocked",
          detail: "The task selected the AWS sandbox, but this orchestrator has no complete CodeBuild configuration.",
        }),
      ].slice(-50),
    });
    await this.#publish(task, operation, [
      event(operation.id, "WORKFLOW_BLOCKED", "The task selected the AWS sandbox, but this orchestrator is not configured for CodeBuild."),
    ]);
  }

  async #runLegacyTask(task: LeasedEngineeringTask): Promise<void> {
    if (this.#openRouter === undefined) {
      await this.#publish(task, {
        ...task.operation,
        status: "blocked",
        safety: { status: "blocked", findings: 0 },
        sandbox: { status: "blocked", buildId: null, detectedPort: null },
        evidence: [
          evidence({
            check: "OpenRouter configuration",
            outcome: "blocked",
            detail: "The orchestrator has no OpenRouter credential and model configuration.",
          }),
        ],
      }, [event(task.operation.id, "WORKFLOW_BLOCKED", "OpenRouter configuration is required before agents can be hired.")]);
      return;
    }

    let workspace: TaskWorkspace | undefined;
    try {
      const planned = await this.#openRouter.plan(task.request);
      let operation = EngineeringOperationSummarySchema.parse({
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
      const planningEvents = [
        event(operation.id, "SPECIFICATION_CREATED", "Sisyphus created a requirement specification from the request."),
      ];
      const assignments = planned.plan.requirements.map((requirement) =>
        newAgent({
          taskId: operation.id,
          role: requirement.specialistRole,
          model: this.#openRouter?.modelForRole(requirement.specialistRole) ?? "unconfigured",
          requirementId: requirement.id,
          activity: "planning-work",
          detail: "Waiting for an isolated workspace.",
        }),
      );
      operation = {
        ...operation,
        requirements: operation.requirements.map((requirement, index) => ({
          ...requirement,
          ownerAgentId: assignments[index]?.id ?? null,
        })),
        agents: assignments,
      };
      await this.#publish(operationTask(task, operation), operation, [
        ...planningEvents,
        event(operation.id, "AGENTS_HIRED", `Sisyphus assigned ${assignments.length} specialist agents from the requirement plan.`),
      ]);

      workspace = await this.#workspaces.createTaskWorkspace(operation.id);
      const branches: string[] = [];
      const skillsByAgentId = new Map<string, readonly SelectedEngineeringSkill[]>();
      for (const initialAgent of operation.agents) {
        const requirement = operation.requirements.find(
          (candidate) => candidate.id === initialAgent.requirementIds[0],
        );
        if (requirement === undefined) {
          throw new Error("An engineering assignment is missing its requirement.");
        }
        const selectedSkills = await this.#controlPlane
          .selectSkills({
            tenantId: task.tenantId,
            request: task.request,
            role: initialAgent.role,
            requirement,
            phase: /(?:qa|quality|review|test|security)/iu.test(initialAgent.role) ? "review" : "build",
          })
          .catch(() => []);
        skillsByAgentId.set(initialAgent.id, selectedSkills);
        if (selectedSkills.length > 0) {
          await this.#publish(operationTask(task, operation), operation, [
            event(
              operation.id,
              "SKILLS_SELECTED",
              `${initialAgent.role} received ${selectedSkills.length} relevant skill instructions for ${requirement.id}.`,
            ),
          ]);
        }
        const completed = await this.#runAssignment({
          task,
          workspace,
          operation,
          agent: initialAgent,
          requirement,
          skills: selectedSkills,
        });
        operation = completed.operation;
        if (completed.branch === undefined) {
          return;
        }
        branches.push(completed.branch);
      }

      operation = { ...operation, status: "integrating" };
      await this.#publish(operationTask(task, operation), operation, [
        event(operation.id, "INTEGRATION_STARTED", "Sisyphus began merging specialist branches into an isolated integration workspace."),
      ]);
      const integration = await this.#workspaces.integrate({ task: workspace, branches });
      if (integration.kind === "conflict") {
        const responsible = operation.agents.find((agent) => agent.branch === integration.branch);
        operation = block(operation, evidence({
          check: "Integration conflict",
          outcome: "failed",
          detail: `The ${integration.branch} branch conflicted in the integration workspace.`,
          primaryAgentId: responsible?.id ?? null,
          confidence: responsible === undefined ? null : 1,
        }));
        await this.#publish(operationTask(task, operation), operation, [
          event(operation.id, "INTEGRATION_CONFLICT", "The integration workspace found a real Git merge conflict."),
          event(operation.id, "FAILURE_ATTRIBUTED", "Integration responsibility was traced from the conflicting branch."),
          event(operation.id, "WORKFLOW_BLOCKED", "Integration needs targeted recovery before the project can continue."),
        ]);
        if (responsible !== undefined) {
          await this.#recordSkillOutcome({
            task,
            agent: responsible,
            requirementId: responsible.requirementIds[0] ?? "integration",
            skills: skillsByAgentId.get(responsible.id) ?? [],
            outcome: "failed",
            durationMs: 0,
            evidence: "The agent branch created a verified integration conflict.",
            score: blockedBeforeSandboxScore(),
          });
        }
        return;
      }

      operation = {
        ...operation,
        status: "safety-review",
        safety: { status: "running", findings: 0 },
      };
      await this.#publish(operationTask(task, operation), operation, [
        event(operation.id, "SAFETY_SCAN_STARTED", "Sisyphus started the generated-project safety gate."),
      ]);
      const safety = await scanWorkspace(integration.workspace);
      if (!safety.passed) {
        operation = block(operation, evidence({
          check: "Safety gate",
          outcome: "failed",
          detail: safety.findings.find((finding) => finding.severity === "critical")?.detail ?? "The safety policy rejected the generated project.",
          primaryAgentId: null,
          confidence: null,
        }));
        operation = {
          ...operation,
          safety: { status: "failed", findings: safety.findings.length },
        };
        await this.#publish(operationTask(task, operation), operation, [
          event(operation.id, "SAFETY_SCAN_FAILED", "The safety gate blocked generated project execution."),
          event(operation.id, "WORKFLOW_BLOCKED", "The safety gate blocked execution until the flagged issue is resolved."),
        ]);
        return;
      }

      operation = {
        ...operation,
        status: "sandbox-running",
        safety: { status: "passed", findings: safety.findings.length },
        sandbox: { status: "queued", buildId: null, detectedPort: null },
      };
      const archive = await this.#workspaces.archiveIntegration(integration.workspace);
      operation = {
        ...operation,
        evidence: [
          ...operation.evidence,
          evidence({
            check: "Generated source archive",
            outcome: "passed",
            detail: `Saved the integrated source to ${archive.directory}.`,
          }),
        ],
      };
      await this.#publish(operationTask(task, operation), operation, [
        event(operation.id, "SAFETY_SCAN_PASSED", "The generated project passed the static safety gate."),
        event(
          operation.id,
          "FILE_CHANGED",
          `Saved generated source to execution folder ${archive.slot}.`,
        ),
      ]);
      if (this.#sandbox === undefined) {
        operation = {
          ...operation,
          status: "blocked",
          sandbox: { status: "blocked", buildId: null, detectedPort: null },
          evidence: [
            ...operation.evidence,
            evidence({
              check: "AWS CodeBuild configuration",
              outcome: "blocked",
              detail: "AWS sandbox settings are required before this project can be executed.",
            }),
          ],
        };
        await this.#publish(operationTask(task, operation), operation, [
          event(operation.id, "WORKFLOW_BLOCKED", "The project passed safety review but awaits AWS sandbox configuration."),
        ]);
        return;
      }

      const sandbox = await this.#sandbox.execute({
        taskId: operation.id,
        integrationCommit: integration.commitId,
        workspace: integration.workspace,
        expectedPlan: safety.executionPlan,
        onExecutionStarted: async ({ executionId }) => {
          operation = {
            ...operation,
            sandbox: { status: "running", buildId: executionId, detectedPort: null },
          };
          await this.#publish(operationTask(task, operation), operation, [
            event(operation.id, "AWS_SANDBOX_STARTED", `CodeBuild ${executionId} accepted the isolated source artifact.`),
            event(operation.id, "BUILD_STARTED", "The trusted sandbox runner started dependency installation and the project build."),
            event(operation.id, "TEST_STARTED", "The trusted sandbox runner will execute the project's declared automated tests."),
          ]);
        },
      });
      operation = projectSandboxResult(operation, sandbox.executionId, sandbox.result);
      const resultEvents = sandboxEvents(operation.id, sandbox.executionId, sandbox.result);
      await this.#publish(operationTask(task, operation), operation, resultEvents);
      const attributedAgentId = operation.evidence
        .toReversed()
        .find((item) => item.outcome === "failed" && item.primaryAgentId !== null)
        ?.primaryAgentId;
      if (sandbox.result?.passed) {
        await Promise.all(
          operation.agents.map((agent) =>
            this.#recordSkillOutcome({
              task,
              agent,
              requirementId: agent.requirementIds[0] ?? "sandbox",
              skills: skillsByAgentId.get(agent.id) ?? [],
              outcome: "passed",
              durationMs: sandbox.result?.checks.reduce(
                (total, check) => total + check.durationMs,
                0,
              ) ?? 0,
              evidence: "The integrated project passed the isolated sandbox acceptance pipeline.",
              score: scoreFromSandbox(sandbox.result!),
            }),
          ),
        );
      } else if (attributedAgentId !== undefined) {
        const agent = operation.agents.find((candidate) => candidate.id === attributedAgentId);
        if (agent !== undefined) {
          await this.#recordSkillOutcome({
            task,
            agent,
            requirementId: agent.requirementIds[0] ?? "sandbox",
            skills: skillsByAgentId.get(agent.id) ?? [],
            outcome: "failed",
            durationMs: sandbox.result?.checks.reduce(
              (total, check) => total + check.durationMs,
              0,
            ) ?? 0,
            evidence: "Sandbox evidence was attributed to this agent with recorded confidence.",
            score: sandbox.result === undefined ? blockedBeforeSandboxScore() : scoreFromSandbox(sandbox.result),
          });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The engineering orchestrator encountered an unknown failure.";
      const operation = block(task.operation, evidence({
        check: "Engineering orchestrator",
        outcome: "failed",
        detail: message.slice(0, 500),
        primaryAgentId: null,
        confidence: null,
      }));
      await this.#publish(task, operation, [
        event(task.operation.id, "WORKFLOW_BLOCKED", "The orchestration workflow paused after an unexpected failure."),
      ]);
    } finally {
      if (workspace !== undefined) {
        await this.#workspaces.cleanup(workspace).catch(() => undefined);
      }
    }
  }

  async #runAssignment(input: {
    task: LeasedEngineeringTask;
    workspace: TaskWorkspace;
    operation: EngineeringOperationSummary;
    agent: EngineeringAgentSummary;
    requirement: EngineeringRequirement;
    skills: readonly SelectedEngineeringSkill[];
  }): Promise<{ operation: EngineeringOperationSummary; branch: string | undefined }> {
    let operation = input.operation;
    let agent = input.agent;
    const startedAt = Date.now();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      agent = {
        ...agent,
        iteration: attempt,
        status: "working",
        activity: "editing-files",
        activityDetail: `Working on ${input.requirement.id} in an isolated branch.`,
        updatedAt: new Date().toISOString(),
      };
      operation = replaceAgent(operation, agent);
      await this.#publish(operationTask(input.task, operation), operation, [
        event(operation.id, "AGENT_STARTED", `${agent.role} started iteration ${attempt} for ${input.requirement.id}.`),
      ]);
      try {
        const proposal = await this.#openRouter?.proposePatch({
          request: input.task.request,
          requirement: input.requirement,
          role: agent.role,
          iteration: attempt,
          skills: input.skills,
        });
        if (proposal === undefined) throw new Error("OpenRouter became unavailable.");
        const change = await this.#workspaces.applyAgentProposal({
          task: input.workspace,
          assignmentId: agent.id,
          role: agent.role,
          iteration: attempt,
          proposal: proposal.proposal,
        });
        agent = {
          ...agent,
          model: proposal.model,
          branch: change.branch,
          status: "completed",
          activity: proposal.proposal.safeActivity,
          activityDetail: proposal.proposal.safeActivityDetail,
          filesChanged: [...change.filesChanged],
          commitId: change.commitId,
          updatedAt: new Date().toISOString(),
        };
        operation = replaceAgent(operation, agent);
        await this.#publish(operationTask(input.task, operation), operation, [
          event(operation.id, "FILE_CHANGED", `${agent.role} committed ${change.filesChanged.length} changed files for ${input.requirement.id}.`),
          event(operation.id, "AGENT_COMPLETED", `${agent.role} completed its isolated assignment.`),
        ]);
        return { operation, branch: change.branch };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message.slice(0, 300) : "The agent did not return an accepted file proposal.";
        agent = {
          ...agent,
          status: attempt === 3 ? "failed" : "retrying",
          activity: "preparing-retry",
          activityDetail: attempt === 3 ? "The third targeted attempt failed." : "Preparing targeted corrective feedback.",
          updatedAt: new Date().toISOString(),
        };
        operation = replaceAgent(operation, agent);
        if (attempt === 3) {
          operation = block(operation, evidence({
            check: `Agent assignment ${input.requirement.id}`,
            outcome: "failed",
            detail: message,
            primaryAgentId: agent.id,
            confidence: 1,
          }));
          await this.#publish(operationTask(input.task, operation), operation, [
            event(operation.id, "FAILURE_ATTRIBUTED", `The failed requirement was traced to ${agent.role}'s assignment and its change branch.`),
            event(operation.id, "SCORE_UPDATED", `${agent.role}'s score was updated from the failed assignment evidence.`),
            event(operation.id, "WORKFLOW_BLOCKED", "The affected requirement needs manual recovery after three targeted attempts."),
          ]);
          await this.#recordSkillOutcome({
            task: input.task,
            agent,
            requirementId: input.requirement.id,
            skills: input.skills,
            outcome: "failed",
            durationMs: Date.now() - startedAt,
            evidence: message,
            score: blockedBeforeSandboxScore(),
          });
          return { operation, branch: undefined };
        }
        operation = { ...operation, status: "retrying" };
        await this.#publish(operationTask(input.task, operation), operation, [
          event(operation.id, "FEEDBACK_GENERATED", `Sisyphus generated focused feedback for ${input.requirement.id}: ${message}`),
          event(operation.id, "AGENT_RETRYING", `${agent.role} is retrying only ${input.requirement.id}.`),
        ]);
        operation = { ...operation, status: "working" };
      }
    }
    return { operation, branch: undefined };
  }

  async #recordSkillOutcome(input: {
    readonly task: LeasedEngineeringTask;
    readonly agent: EngineeringAgentSummary;
    readonly requirementId: string;
    readonly skills: readonly SelectedEngineeringSkill[];
    readonly outcome: "passed" | "failed";
    readonly durationMs: number;
    readonly evidence: string;
    readonly score: EngineeringScore;
  }): Promise<void> {
    if (input.skills.length === 0) return;
    await this.#controlPlane
      .recordSkillExecution({
        tenantId: input.task.tenantId,
        execution: {
          executionId: `${input.task.taskId}:${input.agent.id}:${input.outcome}`,
          skillIds: input.skills.map((skill) => skill.id),
          skillVersions: input.skills.map((skill) => ({
            id: skill.id,
            skillVersionId: skill.skillVersionId,
            contentHash: skill.contentHash,
          })),
          taskId: input.task.taskId,
          agentId: input.agent.id,
          requirementId: input.requirementId,
          model: input.agent.model,
          outcome: input.outcome,
          attempts: input.agent.iteration,
          durationMs: input.durationMs,
          evidence: input.evidence,
          score: input.score,
        },
      })
      .catch(() => undefined);
  }

  async #publish(
    task: LeasedEngineeringTask,
    operation: EngineeringOperationSummary,
    events: readonly EngineeringEventSummary[],
  ): Promise<void> {
    await this.#controlPlane.update({
      tenantId: task.tenantId,
      taskId: task.taskId,
      leaseId: task.leaseId,
      executionGeneration: task.executionGeneration,
      operation,
      events,
    });
  }

  async #isExecutionPermitted(task: LeasedEngineeringTask): Promise<boolean> {
    return this.#controlPlane.permitsExecution({
      tenantId: task.tenantId,
      taskId: task.taskId,
      leaseId: task.leaseId,
      executionGeneration: task.executionGeneration,
    });
  }
}

function operationTask(
  task: LeasedEngineeringTask,
  operation: EngineeringOperationSummary,
): LeasedEngineeringTask {
  return { ...task, taskId: operation.id };
}

function newAgent(input: {
  taskId: string;
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
        ? { ...agent, score: blockedBeforeSandboxScore(), status: "failed" }
        : agent,
    ),
    evidence: [...operation.evidence, failedEvidence].slice(0, 50),
  };
}

function projectSandboxResult(
  operation: EngineeringOperationSummary,
  buildId: string,
  result: ExecutionResult | undefined,
): EngineeringOperationSummary {
  if (result === undefined) {
    return block(
      {
        ...operation,
        sandbox: { status: "failed", buildId, detectedPort: null },
      },
      evidence({
        check: "CodeBuild result artifact",
        outcome: "failed",
        detail: "CodeBuild completed without a structured sandbox result artifact.",
      }),
    );
  }
  const failed = result.checks.find((check) => check.status === "failed");
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
  const next = {
    ...operation,
    status: result.passed ? "approved" : "blocked",
    requirements: operation.requirements.map((requirement) => ({
      ...requirement,
      status: result.passed ? "passed" : requirement.status,
    })),
    agents: operation.agents.map((agent) => ({
      ...agent,
      score:
        result.passed || agent.id === primary?.id
          ? scoreFromSandbox(result)
          : agent.score,
    })),
    sandbox: {
      status: result.passed ? "passed" : "failed",
      buildId,
      detectedPort: result.detectedPort,
    },
    evidence: [...operation.evidence, ...sandboxEvidence].slice(-50),
  } satisfies EngineeringOperationSummary;
  return failed === undefined ? next : next;
}

function sandboxEvents(
  taskId: string,
  buildId: string,
  result: ExecutionResult | undefined,
): EngineeringEventSummary[] {
  if (result === undefined) {
    return [
      event(taskId, "AWS_SANDBOX_STARTED", `CodeBuild ${buildId} started the isolated sandbox run.`),
      event(taskId, "BUILD_FAILED", "CodeBuild did not publish the required structured result artifact."),
      event(taskId, "WORKFLOW_BLOCKED", "The sandbox did not publish enough evidence to continue safely."),
    ];
  }
  const events = [
    event(taskId, result.passed ? "BUILD_PASSED" : "BUILD_FAILED", `The sandbox ${result.passed ? "passed" : "reported a failure"}.`),
    ...result.checks.flatMap((check) => {
      if (check.name === "health-check") {
        return [
          event(taskId, "DEV_SERVER_STARTED", "The sandbox started a supervised development server for runtime verification."),
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
    event(taskId, "SCORE_UPDATED", "Sisyphus updated agent scores from sandbox evidence."),
    event(taskId, result.passed ? "PROJECT_APPROVED" : "WORKFLOW_BLOCKED", result.passed ? "The integrated project passed the sandbox acceptance pipeline." : "The sandbox reported a failure that needs targeted recovery."),
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

function scoreFromSandbox(result: ExecutionResult): EngineeringScore {
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

function blockedBeforeSandboxScore(): EngineeringScore {
  return {
    total: 0,
    functional: 0,
    contractTests: 0,
    security: 0,
    requirementCompliance: 0,
    codeQuality: 0,
  };
}
