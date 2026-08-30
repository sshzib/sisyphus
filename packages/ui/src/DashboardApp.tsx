import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { EngineeringExecutionBackendSchema } from "./contracts.js";
import type {
  AuditEvent,
  DashboardSnapshot,
  EngineeringExecutionBackend,
  EngineeringEventSummary,
  EngineeringOperationSummary,
  HostContext,
  LiveAgentStatus,
  LiveAgentSummary,
  OperationSummary,
  TokenBurnComparison,
} from "./contracts.js";
import type { SisyphusDataClient } from "./data-client.js";
import { formatTimestamp, runtimeLabel } from "./format.js";
import { ReferenceDashboard } from "./ReferenceDashboard.js";
import { SkillsView } from "./SkillsView.js";

const dashboardRefreshMilliseconds = 2_000;
const maximumTaskDraftLength = 4_000;
const themeStorageKey = "sisyphus-color-theme";

type AppTheme = "dark" | "light";

type EngineeringAgentSelection = {
  readonly taskId: string;
  readonly agentId: string;
};

interface DashboardAppProps {
  readonly client: SisyphusDataClient;
  readonly hostContext?: HostContext;
  readonly accountLabel?: string | undefined;
  readonly onSignOut?: (() => void) | undefined;
  readonly readLocalEvidence?: (
    eventId: string,
  ) => Promise<{ readonly evidence: string; readonly digest: string }>;
}

export function DashboardApp({ client, hostContext, accountLabel, onSignOut }: DashboardAppProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>();
  const [submittedOperation, setSubmittedOperation] = useState<EngineeringOperationSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [taskDraft, setTaskDraft] = useState("");
  const [taskSubmissionMessage, setTaskSubmissionMessage] = useState<string>();
  const [submittingTask, setSubmittingTask] = useState(false);
  const [clearingPromptHistory, setClearingPromptHistory] = useState(false);
  const [promptHistoryMessage, setPromptHistoryMessage] = useState<string>();
  const [changingExecution, setChangingExecution] = useState(false);
  const [executionMessage, setExecutionMessage] = useState<string>();
  const [view, setView] = useState<"overview" | "skills">("overview");
  const [theme, setTheme] = useState<AppTheme>("dark");

  useEffect(() => {
    const storedTheme = readStoredTheme();
    if (storedTheme !== undefined) setTheme(storedTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      storeTheme(next);
      return next;
    });
  }, []);

  const submitTask = useCallback(async (): Promise<boolean> => {
    const request = taskDraft.trim();
    if (request.length < 20) {
      setTaskSubmissionMessage("Describe the project in at least 20 characters.");
      return false;
    }
    setSubmittingTask(true);
    setTaskSubmissionMessage(undefined);
    try {
      const response = await client.createEngineeringTask({ request });
      setSubmittedOperation(response.operation);
      setSnapshot((current) =>
        current === undefined
          ? current
          : {
              ...current,
              engineering: {
                ...current.engineering,
                operations: [
                  response.operation,
                  ...current.engineering.operations.filter(
                    (operation) => operation.id !== response.operation.id,
                  ),
                ].slice(0, 20),
              },
            },
      );
      setTaskDraft("");
      setTaskSubmissionMessage("Task accepted. Sisyphus is waiting for the orchestrator to lease it.");
      return true;
    } catch (reason: unknown) {
      setTaskSubmissionMessage(
        reason instanceof Error ? reason.message : "The task could not be created.",
      );
      return false;
    } finally {
      setSubmittingTask(false);
    }
  }, [client, taskDraft]);

  const clearPromptHistory = useCallback(async () => {
    setClearingPromptHistory(true);
    setPromptHistoryMessage(undefined);
    try {
      const result = await client.clearEngineeringHistory();
      const nextSnapshot = await client.getDashboard({});
      setSnapshot(nextSnapshot);
      const removedCount = Math.max(result.removedTaskCount, result.removedEventCount);
      setPromptHistoryMessage(
        removedCount === 0
          ? "There are no completed or paused prompt logs to delete."
          : `${removedCount} old prompt log${removedCount === 1 ? "" : "s"} deleted. Saved execution folders were preserved.`,
      );
    } catch (reason: unknown) {
      setPromptHistoryMessage(
        reason instanceof Error ? reason.message : "Old prompt logs could not be deleted.",
      );
    } finally {
      setClearingPromptHistory(false);
    }
  }, [client]);

  const changeExecution = useCallback(async (next: "running" | "stopped") => {
    setChangingExecution(true);
    setExecutionMessage(undefined);
    try {
      const response = next === "running"
        ? await client.startEngineeringExecution()
        : await client.stopEngineeringExecution();
      const nextSnapshot = await client.getDashboard({});
      setSnapshot(nextSnapshot);
      setExecutionMessage(
        response.execution.status === "running"
          ? "Execution started. The orchestrator can now lease queued tasks."
          : "Execution stopped. Active sandbox builds receive a cancellation request on their next check.",
      );
    } catch (reason: unknown) {
      setExecutionMessage(
        reason instanceof Error ? reason.message : "Engineering execution could not be updated.",
      );
    } finally {
      setChangingExecution(false);
    }
  }, [client]);

  const changeExecutionBackend = useCallback(async (backend: EngineeringExecutionBackend) => {
    setChangingExecution(true);
    setExecutionMessage(undefined);
    try {
      const response = await client.setEngineeringExecutionBackend({ backend });
      const nextSnapshot = await client.getDashboard({});
      setSnapshot(nextSnapshot);
      setExecutionMessage(
        response.execution.backend === "codebuild"
          ? "AWS sandbox selected. Start execution when you are ready to run queued tasks in CodeBuild."
          : "Local static fallback selected. It verifies static sites without running generated commands on this machine.",
      );
    } catch (reason: unknown) {
      setExecutionMessage(
        reason instanceof Error ? reason.message : "The execution backend could not be updated.",
      );
    } finally {
      setChangingExecution(false);
    }
  }, [client]);

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (!active) return;
      refreshTimer = setTimeout(() => void refresh(), dashboardRefreshMilliseconds);
    };
    const refresh = async () => {
      try {
        const nextSnapshot = await client.getDashboard({});
        if (!active) return;
        setSnapshot(nextSnapshot);
        setError(undefined);
      } catch (reason: unknown) {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "The agent operations feed is unavailable.",
        );
      } finally {
        if (active) {
          setLoading(false);
          scheduleRefresh();
        }
      }
    };

    void refresh();
    return () => {
      active = false;
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    };
  }, [client]);

  return (
    <ReferenceDashboard
      accountLabel={accountLabel}
      canManageExecution={snapshot?.engineering.canManageExecution ?? false}
      changingExecution={changingExecution}
      client={client}
      error={error}
      execution={snapshot?.engineering.execution}
      executionMessage={executionMessage}
      loading={loading}
      onExecutionBackendChange={(backend) => void changeExecutionBackend(backend)}
      onExecutionChange={(next) => void changeExecution(next)}
      onSignOut={onSignOut}
      onTaskDraftChange={setTaskDraft}
      onTaskSubmit={submitTask}
      submittedOperation={submittedOperation}
      snapshot={snapshot}
      submittingTask={submittingTask}
      taskDraft={taskDraft}
      taskSubmissionMessage={taskSubmissionMessage}
    />
  );
}

