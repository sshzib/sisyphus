import { type FormEvent, useEffect, useMemo, useState } from "react";
import type {
  CreateCustomSkill,
  SkillImprovementProposal,
  SkillRegistryDetail,
  SkillRegistryEntry,
  SkillRegistrySyncPreview,
} from "./contracts.js";
import type { SisyphusDataClient } from "./data-client.js";

export function SkillsView({ client }: { readonly client: SisyphusDataClient }) {
  const [skills, setSkills] = useState<readonly SkillRegistryEntry[]>();
  const [selected, setSelected] = useState<SkillRegistryDetail>();
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [syncPreview, setSyncPreview] = useState<SkillRegistrySyncPreview>();
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);

  const load = async () => {
    try {
      const result = await client.listSkillRegistry();
      setSkills(result.items);
      setLoadError(undefined);
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "The skill registry could not be loaded.");
    }
  };
  useEffect(() => { void load(); }, [client]);

  const catalog = skills ?? [];
  const filters = useMemo(() => ({
    phases: [...new Set(catalog.map((skill) => skill.phase))].toSorted(),
    sources: [...new Set(catalog.map((skill) => skill.source))].toSorted(),
    statuses: [...new Set(catalog.map((skill) => skill.status))].toSorted(),
  }), [catalog]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return catalog.filter((skill) =>
      (phase === "all" || skill.phase === phase) &&
      (source === "all" || skill.source === source) &&
      (status === "all" || skill.status === status) &&
      (needle.length === 0 || [skill.name, skill.role, skill.description, skill.category, skill.phase, skill.source, skill.status, ...skill.tags].join(" ").toLowerCase().includes(needle)),
    );
  }, [catalog, phase, search, source, status]);
  const evaluated = catalog.filter((skill) => skill.metrics.lastEvaluatedAt !== null).length;
  const needsImprovement = catalog.filter((skill) => skill.status === "needs-improvement").length;
  const active = catalog.filter((skill) => skill.status === "active").length;
  const measured = catalog.filter((skill) => skill.metrics.successRate !== null);
  const successRate = measured.length === 0 ? undefined : measured.reduce((total, skill) => total + (skill.metrics.successRate ?? 0), 0) / measured.length;
  const categoryCount = new Set(catalog.map((skill) => skill.category)).size;
  const sourceCount = new Set(catalog.map((skill) => skill.source)).size;
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * pageSize;
  const pageSkills = visible.slice(pageStart, pageStart + pageSize);
  useEffect(() => { setPage(0); }, [search, phase, source, status]);

  const open = async (skillId: string) => {
    try { setSelected((await client.getSkillRegistryDetail(skillId)).skill); }
    catch (error: unknown) { setNotice(error instanceof Error ? error.message : "The skill could not be opened."); }
  };
  const evaluate = async (skill: SkillRegistryEntry) => {
    try {
      const response = await client.createEngineeringTask({ request: evaluationTask(skill) });
      setNotice(`Evaluation task ${response.operation.id} is queued. Its score will appear after isolated execution evidence is published.`);
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "The skill evaluation could not be started.");
    }
  };
  const reviewSync = async () => {
    try { setSyncPreview(await client.previewSkillRegistrySync()); }
    catch (error: unknown) { setNotice(error instanceof Error ? error.message : "The skill update review could not be completed."); }
  };
  const applySync = async () => {
    try {
      const result = await client.syncSkillRegistry();
      setSyncPreview(undefined);
      setNotice(`${result.total} skills synchronized. ${result.added} new, ${result.updated} updated, ${result.unchanged} unchanged.`);
      await load();
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Skill synchronization failed.");
    }
  };

  if (selected !== undefined) {
    return <SkillDetail client={client} skill={selected} onBack={() => setSelected(undefined)} onChanged={setSelected} onEvaluate={evaluate} />;
  }

  return <section className="reference-content reference-skills-screen">
    <header className="reference-page-heading reference-skills-heading">
      <div><h1>Skills Overview</h1><p>Specialized engineering capabilities, measured through real execution evidence.</p></div>
      <div><span className="reference-live-pill">{skills === undefined ? (loadError === undefined ? "Loading" : "Unavailable") : `${catalog.length} skills`}</span><small>OpenSkills registry</small><button className="reference-skills-action" type="button" onClick={() => void reviewSync()}>Sync Skills</button><button className="reference-skills-action reference-skills-action--primary" type="button" onClick={() => setCreating(true)}>Create Skill</button></div>
    </header>
    {loadError === undefined ? null : <p className="reference-skill-notice reference-skill-notice--error" role="alert">{loadError}<button type="button" onClick={() => void load()}>Retry</button></p>}
    {notice === undefined ? null : <p className="reference-skill-notice" role="status">{notice}<button type="button" onClick={() => setNotice(undefined)}>Dismiss</button></p>}
    {syncPreview === undefined ? null : <section className="reference-skill-sync-preview" aria-label="Skill update review"><div><span>OpenSkills sync</span><h2>{syncPreview.total} skills available</h2><p>New {syncPreview.added} · Updated {syncPreview.updated} · Unchanged {syncPreview.unchanged} · Local versions protected {syncPreview.localEnhancements}</p></div><div><button type="button" onClick={() => void applySync()}>Apply Sync</button><button type="button" onClick={() => setSyncPreview(undefined)}>Cancel</button></div></section>}
    {creating ? <CreateSkillForm client={client} onCancel={() => setCreating(false)} onCreated={(skill) => { setSelected(skill); setCreating(false); void load(); }} /> : null}
    <section className="reference-stat-grid" aria-label="Skill statistics">
      <SkillStatCard label="Total Skills" value={skills === undefined ? "—" : String(catalog.length)} tone="green" detail={skills === undefined ? "Waiting for registry" : `${sourceCount} registered source${sourceCount === 1 ? "" : "s"}`} />
      <SkillStatCard label="Active Skills" value={skills === undefined ? "—" : String(active)} tone="green" detail={skills === undefined ? "Waiting for registry" : `${evaluated} evaluated`} />
      <SkillStatCard label="Needs Attention" value={skills === undefined ? "—" : String(needsImprovement)} tone={needsImprovement === 0 ? "green" : "red"} detail={skills === undefined ? "Waiting for registry" : needsImprovement === 0 ? "All skills are healthy" : "Review evidence"} />
    </section>
    <section className="reference-skill-filters" aria-label="Skill filters"><label className="reference-skill-search"><span>Search</span><input aria-label="Search skills" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search skills, roles, tags, or phases" /></label><Filter label="Phase" value={phase} onChange={setPhase} values={filters.phases} /><Filter label="Source" value={source} onChange={setSource} values={filters.sources} /><Filter label="Status" value={status} onChange={setStatus} values={filters.statuses} /></section>
    {skills === undefined ? null : <p className="reference-skill-result-count">Showing {visible.length} of {catalog.length} skills</p>}
    <div className="reference-agents-grid">
      <section className="reference-table-card reference-agent-table-card reference-skill-table">
        <div className="reference-table-header reference-agent-head"><span /><span>Skill</span><span>Focus</span><span>Health</span></div>
        <div className="reference-table-body">
          {skills === undefined ? <p className="reference-empty-row">{loadError === undefined ? "Loading the skill catalog…" : "The skill catalog is temporarily unavailable."}</p> : pageSkills.length === 0 ? <p className="reference-empty-row">No skills match these filters.</p> : pageSkills.map((skill, index) => <SkillRow key={skill.id} index={index} skill={skill} onOpen={open} />)}
        </div>
        <footer className="reference-table-footer"><span>{skills === undefined || visible.length === 0 ? "No skills to display" : `${pageStart + 1} to ${Math.min(pageStart + pageSize, visible.length)} of ${visible.length} skills`}</span><span><button type="button" disabled={currentPage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Prev</button><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next →</button></span></footer>
      </section>
      <section className="reference-table-card reference-usage-card reference-skill-usage">
        <div className="reference-table-header"><span>Catalog Health</span><span>Amount</span></div>
        <div className="reference-usage-list"><SkillUsageRow label="OpenSkills catalog" value={skills === undefined ? "—" : catalog.filter((skill) => skill.source === "upstream").length} /><SkillUsageRow label="Active skills" value={skills === undefined ? "—" : active} /><SkillUsageRow label="Evaluated skills" value={skills === undefined ? "—" : evaluated} /><SkillUsageRow label="Needs review" value={skills === undefined ? "—" : needsImprovement} /><SkillUsageRow label="Engineering categories" value={skills === undefined ? "—" : categoryCount} /></div>
        <footer className="reference-usage-total"><span>Overall success</span><strong>{skills === undefined ? "Waiting" : successRate === undefined ? "Not measured" : `${Math.round(successRate)}%`}</strong></footer>
      </section>
    </div>
    <section className="reference-efficiency-card reference-skill-coverage"><div><h2>Skill Coverage</h2><p>The catalog stays available while usage evidence accumulates from completed work.</p></div><div className="reference-evidence-bars"><SkillCoverageBar label="Active skills" value={skills === undefined ? undefined : active} max={Math.max(catalog.length, 1)} /><SkillCoverageBar label="Evaluated skills" value={skills === undefined ? undefined : evaluated} max={Math.max(catalog.length, 1)} /></div></section>
    <p className="reference-skills-attribution">OpenSkills · Source: CODE-SAURABH/OpenSkills · MIT licensed. Original notices remain with synchronized source content.</p>
  </section>;
}

