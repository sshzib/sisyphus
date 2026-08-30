import { useMemo, useState, type KeyboardEvent } from "react";

import type {
  AuditEvent,
  DashboardSnapshot,
  EngineeringAgentSummary,
  EngineeringExecutionBackend,
  EngineeringEventSummary,
  EngineeringModelTier,
  EngineeringOperationSummary,
  LiveAgentSummary,
} from "./contracts.js";
import type { SisyphusDataClient } from "./data-client.js";
import { formatTimestamp, runtimeLabel } from "./format.js";
import { SkillsView } from "./SkillsView.js";

const maximumTaskDraftLength = 4_000;

const processingTiers = ["low", "medium", "high", "max"] as const satisfies readonly EngineeringModelTier[];
type WorkspaceView = "build" | "agents" | "logs" | "skills";
type LogFilter = "all" | "completed" | "attention";

type WorkspaceAgent =
  | {
      readonly kind: "engineering";
      readonly id: string;
      readonly role: string;
      readonly model: string;
      readonly status: EngineeringAgentSummary["status"];
      readonly detail: string;
      readonly iteration: number;
      readonly filesChanged: number;
      readonly score: number | null;
    }
  | {
      readonly kind: "runtime";
      readonly id: string;
      readonly role: string;
      readonly model: string;
      readonly status: LiveAgentSummary["status"];
      readonly detail: string;
      readonly iteration: number;
      readonly filesChanged: number;
      readonly score: number | null;
    };

type WorkspaceLog = {
  readonly id: string;
  readonly occurredAt: string;
  readonly label: string;
  readonly summary: string;
  readonly task: string;
  readonly trace: string;
  readonly tone: "completed" | "attention" | "working";
};

export interface ReferenceDashboardProps {
  readonly client: SisyphusDataClient;
  readonly snapshot: DashboardSnapshot | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly taskDraft: string;
  readonly taskSubmissionMessage: string | undefined;
  readonly submittingTask: boolean;
  readonly onTaskDraftChange: (value: string) => void;
  readonly onTaskSubmit: (modelTier: EngineeringModelTier) => Promise<boolean>;
  readonly execution: DashboardSnapshot["engineering"]["execution"] | undefined;
  readonly canManageExecution: boolean;
  readonly changingExecution: boolean;
  readonly executionMessage: string | undefined;
  readonly onExecutionChange: (next: "running" | "stopped") => void;
  readonly onExecutionBackendChange: (backend: EngineeringExecutionBackend) => void;
  readonly submittedOperation: EngineeringOperationSummary | undefined;
  readonly accountLabel: string | undefined;
  readonly onSignOut: (() => void) | undefined;
}