function Overview(input: {
  readonly snapshot: DashboardSnapshot;
  readonly hostContext: HostContext | undefined;
  readonly taskDraft: string;
  readonly onTaskDraftChange: (value: string) => void;
  readonly onTaskSubmit: () => void;
  readonly taskSubmissionMessage: string | undefined;
  readonly submittingTask: boolean;
  readonly onClearPromptHistory: () => void;
  readonly clearingPromptHistory: boolean;
  readonly promptHistoryMessage: string | undefined;
  readonly changingExecution: boolean;
  readonly executionMessage: string | undefined;
  readonly onExecutionChange: (next: "running" | "stopped") => void;
  readonly onExecutionBackendChange: (backend: EngineeringExecutionBackend) => void;
}) {
  const [selectedAgent, setSelectedAgent] = useState<EngineeringAgentSelection>();
  const active = input.snapshot.operations.filter(
    (operation) => operation.status === "active" || operation.status === "retrying",
  );
  const completed = input.snapshot.operations.filter(
    (operation) => operation.status !== "active" && operation.status !== "retrying",
  );
  const activeEngineeringOperations = input.snapshot.engineering.operations.filter((operation) =>
    isActiveEngineeringStatus(operation.status),
  );
  const mostRecentEngineeringOperation = [...input.snapshot.engineering.operations].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )[0];
  const observedEngineeringOperations =
    activeEngineeringOperations.length > 0
      ? activeEngineeringOperations
      : mostRecentEngineeringOperation === undefined
        ? []
        : [mostRecentEngineeringOperation];
  const observedEngineeringAgents = observedEngineeringOperations.flatMap((operation) =>
    operation.agents.map((agent) => ({ operation, agent })),
  );
  const recentAudit = input.snapshot.audit
    .filter(
      (event) =>
        event.action === "event.ingested" ||
        event.action === "retry.issued" ||
        event.action === "evaluation.completed",
    )
    .slice(0, 6);

  return (
    <div className="overview-content">
      <div className="overview-primary">
        <EngineeringWorkforcePanel
          events={input.snapshot.engineering.events}
          operations={input.snapshot.engineering.operations}
          taskDraft={input.taskDraft}
          onTaskDraftChange={input.onTaskDraftChange}
          onTaskSubmit={input.onTaskSubmit}
          taskSubmissionMessage={input.taskSubmissionMessage}
          submittingTask={input.submittingTask}
          onClearPromptHistory={input.onClearPromptHistory}
          clearingPromptHistory={input.clearingPromptHistory}
          promptHistoryMessage={input.promptHistoryMessage}
          execution={input.snapshot.engineering.execution}
          canManageExecution={input.snapshot.engineering.canManageExecution}
          changingExecution={input.changingExecution}
          executionMessage={input.executionMessage}
          onExecutionChange={input.onExecutionChange}
          onExecutionBackendChange={input.onExecutionBackendChange}
          selectedAgent={selectedAgent}
          onAgentSelect={(selection) => setSelectedAgent(selection)}
        />

        <section className="operations-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Runtime telemetry</span>
              <h2>Observed operations</h2>
            </div>
            <span className="panel-count">{active.length + activeEngineeringOperations.flatMap((operation) => operation.agents).length} active</span>
          </div>

          {active.length === 0 && observedEngineeringAgents.length === 0 ? (
            <EmptyOperations context={input.hostContext} />
          ) : (
            <>
              {observedEngineeringAgents.length === 0 ? null : (
                <EngineeringWorkforceObservatory
                  events={input.snapshot.engineering.events}
                  operations={observedEngineeringOperations}
                  mode={activeEngineeringOperations.length > 0 ? "live" : "recent"}
                  selectedAgent={selectedAgent}
                  onAgentSelect={(selection) => setSelectedAgent(selection)}
                />
              )}
              {active.length === 0 ? null : (
                <div className="operation-list">
                  {active.map((operation) => (
                    <OperationCard operation={operation} key={operation.id} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {completed.length === 0 ? null : (
          <section className="operations-panel operations-panel--completed">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Recent outcomes</span>
                <h2>Completed operations</h2>
              </div>
              <span className="panel-count">{completed.length} recorded</span>
            </div>
            <div className="operation-list">
              {completed.slice(0, 5).map((operation) => (
                <OperationCard operation={operation} key={operation.id} />
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="overview-rail">
        <TokenBurnPanel comparison={input.snapshot.overview.tokenBurnComparison} />
        <ObservationPanel snapshot={input.snapshot} context={input.hostContext} />
        <ActivityPanel events={recentAudit} />
      </aside>
    </div>
  );
}

function EngineeringWorkforcePanel(input: {
  readonly events: readonly EngineeringEventSummary[];
  readonly operations: readonly EngineeringOperationSummary[];
  readonly taskDraft: string;
  readonly onTaskDraftChange: (value: string) => void;
  readonly onTaskSubmit: () => void;
  readonly taskSubmissionMessage: string | undefined;
  readonly submittingTask: boolean;
  readonly onClearPromptHistory: () => void;
  readonly clearingPromptHistory: boolean;
  readonly promptHistoryMessage: string | undefined;
  readonly execution: DashboardSnapshot["engineering"]["execution"];
  readonly canManageExecution: boolean;
  readonly changingExecution: boolean;
  readonly executionMessage: string | undefined;
  readonly onExecutionChange: (next: "running" | "stopped") => void;
  readonly onExecutionBackendChange: (backend: EngineeringExecutionBackend) => void;
  readonly selectedAgent: EngineeringAgentSelection | undefined;
  readonly onAgentSelect: (selection: EngineeringAgentSelection | undefined) => void;
}) {
  const [liveLogsOpen, setLiveLogsOpen] = useState(false);
  const active = input.operations.filter((operation) =>
    ["queued", "planning", "working", "integrating", "safety-review", "sandbox-running", "retrying"].includes(
      operation.status,
    ),
  );
  const onTaskKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      input.onTaskSubmit();
    }
  };

  return (
    <>
    <section className="operations-panel engineering-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">AI engineering HR</span>
          <h2>Build request</h2>
        </div>
        <div className="engineering-panel__actions">
          <span className={`status-badge status-badge--${input.execution.status === "running" ? "success" : "danger"}`}>
            Execution {input.execution.status}
          </span>
          {input.canManageExecution ? (
            <>
              <label className="execution-backend-control">
                <span>Run on</span>
                <select
                  aria-label="Execution backend"
                  value={input.execution.backend}
                  disabled={input.changingExecution || input.execution.status === "running"}
                  onChange={(event) => {
                    const backend = EngineeringExecutionBackendSchema.safeParse(event.currentTarget.value);
                    if (backend.success) input.onExecutionBackendChange(backend.data);
                  }}
                >
                  <option value="codebuild">AWS sandbox</option>
                  <option value="local-static">Local static fallback</option>
                </select>
              </label>
              <button
                className="history-clear-button"
                type="button"
                disabled={input.changingExecution}
                onClick={() => input.onExecutionChange(input.execution.status === "running" ? "stopped" : "running")}
              >
                {input.changingExecution
                  ? "Updating execution…"
                  : input.execution.status === "running"
                    ? "Stop execution"
                    : "Start execution"}
              </button>
            </>
          ) : null}
          <button
            className="live-log-button"
            type="button"
            onClick={() => setLiveLogsOpen(true)}
          >
            Live logs <span>{input.events.length}</span>
          </button>
          <button
            className="history-clear-button"
            type="button"
            disabled={input.clearingPromptHistory}
            onClick={input.onClearPromptHistory}
          >
            {input.clearingPromptHistory ? "Deleting logs…" : "Delete old prompt logs"}
          </button>
          <span className="panel-count">{active.length} active</span>
        </div>
      </div>
      <div className="task-draft">
        <label htmlFor="sisyphus-task-draft">Describe the software you want built</label>
        <textarea
          id="sisyphus-task-draft"
          aria-label="Task draft"
          value={input.taskDraft}
          maxLength={maximumTaskDraftLength}
          rows={4}
          placeholder="Build a modern authentication web app with login, registration, protected dashboard, backend API, database persistence, validation and tests…"
          aria-describedby="sisyphus-task-draft-help"
          onChange={(event) => input.onTaskDraftChange(event.currentTarget.value)}
          onKeyDown={onTaskKeyDown}
          disabled={input.submittingTask}
        />
        <div className="task-draft__meta" id="sisyphus-task-draft-help">
          <span>{input.submittingTask ? "Creating task…" : input.execution.status === "stopped" ? `Execution is stopped. New tasks stay queued until an administrator starts ${executionBackendLabel(input.execution.backend)}.` : `Queued tasks run in ${executionBackendLabel(input.execution.backend)}. Press Ctrl/Cmd + Enter to deploy the right specialist workforce.`}</span>
          <span>{input.taskDraft.length}/{maximumTaskDraftLength}</span>
        </div>
        {input.executionMessage === undefined ? null : (
          <p className="task-draft__message" role="status">{input.executionMessage}</p>
        )}
        {input.taskSubmissionMessage === undefined ? null : (
          <p className="task-draft__message" role="status">{input.taskSubmissionMessage}</p>
        )}
      </div>

      {input.operations.length === 0 ? (
        <p className="engineering-empty">No engineering task has been created yet. Sisyphus will only show real assignments, evidence, and sandbox results.</p>
      ) : (
        <div className="engineering-operation-list">
          {input.operations.map((operation) => (
            <EngineeringOperationCard
              events={input.events.filter((event) => event.taskId === operation.id)}
              operation={operation}
              key={operation.id}
              selectedAgent={input.selectedAgent}
              onAgentSelect={input.onAgentSelect}
            />
          ))}
        </div>
      )}
      {input.promptHistoryMessage === undefined ? null : (
        <p className="task-draft__message" role="status">{input.promptHistoryMessage}</p>
      )}
    </section>
    {liveLogsOpen ? (
      <LiveLogsDrawer
        events={input.events}
        operations={input.operations}
        onClose={() => setLiveLogsOpen(false)}
      />
    ) : null}
    </>
  );
}

function EngineeringOperationCard(input: {
  readonly events: readonly EngineeringEventSummary[];
  readonly operation: EngineeringOperationSummary;
  readonly selectedAgent: EngineeringAgentSelection | undefined;
  readonly onAgentSelect: (selection: EngineeringAgentSelection | undefined) => void;
}) {
  const { operation } = input;
  const archiveSlot = executionArchiveSlot(operation, input.events);
  return (
    <article className="engineering-operation-card">
      <div className="operation-card__header">
        <div className="operation-title">
          <span className={`operation-pulse operation-pulse--${engineeringStatusTone(operation.status)}`} />
          <div>
            <h3>{operation.requestSummary}</h3>
            <p>
              {operation.requirements.length} requirements · Safety {operation.safety.status} · {executionLabel(operation)} {operation.sandbox.status}
              {archiveSlot === undefined ? " · Execution folder pending" : ` · Sisyphus Executions #${archiveSlot}`}
            </p>
          </div>
        </div>
        <span className={`status-badge status-badge--${engineeringStatusTone(operation.status)}`}>
          {engineeringStatusLabel(operation.status)}
        </span>
      </div>
      <div className="engineering-agent-roster" aria-label={`Specialists assigned to ${operation.requestSummary}`}>
        {operation.agents.map((agent) => (
          <EngineeringAgentCard
            agent={agent}
            key={agent.id}
            operation={operation}
            selected={isSelectedEngineeringAgent(input.selectedAgent, operation.id, agent.id)}
            onSelect={input.onAgentSelect}
          />
        ))}
      </div>
      {operation.evidence.length === 0 ? null : (
        <div className="engineering-evidence-list">
          {operation.evidence.slice(0, 3).map((evidence, index) => (
            <p key={`${evidence.check}-${index}`}>
              <strong>{evidence.check}</strong> · {evidence.detail}
              {evidence.primaryAgentId === null ? "" : ` · Attribution ${Math.round((evidence.attributionConfidence ?? 0) * 100)}%`}
            </p>
          ))}
        </div>
      )}
      {input.events.length === 0 ? null : (
        <div className="engineering-event-list" aria-label={`Events for ${operation.requestSummary}`}>
          {input.events.slice(0, 5).map((event) => <p key={event.id}>{event.type.replaceAll("_", " ")} · {event.summary}</p>)}
        </div>
      )}
    </article>
  );
}

function EngineeringWorkforceObservatory(input: {
  readonly events: readonly EngineeringEventSummary[];
  readonly operations: readonly EngineeringOperationSummary[];
  readonly mode: "live" | "recent";
  readonly selectedAgent: EngineeringAgentSelection | undefined;
  readonly onAgentSelect: (selection: EngineeringAgentSelection | undefined) => void;
}) {
  const observedAgents = input.operations.flatMap((operation) =>
    operation.agents.map((agent) => ({ operation, agent })),
  );
  const selected = input.selectedAgent === undefined
    ? undefined
    : observedAgents.find(({ operation, agent }) =>
        isSelectedEngineeringAgent(input.selectedAgent, operation.id, agent.id),
      );
  return (
    <div className="observed-engineering-workforce">
      <div className="observed-engineering-workforce__heading">
        <span>{input.mode === "live" ? "Active engineering workforce" : "Most recent engineering workforce"}</span>
        <small>
          {observedAgents.length} {input.mode === "live" ? "live" : "completed"} specialist{observedAgents.length === 1 ? "" : "s"}
        </small>
      </div>
      <div
        className="observed-engineering-workforce__grid"
        aria-label={input.mode === "live" ? "Live engineering workforce" : "Most recent engineering workforce"}
      >
        {observedAgents.map(({ operation, agent }) => (
          <EngineeringAgentCard
            agent={agent}
            key={`${operation.id}-${agent.id}`}
            operation={operation}
            selected={isSelectedEngineeringAgent(input.selectedAgent, operation.id, agent.id)}
            onSelect={input.onAgentSelect}
          />
        ))}
      </div>
      {selected === undefined ? null : (
        <EngineeringAgentDetail
          agent={selected.agent}
          events={input.events.filter((event) => event.taskId === selected.operation.id)}
          operation={selected.operation}
          onClose={() => input.onAgentSelect(undefined)}
        />
      )}
    </div>
  );
}

function EngineeringAgentCard(input: {
  readonly agent: EngineeringOperationSummary["agents"][number];
  readonly operation: EngineeringOperationSummary;
  readonly selected: boolean;
  readonly onSelect: (selection: EngineeringAgentSelection | undefined) => void;
}) {
  const { agent, operation } = input;
  return (
    <button
      aria-label={`Inspect ${displayRole(agent.role)}`}
      aria-pressed={input.selected}
      className={`engineering-agent-card engineering-agent-card--interactive${input.selected ? " engineering-agent-card--selected" : ""}`}
      onClick={() => input.onSelect({ taskId: operation.id, agentId: agent.id })}
      type="button"
    >
      <span className="engineering-agent-card__identity">
        <strong>{displayRole(agent.role)}</strong>
        <span>{agent.model} · Iteration {agent.iteration}</span>
      </span>
      <span className={`engineering-agent-card__status engineering-agent-card__status--${agent.status}`}>{agent.status.replaceAll("-", " ")}</span>
      <span className="engineering-agent-card__activity">{agent.activityDetail}</span>
      <span className="engineering-agent-card__skills">
        {agent.selectedSkills.length === 0
          ? "Skills: none selected"
          : `Skills: ${agent.selectedSkills.map((skill) => `${skill.name} · ${compactIdentifier(skill.skillVersionId)}`).join(", ")}`}
      </span>
      <span className="engineering-agent-card__footer">
        <span>{agent.filesChanged.length === 0 ? "No files changed" : `${agent.filesChanged.length} files changed`}</span>
        <span>{agent.score === null ? "Score pending" : `Score ${Math.round(agent.score.total)}`}</span>
      </span>
      {agent.commitId === null ? null : <small>Commit {compactIdentifier(agent.commitId)} · {agent.branch}</small>}
    </button>
  );
}

function EngineeringAgentDetail(input: {
  readonly agent: EngineeringOperationSummary["agents"][number];
  readonly events: readonly EngineeringEventSummary[];
  readonly operation: EngineeringOperationSummary;
  readonly onClose: () => void;
}) {
  const archiveSlot = executionArchiveSlot(input.operation, input.events);
  const requirements = input.operation.requirements.filter((requirement) =>
    input.agent.requirementIds.includes(requirement.id),
  );
  const evidence = input.operation.evidence.filter(
    (item) =>
      item.primaryAgentId === input.agent.id ||
      (item.requirementId !== null && input.agent.requirementIds.includes(item.requirementId)),
  );
  return (
    <section className="engineering-agent-detail" aria-label={`${displayRole(input.agent.role)} details`}>
      <div className="engineering-agent-detail__header">
        <div>
          <span className="panel-kicker">Selected specialist</span>
          <h3>{displayRole(input.agent.role)}</h3>
          <p>{input.agent.model} · Iteration {input.agent.iteration} · {input.agent.status.replaceAll("-", " ")}</p>
        </div>
        <button className="button--quiet" onClick={input.onClose} type="button">Close details</button>
      </div>
      <p className="engineering-agent-detail__activity">{input.agent.activityDetail}</p>
      <div className="engineering-agent-detail__grid">
        <div>
          <h4>Assigned requirements</h4>
          {requirements.length === 0 ? <p>No requirement metadata is available.</p> : (
            <ul>
              {requirements.map((requirement) => (
                <li key={requirement.id}>
                  <strong>{requirement.id} · {requirement.title}</strong>
                  <span>{requirement.acceptanceCriteria.join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4>Selected skills</h4>
          {input.agent.selectedSkills.length === 0 ? <p>No skill instructions were selected.</p> : (
            <ul>
              {input.agent.selectedSkills.map((skill) => (
                <li key={skill.id}><strong>{skill.name}</strong><span>{compactIdentifier(skill.skillVersionId)}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4>Traceability</h4>
          <ul>
            <li><strong>Branch</strong><span>{input.agent.branch}</span></li>
            <li><strong>Commit</strong><span>{input.agent.commitId === null ? "Not committed" : compactIdentifier(input.agent.commitId)}</span></li>
            <li><strong>Files</strong><span>{input.agent.filesChanged.length === 0 ? "No files changed" : input.agent.filesChanged.join(", ")}</span></li>
            {archiveSlot === undefined ? null : <li><strong>Execution folder</strong><span>Sisyphus Executions #{archiveSlot}</span></li>}
            <li><strong>Score</strong><span>{input.agent.score === null ? "Pending evidence" : `${Math.round(input.agent.score.total)}/100`}</span></li>
          </ul>
        </div>
      </div>
      <div className="engineering-agent-detail__evidence">
        <h4>Attributed evidence</h4>
        {evidence.length === 0 ? <p>No evidence is attributed to this specialist yet.</p> : (
          <ul>{evidence.map((item, index) => <li key={`${item.check}-${index}`}><strong>{item.check}</strong><span>{item.detail}</span></li>)}</ul>
        )}
      </div>
      <div className="engineering-agent-detail__events">
        <h4>Task event context</h4>
        <p>These safe events belong to the task. Per-agent activity is shown above from the live assignment record.</p>
        {input.events.length === 0 ? null : <ul>{input.events.slice(0, 4).map((event) => <li key={event.id}><strong>{event.type.replaceAll("_", " ")}</strong><span>{event.summary}</span></li>)}</ul>}
      </div>
    </section>
  );
}

function LiveLogsDrawer(input: {
  readonly events: readonly EngineeringEventSummary[];
  readonly operations: readonly EngineeringOperationSummary[];
  readonly onClose: () => void;
}) {
  const [scope, setScope] = useState<"latest" | "all">("latest");
  const latestTaskId = input.operations[0]?.id;
  const summaries = new Map(input.operations.map((operation) => [operation.id, operation.requestSummary]));
  const events = [...input.events]
    .filter((event) => scope === "all" || latestTaskId === undefined || event.taskId === latestTaskId)
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  return (
    <div className="live-log-layer" role="presentation">
      <section className="live-log-drawer" role="dialog" aria-modal="true" aria-label="Live workflow logs">
        <div className="live-log-drawer__header">
          <div>
            <span className="panel-kicker">Real control-plane events</span>
            <h3>Live logs</h3>
          </div>
          <button className="live-log-close" type="button" onClick={input.onClose} aria-label="Close live logs">Close</button>
        </div>
        <div className="live-log-filters" aria-label="Log scope">
          <button
            className={scope === "latest" ? "live-log-filter live-log-filter--active" : "live-log-filter"}
            type="button"
            onClick={() => setScope("latest")}
          >
            Latest task
          </button>
          <button
            className={scope === "all" ? "live-log-filter live-log-filter--active" : "live-log-filter"}
            type="button"
            onClick={() => setScope("all")}
          >
            All tasks
          </button>
        </div>
        <p className="live-log-note">Safe event summaries update with the live control-plane feed. Prompts, keys, source contents, and hidden reasoning are never shown here.</p>
        {events.length === 0 ? (
          <p className="live-log-empty">No workflow event has been recorded for this scope yet.</p>
        ) : (
          <div className="live-log-list" aria-live="polite">
            {events.map((event) => (
              <article key={event.id}>
                <div>
                  <time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time>
                  <strong>{event.type.replaceAll("_", " ")}</strong>
                </div>
                <p>{event.summary}</p>
                <small>{summaries.get(event.taskId) ?? compactIdentifier(event.taskId)} · Trace {compactIdentifier(event.payloadDigest)}</small>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OperationCard({ operation }: { readonly operation: OperationSummary }) {
  return (
    <article className="operation-card">
      <div className="operation-card__header">
        <div className="operation-title">
          <span className={`operation-pulse operation-pulse--${statusTone(operation.status)}`} />
          <div>
            <h3>{operation.taskSummary}</h3>
            <p>{operation.project} · {runtimeLabel(operation.runtime)}</p>
          </div>
        </div>
        <StatusBadge status={operation.status} />
      </div>

      <div className="operation-meta">
        <span>Run {compactIdentifier(operation.runId)}</span>
        <span>{operation.selectedSkillVersionId ?? "No managed skill"}</span>
        <span>Updated {formatTimestamp(operation.updatedAt)}</span>
      </div>

      <div className="agent-roster" aria-label={`Agents for ${operation.taskSummary}`}>
        {operation.agents.map((agent) => (
          <AgentCard agent={agent} key={agent.id} />
        ))}
      </div>
    </article>
  );
}

function AgentCard({ agent }: { readonly agent: LiveAgentSummary }) {
  return (
    <article className={agent.kind === "root" ? "agent-card agent-card--root" : "agent-card agent-card--subagent"}>
      <div className="agent-card__identity">
        <span className="agent-avatar" aria-hidden="true">{agent.kind === "root" ? "O" : "A"}</span>
        <div>
          <h4>{agentRole(agent)}</h4>
          <p>{compactIdentifier(agent.agentId)}</p>
        </div>
        <StatusBadge status={agent.status} compact />
      </div>
      <div className="agent-card__activity">
        <span>{activityLabel(agent.activity)}</span>
        <strong>{agent.activityDetail}</strong>
      </div>
      <div className="agent-card__footer">
        <span>{agent.attempts === 1 ? "First attempt" : `Attempt ${agent.attempts}`}</span>
        <span>{formatTimestamp(agent.lastSeenAt)}</span>
      </div>
    </article>
  );
}

function TokenBurnPanel({ comparison }: { readonly comparison: TokenBurnComparison }) {
  const measured = comparison.kind === "measured";
  return (
    <section className="rail-panel token-burn-panel">
      <div className="panel-heading panel-heading--compact">
        <div>
          <span className="panel-kicker">Efficiency</span>
          <h2>Token burn</h2>
        </div>
      </div>
      <div className="token-burn-values">
        <div>
          <span>Before Sisyphus</span>
          <strong>{measured ? formatTokenCount(comparison.before.tokens) : "—"}</strong>
        </div>
        <div>
          <span>With Sisyphus</span>
          <strong>{measured ? formatTokenCount(comparison.withSisyphus.tokens) : "—"}</strong>
        </div>
      </div>
      <div className="token-burn-difference">
        <span>Difference</span>
        <strong>{measured ? tokenDifferenceLabel(comparison) : "Not measured"}</strong>
      </div>
      <p className="token-burn-note">
        {measured
          ? "Compared from two compatible runs using provider-reported token usage."
          : tokenComparisonUnavailableMessage(comparison.reason)}
      </p>
    </section>
  );
}

function ObservationPanel(input: {
  readonly snapshot: DashboardSnapshot;
  readonly context: HostContext | undefined;
}) {
  const codexObserved =
    input.snapshot.integrations.some((integration) => integration.runtime === "codex") ||
    (input.context?.kind === "desktop" &&
      input.context.adapterAccess.some((access) => access.runtime === "codex"));
  return (
    <section className="rail-panel">
      <div className="panel-heading panel-heading--compact">
        <div>
          <span className="panel-kicker">Coverage</span>
          <h2>What is observable</h2>
        </div>
      </div>
      <dl className="coverage-facts">
        <div><dt>Root lifecycle</dt><dd className="fact-good">Live</dd></div>
        <div><dt>Tool activity</dt><dd className="fact-good">Live</dd></div>
        <div><dt>Evaluation outcome</dt><dd className="fact-good">Recorded</dd></div>
        <div><dt>Subagent start</dt><dd className={codexObserved ? "fact-warning" : "fact-muted"}>{codexObserved ? "Runtime-limited" : "Awaiting runtime"}</dd></div>
      </dl>
      {codexObserved ? (
        <p className="coverage-note">Codex currently identifies subagents when their stop event arrives. Sisyphus does not fabricate an earlier deployment state.</p>
      ) : null}
    </section>
  );
}

function ActivityPanel({ events }: { readonly events: readonly AuditEvent[] }) {
  return (
    <section className="rail-panel">
      <div className="panel-heading panel-heading--compact">
        <div>
          <span className="panel-kicker">Backend stream</span>
          <h2>Recent activity</h2>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="rail-empty">No agent events have reached the control plane yet.</p>
      ) : (
        <div className="activity-list">
          {events.map((event) => (
            <article key={event.id}>
              <span className={`activity-dot activity-dot--${auditTone(event)}`} />
              <div>
                <p>{event.summary}</p>
                <span>{formatTimestamp(event.occurredAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyOperations(input: {
  readonly context: HostContext | undefined;
}) {
  const { context } = input;
  const workerOnline = context?.kind === "desktop" && context.worker.kind === "online";
  return (
    <div className="empty-operations">
      <div className="empty-orbit" aria-hidden="true"><span /></div>
      <span className="panel-kicker">Waiting for a real task</span>
      <h3>No agents are deployed</h3>
      <p>
        {workerOnline
          ? "The worker is ready. Reported runtime activity will appear here automatically."
          : "Connect the worker and control plane to receive observed runtime activity."}
      </p>
    </div>
  );
}

function LoadingOverview() {
  return (
    <div className="overview-content" aria-label="Loading agent operations">
      <div className="overview-primary">
        <div className="loading-panel"><span /><span /><span /></div>
      </div>
      <div className="overview-rail">
        <div className="loading-panel loading-panel--small"><span /><span /></div>
      </div>
    </div>
  );
}

function UnavailableOverview() {
  return (
    <section className="operations-panel unavailable-panel">
      <span className="panel-kicker">Connection required</span>
      <h2>The live operations backend is unavailable</h2>
      <p>Configure the control-plane URL and access token. Sisyphus will reconnect automatically.</p>
    </section>
  );
}

function Metric(input: {
  readonly label: string;
  readonly value: number;
  readonly tone: "accent" | "ai" | "success" | "danger";
}) {
  return (
    <article className={`operation-metric operation-metric--${input.tone}`}>
      <span>{input.label}</span>
      <strong>{input.value}</strong>
    </article>
  );
}

function StatusBadge({ status, compact = false }: { readonly status: LiveAgentStatus; readonly compact?: boolean }) {
  return (
    <span className={compact ? `status-badge status-badge--${statusTone(status)} status-badge--compact` : `status-badge status-badge--${statusTone(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

function ConnectionSignal(input: {
  readonly context: HostContext | undefined;
  readonly dataSource: SisyphusDataClient["dataSource"]["kind"];
}) {
  if (input.context?.kind === "desktop") {
    if (input.context.worker.kind === "offline") {
      return <><span className="status-dot status-dot--warning" /><div><strong>Worker offline</strong><span>{input.context.worker.reason}</span></div></>;
    }
    return <><span className="status-dot status-dot--active" /><div><strong>Worker online</strong><span>{input.context.worker.pendingUploads} events pending</span></div></>;
  }
  const connected = input.dataSource === "authenticated-session" || input.dataSource === "remote-api";
  return <><span className={connected ? "status-dot status-dot--active" : "status-dot status-dot--warning"} /><div><strong>{connected ? "Control plane connected" : "Control plane required"}</strong><span>{connected ? "Automatic live refresh" : "No sample data loaded"}</span></div></>;
}

function OverviewIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SkillsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4.5 13h6.2L10 22l9.5-12h-6.2L13 2Z" />
    </svg>
  );
}

function ThemeIcon({ theme }: { readonly theme: AppTheme }) {
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.72 5.28l-1.42 1.42M6.7 17.3l-1.42 1.42M18.72 18.72l-1.42-1.42M6.7 6.7 5.28 5.28" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
    </svg>
  );
}

function readStoredTheme(): AppTheme | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return isAppTheme(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function storeTheme(theme: AppTheme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Theme persistence is optional when storage is unavailable.
  }
}

function isAppTheme(value: string | null): value is AppTheme {
  return value === "dark" || value === "light";
}

function operationMetrics(
  operations: readonly OperationSummary[],
  engineeringOperations: readonly EngineeringOperationSummary[],
) {
  const activeEngineering = engineeringOperations.filter((operation) =>
    ["queued", "planning", "working", "integrating", "safety-review", "sandbox-running", "retrying"].includes(
      operation.status,
    ),
  );
  return {
    activeOperations:
      operations.filter((operation) => operation.status === "active" || operation.status === "retrying").length +
      activeEngineering.length,
    activeAgents:
      operations.flatMap((operation) => operation.agents).filter((agent) => agent.status === "active" || agent.status === "retrying").length +
      activeEngineering.flatMap((operation) => operation.agents).filter((agent) => agent.status === "working" || agent.status === "retrying").length,
    completedOperations:
      operations.filter((operation) => operation.status === "passed" || operation.status === "inconclusive").length +
      engineeringOperations.filter((operation) => operation.status === "approved").length,
    failedOperations:
      operations.filter((operation) => operation.status === "failed").length +
      engineeringOperations.filter((operation) => operation.status === "blocked" || operation.status === "rejected").length,
  };
}

function isActiveEngineeringStatus(status: EngineeringOperationSummary["status"]): boolean {
  return ["queued", "planning", "working", "integrating", "safety-review", "sandbox-running", "retrying"].includes(
    status,
  );
}

function isSelectedEngineeringAgent(
  selection: EngineeringAgentSelection | undefined,
  taskId: string,
  agentId: string,
): boolean {
  return selection?.taskId === taskId && selection.agentId === agentId;
}

function executionLabel(operation: EngineeringOperationSummary): string {
  return operation.sandbox.buildId?.startsWith("local-") === true ? "Local execution" : "Sandbox";
}

function executionBackendLabel(backend: EngineeringExecutionBackend): string {
  switch (backend) {
    case "codebuild":
      return "the AWS sandbox";
    case "local-static":
      return "the local static fallback";
    default: {
      const exhaustive: never = backend;
      return exhaustive;
    }
  }
}

function executionArchiveSlot(
  operation: EngineeringOperationSummary,
  events: readonly EngineeringEventSummary[],
): number | undefined {
  const archiveEvent = events.find(
    (event) => event.type === "FILE_CHANGED" && /execution folder\s+\d+/iu.test(event.summary),
  );
  const slot = archiveEvent?.summary.match(/execution folder\s+(\d+)/iu)?.[1];
  if (slot !== undefined) return Number(slot);
  const archiveEvidence = operation.evidence.find((item) => item.check === "Generated source archive");
  const evidenceSlot = archiveEvidence?.detail.match(/[\\/](\d+)\.?$/u)?.[1];
  return evidenceSlot === undefined ? undefined : Number(evidenceSlot);
}

function engineeringStatusLabel(status: EngineeringOperationSummary["status"]): string {
  return status.replaceAll("-", " ").replace(/^./u, (character) => character.toUpperCase());
}

function engineeringStatusTone(
  status: EngineeringOperationSummary["status"],
): "active" | "warning" | "success" | "danger" | "muted" {
  switch (status) {
    case "queued":
    case "planning":
    case "working":
    case "integrating":
    case "sandbox-running":
      return "active";
    case "safety-review":
    case "retrying":
      return "warning";
    case "approved":
      return "success";
    case "blocked":
    case "rejected":
      return "danger";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function displayRole(role: string): string {
  return role.replaceAll(/[-_]+/gu, " ").replace(/^./u, (character) => character.toUpperCase());
}

function statusLabel(status: LiveAgentStatus): string {
  switch (status) {
    case "active": return "Working";
    case "retrying": return "Retrying";
    case "passed": return "Passed";
    case "failed": return "Failed";
    case "inconclusive": return "Inconclusive";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function statusTone(status: LiveAgentStatus): "active" | "warning" | "success" | "danger" | "muted" {
  switch (status) {
    case "active": return "active";
    case "retrying": return "warning";
    case "passed": return "success";
    case "failed": return "danger";
    case "inconclusive": return "muted";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function activityLabel(activity: LiveAgentSummary["activity"]): string {
  switch (activity) {
    case "prompt-received": return "Task received";
    case "tool-requested": return "Using tool";
    case "tool-completed": return "Tool finished";
    case "evaluation-completed": return "Evaluation";
    default: {
      const exhaustive: never = activity;
      return exhaustive;
    }
  }
}

function agentRole(agent: LiveAgentSummary): string {
  if (agent.role === null) return agent.kind === "root" ? "Orchestrator" : "Subagent";
  return agent.role
    .replaceAll(/[-_]+/gu, " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

function compactIdentifier(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function tokenDifferenceLabel(
  comparison: Extract<TokenBurnComparison, { readonly kind: "measured" }>,
): string {
  const difference = comparison.before.tokens - comparison.withSisyphus.tokens;
  if (difference === 0) return "No change";
  return `${formatTokenCount(Math.abs(difference))} ${difference > 0 ? "fewer" : "more"}`;
}

function tokenComparisonUnavailableMessage(
  reason: Extract<TokenBurnComparison, { readonly kind: "unavailable" }>["reason"],
): string {
  switch (reason) {
    case "no-paired-runs":
      return "A compatible before-and-with-Sisyphus run pair is required.";
    case "token-usage-unavailable":
      return "The paired runtime did not report token usage.";
    case "incompatible-runs":
      return "The available runs cannot be compared safely.";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function auditTone(event: AuditEvent): "active" | "warning" | "success" {
  if (event.action === "retry.issued") return "warning";
  if (event.action === "evaluation.completed") return "success";
  return "active";
}
