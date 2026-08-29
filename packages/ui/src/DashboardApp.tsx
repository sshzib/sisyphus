import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AgentRuntimeSchema,
  type AgentRuntime,
  type AuditEvent,
  type Capability,
  type DashboardSnapshot,
  type EnforcementCoverage,
  type EvaluationResult,
  type HostContext,
  type IntegrationSummary,
  type RunSummary,
  type SkillSummary,
} from "./contracts.js";
import type { SisyphusDataClient } from "./client.js";
import {
  attributionLabel,
  enforcementLabel,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTimestamp,
  resultLabel,
  runtimeLabel,
} from "./format.js";

type Section =
  | "overview"
  | "runs"
  | "agents"
  | "skills"
  | "conflicts"
  | "integrations"
  | "policies"
  | "audit"
  | "devices";

const sections: { id: Section; label: string; glyph: string }[] = [
  { id: "overview", label: "Overview", glyph: "OV" },
  { id: "runs", label: "Runs", glyph: "RU" },
  { id: "agents", label: "Agents", glyph: "AG" },
  { id: "skills", label: "Skills", glyph: "SK" },
  { id: "conflicts", label: "Conflict matrix", glyph: "CM" },
  { id: "integrations", label: "Integrations", glyph: "IN" },
  { id: "policies", label: "Policies", glyph: "PO" },
  { id: "audit", label: "Audit log", glyph: "AU" },
  { id: "devices", label: "Devices", glyph: "DE" },
];

const runtimeOptions: AgentRuntime[] = [
  "codex",
  "claude-code",
  "cursor",
  "opencode",
];

interface DashboardAppProps {
  client: SisyphusDataClient;
  hostContext?: HostContext;
  readLocalEvidence?: (
    eventId: string,
  ) => Promise<{ readonly evidence: string; readonly digest: string }>;
}