export function ReferenceDashboard(input: ReferenceDashboardProps) {
  const [view, setView] = useState<WorkspaceView>("build");
  const [tier, setTier] = useState<EngineeringModelTier>("low");
  const [tierOpen, setTierOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const operation = currentEngineeringOperation({
    submitted: input.submittedOperation,
    operations: input.snapshot?.engineering.operations ?? [],
  });
  const projectName = operation?.requestSummary ?? input.snapshot?.workspace.name ?? "Current Workspace";
  const agents = workspaceAgents(input.snapshot, operation);
  const logs = workspaceLogs(input.snapshot);
  const workflowEventCount = input.snapshot?.engineering.events.length ?? 0;

  async function submit(): Promise<void> {
    const created = await input.onTaskSubmit(tier);
    if (created) setView("agents");
  }

  function handleTaskKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="reference-dashboard">
      <aside className="reference-sidebar">
        <div className="reference-brand-row">
          <div className="reference-brand">
            <span className="sisyphus-logo reference-logo" aria-hidden="true" />
            <strong>Sisyphus AI</strong>
          </div>
          <button className="reference-icon-button reference-collapse" type="button" aria-label="Collapse sidebar">
            <Icon name="sidebar" />
          </button>
        </div>

        <button className="reference-workspace" type="button" onClick={() => setView("build")}>
          <span>{truncate(projectName, 26)}</span>
          <Icon name="chevron" />
          <small>Current Workspace</small>
        </button>

        <div className="reference-segmented" aria-label="Workspace content">
          <button className={view !== "skills" ? "is-active" : ""} type="button" onClick={() => setView("build")}>Overview</button>
          <button className={view === "skills" ? "is-active" : ""} type="button" onClick={() => setView("skills")}>Skills</button>
        </div>

        <nav className="reference-nav" aria-label="Workspace navigation">
          <p>Active Agents <Icon name="chevron-up" /></p>
          <button className={view === "build" ? "is-active" : ""} type="button" onClick={() => setView("build")}><Icon name="corner" />Overview</button>
          <button className={view === "agents" ? "is-active" : ""} type="button" onClick={() => setView("agents")}><Icon name="corner" />Active Agents</button>
          <button className={view === "logs" ? "is-active" : ""} type="button" onClick={() => setView("logs")}><Icon name="log" />Live Logs</button>
        </nav>

        <div className="reference-projects">
          <p>Other Projects</p>
          {recentProjectNames(input.snapshot?.engineering.operations ?? []).map((name, index) => (
            <button key={`${name}-${index}`} type="button" onClick={() => setView("agents")}>
              <Icon name="folder" />{truncate(name, 21)}
            </button>
          ))}
        </div>

        <button className="reference-search-button" type="button" onClick={() => setView("logs")}><Icon name="search" />Search <kbd>⌘ K</kbd></button>
      </aside>

      <section className="reference-workspace-shell">
        <header className="reference-topbar">
          <div className="reference-history-controls">
            <button type="button" aria-label="Back"><Icon name="arrow-left" /></button>
            <button type="button" aria-label="Forward"><Icon name="arrow-right" /></button>
          </div>
          <label className="reference-global-search"><Icon name="search" /><input aria-label="Search workspace" placeholder="Search..." /></label>
          <div className="reference-topbar-actions">
            <button className="reference-icon-button" type="button" aria-label="Notifications"><Icon name="bell" /></button>
            <button className="reference-new-workspace" type="button" onClick={() => setView("build")}>New Workspace <Icon name="plus" /></button>
            {input.onSignOut === undefined ? <span className="reference-avatar" aria-hidden="true" /> : <button className="reference-avatar" type="button" aria-label={input.accountLabel === undefined ? "Sign out" : `Sign out ${input.accountLabel}`} onClick={input.onSignOut} />}
          </div>
        </header>

        <main className={`reference-main reference-main--${view}`}>
          {input.loading && input.snapshot === undefined ? <LoadingState /> : null}
          {input.error === undefined ? null : <p className="reference-feed-error" role="alert">Live control-plane data is reconnecting: {input.error}</p>}
          {view === "build" ? (
            <BuildScreen
              draft={input.taskDraft}
              message={input.taskSubmissionMessage}
              submitting={input.submittingTask}
              tier={tier}
              tierOpen={tierOpen}
              onDraftChange={input.onTaskDraftChange}
              onKeyDown={handleTaskKeyDown}
              onSubmit={() => void submit()}
              onTierChange={(next) => { setTier(next); setTierOpen(false); }}
              onTierOpen={() => setTierOpen((open) => !open)}
              automationOpen={automationOpen}
              canManageExecution={input.canManageExecution}
              changingExecution={input.changingExecution}
              execution={input.execution}
              executionMessage={input.executionMessage}
              onAutomationOpen={() => setAutomationOpen((open) => !open)}
              onExecutionBackendChange={input.onExecutionBackendChange}
              onExecutionChange={input.onExecutionChange}
            />
          ) : view === "agents" ? (
            <AgentsScreen agents={agents} operation={operation} generatedAt={input.snapshot?.generatedAt} workflowEventCount={workflowEventCount} />
          ) : view === "logs" ? (
            <LogsScreen logs={logs} />
          ) : (
            <SkillsView client={input.client} />
          )}
          {view === "agents" || view === "logs" ? (
            <FloatingComposer
              draft={input.taskDraft}
              submitting={input.submittingTask}
              tier={tier}
              tierOpen={tierOpen}
              onDraftChange={input.onTaskDraftChange}
              onKeyDown={handleTaskKeyDown}
              onSubmit={() => void submit()}
              onTierChange={(next) => { setTier(next); setTierOpen(false); }}
              onTierOpen={() => setTierOpen((open) => !open)}
              automationOpen={automationOpen}
              canManageExecution={input.canManageExecution}
              changingExecution={input.changingExecution}
              execution={input.execution}
              executionMessage={input.executionMessage}
              onAutomationOpen={() => setAutomationOpen((open) => !open)}
              onExecutionBackendChange={input.onExecutionBackendChange}
              onExecutionChange={input.onExecutionChange}
            />
          ) : null}
        </main>
      </section>
    </div>
  );
}

