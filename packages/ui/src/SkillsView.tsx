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
  const [skills, setSkills] = useState<readonly SkillRegistryEntry[]>([]);
  const [selected, setSelected] = useState<SkillRegistryDetail>();
  const [search, setSearch] = useState("");
  const [phase, setPhase] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [message, setMessage] = useState<string>();
  const [syncPreview, setSyncPreview] = useState<SkillRegistrySyncPreview>();
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const result = await client.listSkillRegistry();
      setSkills(result.items);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "The skill registry could not be loaded.");
    }
  };
  useEffect(() => { void load(); }, [client]);

  const filters = useMemo(() => ({
    phases: [...new Set(skills.map((skill) => skill.phase))].toSorted(),
    sources: [...new Set(skills.map((skill) => skill.source))].toSorted(),
    statuses: [...new Set(skills.map((skill) => skill.status))].toSorted(),
  }), [skills]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return skills.filter((skill) =>
      (phase === "all" || skill.phase === phase) &&
      (source === "all" || skill.source === source) &&
      (status === "all" || skill.status === status) &&
      (needle.length === 0 || [skill.name, skill.role, skill.description, skill.category, skill.phase, skill.source, skill.status, ...skill.tags].join(" ").toLowerCase().includes(needle)),
    );
  }, [phase, search, skills, source, status]);
  const evaluated = skills.filter((skill) => skill.metrics.lastEvaluatedAt !== null).length;
  const needsImprovement = skills.filter((skill) => skill.status === "needs-improvement").length;
  const active = skills.filter((skill) => skill.status === "active").length;
  const measured = skills.filter((skill) => skill.metrics.successRate !== null);
  const successRate = measured.length === 0 ? undefined : measured.reduce((total, skill) => total + (skill.metrics.successRate ?? 0), 0) / measured.length;

  const open = async (skillId: string) => {
    try { setSelected((await client.getSkillRegistryDetail(skillId)).skill); }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : "The skill could not be opened."); }
  };
  const evaluate = async (skill: SkillRegistryEntry) => {
    try {
      const response = await client.createEngineeringTask({ request: evaluationTask(skill) });
      setMessage(`Evaluation task ${response.operation.id} is queued. Its score will appear only after the isolated execution pipeline publishes evidence.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "The skill evaluation could not be started.");
    }
  };
  const reviewSync = async () => {
    try { setSyncPreview(await client.previewSkillRegistrySync()); }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : "The skill update review could not be completed."); }
  };
  const applySync = async () => {
    try {
      const result = await client.syncSkillRegistry();
      setSyncPreview(undefined);
      setMessage(`${result.total} skills synchronized. ${result.added} new, ${result.updated} updated, ${result.unchanged} unchanged.`);
      await load();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Skill synchronization failed.");
    }
  };

  if (selected !== undefined) {
    return <SkillDetail client={client} skill={selected} onBack={() => setSelected(undefined)} onChanged={setSelected} onEvaluate={evaluate} />;
  }

  return <main className="skills-center">
    <header className="skills-header">
      <div><span className="panel-kicker">Skills intelligence</span><h1>Skills Intelligence</h1><p>Give Sisyphus specialized engineering capabilities, evaluate them, and improve them through execution.</p></div>
      <div className="skills-actions"><button onClick={() => void reviewSync()}>Sync Skills</button><button onClick={() => setCreating(true)}>Create Skill</button></div>
    </header>
    {message === undefined ? null : <p role="status" className="task-draft__message">{message}</p>}
    {syncPreview === undefined ? null : <section className="skills-sync-preview" aria-label="Skill update review"><div><span className="panel-kicker">OpenSkills sync</span><h2>{syncPreview.total} skills available</h2><p>New {syncPreview.added} · Updated {syncPreview.updated} · Unchanged {syncPreview.unchanged} · Local versions protected {syncPreview.localEnhancements}</p></div><div><button onClick={() => void applySync()}>Apply Sync</button><button className="button--quiet" onClick={() => setSyncPreview(undefined)}>Cancel</button></div></section>}
    {creating ? <CreateSkillForm client={client} onCancel={() => setCreating(false)} onCreated={(skill) => { setSelected(skill); setCreating(false); void load(); }} /> : null}
    <section className="skills-metrics" aria-label="Skill statistics"><Metric label="Total Skills" value={String(skills.length)} /><Metric label="Active Skills" value={String(active)} /><Metric label="Skills Evaluated" value={String(evaluated)} /><Metric label="Needs Improvement" value={String(needsImprovement)} /><Metric label="Overall Success Rate" value={successRate === undefined ? "Not measured" : `${Math.round(successRate)}%`} /></section>
    <section className="skills-toolbar" aria-label="Skill filters"><label className="skills-search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search skills, roles, tags, or phases" /></label><Filter label="Phase" value={phase} onChange={setPhase} values={filters.phases} /><Filter label="Source" value={source} onChange={setSource} values={filters.sources} /><Filter label="Status" value={status} onChange={setStatus} values={filters.statuses} /></section>
    <p className="skills-result-count">Showing {visible.length} of {skills.length} skills</p>
    <section className="skills-grid">{visible.map((skill) => <SkillCard key={skill.id} skill={skill} onOpen={open} onEvaluate={evaluate} />)}</section>
    <section className="skills-attribution"><h2>Licensing & Attribution</h2><p>OpenSkills · Source: CODE-SAURABH/OpenSkills · License: MIT. Original license text and notices are retained in <code>THIRD_PARTY_NOTICES.md</code> and alongside synchronized source content.</p></section>
  </main>;
}

function SkillCard(input: { readonly skill: SkillRegistryEntry; readonly onOpen: (skillId: string) => Promise<void>; readonly onEvaluate: (skill: SkillRegistryEntry) => Promise<void> }) {
  const { skill } = input;
  return <article className="skill-card"><div className="skill-card__heading"><span className="panel-kicker">{skill.category} · {skill.phase}</span><span className={`skill-status skill-status--${skill.status}`}>{skill.status.replaceAll("-", " ")}</span></div><div><h2>{skill.name}</h2><p>{skill.description}</p></div><dl><div><dt>Role</dt><dd>{skill.role}</dd></div><div><dt>Source</dt><dd>{sourceLabel(skill)}</dd></div><div><dt>Health</dt><dd>{skill.metrics.averageScore === null ? "Not measured" : `${Math.round(skill.metrics.averageScore)}%`}</dd></div><div><dt>Last evaluated</dt><dd>{formatDate(skill.metrics.lastEvaluatedAt)}</dd></div></dl><div className="skill-card__stats"><span><strong>{skill.metrics.successRate === null ? "—" : `${Math.round(skill.metrics.successRate)}%`}</strong> success</span><span><strong>{skill.metrics.executions}</strong> executions</span><span><strong>{skill.metrics.failures}</strong> failures</span></div><footer><span>v{skill.version}</span><div><button className="button--quiet" onClick={() => void input.onOpen(skill.id)}>View Skill</button><button onClick={() => void input.onEvaluate(skill)}>Evaluate</button></div></footer></article>;
}

function SkillDetail(input: { readonly client: SisyphusDataClient; readonly skill: SkillRegistryDetail; readonly onBack: () => void; readonly onChanged: (skill: SkillRegistryDetail) => void; readonly onEvaluate: (skill: SkillRegistryEntry) => Promise<void> }) {
  const { skill } = input;
  const proposed = skill.proposals.filter((proposal) => proposal.status === "proposed");
  const resolveProposal = async (proposal: SkillImprovementProposal, action: "apply" | "reject") => {
    try { input.onChanged((await input.client.resolveSkillImprovementProposal(skill.id, proposal.id, { action })).skill); }
    catch { input.onChanged((await input.client.getSkillRegistryDetail(skill.id)).skill); }
  };
  return <main className="skills-center"><button className="button--quiet" onClick={input.onBack}>Back to Skills</button><header className="skills-header"><div><span className="panel-kicker">{sourceLabel(skill)} · {skill.category} · {skill.phase}</span><h1>{skill.name}</h1><p>{skill.description}</p></div><div className="skills-actions"><button onClick={() => void input.onEvaluate(skill)}>Evaluate Skill</button></div></header><section className="skill-detail-meta"><Metric label="Role" value={skill.role} /><Metric label="Version" value={skill.version} /><Metric label="License" value={skill.license} /><Metric label="Last synced" value={formatDate(skill.lastSyncedAt)} /></section><section className="skill-detail-layout"><article className="skill-performance"><span className="panel-kicker">Skill health</span><h2>{skill.metrics.averageScore === null ? "Not measured" : `${Math.round(skill.metrics.averageScore)}%`}</h2><div className="skill-health-track"><span style={{ width: `${skill.metrics.averageScore ?? 0}%` }} /></div><p>{skill.metrics.executions} total uses · {skill.metrics.failures} failed · {skill.metrics.averageRetries === null ? "No retry data" : `${skill.metrics.averageRetries.toFixed(1)} avg retries`}</p>{skill.performance.trend.length === 0 ? <p>No execution scores yet. Sisyphus records this only after isolated verification.</p> : <p>Last {skill.performance.trend.length} executions: {skill.performance.trend.join(" → ")}</p>}</article><article className="skill-performance"><span className="panel-kicker">Agent compatibility</span><h2>{skill.performance.compatibility.length === 0 ? "Waiting for evidence" : "Verified models"}</h2>{skill.performance.compatibility.length === 0 ? <p>Compatibility is learned from completed, attributed execution records.</p> : <ul className="skill-compatibility">{skill.performance.compatibility.map((item) => <li key={item.model}><span>{item.model}</span><strong>{item.successRate}%</strong><small>{item.executions} uses</small></li>)}</ul>}</article></section>{proposed.length === 0 ? null : <section className="skill-proposals"><span className="panel-kicker">Human review required</span><h2>Skill Improvement Proposal</h2>{proposed.map((proposal) => <ImprovementProposal key={proposal.id} proposal={proposal} onResolve={resolveProposal} />)}</section>}<section className="skill-detail-layout"><article className="skill-instructions"><h2>Skill Instructions</h2><MarkdownSections content={skill.instructions} /></article><article className="skill-performance"><h2>Recent failures</h2>{skill.performance.recentFailures.length === 0 ? <p>No attributed failures have been recorded for this skill.</p> : <ul className="skill-failure-list">{skill.performance.recentFailures.map((failure) => <li key={failure.executionId}><strong>{failure.requirementId}</strong><span>{failure.model} · {formatDate(failure.recordedAt)}</span><p>{failure.evidence}</p></li>)}</ul>}</article></section></main>;
}

function ImprovementProposal(input: { readonly proposal: SkillImprovementProposal; readonly onResolve: (proposal: SkillImprovementProposal, action: "apply" | "reject") => Promise<void> }) { const { proposal } = input; return <article className="skill-proposal"><dl><div><dt>Observed issue</dt><dd>{proposal.observedIssue}</dd></div><div><dt>Evidence</dt><dd>{proposal.evidence.failureCount} failures across {proposal.evidence.executionCount} executions</dd></div><div><dt>Suggested improvement</dt><dd>{proposal.suggestedImprovement}</dd></div><div><dt>Expected impact</dt><dd>{proposal.expectedImpact}</dd></div><div><dt>Confidence</dt><dd>{proposal.confidence}</dd></div></dl><div><button onClick={() => void input.onResolve(proposal, "apply")}>Apply Improvement</button><button className="button--quiet" onClick={() => void input.onResolve(proposal, "reject")}>Reject</button></div></article>; }
function MarkdownSections({ content }: { readonly content: string }) { const sections = content.split(/^##\s+/mu).filter(Boolean); return <div className="markdown-sections">{sections.map((section, index) => { const [heading = "Instructions", ...body] = section.split("\n"); return <article key={`${heading}-${index}`}><h3>{heading.replace(/^#\s+/u, "")}</h3><pre>{body.join("\n").trim()}</pre></article>; })}</div>; }
function CreateSkillForm(input: { readonly client: SisyphusDataClient; readonly onCancel: () => void; readonly onCreated: (skill: SkillRegistryDetail) => void }) { const [error, setError] = useState<string>(); const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const values = new FormData(event.currentTarget); const payload: CreateCustomSkill = { name: String(values.get("name") ?? ""), description: String(values.get("description") ?? ""), role: String(values.get("role") ?? ""), category: String(values.get("category") ?? ""), phase: String(values.get("phase") ?? ""), triggerConditions: String(values.get("triggers") ?? "").split("\n").map((value) => value.trim()).filter(Boolean), executionWorkflow: String(values.get("workflow") ?? ""), outputTemplate: String(values.get("output") ?? ""), definitionOfDone: String(values.get("done") ?? "") }; try { input.onCreated((await input.client.createCustomSkill(payload)).skill); } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "The custom skill could not be saved."); } }; return <form className="skill-create-form" onSubmit={submit}><h2>Create a Sisyphus Custom Skill</h2><label>Skill Name<input name="name" pattern="[a-z0-9-]+" required /></label><label>Description<textarea name="description" required /></label><label>Role<input name="role" required /></label><label>Category<input name="category" required /></label><label>Phase<input name="phase" required /></label><label>Trigger Conditions<textarea name="triggers" required /></label><label>Execution Workflow<textarea name="workflow" required /></label><label>Output Template<textarea name="output" required /></label><label>Definition of Done<textarea name="done" required /></label>{error === undefined ? null : <p role="alert">{error}</p>}<div><button type="submit">Save Custom Skill</button><button className="button--quiet" type="button" onClick={input.onCancel}>Cancel</button></div></form>; }
function Filter(input: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly values: readonly string[] }) { return <label className="skills-filter"><span>{input.label}</span><select value={input.value} onChange={(event) => input.onChange(event.currentTarget.value)}><option value="all">All</option>{input.values.map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</select></label>; }
function Metric({ label, value }: { readonly label: string; readonly value: string }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function formatDate(value: string | null): string { return value === null ? "Not yet" : new Date(value).toLocaleDateString(); }
function sourceLabel(skill: Pick<SkillRegistryEntry, "source">): string { return skill.source === "custom" ? "Sisyphus Custom" : skill.source === "enhanced" ? "Local Enhanced" : "OpenSkills"; }
function evaluationTask(skill: SkillRegistryEntry): string { return `Controlled skill evaluation for ${skill.id}. Use the selected ${skill.name} skill to produce a small, production-style implementation matching its workflow and definition of done. Create deterministic tests, validation, and security checks appropriate to this role. This is an evaluation task: keep the scope focused, accept only isolated sandbox evidence, and report the exact requirement evidence for any failure.`; }
