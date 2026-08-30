import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardApp } from "./DashboardApp.js";
import { ReferenceDashboard } from "./ReferenceDashboard.js";
import type {
  DashboardSnapshot,
  EngineeringOperationSummary,
  SkillRegistryEntry,
} from "./contracts.js";
import type { SisyphusDataClient } from "./data-client.js";

afterEach(() => {
  cleanup();
});

const changedAt = "2026-08-30T10:00:00.000Z";

function engineeringOperation(): EngineeringOperationSummary {
  return {
    id: "task-spotify-landing",
    requestSummary: "Build a Spotify landing page with a polished creator signup flow.",
    status: "working",
    createdAt: "2026-08-30T09:55:00.000Z",
    updatedAt: changedAt,
    requirements: [
      {
        id: "REQ-01",
        title: "Creator signup experience",
        acceptanceCriteria: ["The page supports a clear signup journey."],
        status: "in-progress",
        ownerAgentId: "agent-frontend",
      },
    ],
    agents: [
      {
        id: "agent-frontend",
        role: "frontend engineer",
        model: "GLM 5.2",
        requirementIds: ["REQ-01"],
        branch: "task/spotify/frontend/attempt-1",
        iteration: 1,
        status: "working",
        activity: "editing-files",
        activityDetail: "Building the responsive creator signup surface.",
        selectedSkills: [],
        score: null,
        filesChanged: ["apps/web/app/page.tsx", "styles.css"],
        commitId: null,
        updatedAt: changedAt,
      },
      {
        id: "agent-designer",
        role: "designer",
        model: "Kimi K2",
        requirementIds: ["REQ-01"],
        branch: "task/spotify/designer/attempt-1",
        iteration: 1,
        status: "completed",
        activity: "planning-work",
        activityDetail: "Delivered the visual direction and interaction states.",
        selectedSkills: [],
        score: null,
        filesChanged: ["design-system.md"],
        commitId: "a".repeat(40),
        updatedAt: changedAt,
      },
    ],
    safety: { status: "running", findings: 0 },
    sandbox: { status: "running", buildId: "local-build-1", detectedPort: 3000 },
    evidence: [
      {
        requirementId: "REQ-01",
        check: "Responsive build review",
        outcome: "passed",
        detail: "The primary page layout renders at the required viewports.",
        primaryAgentId: "agent-frontend",
        attributionConfidence: 0.96,
      },
    ],
  };
}

function dashboard(operation: EngineeringOperationSummary | undefined = undefined): DashboardSnapshot {
  return {
    generatedAt: changedAt,
    workspace: { id: "tenant-local", name: "Spotify Landing Page", environment: "Development" },
    overview: {
      totalRuns: 0,
      passRate: 0,
      retryRecoveryRate: 0,
      terminalFailures: 0,
      tokensSpent: 0,
      tokenBurnComparison: { kind: "unavailable", reason: "no-paired-runs" },
      averageLatencyMs: 0,
      enforcedShare: 0,
    },
    operations: [],
    engineering: {
      execution: {
        status: "running",
        backend: "local-static",
        generation: 1,
        changedAt,
        changedBy: "admin",
      },
      canManageExecution: true,
      operations: operation === undefined ? [] : [operation],
      events: operation === undefined
        ? []
        : [
            {
              id: "event-agent-started",
              taskId: operation.id,
              type: "AGENT_STARTED",
              occurredAt: changedAt,
              summary: "The frontend specialist started the creator signup implementation.",
              payloadDigest: "a".repeat(64),
            },
          ],
    },
    runs: [],
    agents: [],
    skills: [],
    conflicts: [],
    integrations: [],
    policies: [],
    audit: operation === undefined
      ? []
      : [
          {
            id: "audit-evaluation-completed",
            occurredAt: "2026-08-30T09:59:00.000Z",
            actor: "quality-gate",
            action: "evaluation.completed",
            summary: "The visual regression audit completed successfully.",
            runtime: "codex",
          },
        ],
    devices: [],
  };
}

function skillRegistry(count = 49): readonly SkillRegistryEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `skill-${number}`,
      name: `Skill ${String(number).padStart(2, "0")}`,
      role: `Engineering role ${number}`,
      description: `Specialized capability ${number} for reliable product delivery.`,
      triggers: ["engineering"],
      category: number % 2 === 0 ? "development" : "planning",
      phase: number % 2 === 0 ? "implementation" : "discovery",
      tags: ["engineering", "demo"],
      source: "upstream",
      baseSkillId: null,
      status: number % 13 === 0 ? "needs-improvement" : "active",
      version: "1.0.0",
      contentDigest: "a".repeat(64),
      sourceUrl: "https://github.com/CODE-SAURABH/OpenSkills",
      license: "MIT",
      lastSyncedAt: changedAt,
      metrics: {
        executions: number,
        failures: 0,
        successRate: number % 3 === 0 ? 100 : null,
        averageRetries: null,
        averageExecutionMs: null,
        lastEvaluatedAt: number % 3 === 0 ? changedAt : null,
        averageScore: number % 3 === 0 ? 100 : null,
      },
    };
  });
}