function BuildScreen(input: ComposerProps) {
  return (
    <section className="reference-build-screen">
      <h1>What do you want to build today?</h1>
      <PromptComposer {...input} centered />
      {input.message === undefined ? null : <p className="reference-composer-message" role="status">{input.message}</p>}
    </section>
  );
}

type ComposerProps = {
  readonly draft: string;
  readonly message: string | undefined;
  readonly submitting: boolean;
  readonly tier: EngineeringModelTier;
  readonly tierOpen: boolean;
  readonly onDraftChange: (value: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onSubmit: () => void;
  readonly onTierChange: (tier: EngineeringModelTier) => void;
  readonly onTierOpen: () => void;
  readonly automationOpen: boolean;
  readonly canManageExecution: boolean;
  readonly changingExecution: boolean;
  readonly execution: DashboardSnapshot["engineering"]["execution"] | undefined;
  readonly executionMessage: string | undefined;
  readonly onAutomationOpen: () => void;
  readonly onExecutionChange: (next: "running" | "stopped") => void;
  readonly onExecutionBackendChange: (backend: EngineeringExecutionBackend) => void;
};

function FloatingComposer(input: Omit<ComposerProps, "message">) {
  return <PromptComposer {...input} message={undefined} />;
}

function PromptComposer({ centered: _centered, ...input }: ComposerProps & { readonly centered?: boolean }) {
  return (
    <div className="reference-composer">
      <textarea
        aria-label="Task draft"
        value={input.draft}
        maxLength={maximumTaskDraftLength}
        disabled={input.submitting}
        onChange={(event) => input.onDraftChange(event.currentTarget.value)}
        onKeyDown={input.onKeyDown}
        placeholder="Describe your project..."
      />
      <div className="reference-composer-footer">
        <div className="reference-composer-left">
          <button className="reference-add-button" type="button" aria-label="Add context"><Icon name="plus" /></button>
          <div className="reference-automation-menu">
            <button className="reference-automation" type="button" aria-expanded={input.automationOpen} onClick={input.onAutomationOpen}><Icon name="bolt" />Automation <Icon name="chevron" /></button>
            {input.automationOpen ? <AutomationPopover input={input} /> : null}
          </div>
        </div>
        <div className="reference-composer-right">
          <div className="reference-tier-menu">
            <button type="button" aria-expanded={input.tierOpen} onClick={input.onTierOpen}>{tierLabel(input.tier)}<Icon name="chevron" /></button>
            {input.tierOpen ? <div className="reference-tier-popover" role="menu">{processingTiers.map((tier) => <button className={tier === input.tier ? "is-selected" : ""} key={tier} type="button" onClick={() => input.onTierChange(tier)} role="menuitem"><Icon name={tierIcon(tier)} />{tierLabel(tier)}</button>)}</div> : null}
          </div>
          <button className="reference-icon-button" type="button" aria-label="Voice input"><Icon name="mic" /></button>
          <button className="reference-send-button" type="button" aria-label="Submit build request" disabled={input.submitting || input.draft.trim().length < 20} onClick={input.onSubmit}><Icon name="send" /></button>
        </div>
      </div>
    </div>
  );
}

function AutomationPopover({ input }: { readonly input: ComposerProps }) {
  const execution = input.execution;
  const status = execution?.status ?? "stopped";
  const nextStatus = status === "running" ? "stopped" : "running";
  return (
    <div className="reference-automation-popover" role="dialog" aria-label="Execution controls">
      <div><strong>Execution control</strong><span className={`reference-execution-state reference-execution-state--${status}`}>{status === "running" ? "Running" : "Stopped"}</span></div>
      <label>Execution backend
        <select
          aria-label="Execution backend"
          disabled={!input.canManageExecution || input.changingExecution}
          value={execution?.backend ?? "local-static"}
          onChange={(event) => {
            const backend = executionBackendFrom(event.currentTarget.value);
            if (backend !== undefined) input.onExecutionBackendChange(backend);
          }}
        >
          <option value="local-static">Local static fallback</option>
          <option value="codebuild">AWS CodeBuild sandbox</option>
        </select>
      </label>
      <button
        className="reference-execution-button"
        disabled={!input.canManageExecution || input.changingExecution}
        type="button"
        onClick={() => input.onExecutionChange(nextStatus)}
      >
        {input.changingExecution ? "Updating…" : nextStatus === "running" ? "Start execution" : "Stop execution"}
      </button>
      {input.executionMessage === undefined ? null : <p>{input.executionMessage}</p>}
    </div>
  );
}

function AgentsScreen(input: {
  readonly agents: readonly WorkspaceAgent[];
  readonly operation: EngineeringOperationSummary | undefined;
  readonly generatedAt: string | undefined;
  readonly workflowEventCount: number;
}) {
  const working = input.agents.filter((agent) => isWorking(agent.status));
  const attention = input.agents.filter((agent) => needsAttention(agent.status));
  const completed = input.agents.filter((agent) => isCompleted(agent.status));
  const filesChanged = input.agents.reduce((sum, agent) => sum + agent.filesChanged, 0);
  const evidenceCount = input.operation?.evidence.length ?? 0;
  const request = input.operation?.requirements.length ?? 0;
  return (
    <section className="reference-content reference-agents-screen">
      <header className="reference-page-heading"><h1>Agents Overview</h1><div><span className="reference-live-pill">Live View</span><small>Last Updated: {input.generatedAt === undefined ? "—" : formatTimestamp(input.generatedAt)}</small></div></header>
      <div className="reference-stat-grid">
        <StatCard label="Active Agents" value={input.agents.length} tone="green" detail={`${completed.length} completed`} />
        <StatCard label="Agents Working" value={working.length} tone="red" detail={working.length === 0 ? "No agents currently running" : "Live assignments in progress"} />
        <StatCard label="Inefficient Agents" value={attention.length} tone="green" detail={attention.length === 0 ? "No agents need recovery" : "Retrying or need attention"} />
      </div>
      <div className="reference-agents-grid">
        <section className="reference-table-card reference-agent-table-card">
          <div className="reference-table-header reference-agent-head"><span /><span>Agent</span><span>Role</span><span>Model Used</span></div>
          <div className="reference-table-body">
            {input.agents.length === 0 ? <p className="reference-empty-row">Submit a build request to deploy the workforce.</p> : input.agents.slice(0, 7).map((agent, index) => <AgentRow agent={agent} index={index} key={agent.id} />)}
          </div>
          <footer className="reference-table-footer"><span>{input.agents.length === 0 ? "No agents yet" : `1 to ${Math.min(input.agents.length, 7)} of ${input.agents.length} agents`}</span><span>Prev <strong>Next <Icon name="arrow-right" /></strong></span></footer>
        </section>
        <section className="reference-table-card reference-usage-card">
          <div className="reference-table-header"><span>Usage Type</span><span>Amount</span></div>
          <div className="reference-usage-list">
            <UsageRow label="Workflow events" value={input.workflowEventCount} />
            <UsageRow label="Requirements" value={request} />
            <UsageRow label="Files changed" value={filesChanged} />
            <UsageRow label="Evidence checks" value={evidenceCount} />
            <UsageRow label="Completed agents" value={completed.length} />
          </div>
          <footer className="reference-usage-total"><span><Icon name="coin" />Latest status</span><strong>{input.operation?.status ?? "No task"}</strong></footer>
        </section>
      </div>
      <section className="reference-efficiency-card">
        <div><h2>Workflow Evidence</h2><p>Real task and agent data from the Sisyphus control plane.</p></div>
        <div className="reference-evidence-bars"><EvidenceBar label="Assigned specialists" value={input.agents.length} max={13} /><EvidenceBar label="Completed work" value={completed.length} max={Math.max(input.agents.length, 1)} /></div>
      </section>
    </section>
  );
}

function StatCard(input: { readonly label: string; readonly value: number; readonly tone: "green" | "red"; readonly detail: string }) {
  return <article className="reference-stat-card"><span>{input.label}</span><button type="button" aria-label={`${input.label} options`}>⋮</button><strong>{input.value}</strong><p className={`reference-stat-detail reference-stat-detail--${input.tone}`}><Icon name={input.tone === "green" ? "trend-up" : "trend-down"} />{input.detail}</p><svg aria-hidden="true" viewBox="0 0 112 48"><path d={input.tone === "green" ? "M2 39C20 37 22 13 42 17s20 21 37 12S94 2 110 6" : "M2 5c19 0 17 30 37 34s26-20 41-10 20 13 30 16"} /></svg></article>;
}

function AgentRow({ agent, index }: { readonly agent: WorkspaceAgent; readonly index: number }) {
  return <article className="reference-agent-row"><span className="reference-row-grip">⠿</span><span className={`reference-agent-orb reference-agent-orb--${index % 4}`} /><div><strong>{titleCase(agent.role)}</strong><small className={`reference-status reference-status--${statusTone(agent.status)}`}>{statusLabel(agent.status)}</small></div><span>{agent.kind === "engineering" ? agent.detail : titleCase(agent.role)}</span><span>{agent.model}</span></article>;
}

function UsageRow({ label, value }: { readonly label: string; readonly value: number }) {
  return <div><span><i aria-hidden="true" />{label}</span><strong>{value.toLocaleString("en-US")}</strong></div>;
}

function EvidenceBar({ label, value, max }: { readonly label: string; readonly value: number; readonly max: number }) {
  const width = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return <div className="reference-evidence-bar"><span>{label}</span><div><i style={{ width: `${width}%` }} /></div><strong>{value}</strong></div>;
}

function LogsScreen({ logs }: { readonly logs: readonly WorkspaceLog[] }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const [ascending, setAscending] = useState(false);
  const [showTrace, setShowTrace] = useState(true);
  const filtered = useMemo(() => logs.filter((log) => {
    const matchesFilter = filter === "all" || (filter === "completed" ? log.tone === "completed" : log.tone === "attention");
    const term = query.trim().toLocaleLowerCase();
    return matchesFilter && (term.length === 0 || `${log.label} ${log.summary} ${log.task}`.toLocaleLowerCase().includes(term));
  }).sort((left, right) => ascending ? Date.parse(left.occurredAt) - Date.parse(right.occurredAt) : Date.parse(right.occurredAt) - Date.parse(left.occurredAt)), [ascending, filter, logs, query]);
  return (
    <section className="reference-content reference-logs-screen">
      <header className="reference-logs-heading"><h1>Live Logs <small>{logs.length}</small></h1><div><button className={filter === "attention" ? "is-active" : ""} type="button" onClick={() => setFilter((current) => current === "attention" ? "all" : "attention")}><Icon name="filter" />Filter</button><button type="button" onClick={() => setAscending((current) => !current)}><Icon name="sort" />Sort</button><button className={showTrace ? "is-active" : ""} type="button" onClick={() => setShowTrace((current) => !current)}><Icon name="columns" />Columns</button><label><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search..." aria-label="Search live logs" /></label></div></header>
      <section className="reference-log-table">
        <div className="reference-log-head"><span>Log Level</span><span>Member</span><span>Log</span>{showTrace ? <span>Trace</span> : null}<span>Time</span></div>
        {filtered.length === 0 ? <p className="reference-empty-row">No audit events match this view.</p> : filtered.map((log, index) => <article className="reference-log-row" key={log.id}><span className={`reference-log-level reference-log-level--${log.tone}`}><i />{log.label}</span><span className={`reference-agent-orb reference-agent-orb--${index % 4}`} /><div><strong>{log.task}</strong><p>{log.summary}</p></div>{showTrace ? <button className="reference-trace" type="button" onClick={() => void copyTrace(log.trace)} title="Copy event trace">{shortTrace(log.trace)}</button> : null}<time dateTime={log.occurredAt}>{formatTimestamp(log.occurredAt)}</time></article>)}
        <footer className="reference-table-footer"><span>{filtered.length} visible audit event{filtered.length === 1 ? "" : "s"}</span><span>Live refresh enabled</span></footer>
      </section>
    </section>
  );
}

function LoadingState() { return <div className="reference-loading" aria-live="polite">Connecting to Sisyphus…</div>; }

function newestEngineeringOperation(operations: readonly EngineeringOperationSummary[]): EngineeringOperationSummary | undefined {
  return [...operations].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).at(0);
}

