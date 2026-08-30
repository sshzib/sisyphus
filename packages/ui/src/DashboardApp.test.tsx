import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardApp } from "./DashboardApp.js";
import type { DashboardSnapshot } from "./contracts.js";
import type { SisyphusDataClient } from "./data-client.js";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function snapshot(operations: DashboardSnapshot["operations"] = []): DashboardSnapshot {
  return {
    generatedAt: "2026-08-30T10:00:00.000Z",
    workspace: {
      id: "tenant-local",
      name: "Sisyphus Local",
      environment: "Development",
    },
    overview: {
      totalRuns: 0,
      passRate: 0,
      retryRecoveryRate: 0,
      terminalFailures: 0,
      tokensSpent: 0,
      tokenBurnComparison: {
        kind: "unavailable",
        reason: "no-paired-runs",
      },
      averageLatencyMs: 0,
      enforcedShare: 0,
    },
    operations,
    engineering: { operations: [], events: [] },
    runs: [],
    agents: [],
    skills: [],
    conflicts: [],
    integrations: [],
    policies: [],
    audit: [],
    devices: [],
  };
}

function client(value: DashboardSnapshot): SisyphusDataClient {
  return {
    dataSource: { kind: "remote-api" },
    getDashboard: vi.fn(async () => value),
    createEngineeringTask: vi.fn(async () => {
      throw new Error("Task creation is not part of this test client.");
    }),
    clearEngineeringHistory: vi.fn(async () => ({ removedTaskCount: 0, removedEventCount: 0 })),
    restoreSkill: vi.fn(async () => {
      throw new Error("The overview monitor has no mutation controls.");
    }),
    listSkillRegistry: vi.fn(async () => ({ items: [] })),
    getSkillRegistryDetail: vi.fn(async () => {
      throw new Error("The skill is not in this test registry.");
    }),
    syncSkillRegistry: vi.fn(async () => ({
      added: 0,
      updated: 0,
      unchanged: 0,
      total: 0,
      syncedAt: "2026-08-30T10:00:00.000Z",
    })),
    createCustomSkill: vi.fn(async () => {
      throw new Error("Custom skills are not part of this test client.");
    }),
  };
}

function liveOperation(): DashboardSnapshot["operations"][number] {
  return {
    id: "run-auth",
    runId: "run-auth",
    taskSummary: "Prompt aaaaaaaaaaaa",
    project: "identity-service",
    runtime: "codex",
    profile: "local",
    status: "active",
    selectedSkillVersionId: null,
    startedAt: "2026-08-30T09:59:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
    completedAt: null,
    agents: [
      {
        id: "run-auth:root-work",
        agentId: "codex-root:session-auth",
        parentAgentId: null,
        kind: "root",
        role: "orchestrator",
        runtime: "codex",
        profile: "local",
        project: "identity-service",
        workItemId: "root-work",
        status: "active",
        activity: "tool-requested",
        activityDetail: "functions.exec · allowed",
        selectedSkillVersionId: null,
        attempts: 1,
        startedAt: "2026-08-30T09:59:00.000Z",
        lastSeenAt: "2026-08-30T10:00:00.000Z",
        completedAt: null,
      },
      {
        id: "run-auth:frontend-work",
        agentId: "agent-frontend",
        parentAgentId: "codex-root:session-auth",
        kind: "subagent",
        role: "frontend-agent",
        runtime: "codex",
        profile: "local",
        project: "identity-service",
        workItemId: "frontend-work",
        status: "passed",
        activity: "evaluation-completed",
        activityDetail: "Evaluation pass",
        selectedSkillVersionId: null,
        attempts: 1,
        startedAt: "2026-08-30T09:59:15.000Z",
        lastSeenAt: "2026-08-30T09:59:50.000Z",
        completedAt: "2026-08-30T09:59:50.000Z",
      },
    ],
  };
}

function completedEngineeringOperation(): DashboardSnapshot["engineering"]["operations"][number] {
  return {
    id: "task-completed-sisyphus-landing",
    requestSummary: "Build a completed Sisyphus landing page",
    status: "approved",
    createdAt: "2026-08-30T09:59:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
    requirements: [
      {
        id: "REQ-01",
        title: "Sisyphus brand landing page",
        acceptanceCriteria: ["The visible heading includes Sisyphus."],
        status: "completed",
        ownerAgentId: "agent-completed-frontend",
      },
    ],
    agents: [
      {
        id: "agent-completed-frontend",
        role: "frontend",
        model: "qwen/qwen3-coder",
        requirementIds: ["REQ-01"],
        branch: "task/agent-completed-frontend/frontend/attempt-1",
        iteration: 1,
        status: "completed",
        activity: "editing-files",
        activityDetail: "Built the completed Sisyphus landing page.",
        selectedSkills: [],
        score: null,
        filesChanged: ["index.html"],
        commitId: "a".repeat(64),
        updatedAt: "2026-08-30T10:00:00.000Z",
      },
    ],
    safety: { status: "passed", findings: 0 },
    sandbox: { status: "passed", buildId: "local-test", detectedPort: 42123 },
    evidence: [],
  };
}