function SkillStatCard(input: { readonly label: string; readonly value: string; readonly tone: "green" | "red"; readonly detail: string }) { return <article className="reference-stat-card"><span>{input.label}</span><button type="button" aria-label={`${input.label} options`}>⋮</button><strong>{input.value}</strong><p className={`reference-stat-detail reference-stat-detail--${input.tone}`}><b aria-hidden="true">{input.tone === "green" ? "↑" : "↓"}</b>{input.detail}</p><svg aria-hidden="true" viewBox="0 0 112 48"><path d={input.tone === "green" ? "M2 39C20 37 22 13 42 17s20 21 37 12S94 2 110 6" : "M2 5c19 0 17 30 37 34s26-20 41-10 20 13 30 16"} /></svg></article>; }
function SkillRow(input: { readonly skill: SkillRegistryEntry; readonly index: number; readonly onOpen: (skillId: string) => Promise<void> }) { const { skill } = input; return <button className="reference-agent-row reference-skill-row" type="button" onClick={() => void input.onOpen(skill.id)}><span className="reference-row-grip">⠿</span><span className={`reference-agent-orb reference-agent-orb--${input.index % 4}`} /><div><strong>{skill.name}</strong><small className={`reference-status reference-skill-status--${skill.status}`}>{sourceLabel(skill)} · {skillStatusLabel(skill.status)}</small></div><span>{skill.category} · {skill.phase}</span><span>{skill.metrics.averageScore === null ? "Awaiting data" : `${Math.round(skill.metrics.averageScore)}%`}</span></button>; }
function SkillUsageRow({ label, value }: { readonly label: string; readonly value: number | string }) { return <div><span><i aria-hidden="true" />{label}</span><strong>{typeof value === "number" ? value.toLocaleString("en-US") : value}</strong></div>; }
function SkillCoverageBar({ label, value, max }: { readonly label: string; readonly value: number | undefined; readonly max: number }) { const width = value === undefined ? 0 : Math.min(100, Math.round((value / max) * 100)); return <div className="reference-evidence-bar"><span>{label}</span><div><i style={{ width: `${width}%` }} /></div><strong>{value ?? "—"}</strong></div>; }