function currentEngineeringOperation(input: {
  readonly submitted: EngineeringOperationSummary | undefined;
  readonly operations: readonly EngineeringOperationSummary[];
}): EngineeringOperationSummary | undefined {
  const submitted = input.submitted;
  if (submitted !== undefined) {
    return input.operations.find((operation) => operation.id === submitted.id) ?? submitted;
  }
  return newestEngineeringOperation(input.operations);
}

function workspaceAgents(snapshot: DashboardSnapshot | undefined, operation: EngineeringOperationSummary | undefined): readonly WorkspaceAgent[] {
  if (operation !== undefined) return operation.agents.map((agent) => ({ kind: "engineering", id: agent.id, role: agent.role, model: agent.model, status: agent.status, detail: agent.activityDetail, iteration: agent.iteration, filesChanged: agent.filesChanged.length, score: agent.score?.total ?? null }));
  return (snapshot?.operations ?? []).flatMap((operation) => operation.agents.map((agent) => ({ kind: "runtime", id: agent.id, role: agent.role ?? "Agent", model: runtimeLabel(agent.runtime), status: agent.status, detail: agent.activityDetail, iteration: agent.attempts, filesChanged: 0, score: null })));
}

function workspaceLogs(snapshot: DashboardSnapshot | undefined): readonly WorkspaceLog[] {
  const operationNames = new Map(
    (snapshot?.engineering.operations ?? []).map((operation) => [operation.id, operation.requestSummary]),
  );
  const logs = [
    ...(snapshot?.audit ?? []).map((event) => auditLog(event)),
    ...(snapshot?.engineering.events ?? []).map((event) => engineeringLog(event, operationNames.get(event.taskId))),
  ];
  return logs.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}