describe("DashboardApp", () => {
  it("offers an editable task draft without a canned launch control", async () => {
    const dataClient = client(snapshot());
    const user = userEvent.setup();
    render(<DashboardApp client={dataClient} hostContext={{ kind: "web" }} />);

    expect(await screen.findByRole("heading", { name: "Agent operations" })).toBeInTheDocument();
    expect(screen.getByText("No agents are deployed")).toBeInTheDocument();
    expect(screen.getAllByText("Overview")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skills" })).toBeInTheDocument();
    expect(
      screen.queryByText(/Create an authentication page with frontend/u),
    ).not.toBeInTheDocument();

    const taskDraft = screen.getByRole("textbox", { name: "Task draft" });
    await user.type(taskDraft, "Build account recovery with frontend and test agents.");

    expect(taskDraft).toHaveValue(
      "Build account recovery with frontend and test agents.",
    );
    expect(dataClient.restoreSkill).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Token burn" })).toBeInTheDocument();
    expect(screen.getByText("Not measured")).toBeInTheDocument();
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
    expect(screen.queryByText("Policies")).not.toBeInTheDocument();
  });

  it("switches between the dark and light command-center themes", async () => {
    const user = userEvent.setup();
    const { container } = render(<DashboardApp client={client(snapshot())} hostContext={{ kind: "web" }} />);

    const toggle = await screen.findByRole("button", { name: "Switch to light theme" });
    await user.click(toggle);

    expect(toggle).toHaveAccessibleName("Switch to dark theme");
    expect(container.firstElementChild).toHaveClass("sisyphus-app--light");
    expect(window.localStorage.getItem("sisyphus-color-theme")).toBe("light");
  });

  it("shows provider-reported agent roles and real lifecycle states", async () => {
    render(<DashboardApp client={client(snapshot([liveOperation()]))} hostContext={{ kind: "web" }} />);

    expect(await screen.findByText("Prompt aaaaaaaaaaaa")).toBeInTheDocument();
    expect(screen.getByText("Orchestrator")).toBeInTheDocument();
    expect(screen.getByText("Frontend agent")).toBeInTheDocument();
    expect(screen.getAllByText("Working").length).toBeGreaterThan(0);
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("functions.exec · allowed")).toBeInTheDocument();
  });

  it("shows selected skill evidence and the real engineering event log", async () => {
    const value = snapshot();
    value.engineering = {
      operations: [
        {
          id: "task-sisyphus-landing",
          requestSummary: "Build a Sisyphus landing page",
          status: "working",
          createdAt: "2026-08-30T09:59:00.000Z",
          updatedAt: "2026-08-30T10:00:00.000Z",
          requirements: [
            {
              id: "REQ-01",
              title: "Sisyphus brand landing page",
              acceptanceCriteria: ["The visible heading includes Sisyphus."],
              status: "in-progress",
              ownerAgentId: "agent-frontend",
            },
          ],
          agents: [
            {
              id: "agent-frontend",
              role: "frontend",
              model: "qwen/qwen3-coder",
              requirementIds: ["REQ-01"],
              branch: "task/agent-frontend/frontend/attempt-1",
              iteration: 1,
              status: "working",
              activity: "editing-files",
              activityDetail: "Creating the visible Sisyphus landing page.",
              selectedSkills: [
                {
                  id: "frontend-design",
                  name: "Frontend design",
                  skillVersionId: "v1.0.0",
                  contentHash: `sha256:${"a".repeat(64)}`,
                },
              ],
              score: null,
              filesChanged: [],
              commitId: null,
              updatedAt: "2026-08-30T10:00:00.000Z",
            },
          ],
          safety: { status: "not-started", findings: 0 },
          sandbox: { status: "not-started", buildId: null, detectedPort: null },
          evidence: [],
        },
      ],
      events: [
        {
          id: "event-agent-started",
          taskId: "task-sisyphus-landing",
          type: "AGENT_STARTED",
          occurredAt: "2026-08-30T10:00:00.000Z",
          summary: "frontend started iteration 1 for REQ-01.",
          payloadDigest: "a".repeat(64),
        },
        {
          id: "event-skills-selected",
          taskId: "task-sisyphus-landing",
          type: "SKILLS_SELECTED",
          occurredAt: "2026-08-30T09:59:59.000Z",
          summary: "frontend received 1 relevant skill instruction for REQ-01.",
          payloadDigest: "b".repeat(64),
        },
      ],
    };
    const user = userEvent.setup();
    render(<DashboardApp client={client(value)} hostContext={{ kind: "web" }} />);

    expect(await screen.findAllByText(/Skills: Frontend design/u)).toHaveLength(2);
    expect(screen.getByText("Active engineering workforce")).toBeInTheDocument();
    const agentCards = screen.getAllByRole("button", { name: "Inspect Frontend" });
    await user.click(agentCards[0]!);
    expect(screen.getByLabelText("Frontend details")).toBeInTheDocument();
    expect(screen.getByText("Assigned requirements")).toBeInTheDocument();
    expect(screen.getByText("Task event context")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByLabelText("Frontend details")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Live logs/u }));

    expect(screen.getByRole("dialog", { name: "Live workflow logs" })).toBeInTheDocument();
    expect(screen.getByText("frontend started iteration 1 for REQ-01.")).toBeInTheDocument();
    expect(screen.getByText("frontend received 1 relevant skill instruction for REQ-01.")).toBeInTheDocument();
  });

  it("keeps the most recent completed workforce inspectable in Observed Operations", async () => {
    const value = snapshot();
    value.engineering = { operations: [completedEngineeringOperation()], events: [] };
    const user = userEvent.setup();
    render(<DashboardApp client={client(value)} hostContext={{ kind: "web" }} />);

    expect(await screen.findByText("Most recent engineering workforce")).toBeInTheDocument();
    expect(screen.getByText("1 completed specialist")).toBeInTheDocument();
    const agentCards = screen.getAllByRole("button", { name: "Inspect Frontend" });
    await user.click(agentCards[1]!);
    expect(screen.getByLabelText("Frontend details")).toBeInTheDocument();
  });

  it("shows the saved execution folder and deletes only old prompt logs on request", async () => {
    const value = snapshot();
    value.engineering = {
      operations: [completedEngineeringOperation()],
      events: [
        {
          id: "event-archive",
          taskId: "task-completed-sisyphus-landing",
          type: "FILE_CHANGED",
          occurredAt: "2026-08-30T10:00:00.000Z",
          summary: "Saved generated source to execution folder 42.",
          payloadDigest: "c".repeat(64),
        },
      ],
    };
    const dataClient = client(value);
    const clearHistory = vi.mocked(dataClient.clearEngineeringHistory);
    clearHistory.mockResolvedValue({ removedTaskCount: 1, removedEventCount: 1 });
    vi.mocked(dataClient.getDashboard)
      .mockResolvedValueOnce(value)
      .mockResolvedValue({
        ...value,
        engineering: { operations: [], events: [] },
      });
    const user = userEvent.setup();
    render(<DashboardApp client={dataClient} hostContext={{ kind: "web" }} />);

    expect(await screen.findByText(/Sisyphus Executions #42/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete old prompt logs" }));

    expect(clearHistory).toHaveBeenCalledOnce();
    expect(await screen.findByText(/1 old prompt log deleted/u)).toBeInTheDocument();
  });

  it("compares token burn only from a provider-reported run pair", async () => {
    const measured = snapshot();
    measured.overview.tokenBurnComparison = {
      kind: "measured",
      pairId: "account-recovery-comparison",
      source: "provider-reported",
      before: { runId: "run-before", tokens: 15_400 },
      withSisyphus: { runId: "run-with-sisyphus", tokens: 10_200 },
    };

    render(<DashboardApp client={client(measured)} hostContext={{ kind: "web" }} />);

    expect(await screen.findByText("15,400")).toBeInTheDocument();
    expect(screen.getByText("10,200")).toBeInTheDocument();
    expect(screen.getByText("5,200 fewer")).toBeInTheDocument();
    expect(screen.getByText(/provider-reported token usage/u)).toBeInTheDocument();
  });

  it("states the Codex subagent observation limit instead of inventing live starts", async () => {
    render(
      <DashboardApp
        client={client(snapshot())}
        hostContext={{
          kind: "desktop",
          worker: {
            kind: "online",
            version: "0.1.0",
            pendingUploads: 0,
            policyMode: "cloud-managed",
          },
          localEvidence: { kind: "supported" },
          adapterAccess: [{ kind: "paired", runtime: "codex" }],
        }}
      />,
    );

    expect(await screen.findByText("Runtime-limited")).toBeInTheDocument();
    expect(
      screen.getByText(/Codex currently identifies subagents when their stop event arrives/u),
    ).toBeInTheDocument();
  });

  it("keeps retrying after a control-plane read fails", async () => {
    const failingClient: SisyphusDataClient = {
      dataSource: { kind: "remote-api" },
      getDashboard: vi.fn(async () => {
        throw new Error("Connection refused");
      }),
      restoreSkill: vi.fn(async () => {
        throw new Error("Unavailable");
      }),
      createEngineeringTask: vi.fn(async () => {
        throw new Error("Unavailable");
      }),
      clearEngineeringHistory: vi.fn(async () => {
        throw new Error("Unavailable");
      }),
      listSkillRegistry: vi.fn(async () => ({ items: [] })),
      getSkillRegistryDetail: vi.fn(async () => {
        throw new Error("Unavailable");
      }),
      syncSkillRegistry: vi.fn(async () => ({
        added: 0,
        updated: 0,
        unchanged: 0,
        total: 0,
        syncedAt: "2026-08-30T10:00:00.000Z",
      })),
      createCustomSkill: vi.fn(async () => {
        throw new Error("Unavailable");
      }),
    };
    render(<DashboardApp client={failingClient} hostContext={{ kind: "web" }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Connection refused");
    expect(screen.getByText("The live operations backend is unavailable")).toBeInTheDocument();
  });
});