function SkillDetail(input: { readonly client: SisyphusDataClient; readonly skill: SkillRegistryDetail; readonly onBack: () => void; readonly onChanged: (skill: SkillRegistryDetail) => void; readonly onEvaluate: (skill: SkillRegistryEntry) => Promise<void> }) {
  const { skill } = input;
  const proposed = skill.proposals.filter((proposal) => proposal.status === "proposed");
  const resolveProposal = async (proposal: SkillImprovementProposal, action: "apply" | "reject") => {
    try { input.onChanged((await input.client.resolveSkillImprovementProposal(skill.id, proposal.id, { action })).skill); }
    catch { input.onChanged((await input.client.getSkillRegistryDetail(skill.id)).skill); }
  };
  return <main className="reference-content reference-skills-screen reference-skill-detail"><button className="button--quiet" onClick={input.onBack}>Back to Skills</button><header className="skills-header"><div><span className="panel-kicker">{sourceLabel(skill)} · {skill.category} · {skill.phase}</span><h1>{skill.name}</h1><p>{skill.description}</p></div><div className="skills-actions"><button onClick={() => void input.onEvaluate(skill)}>Evaluate Skill</button></div></header><section className="skill-detail-meta"><Metric label="Role" value={skill.role} /><Metric label="Version" value={skill.version} /><Metric label="License" value={skill.license} /><Metric label="Last synced" value={formatDate(skill.lastSyncedAt)} /></section><section className="skill-detail-layout"><article className="skill-performance"><span className="panel-kicker">Skill health</span><h2>{skill.metrics.averageScore === null ? "Not measured" : `${Math.round(skill.metrics.averageScore)}%`}</h2><div className="skill-health-track"><span style={{ width: `${skill.metrics.averageScore ?? 0}%` }} /></div><p>{skill.metrics.executions} total uses · {skill.metrics.failures} failed · {skill.metrics.averageRetries === null ? "No retry data" : `${skill.metrics.averageRetries.toFixed(1)} avg retries`}</p>{skill.performance.trend.length === 0 ? <p>No execution scores yet. Sisyphus records this only after isolated verification.</p> : <p>Last {skill.performance.trend.length} executions: {skill.performance.trend.join(" → ")}</p>}</article><article className="skill-performance"><span className="panel-kicker">Agent compatibility</span><h2>{skill.performance.compatibility.length === 0 ? "Waiting for evidence" : "Verified models"}</h2>{skill.performance.compatibility.length === 0 ? <p>Compatibility is learned from completed, attributed execution records.</p> : <ul className="skill-compatibility">{skill.performance.compatibility.map((item) => <li key={item.model}><span>{item.model}</span><strong>{item.successRate}%</strong><small>{item.executions} uses</small></li>)}</ul>}</article></section>{proposed.length === 0 ? null : <section className="skill-proposals"><span className="panel-kicker">Human review required</span><h2>Skill Improvement Proposal</h2>{proposed.map((proposal) => <ImprovementProposal key={proposal.id} proposal={proposal} onResolve={resolveProposal} />)}</section>}<section className="skill-detail-layout"><article className="skill-instructions"><h2>Skill Instructions</h2><MarkdownSections content={skill.instructions} /></article><article className="skill-performance"><h2>Recent failures</h2>{skill.performance.recentFailures.length === 0 ? <p>No attributed failures have been recorded for this skill.</p> : <ul className="skill-failure-list">{skill.performance.recentFailures.map((failure) => <li key={failure.executionId}><strong>{failure.requirementId}</strong><span>{failure.model} · {formatDate(failure.recordedAt)}</span><p>{failure.evidence}</p></li>)}</ul>}</article></section></main>;
}