function auditLog(event: AuditEvent): WorkspaceLog {
  return { id: event.id, occurredAt: event.occurredAt, label: titleCase(event.action.replaceAll(".", " ")), summary: event.summary, task: event.actor, trace: event.id, tone: event.action === "skill.quarantined" || event.action === "integration.degraded" ? "attention" : event.action === "retry.issued" ? "working" : "completed" };
}

function engineeringLog(event: EngineeringEventSummary, task: string | undefined): WorkspaceLog {
  return {
    id: `engineering-${event.id}`,
    occurredAt: event.occurredAt,
    label: titleCase(event.type.replaceAll("_", " ")),
    summary: event.summary,
    task: task ?? "Engineering task",
    trace: event.payloadDigest,
    tone: engineeringEventTone(event.type),
  };
}

function engineeringEventTone(type: string): WorkspaceLog["tone"] {
  if (/(?:FAILED|BLOCKED|QUARANTINED|EXHAUSTED)/u.test(type)) return "attention";
  if (/(?:STARTED|ASSIGNED|RUNNING|REASSIGNED|RETRY)/u.test(type)) return "working";
  return "completed";
}

function recentProjectNames(operations: readonly EngineeringOperationSummary[]): readonly string[] {
  const names = operations.map((operation) => operation.requestSummary).filter((name, index, all) => all.indexOf(name) === index).slice(0, 2);
  return names.length === 0 ? ["Sisyphus Task Force", "Spotify Landing Page"] : names;
}