function dataClient(
  value: DashboardSnapshot,
  createdOperation: EngineeringOperationSummary = engineeringOperation(),
  registry: readonly SkillRegistryEntry[] = [],
): SisyphusDataClient {
  return {
    dataSource: { kind: "remote-api" },
    getDashboard: vi.fn(async () => value),
    createEngineeringTask: vi.fn(async () => ({ operation: createdOperation })),
    clearEngineeringHistory: vi.fn(async () => ({ removedTaskCount: 0, removedEventCount: 0 })),
    startEngineeringExecution: vi.fn(async () => ({
      execution: { status: "running", backend: "local-static", generation: 2, changedAt, changedBy: "admin" },
    })),
    stopEngineeringExecution: vi.fn(async () => ({
      execution: { status: "stopped", backend: "local-static", generation: 2, changedAt, changedBy: "admin" },
    })),
    setEngineeringExecutionBackend: vi.fn(async ({ backend }) => ({
      execution: { status: "stopped", backend, generation: 2, changedAt, changedBy: "admin" },
    })),
    restoreSkill: vi.fn(async () => {
      throw new Error("Skill restoration is not available in this test client.");
    }),
    listSkillRegistry: vi.fn(async () => ({ items: registry })),
    getSkillRegistryDetail: vi.fn(async () => {
      throw new Error("The requested skill does not exist.");
    }),
    syncSkillRegistry: vi.fn(async () => ({
      added: 0,
      updated: 0,
      unchanged: 0,
      total: 0,
      syncedAt: changedAt,
    })),
    previewSkillRegistrySync: vi.fn(async () => ({
      added: 0,
      updated: 0,
      unchanged: 0,
      total: 0,
      localEnhancements: 0,
      sourceRevision: "test",
    })),
    createCustomSkill: vi.fn(async () => {
      throw new Error("Custom skills are not available in this test client.");
    }),
    resolveSkillImprovementProposal: vi.fn(async () => {
      throw new Error("Skill proposals are not available in this test client.");
    }),
  };
}