function ImprovementProposal(input: { readonly proposal: SkillImprovementProposal; readonly onResolve: (proposal: SkillImprovementProposal, action: "apply" | "reject") => Promise<void> }) { const { proposal } = input; return <article className="skill-proposal"><dl><div><dt>Observed issue</dt><dd>{proposal.observedIssue}</dd></div><div><dt>Evidence</dt><dd>{proposal.evidence.failureCount} failures across {proposal.evidence.executionCount} executions</dd></div><div><dt>Suggested improvement</dt><dd>{proposal.suggestedImprovement}</dd></div><div><dt>Expected impact</dt><dd>{proposal.expectedImpact}</dd></div><div><dt>Confidence</dt><dd>{proposal.confidence}</dd></div></dl><div><button onClick={() => void input.onResolve(proposal, "apply")}>Apply Improvement</button><button className="button--quiet" onClick={() => void input.onResolve(proposal, "reject")}>Reject</button></div></article>; }
function MarkdownSections({ content }: { readonly content: string }) { const sections = content.split(/^##\s+/mu).filter(Boolean); return <div className="markdown-sections">{sections.map((section, index) => { const [heading = "Instructions", ...body] = section.split("\n"); return <article key={`${heading}-${index}`}><h3>{heading.replace(/^#\s+/u, "")}</h3><pre>{body.join("\n").trim()}</pre></article>; })}</div>; }
function CreateSkillForm(input: { readonly client: SisyphusDataClient; readonly onCancel: () => void; readonly onCreated: (skill: SkillRegistryDetail) => void }) { const [error, setError] = useState<string>(); const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const values = new FormData(event.currentTarget); const payload: CreateCustomSkill = { name: String(values.get("name") ?? ""), description: String(values.get("description") ?? ""), role: String(values.get("role") ?? ""), category: String(values.get("category") ?? ""), phase: String(values.get("phase") ?? ""), triggerConditions: String(values.get("triggers") ?? "").split("\n").map((value) => value.trim()).filter(Boolean), executionWorkflow: String(values.get("workflow") ?? ""), outputTemplate: String(values.get("output") ?? ""), definitionOfDone: String(values.get("done") ?? "") }; try { input.onCreated((await input.client.createCustomSkill(payload)).skill); } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "The custom skill could not be saved."); } }; return <form className="reference-skill-create-form" onSubmit={submit}><h2>Create a Sisyphus Custom Skill</h2><label>Skill Name<input name="name" pattern="[a-z0-9-]+" required /></label><label>Description<textarea name="description" required /></label><label>Role<input name="role" required /></label><label>Category<input name="category" required /></label><label>Phase<input name="phase" required /></label><label>Trigger Conditions<textarea name="triggers" required /></label><label>Execution Workflow<textarea name="workflow" required /></label><label>Output Template<textarea name="output" required /></label><label>Definition of Done<textarea name="done" required /></label>{error === undefined ? null : <p role="alert">{error}</p>}<div><button type="submit">Save Custom Skill</button><button type="button" onClick={input.onCancel}>Cancel</button></div></form>; }
function Filter(input: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly values: readonly string[] }) { return <label className="reference-skill-filter"><span>{input.label}</span><select aria-label={`Filter by ${input.label}`} value={input.value} onChange={(event) => input.onChange(event.currentTarget.value)}><option value="all">All</option>{input.values.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</select></label>; }
function Metric({ label, value }: { readonly label: string; readonly value: string }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function formatDate(value: string | null): string { return value === null ? "Not yet" : new Date(value).toLocaleDateString(); }
function sourceLabel(skill: Pick<SkillRegistryEntry, "source">): string { return skill.source === "custom" ? "Sisyphus Custom" : skill.source === "enhanced" ? "Local Enhanced" : "OpenSkills"; }
function skillStatusLabel(status: SkillRegistryEntry["status"]): string { return status === "needs-improvement" ? "Needs review" : status === "active" ? "Active" : "Draft"; }
function evaluationTask(skill: SkillRegistryEntry): string { return `Controlled skill evaluation for ${skill.id}. Use the selected ${skill.name} skill to produce a small, production-style implementation matching its workflow and definition of done. Create deterministic tests, validation, and security checks appropriate to this role. This is an evaluation task: keep the scope focused, accept only isolated sandbox evidence, and report the exact requirement evidence for any failure.`; }