function isWorking(status: WorkspaceAgent["status"]): boolean { return status === "working" || status === "active" || status === "retrying" || status === "planned" || status === "waiting" || status === "reassigned"; }
function needsAttention(status: WorkspaceAgent["status"]): boolean { return status === "failed" || status === "blocked" || status === "retrying" || status === "inconclusive"; }
function isCompleted(status: WorkspaceAgent["status"]): boolean { return status === "completed" || status === "passed"; }
function statusTone(status: WorkspaceAgent["status"]): "completed" | "attention" | "working" { return needsAttention(status) ? "attention" : isCompleted(status) ? "completed" : "working"; }
function statusLabel(status: WorkspaceAgent["status"]): string { return titleCase(status.replaceAll("-", " ")); }
function titleCase(value: string): string { return value.replaceAll(/\b[a-z]/gu, (letter) => letter.toUpperCase()); }
function truncate(value: string, limit: number): string { return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`; }
function shortTrace(value: string): string { return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`; }
function tierLabel(tier: EngineeringModelTier): string { switch (tier) { case "low": return "Low Tier"; case "medium": return "Medium Tier"; case "high": return "High Tier"; case "max": return "Max Tier"; default: { const exhaustive: never = tier; return exhaustive; } } }
function tierIcon(tier: EngineeringModelTier): IconName { switch (tier) { case "low": return "leaf"; case "medium": return "cube"; case "high": return "bolt"; case "max": return "flame"; default: { const exhaustive: never = tier; return exhaustive; } } }
function executionBackendFrom(value: string): EngineeringExecutionBackend | undefined { return value === "local-static" || value === "codebuild" ? value : undefined; }
async function copyTrace(trace: string): Promise<void> { await globalThis.navigator.clipboard?.writeText(trace); }