export function DashboardApp({ client, hostContext, readLocalEvidence }: DashboardAppProps) {
  const [section, setSection] = useState<Section>("overview");
  const [runtime, setRuntime] = useState<AgentRuntime | undefined>();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<SkillSummary>();
  const [restoreReason, setRestoreReason] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [evidenceTarget, setEvidenceTarget] = useState<RunSummary>();
  const [evidenceText, setEvidenceText] = useState<string>();
  const [evidenceError, setEvidenceError] = useState<string>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void client
      .getDashboard(runtime === undefined ? {} : { runtime })
      .then((nextSnapshot) => {
        if (active) {
          setSnapshot(nextSnapshot);
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Dashboard data is unavailable.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client, refreshKey, runtime]);

  const navigate = useCallback((nextSection: Section) => {
    setSection(nextSection);
    setMobileNavigationOpen(false);
  }, []);

  function updateRuntime(value: string) {
    if (value === "all") {
      setRuntime(undefined);
      return;
    }
    const parsed = AgentRuntimeSchema.safeParse(value);
    if (parsed.success) {
      setRuntime(parsed.data);
    }
  }

  async function submitRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (restoreTarget === undefined || restoreReason.trim().length < 8) {
      return;
    }
    setRestoring(true);
    setError(undefined);
    try {
      await client.restoreSkill(restoreTarget.skillVersionId, { reason: restoreReason.trim() });
      setRestoreTarget(undefined);
      setRestoreReason("");
      setRefreshKey((value) => value + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The skill could not be restored.");
    } finally {
      setRestoring(false);
    }
  }

  async function inspectEvidence(run: RunSummary) {
    if (readLocalEvidence === undefined) return;
    setEvidenceTarget(run);
    setEvidenceText(undefined);
    setEvidenceError(undefined);
    setEvidenceLoading(true);
    try {
      const result = await readLocalEvidence(run.eventId);
      setEvidenceText(result.evidence);
    } catch (reason: unknown) {
      setEvidenceError(
        reason instanceof Error ? reason.message : "Local evidence is unavailable.",
      );
    } finally {
      setEvidenceLoading(false);
    }
  }

  const selectedSectionLabel = useMemo(
    () => sections.find((candidate) => candidate.id === section)?.label ?? "Overview",
    [section],
  );

  return (
    <div className="sisyphus-app">
      <aside className={mobileNavigationOpen ? "side-nav side-nav--open" : "side-nav"}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <div className="brand-name">Sisyphus</div>
            <div className="brand-tagline">Agent operations</div>
          </div>
        </div>

        <nav className="nav-list" aria-label="Dashboard sections">
          {sections.map((item) => (
            <button
              className={item.id === section ? "nav-item nav-item--active" : "nav-item"}
              key={item.id}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <span className="nav-glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span>{item.label}</span>
              {item.id === "skills" && snapshot !== undefined ? (
                <span className="nav-count">
                  {snapshot.skills.filter((skill) => skill.disposition === "quarantined").length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="nav-footer">
          <div className="tenant-avatar" aria-hidden="true">
            {workspaceInitials(snapshot?.workspace.name ?? "Workspace")}
          </div>
          <div>
            <strong>{snapshot?.workspace.name ?? "Workspace"}</strong>
            <span>{snapshot?.workspace.environment ?? "Loading tenant"}</span>
          </div>
        </div>
      </aside>

      {mobileNavigationOpen ? (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNavigationOpen(false)}
          type="button"
        />
      ) : null}

      <main className="main-column">
        <header className="top-bar">
          <div className="top-bar__title">
            <button
              className="menu-button"
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileNavigationOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <div>
              <p>Operations</p>
              <h1>{selectedSectionLabel}</h1>
            </div>
          </div>

          <div className="top-bar__controls">
            <HostStatus context={hostContext} />
            <label className="runtime-filter">
              <span>Runtime</span>
              <select
                aria-label="Runtime"
                value={runtime ?? "all"}
                onChange={(event) => updateRuntime(event.currentTarget.value)}
              >
                <option value="all">All comparable cohorts</option>
                {runtimeOptions.map((option) => (
                  <option value={option} key={option}>
                    {runtimeLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="content-area">
          {error === undefined ? null : (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>
                Retry
              </button>
            </div>
          )}

          {loading || snapshot === undefined ? (
            <LoadingState />
          ) : (
            <DashboardSection
              section={section}
              snapshot={snapshot}
              runtime={runtime}
              onNavigate={navigate}
              onRestore={setRestoreTarget}
              hostContext={hostContext}
              {...(
                hostContext?.kind === "desktop" &&
                hostContext.localEvidence.kind === "supported" &&
                readLocalEvidence !== undefined
                  ? { onInspectEvidence: (run: RunSummary) => void inspectEvidence(run) }
                  : {}
              )}
            />
          )}
        </div>
      </main>

      {restoreTarget === undefined ? null : (
        <div className="modal-layer" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="restore-title">
            <div className="modal-card__heading">
              <div>
                <p className="eyebrow">Administrative action</p>
                <h2 id="restore-title">Restore {restoreTarget.name}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close restore dialog"
                onClick={() => setRestoreTarget(undefined)}
              >
                ×
              </button>
            </div>
            <p className="modal-copy">
              This version will enter probation. Its previous evaluations and quarantine history stay intact.
            </p>
            <form onSubmit={(event) => void submitRestore(event)}>
              <label className="field-stack">
                <span>Reason for restoration</span>
                <textarea
                  autoFocus
                  minLength={8}
                  maxLength={500}
                  required
                  value={restoreReason}
                  onChange={(event) => setRestoreReason(event.currentTarget.value)}
                  placeholder="Describe what changed or why this version is safe to retry."
                />
              </label>
              <div className="modal-actions">
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => setRestoreTarget(undefined)}
                >
                  Cancel
                </button>
                <button className="button button--primary" type="submit" disabled={restoring}>
                  {restoring ? "Restoring…" : "Restore to probation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {evidenceTarget === undefined ? null : (
        <div className="modal-layer" role="presentation">
          <div className="modal-card modal-card--evidence" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
            <div className="modal-card__heading">
              <div>
                <p className="eyebrow">Device-local evidence</p>
                <h2 id="evidence-title">{evidenceTarget.agentName} · {evidenceTarget.project}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close evidence dialog"
                onClick={() => setEvidenceTarget(undefined)}
              >
                ×
              </button>
            </div>
            {evidenceLoading ? <p className="modal-copy">Decrypting local evidence…</p> : null}
            {evidenceError === undefined ? null : <p className="error-banner">{evidenceError}</p>}
            {evidenceText === undefined ? null : <pre className="evidence-viewer">{evidenceText}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

function HostStatus({ context }: { context: HostContext | undefined }) {
  if (context?.kind !== "desktop") {
    return <span className="host-pill"><span className="status-dot status-dot--good" />Cloud synced</span>;
  }
  if (context.worker.kind === "offline") {
    return (
      <span className="host-pill host-pill--warning" title={context.worker.reason}>
        <span className="status-dot status-dot--warning" />Worker offline
      </span>
    );
  }
  const setupRequired = context.adapterAccess.find(
    (access) => access.kind === "setup-required",
  );
  if (setupRequired?.kind === "setup-required") {
    return (
      <span className="host-pill host-pill--warning" title={setupRequired.reason}>
        <span className="status-dot status-dot--warning" />Worker online · adapter setup needed
      </span>
    );
  }
  return (
    <span className="host-pill">
      <span className="status-dot status-dot--good" />
      Worker {context.worker.version} · {context.worker.pendingUploads} pending
    </span>
  );
}

function LoadingState() {
  return (
    <div className="loading-grid" aria-label="Loading dashboard">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="loading-block" key={index} />
      ))}
    </div>
  );
}

function DashboardSection(input: {
  section: Section;
  snapshot: DashboardSnapshot;
  runtime: AgentRuntime | undefined;
  onNavigate: (section: Section) => void;
  onRestore: (skill: SkillSummary) => void;
  hostContext: HostContext | undefined;
  onInspectEvidence?: (run: RunSummary) => void;
}) {
  switch (input.section) {
    case "overview":
      return <OverviewView snapshot={input.snapshot} runtime={input.runtime} onNavigate={input.onNavigate} />;
    case "runs":
      return (
        <RunsView
          runs={input.snapshot.runs}
          {...(input.onInspectEvidence === undefined
            ? {}
            : { onInspectEvidence: input.onInspectEvidence })}
        />
      );
    case "agents":
      return <AgentsView snapshot={input.snapshot} />;
    case "skills":
      return <SkillsView skills={input.snapshot.skills} onRestore={input.onRestore} />;
    case "conflicts":
      return <ConflictsView conflicts={input.snapshot.conflicts} />;
    case "integrations":
      return (
        <IntegrationsView
          integrations={input.snapshot.integrations}
          hostContext={input.hostContext}
        />
      );
    case "policies":
      return <PoliciesView snapshot={input.snapshot} />;
    case "audit":
      return <AuditView events={input.snapshot.audit} />;
    case "devices":
      return <DevicesView snapshot={input.snapshot} />;
    default: {
      const exhaustive: never = input.section;
      return exhaustive;
    }
  }
}

function OverviewView(input: {
  snapshot: DashboardSnapshot;
  runtime: AgentRuntime | undefined;
  onNavigate: (section: Section) => void;
}) {
  const { overview } = input.snapshot;
  const recentFailures = input.snapshot.runs.filter(
    (run) => run.result === "terminal-failure" || run.result === "retryable-failure",
  );
  const healthyIntegrations = input.snapshot.integrations.filter(
    (integration) => integration.status === "healthy",
  ).length;
  return (
    <div className="view-stack">
      <section className="summary-strip">
        <div>
          <p className="eyebrow">Current cohort</p>
          <h2>{input.runtime === undefined ? "Comparable runtime cohorts" : runtimeLabel(input.runtime)}</h2>
          <p>
            Rankings use matching attribution and enforcement coverage. Estimated token savings stay labeled.
          </p>
        </div>
        <div className="summary-strip__signal">
          <span className="signal-value">{formatPercent(overview.enforcedShare)}</span>
          <span>fully enforced</span>
        </div>
      </section>

      <section className="metric-grid" aria-label="Performance summary">
        <MetricCard label="Runs" value={formatNumber(overview.totalRuns)} note="All completed attempts" tone="neutral" />
        <MetricCard label="Pass rate" value={formatPercent(overview.passRate)} note="Conclusive evaluations" tone="good" />
        <MetricCard label="Retry recovery" value={formatPercent(overview.retryRecoveryRate)} note="Passed after feedback" tone="good" />
        <MetricCard label="Terminal failures" value={formatNumber(overview.terminalFailures)} note="Verified standing events" tone="bad" />
        <MetricCard label="Tokens spent" value={formatNumber(overview.tokensSpent)} note="Reported and estimated" tone="neutral" />
        <MetricCard label="Tokens avoided" value={`≈${formatNumber(overview.tokensAvoidedEstimate)}`} note="Estimated, not measured" tone="accent" />
      </section>

      <div className="overview-grid">
        <Panel
          title="Latest runs"
          eyebrow="Live evaluation feed"
          action={<button type="button" className="text-button" onClick={() => input.onNavigate("runs")}>View all</button>}
        >
          <div className="run-feed">
            {input.snapshot.runs.slice(0, 5).map((run) => (
              <RunFeedRow run={run} key={run.id} />
            ))}
          </div>
        </Panel>

        <Panel
          title="Runtime coverage"
          eyebrow="Adapter health"
          action={<button type="button" className="text-button" onClick={() => input.onNavigate("integrations")}>Inspect</button>}
        >
          <div className="coverage-summary">
            <div
              className="coverage-ring"
              style={{
                background: `conic-gradient(var(--green) ${(healthyIntegrations / Math.max(input.snapshot.integrations.length, 1)) * 100}%, #25303d 0)`,
              }}
            >
              <span>{healthyIntegrations}/{input.snapshot.integrations.length}</span>
              <small>healthy</small>
            </div>
            <div className="coverage-list">
              {input.snapshot.integrations.map((integration) => (
                <div key={integration.id}>
                  <RuntimeMark runtime={integration.runtime} />
                  <span>{runtimeLabel(integration.runtime)} · {integration.scope}</span>
                  <StatusBadge value={integration.status} />
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {recentFailures.length === 0 ? null : (
        <Panel title="Needs attention" eyebrow="Recent failures">
          <div className="attention-grid">
            {recentFailures.slice(0, 3).map((run) => (
              <article key={run.id} className="attention-card">
                <div className="attention-card__top">
                  <ResultBadge result={run.result} />
                  <span>{formatTimestamp(run.occurredAt)}</span>
                </div>
                <h3>{run.agentName} · {run.project}</h3>
                <p>{run.findings[0] ?? "The evaluation did not pass."}</p>
                <div className="attention-card__meta">
                  <span>{run.skillName ?? "No managed skill"}</span>
                  <CoverageBadge coverage={run.enforcement} />
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function MetricCard(input: {
  label: string;
  value: string;
  note: string;
  tone: "neutral" | "good" | "bad" | "accent";
}) {
  return (
    <article className={`metric-card metric-card--${input.tone}`}>
      <span className="metric-card__label">{input.label}</span>
      <strong>{input.value}</strong>
      <span className="metric-card__note">{input.note}</span>
    </article>
  );
}

function Panel(input: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel__heading">
        <div>
          {input.eyebrow === undefined ? null : <p className="eyebrow">{input.eyebrow}</p>}
          <h2>{input.title}</h2>
        </div>
        {input.action}
      </div>
      {input.children}
    </section>
  );
}

function RunFeedRow({ run }: { run: RunSummary }) {
  return (
    <article className="run-feed__row">
      <RuntimeMark runtime={run.runtime} />
      <div className="run-feed__identity">
        <strong>{run.agentName}</strong>
        <span>{run.project}</span>
      </div>
      <CoverageBadge coverage={run.enforcement} />
      <ResultBadge result={run.result} />
      <span className="run-feed__time">{formatTimestamp(run.occurredAt)}</span>
    </article>
  );
}

function RunsView({
  runs,
  onInspectEvidence,
}: {
  runs: RunSummary[];
  onInspectEvidence?: (run: RunSummary) => void;
}) {
  return (
    <Panel title="Evaluation runs" eyebrow={`${runs.length} recent records`}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Run</th><th>Agent</th><th>Skill</th><th>Coverage</th><th>Result</th><th>Score</th><th>Cost</th><th>Time</th>{onInspectEvidence === undefined ? null : <th>Evidence</th>}</tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td><div className="primary-cell"><strong>{run.id}</strong><span>{runtimeLabel(run.runtime)} · {run.runtimeVersion}</span></div></td>
                <td><div className="primary-cell"><strong>{run.agentName}</strong><span>{run.project}</span></div></td>
                <td><div className="primary-cell"><strong>{run.skillName ?? "Unmanaged"}</strong><span>{attributionLabel(run.attribution)} attribution</span></div></td>
                <td><CoverageBadge coverage={run.enforcement} /></td>
                <td><ResultBadge result={run.result} /></td>
                <td><span className="score-value">{run.score === null ? "—" : run.score}</span></td>
                <td><div className="primary-cell"><strong>{formatNumber(run.tokens)} tok</strong><span>{run.attempts} attempt{run.attempts === 1 ? "" : "s"}</span></div></td>
                <td><div className="primary-cell"><strong>{formatTimestamp(run.occurredAt)}</strong><span>{formatDuration(run.latencyMs)}</span></div></td>
                {onInspectEvidence === undefined ? null : (
                  <td>
                    <button className="button button--ghost" type="button" onClick={() => onInspectEvidence(run)}>
                      View local
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AgentsView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const cohorts = agentCohorts(snapshot.agents);
  return (
    <div className="view-stack">
      {cohorts.map((cohort) => (
        <section className="agent-cohort" key={cohort.key}>
          <header>
            <div>
              <p className="eyebrow">Comparable cohort</p>
              <h2>{attributionLabel(cohort.attribution)} attribution · {enforcementLabel(cohort.enforcement)}</h2>
            </div>
            <span>{cohort.agents.length} agent{cohort.agents.length === 1 ? "" : "s"}</span>
          </header>
          <div className="agent-grid">
            {cohort.agents.map((agent, index) => (
              <article className="agent-card" key={agent.id}>
                <div className="agent-card__rank">#{index + 1}</div>
                <div className="agent-card__heading">
                  <RuntimeMark runtime={agent.runtime} />
                  <div><h2>{agent.name}</h2><span>{runtimeLabel(agent.runtime)} · {formatNumber(agent.runs)} runs</span></div>
                  <strong>{agent.averageScore.toFixed(1)}</strong>
                </div>
                <div className="performance-bar"><span style={{ width: `${agent.averageScore}%` }} /></div>
                <div className="agent-card__metrics">
                  <div><span>Pass rate</span><strong>{formatPercent(agent.passRate)}</strong></div>
                  <div><span>Retry recovery</span><strong>{formatPercent(agent.retryRecoveryRate)}</strong></div>
                  <div><span>Terminal failures</span><strong>{agent.terminalFailures}</strong></div>
                  <div><span>Tokens</span><strong>{formatNumber(agent.tokens)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      <p className="cohort-note">Ranks restart for each attribution and enforcement cohort. Sisyphus never places observation-only results in an enforced ranking.</p>
    </div>
  );
}

function SkillsView(input: { skills: SkillSummary[]; onRestore: (skill: SkillSummary) => void }) {
  return (
    <Panel title="Managed skill versions" eyebrow="Standing and attribution">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Skill version</th><th>Runtime</th><th>Standing</th><th>Verified attribution</th><th>Pass rate</th><th>Failures</th><th>Changed</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {input.skills.map((skill) => (
              <tr key={skill.skillVersionId}>
                <td><div className="primary-cell"><strong>{skill.name}</strong><span>v{skill.version} · {formatNumber(skill.runs)} runs</span></div></td>
                <td><div className="runtime-cell"><RuntimeMark runtime={skill.runtime} /><span>{runtimeLabel(skill.runtime)}</span></div></td>
                <td><DispositionBadge disposition={skill.disposition} /></td>
                <td><InlineMeter value={skill.verifiedAttributionRate} /></td>
                <td><InlineMeter value={skill.passRate} /></td>
                <td><span className={skill.terminalFailures >= 10 ? "failure-count failure-count--high" : "failure-count"}>{skill.terminalFailures}</span></td>
                <td>{formatTimestamp(skill.lastChangedAt)}</td>
                <td>{skill.disposition === "quarantined" || skill.disposition === "revoked" ? <button className="button button--compact" type="button" onClick={() => input.onRestore(skill)}>Restore</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ConflictsView({ conflicts }: { conflicts: DashboardSnapshot["conflicts"] }) {
  return (
    <div className="view-stack">
      <section className="summary-strip summary-strip--compact">
        <div><p className="eyebrow">Deterministic resolver</p><h2>One prompt, one managed skill</h2><p>Administrator priority wins first, trigger specificity second, stable version ID last.</p></div>
      </section>
      <div className="conflict-list">
        {conflicts.map((conflict) => (
          <article className="conflict-card" key={conflict.id}>
            <header><div><RuntimeMark runtime={conflict.runtime} /><div><span>{runtimeLabel(conflict.runtime)} · {formatTimestamp(conflict.occurredAt)}</span><h2>{conflict.promptSummary}</h2></div></div><span className="selected-pill">Selected {conflict.selectedSkill}</span></header>
            <div className="candidate-list">
              {conflict.candidates.map((candidate) => (
                <div className={candidate.selected ? "candidate candidate--selected" : "candidate"} key={candidate.skillVersionId}>
                  <div><strong>{candidate.skillName}</strong><span>{candidate.reason}</span></div>
                  <div className="candidate__scores"><span>Priority <strong>{candidate.priority}</strong></span><span>Specificity <strong>{candidate.specificity}</strong></span></div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

const capabilityFields: {
  label: string;
  read: (integration: IntegrationSummary) => Capability;
}[] = [
  { label: "Prompt intercept", read: (integration) => integration.capabilities.promptInterception },
  { label: "Skill routing", read: (integration) => integration.capabilities.skillSelectionControl },
  { label: "Root retry", read: (integration) => integration.capabilities.rootStopContinuation },
  { label: "Subagent retry", read: (integration) => integration.capabilities.subagentStopContinuation },
  { label: "Tool prevention", read: (integration) => integration.capabilities.toolPrevention },
  { label: "Tool observation", read: (integration) => integration.capabilities.toolObservation },
  { label: "Token usage", read: (integration) => integration.capabilities.stableTokenUsage },
  { label: "Local evidence", read: (integration) => integration.capabilities.localEvidenceAccess },
];

function IntegrationsView({
  integrations,
  hostContext,
}: {
  integrations: IntegrationSummary[];
  hostContext: HostContext | undefined;
}) {
  return (
    <div className="integration-grid">
      {integrations.map((integration) => {
        const access =
          hostContext?.kind === "desktop" && integration.scope === "local"
            ? hostContext.adapterAccess.find(
                (candidate) => candidate.runtime === integration.runtime,
              )
            : undefined;
        const effectiveStatus =
          access?.kind === "setup-required" ? "degraded" : integration.status;
        return (
          <article className="integration-card" key={integration.id}>
            <header><div className="integration-card__identity"><RuntimeMark runtime={integration.runtime} /><div><h2>{runtimeLabel(integration.runtime)}</h2><span>{integration.scope} · adapter {integration.adapterVersion}</span></div></div><StatusBadge value={effectiveStatus} /></header>
            {access?.kind === "setup-required" ? (
              <p className="integration-warning">{access.reason}</p>
            ) : null}
            <div className="integration-meta"><span>Runtime {integration.runtimeVersion}</span><span>Seen {formatTimestamp(integration.lastSeenAt)}</span></div>
            <div className="capability-list">
              {capabilityFields.map((field) => <CapabilityRow key={field.label} label={field.label} capability={field.read(integration)} />)}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CapabilityRow({ label, capability }: { label: string; capability: Capability }) {
  const detail = capability.kind === "partial" ? capability.limitation : capability.kind === "unsupported" ? capability.reason : "Supported by this adapter.";
  return <div className="capability-row" title={detail}><span>{label}</span><CapabilityBadge capability={capability} /></div>;
}

function PoliciesView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className="policy-grid">
      {snapshot.policies.map((policy) => {
        const matchingIntegrations = snapshot.integrations.filter((integration) => policy.runtime === null || integration.runtime === policy.runtime);
        const unsupportedCount = matchingIntegrations.reduce((sum, integration) => sum + policy.requiredCapabilities.filter((requirement) => integration.capabilities[requirement].kind === "unsupported").length, 0);
        return (
          <article className="policy-card" key={policy.id}>
            <header><div><span className={policy.enabled ? "status-dot status-dot--good" : "status-dot"} /><div><h2>{policy.name}</h2><span>{policy.runtime === null ? "All runtimes" : runtimeLabel(policy.runtime)}</span></div></div><span className={policy.enabled ? "toggle-label toggle-label--on" : "toggle-label"}>{policy.enabled ? "Active" : "Off"}</span></header>
            <div className="policy-stats"><div><span>Pass threshold</span><strong>{policy.passThreshold}</strong></div><div><span>Retry limit</span><strong>{policy.retryLimit}</strong></div><div><span>Capability gaps</span><strong className={unsupportedCount > 0 ? "text-danger" : ""}>{unsupportedCount}</strong></div></div>
            <div className="tag-row">{policy.requiredCapabilities.map((capability) => <span key={capability}>{splitIdentifier(capability)}</span>)}</div>
            <footer>Updated {formatTimestamp(policy.updatedAt)}</footer>
          </article>
        );
      })}
    </div>
  );
}

function AuditView({ events }: { events: AuditEvent[] }) {
  return (
    <Panel title="Audit log" eyebrow="Immutable team history">
      <div className="timeline">
        {events.map((event) => (
          <article key={event.id} className="timeline-row">
            <span className={`timeline-marker timeline-marker--${auditTone(event)}`} />
            <div><div className="timeline-row__meta"><strong>{splitIdentifier(event.action)}</strong><span>{formatTimestamp(event.occurredAt)}</span></div><p>{event.summary}</p><span className="timeline-row__actor">{event.actor}{event.runtime === null ? "" : ` · ${runtimeLabel(event.runtime)}`}</span></div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function DevicesView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className="device-grid">
      {snapshot.devices.map((device) => (
        <article className="device-card" key={device.id}>
          <header><div className="device-icon" aria-hidden="true">{device.platform === "windows" ? "W" : device.platform === "macos" ? "M" : "L"}</div><div><h2>{device.name}</h2><span>{device.platform}</span></div><StatusBadge value={device.status} /></header>
          <dl><div><dt>Last seen</dt><dd>{formatTimestamp(device.lastSeenAt)}</dd></div><div><dt>Sync lag</dt><dd>{device.syncLagSeconds < 60 ? `${device.syncLagSeconds}s` : `${Math.round(device.syncLagSeconds / 60)}m`}</dd></div><div><dt>Plugin trust</dt><dd><TrustBadge trust={device.pluginTrust} /></dd></div></dl>
          <div className="runtime-tags">{device.runtimes.map((runtime) => <span key={runtime}><RuntimeMark runtime={runtime} />{runtimeLabel(runtime)}</span>)}</div>
        </article>
      ))}
    </div>
  );
}

function RuntimeMark({ runtime }: { runtime: AgentRuntime }) {
  return <span className={`runtime-mark runtime-mark--${runtime}`} aria-label={runtimeLabel(runtime)}>{runtimeLabel(runtime).slice(0, 1)}</span>;
}

function ResultBadge({ result }: { result: EvaluationResult }) {
  return <span className={`badge badge--result-${result}`}>{resultLabel(result)}</span>;
}

function CoverageBadge({ coverage }: { coverage: EnforcementCoverage }) {
  return <span className={`badge badge--coverage-${coverage}`}>{enforcementLabel(coverage)}</span>;
}

function CapabilityBadge({ capability }: { capability: Capability }) {
  switch (capability.kind) {
    case "supported":
      return <span className="badge badge--supported">Supported</span>;
    case "partial":
      return <span className="badge badge--partial">Partial</span>;
    case "unsupported":
      return <span className="badge badge--unsupported">Unsupported</span>;
    default: {
      const exhaustive: never = capability;
      return exhaustive;
    }
  }
}

function DispositionBadge({ disposition }: { disposition: SkillSummary["disposition"] }) {
  return <span className={`badge badge--disposition-${disposition}`}>{capitalize(disposition)}</span>;
}

function StatusBadge({ value }: { value: "healthy" | "degraded" | "offline" | "online" | "stale" }) {
  const tone = value === "healthy" || value === "online" ? "good" : value === "degraded" || value === "stale" ? "warning" : "bad";
  return <span className={`status-label status-label--${tone}`}><span className={`status-dot status-dot--${tone}`} />{capitalize(value)}</span>;
}

function TrustBadge({ trust }: { trust: DashboardSnapshot["devices"][number]["pluginTrust"] }) {
  return <span className={`trust-label trust-label--${trust}`}>{capitalize(trust)}</span>;
}

function InlineMeter({ value }: { value: number }) {
  return <div className="inline-meter"><span><i style={{ width: `${value}%` }} /></span><strong>{formatPercent(value)}</strong></div>;
}

function auditTone(event: AuditEvent): "good" | "bad" | "warning" | "neutral" {
  switch (event.action) {
    case "skill.restored":
    case "device.enrolled":
      return "good";
    case "skill.quarantined":
      return "bad";
    case "integration.degraded":
      return "warning";
    case "evaluation.completed":
    case "policy.updated":
    case "event.ingested":
      return "neutral";
    default: {
      const exhaustive: never = event.action;
      return exhaustive;
    }
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function splitIdentifier(value: string): string {
  return value
    .replaceAll(".", " ")
    .replaceAll(/([a-z])([A-Z])/gu, "$1 $2")
    .toLowerCase();
}

function workspaceInitials(name: string): string {
  return name
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function agentCohorts(agents: DashboardSnapshot["agents"]): {
  key: string;
  attribution: DashboardSnapshot["agents"][number]["attributionCohort"];
  enforcement: DashboardSnapshot["agents"][number]["enforcementCohort"];
  agents: DashboardSnapshot["agents"];
}[] {
  const cohorts = new Map<string, DashboardSnapshot["agents"]>();
  for (const agent of agents) {
    const key = `${agent.attributionCohort}:${agent.enforcementCohort}`;
    const cohort = cohorts.get(key) ?? [];
    cohort.push(agent);
    cohorts.set(key, cohort);
  }
  return [...cohorts.entries()].map(([key, cohortAgents]) => {
    const first = cohortAgents[0];
    if (first === undefined) {
      throw new Error("An agent cohort cannot be empty.");
    }
    return {
      key,
      attribution: first.attributionCohort,
      enforcement: first.enforcementCohort,
      agents: [...cohortAgents].sort((left, right) => right.averageScore - left.averageScore),
    };
  });
}