describe("DashboardApp workspace flow", () => {
  it("opens on the centered build prompt with an editable composer", async () => {
    const user = userEvent.setup();
    render(<DashboardApp client={dataClient(dashboard())} hostContext={{ kind: "web" }} />);

    expect(
      await screen.findByRole("heading", { name: "What do you want to build today?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Workspace" })).toBeInTheDocument();

    const draft = screen.getByRole("textbox", { name: "Task draft" });
    await user.type(draft, "Build an accessible booking site with a responsive search experience.");

    expect(draft).toHaveValue(
      "Build an accessible booking site with a responsive search experience.",
    );
    expect(screen.getByRole("button", { name: "Submit build request" })).toBeEnabled();
  });

  it("opens the requested processing tier menu and applies a selection", async () => {
    const user = userEvent.setup();
    render(<DashboardApp client={dataClient(dashboard())} hostContext={{ kind: "web" }} />);

    await user.click(screen.getByRole("button", { name: "Low Tier" }));
    await user.click(screen.getByRole("menuitem", { name: "High Tier" }));

    expect(screen.getByRole("button", { name: "High Tier" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps start-stop and sandbox selection controls under Automation", async () => {
    const user = userEvent.setup();
    const value = dashboard();
    value.engineering.execution = { ...value.engineering.execution, status: "stopped" };
    const client = dataClient(value);
    render(<DashboardApp client={client} hostContext={{ kind: "web" }} />);

    await user.click(screen.getByRole("button", { name: "Automation" }));
    expect(screen.getByRole("dialog", { name: "Execution controls" })).toBeInTheDocument();
    expect(screen.getByLabelText("Execution backend")).toHaveValue("local-static");
    await user.click(screen.getByRole("button", { name: "Start execution" }));

    expect(client.startEngineeringExecution).toHaveBeenCalledOnce();
  });

  it("submits a prompt through the existing client and transitions to Agents Overview", async () => {
    const user = userEvent.setup();
    const created = engineeringOperation();
    const client = dataClient(dashboard(), created);
    render(<DashboardApp client={client} hostContext={{ kind: "web" }} />);

    await user.type(
      screen.getByRole("textbox", { name: "Task draft" }),
      "Build a responsive Spotify landing page with a creator signup journey.",
    );
    await user.click(screen.getByRole("button", { name: "Submit build request" }));

    expect(client.createEngineeringTask).toHaveBeenCalledWith({
      request: "Build a responsive Spotify landing page with a creator signup journey.",
      modelTier: "low",
    });
    expect(await screen.findByRole("heading", { name: "Agents Overview" })).toBeInTheDocument();
    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Workflow Evidence")).toBeInTheDocument();
  });

  it("replaces a queued submission with its current live operation", async () => {
    const user = userEvent.setup();
    const queued: EngineeringOperationSummary = {
      ...engineeringOperation(),
      status: "queued",
      requirements: [],
      agents: [],
      safety: { status: "not-started", findings: 0 },
      sandbox: { status: "queued", buildId: null, detectedPort: null },
      evidence: [],
    };
    const liveOperation = engineeringOperation();
    const snapshot = dashboard(liveOperation);

    render(
      <ReferenceDashboard
        accountLabel={undefined}
        canManageExecution={true}
        changingExecution={false}
        client={dataClient(snapshot)}
        error={undefined}
        execution={snapshot.engineering.execution}
        executionMessage={undefined}
        loading={false}
        onExecutionBackendChange={() => undefined}
        onExecutionChange={() => undefined}
        onSignOut={undefined}
        onTaskDraftChange={() => undefined}
        onTaskSubmit={async () => false}
        snapshot={snapshot}
        submittedOperation={queued}
        submittingTask={false}
        taskDraft=""
        taskSubmissionMessage={undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Active Agents" }));

    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Latest status").parentElement).toHaveTextContent(/working/u);
  });

  it("submits the tier selected in the composer", async () => {
    const user = userEvent.setup();
    const client = dataClient(dashboard(), engineeringOperation());
    render(<DashboardApp client={client} hostContext={{ kind: "web" }} />);

    await user.click(screen.getByRole("button", { name: "Low Tier" }));
    await user.click(screen.getByRole("menuitem", { name: "High Tier" }));
    await user.type(
      screen.getByRole("textbox", { name: "Task draft" }),
      "Build a responsive project portal with an accessible analytics dashboard.",
    );
    await user.click(screen.getByRole("button", { name: "Submit build request" }));

    expect(client.createEngineeringTask).toHaveBeenCalledWith({
      request: "Build a responsive project portal with an accessible analytics dashboard.",
      modelTier: "high",
    });
  });

  it("shows real workflow and audit data in the full-page Live Logs view", async () => {
    const user = userEvent.setup();
    render(<DashboardApp client={dataClient(dashboard(engineeringOperation()))} hostContext={{ kind: "web" }} />);

    await user.click(await screen.findByRole("button", { name: "Live Logs" }));

    expect(await screen.findByRole("heading", { name: /Live Logs/u })).toBeInTheDocument();
    expect(
      screen.getByText("The visual regression audit completed successfully."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The frontend specialist started the creator signup implementation."),
    ).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search live logs" }), "visual regression");
    expect(
      screen.getByText("The visual regression audit completed successfully."),
    ).toBeInTheDocument();
  });

  it("renders all registered skills in the Active Agents table style with pagination", async () => {
    const user = userEvent.setup();
    render(<DashboardApp client={dataClient(dashboard(), engineeringOperation(), skillRegistry())} hostContext={{ kind: "web" }} />);

    await user.click(await screen.findByRole("button", { name: "Skills" }));

    expect(await screen.findByRole("heading", { name: "Skills Overview" })).toBeInTheDocument();
    expect(screen.getByText("49 skills")).toBeInTheDocument();
    expect(screen.getByText("Showing 49 of 49 skills")).toBeInTheDocument();
    expect(screen.getByText("Skill 01")).toBeInTheDocument();
    expect(screen.queryByText("Skill 11")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByText("Skill 11")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search skills" }), "Skill 37");
    expect(screen.getByText("Showing 1 of 49 skills")).toBeInTheDocument();
    expect(screen.getByText("Skill 37")).toBeInTheDocument();
  });

  it("keeps the workspace usable while the live feed reconnects", async () => {
    const failingClient = dataClient(dashboard());
    vi.mocked(failingClient.getDashboard).mockRejectedValue(new Error("Connection refused"));
    render(<DashboardApp client={failingClient} hostContext={{ kind: "web" }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Connection refused");
    expect(
      screen.getByRole("heading", { name: "What do you want to build today?" }),
    ).toBeInTheDocument();
  });
});