type IconName = "sidebar" | "chevron" | "chevron-up" | "corner" | "log" | "folder" | "search" | "arrow-left" | "arrow-right" | "bell" | "plus" | "bolt" | "mic" | "send" | "leaf" | "cube" | "flame" | "trend-up" | "trend-down" | "filter" | "sort" | "columns" | "coin";
function Icon({ name }: { readonly name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
  switch (name) {
    case "plus": return <svg viewBox="0 0 24 24" {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "chevron": return <svg viewBox="0 0 24 24" {...common}><path d="m7 10 5 5 5-5" /></svg>;
    case "chevron-up": return <svg viewBox="0 0 24 24" {...common}><path d="m7 14 5-5 5 5" /></svg>;
    case "arrow-left": return <svg viewBox="0 0 24 24" {...common}><path d="M19 12H5m6-6-6 6 6 6" /></svg>;
    case "arrow-right": return <svg viewBox="0 0 24 24" {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
    case "search": return <svg viewBox="0 0 24 24" {...common}><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>;
    case "bell": return <svg viewBox="0 0 24 24" {...common}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
    case "sidebar": return <svg viewBox="0 0 24 24" {...common}><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M10 5v14" /></svg>;
    case "corner": return <svg viewBox="0 0 24 24" {...common}><path d="M7 5v12a2 2 0 0 0 2 2h8" /></svg>;
    case "log": return <svg viewBox="0 0 24 24" {...common}><rect x="5" y="5" width="14" height="14" rx="2" /><path d="m8 14 2-2 2 2 4-4" /></svg>;
    case "folder": return <svg viewBox="0 0 24 24" {...common}><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
    case "bolt": return <svg viewBox="0 0 24 24" {...common}><path d="m13 2-8 12h7l-1 8 8-12h-7z" /></svg>;
    case "mic": return <svg viewBox="0 0 24 24" {...common}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
    case "send": return <svg viewBox="0 0 24 24" {...common}><path d="m4 4 16 8-16 8 3-8z" /><path d="M7 12h13" /></svg>;
    case "leaf": return <svg viewBox="0 0 24 24" {...common}><path d="M19 4C9 4 5 9 5 15c0 3 2 5 5 5 6 0 9-6 9-16Z" /><path d="M5 20c3-5 6-7 11-10" /></svg>;
    case "cube": return <svg viewBox="0 0 24 24" {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5 12 12l8-4.5M12 12v9" /></svg>;
    case "flame": return <svg viewBox="0 0 24 24" {...common}><path d="M13 3s4 4 4 9a5 5 0 1 1-10 0c0-3 2-6 4-8 0 4 2 5 2 5s1-3 0-6Z" /></svg>;
    case "trend-up": return <svg viewBox="0 0 24 24" {...common}><path d="M4 16 10 10l4 4 6-7M15 7h5v5" /></svg>;
    case "trend-down": return <svg viewBox="0 0 24 24" {...common}><path d="m4 8 6 6 4-4 6 7m-5 0h5v-5" /></svg>;
    case "filter": return <svg viewBox="0 0 24 24" {...common}><path d="M4 6h16M7 12h10m-7 6h4" /><circle cx="9" cy="6" r="1" /><circle cx="15" cy="12" r="1" /></svg>;
    case "sort": return <svg viewBox="0 0 24 24" {...common}><path d="M5 7h14M8 12h8m-5 5h2" /></svg>;
    case "columns": return <svg viewBox="0 0 24 24" {...common}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M10 5v14M15 5v14" /></svg>;
    case "coin": return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8" /><path d="M14.5 9.5c-.4-.7-1.2-1-2.5-1-1.4 0-2.4.7-2.4 1.8 0 2.7 4.8 1.1 4.8 3.7 0 1.1-1 1.8-2.5 1.8-1.3 0-2.2-.4-2.7-1.2M12 7v10" /></svg>;
    default: { const exhaustive: never = name; return exhaustive; }
  }
}
