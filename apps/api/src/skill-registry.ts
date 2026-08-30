import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { createInMemorySkillCatalog } from "@sisyphus/catalog";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const SourceManifestSchema = z
  .object({
    version: z.string().trim().min(1),
    repository: z.string().url(),
    license: z.literal("MIT"),
    skills: z
      .array(
        z
          .object({
            name: z.string().trim().regex(/^[a-z0-9-]+$/u),
            path: z.string().trim().min(1),
            category: z.string().trim().min(1),
            phase: z.string().trim().min(1),
            description: z.string().trim().min(1),
            tags: z.array(z.string().trim().min(1)).default([]),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const RegistryMetricsSchema = z
  .object({
    executions: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(100).nullable(),
    averageRetries: z.number().nonnegative().nullable(),
    averageExecutionMs: z.number().nonnegative().nullable(),
    lastEvaluatedAt: z.string().datetime().nullable(),
    averageScore: z.number().min(0).max(100).nullable().default(null),
    totalRetries: z.number().int().nonnegative(),
    totalExecutionMs: z.number().int().nonnegative(),
    totalScore: z.number().nonnegative().default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.failures > value.executions) {
      context.addIssue({
        code: "custom",
        path: ["failures"],
        message: "failures cannot exceed executions",
      });
    }
  });

const RegistryEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    name: z.string().min(1),
    role: z.string().min(1),
    description: z.string().min(1),
    triggers: z.array(z.string().min(1)).min(1).max(40),
    category: z.string().min(1),
    phase: z.string().min(1),
    tags: z.array(z.string()).max(40),
    source: z.enum(["upstream", "enhanced", "custom"]),
    baseSkillId: z.string().regex(/^[a-z0-9-]+$/u).nullable().default(null),
    status: z.enum(["active", "needs-improvement", "draft"]),
    version: z.string().min(1),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    contentPath: z.string().min(1),
    sourceUrl: z.string().url(),
    license: z.string().min(1),
    lastSyncedAt: z.string().datetime(),
    metrics: RegistryMetricsSchema,
  })
  .strict();

const RegistryFileSchema = z
  .object({
    sourceRevision: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
    syncedAt: z.string().datetime().nullable(),
    entries: z.array(RegistryEntrySchema),
  })
  .strict();

const CustomSkillInputSchema = z
  .object({
    name: z.string().trim().regex(/^[a-z0-9-]+$/u),
    description: z.string().trim().min(20).max(2_000),
    role: z.string().trim().min(2).max(100),
    category: z.string().trim().min(2).max(100),
    phase: z.string().trim().min(2).max(100),
    triggerConditions: z.array(z.string().trim().min(3).max(300)).min(1).max(20),
    executionWorkflow: z.string().trim().min(20).max(12_000),
    outputTemplate: z.string().trim().min(10).max(8_000),
    definitionOfDone: z.string().trim().min(10).max(8_000),
  })
  .strict();

export const SkillExecutionInputSchema = z
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

const SkillExecutionRecordSchema = SkillExecutionInputSchema.extend({
  recordedAt: z.string().datetime(),
}).strict();

const SkillImprovementProposalSchema = z
  .object({
    id: z.string().regex(/^proposal-[a-f0-9]{16}$/u),
    skillId: z.string().regex(/^[a-z0-9-]+$/u),
    status: z.enum(["proposed", "applied", "rejected"]),
    observedIssue: z.string().min(1).max(1_000),
    evidence: z
      .object({
        executionCount: z.number().int().nonnegative(),
        failureCount: z.number().int().nonnegative(),
        failureExamples: z.array(z.string().min(1).max(1_000)).max(3),
      })
      .strict(),
    suggestedImprovement: z.string().min(1).max(2_000),
    expectedImpact: z.string().min(1).max(1_000),
    confidence: z.enum(["low", "medium", "high"]),
    createdAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
  })
  .strict();

export const SkillSelectionRequestSchema = z
  .object({
    request: z.string().trim().min(20).max(4_000),
    role: z.string().trim().min(2).max(80),
    phase: z.enum(["build", "review"]),
    limit: z.number().int().min(1).max(4).default(3),
  })
  .strict();
export type SkillSelectionRequest = z.infer<typeof SkillSelectionRequestSchema>;

export const SelectedSkillSchema = z
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
export type SelectedSkill = z.infer<typeof SelectedSkillSchema>;

export type CustomSkillInput = z.infer<typeof CustomSkillInputSchema>;
export type SkillExecutionInput = z.infer<typeof SkillExecutionInputSchema>;
export type SkillRegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type SkillImprovementProposal = z.infer<typeof SkillImprovementProposalSchema>;
export type SkillExecutionRecord = z.infer<typeof SkillExecutionRecordSchema>;
export type SkillPerformance = {
  readonly trend: readonly number[];
  readonly compatibility: readonly {
    readonly model: string;
    readonly executions: number;
    readonly successRate: number;
  }[];
  readonly recentFailures: readonly {
    readonly executionId: string;
    readonly requirementId: string;
    readonly model: string;
    readonly evidence: string;
    readonly recordedAt: string;
  }[];
};
export type SkillRegistryDetail = SkillRegistryEntry & {
  readonly instructions: string;
  readonly performance: SkillPerformance;
  readonly proposals: readonly SkillImprovementProposal[];
};

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sourcePath(root: string, path: string): string {
  const candidate = resolve(root, path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("A skill source path escaped the registry root.");
  }
  return candidate;
}

function parseFrontmatter(content: string): {
  readonly name: string | undefined;
  readonly description: string | undefined;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  const frontmatter = match?.[1];
  if (frontmatter === undefined) return { name: undefined, description: undefined };
  const fields = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/u)) {
    const field = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/u.exec(line);
    const key = field?.[1];
    const value = field?.[2];
    if (key !== undefined && value !== undefined) {
      fields.set(key, value.replace(/^['"]|['"]$/gu, "").trim());
    }
  }
  return { name: fields.get("name"), description: fields.get("description") };
}

function titleFromMarkdown(content: string, fallback: string): string {
  const match = /^#\s+(.+)$/mu.exec(content);
  return match?.[1]?.replace(/^\p{Emoji_Presentation}\s*/u, "").trim() || fallback;
}

function triggerConditions(input: {
  readonly id: string;
  readonly description: string;
  readonly tags: readonly string[];
}): string[] {
  const extracted = /use when\s+(.+?)(?:\.|$)/iu.exec(input.description)?.[1]
    ?.split(/,|\bor\b/iu)
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  return [...new Set([...extracted, input.id, ...input.tags])].slice(0, 40);
}

function tokenize(value: string): readonly string[] {
  return value.toLowerCase().match(/[a-z0-9]{3,}/gu) ?? [];
}

function skillTerms(entry: z.infer<typeof RegistryEntrySchema>): readonly string[] {
  return tokenize(
    [
      entry.id,
      entry.role,
      entry.category,
      entry.phase,
      entry.description,
      ...entry.tags,
      ...entry.triggers,
    ].join(" "),
  );
}

function overlappingTerms(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  return [...left].filter((term) => right.has(term)).length;
}

function roleSelectionTerms(role: string): readonly string[] {
  const normalized = role.toLowerCase();
  const aliases: string[] = [];
  if (/frontend|ui|ux|visual/iu.test(normalized)) {
    aliases.push("frontend", "ui", "ux", "html", "css", "react", "component", "visual");
  }
  if (/backend|api|database|data/iu.test(normalized)) {
    aliases.push("backend", "api", "server", "database", "data", "validation", "persistence");
  }
  if (/qa|quality|test/iu.test(normalized)) {
    aliases.push("qa", "quality", "test", "testing", "e2e", "playwright", "regression");
  }
  if (/review|audit/iu.test(normalized)) {
    aliases.push("review", "audit", "quality", "maintainability", "code");
  }
  if (/security/iu.test(normalized)) {
    aliases.push("security", "threat", "vulnerability", "auth", "validation");
  }
  if (/devops|cloud|deploy/iu.test(normalized)) {
    aliases.push("devops", "cloud", "deployment", "cicd", "infrastructure");
  }
  return [...new Set([...tokenize(role), ...aliases])];
}

function phaseScore(
  entry: z.infer<typeof RegistryEntrySchema>,
  phase: SkillSelectionRequest["phase"],
): number {
  const entryPhase = entry.phase.toLowerCase();
  if (phase === "build") return entryPhase === "build" ? 5 : 0;
  if (["test", "review", "reflect"].includes(entryPhase)) return 5;
  return entry.category.toLowerCase() === "quality" ? 2 : 0;
}

function emptyMetrics(): z.infer<typeof RegistryMetricsSchema> {
  return {
    executions: 0,
    failures: 0,
    successRate: null,
    averageRetries: null,
    averageExecutionMs: null,
    lastEvaluatedAt: null,
    averageScore: null,
    totalRetries: 0,
    totalExecutionMs: 0,
    totalScore: 0,
  };
}

function updateMetrics(
  current: z.infer<typeof RegistryMetricsSchema>,
  record: z.infer<typeof SkillExecutionRecordSchema>,
): z.infer<typeof RegistryMetricsSchema> {
  const executions = current.executions + 1;
  const failures = current.failures + (record.outcome === "failed" ? 1 : 0);
  const totalRetries = current.totalRetries + Math.max(0, record.attempts - 1);
  const totalExecutionMs = current.totalExecutionMs + record.durationMs;
  const totalScore = current.totalScore + record.score.total;
  return {
    executions,
    failures,
    successRate: Math.round(((executions - failures) / executions) * 100),
    averageRetries: totalRetries / executions,
    averageExecutionMs: totalExecutionMs / executions,
    lastEvaluatedAt: record.recordedAt,
    averageScore: Math.round(totalScore / executions),
    totalRetries,
    totalExecutionMs,
    totalScore,
  };
}

function skillNeedsImprovement(metrics: z.infer<typeof RegistryMetricsSchema>): boolean {
  return (
    metrics.executions >= 3 &&
    metrics.failures >= 2 &&
    metrics.failures / metrics.executions >= 0.25
  );
}

export class FileSkillRegistry {
  readonly #root: string;
  readonly #sourceRoot: string;
  readonly #registryFile: string;
  readonly #customRoot: string;
  readonly #enhancedRoot: string;
  readonly #evaluationRoot: string;
  readonly #catalog = createInMemorySkillCatalog();

  public constructor(root: string) {
    this.#root = resolve(root);
    this.#sourceRoot = join(this.#root, "sources", "openskills");
    this.#registryFile = join(this.#root, "registry", "skills.json");
    this.#customRoot = join(this.#root, "custom");
    this.#enhancedRoot = join(this.#root, "enhanced");
    this.#evaluationRoot = join(this.#root, "evaluations");
  }

  public async list(): Promise<SkillRegistryEntry[]> {
    return (await this.#load()).entries
      .map((entry) => this.#toPublicEntry(entry))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  }

  public async detail(id: string): Promise<SkillRegistryDetail | undefined> {
    const entry = (await this.#load()).entries.find((candidate) => candidate.id === id);
    if (entry === undefined) return undefined;
    const instructions = await readFile(sourcePath(this.#root, entry.contentPath), "utf8");
    const records = await this.#readExecutionRecords(entry.id);
    const proposals = await this.#readImprovementProposals(entry.id);
    return {
      ...this.#toPublicEntry(entry),
      instructions,
      performance: this.#performance(records),
      proposals,
    };
  }

  public async select(input: SkillSelectionRequest | unknown): Promise<SelectedSkill[]> {
    const request = SkillSelectionRequestSchema.parse(input);
    const requestTerms = new Set(tokenize(request.request));
    const roleTerms = new Set(roleSelectionTerms(request.role));
    const registry = await this.#load();
    const enhancedBaseIds = new Set(
      registry.entries
        .filter((entry) => entry.source === "enhanced" && entry.status === "active")
        .map((entry) => entry.baseSkillId)
        .filter((id): id is string => id !== null),
    );
    const candidates = registry.entries
      .filter((entry) => entry.status === "active")
      .filter((entry) => entry.source !== "upstream" || !enhancedBaseIds.has(entry.id))
      .map((entry) => {
        const terms = new Set(skillTerms(entry));
        const requestScore = overlappingTerms(terms, requestTerms);
        const roleScore = overlappingTerms(terms, roleTerms);
        return {
          entry,
          // Role relevance must dominate broad request words such as
          // "engineering", otherwise a generic planning skill can displace
          // the frontend, QA, or review capability that an agent actually needs.
          score: requestScore + roleScore * 8 + phaseScore(entry, request.phase),
        };
      })
      .filter((candidate) => candidate.score > 0)
      .toSorted(
        (left, right) =>
          right.score - left.score || left.entry.id.localeCompare(right.entry.id),
      )
      .slice(0, request.limit);

    const selected: SelectedSkill[] = [];
    for (const candidate of candidates) {
      const detail = await this.detail(candidate.entry.id);
      if (detail === undefined) continue;
      const imported = this.#catalog.importSkill({
        skillId: detail.id,
        displayName: detail.name,
        description: detail.description,
        canonicalContent: detail.instructions,
        source: {
          kind: "file",
          path: sourcePath(this.#root, candidate.entry.contentPath),
        },
        triggers: detail.triggers.map((pattern) => ({
          kind: "contains" as const,
          pattern,
        })),
      });
      selected.push(
        SelectedSkillSchema.parse({
          id: detail.id,
          name: detail.name,
          description: detail.description,
          skillVersionId: imported.version.skillVersionId,
          stableVersionKey: imported.version.stableVersionKey,
          contentHash: imported.version.contentHash,
          instructions: detail.instructions,
        }),
      );
    }
    return selected;
  }

  public async sync(): Promise<{
    readonly added: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly total: number;
    readonly syncedAt: string;
  }> {
    await this.#refreshUpstreamSource();
    return this.#synchronizeIndex();
  }

  public async previewSync(): Promise<{
    readonly added: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly total: number;
    readonly localEnhancements: number;
    readonly sourceRevision: string;
  }> {
    await this.#fetchUpstreamSource();
    const revision = await this.#gitRevision("FETCH_HEAD");
    const manifestText = await this.#gitShow(revision, "skills.json");
    const source = SourceManifestSchema.parse(JSON.parse(manifestText));
    const previous = await this.#readRegistry();
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    for (const skill of source.skills) {
      const content = await this.#gitShow(revision, skill.path);
      const old = previous.entries.find(
        (entry) => entry.id === skill.name && entry.source === "upstream",
      );
      if (old === undefined) added += 1;
      else if (old.contentDigest === digest(content)) unchanged += 1;
      else updated += 1;
    }
    return {
      added,
      updated,
      unchanged,
      total: source.skills.length,
      localEnhancements: previous.entries.filter((entry) => entry.source !== "upstream").length,
      sourceRevision: revision,
    };
  }

  public async createCustom(input: CustomSkillInput | unknown): Promise<SkillRegistryEntry> {
    const value = CustomSkillInputSchema.parse(input);
    const existing = await this.#load();
    if (existing.entries.some((entry) => entry.id === value.name)) {
      throw new Error("A skill with that name already exists.");
    }
    const content = [
      "---",
      `name: ${value.name}`,
      `description: ${value.description}`,
      "---",
      "",
      `# ${value.role}`,
      "",
      "## When to Invoke",
      ...value.triggerConditions.map((condition) => `- ${condition}`),
      "",
      "## Execution Workflow",
      value.executionWorkflow,
      "",
      "## Output Template",
      value.outputTemplate,
      "",
      "## Definition of Done",
      value.definitionOfDone,
      "",
    ].join("\n");
    const relativePath = join("custom", value.name, "SKILL.md").replaceAll("\\", "/");
    const target = sourcePath(this.#root, relativePath);
    await mkdir(join(this.#customRoot, value.name), { recursive: true });
    await writeFile(target, content, { encoding: "utf8", flag: "wx" });
    const entry = RegistryEntrySchema.parse({
      id: value.name,
      name: value.role,
      role: value.role,
      description: value.description,
      triggers: triggerConditions({
        id: value.name,
        description: value.description,
        tags: [],
      }),
      category: value.category,
      phase: value.phase,
      tags: [],
      source: "custom",
      status: "draft",
      version: `local-${new Date().toISOString().slice(0, 10)}`,
      contentDigest: digest(content),
      contentPath: relativePath,
      sourceUrl: "https://sisyphus.local/custom-skills",
      license: "Sisyphus Custom Skill",
      lastSyncedAt: new Date().toISOString(),
      metrics: emptyMetrics(),
    });
    await this.#write({ ...existing, entries: [...existing.entries, entry] });
    return this.#toPublicEntry(entry);
  }

  public async recordExecution(input: SkillExecutionInput | unknown): Promise<void> {
    const record = SkillExecutionRecordSchema.parse({
      ...SkillExecutionInputSchema.parse(input),
      recordedAt: new Date().toISOString(),
    });
    const registry = await this.#load();
    let changed = false;
    const entries = await Promise.all(
      registry.entries.map(async (entry) => {
        if (!record.skillIds.includes(entry.id)) return entry;
        if (await this.#recordExists(entry.id, record.executionId)) return entry;
        await this.#appendExecution(entry.id, record);
        const metrics = updateMetrics(entry.metrics, record);
        changed = true;
        return RegistryEntrySchema.parse({
          ...entry,
          metrics,
          status:
            entry.source === "custom" && entry.status === "draft"
              ? "draft"
              : skillNeedsImprovement(metrics)
                ? "needs-improvement"
                : "active",
        });
      }),
    );
    if (changed) await this.#write({ ...registry, entries });
    await Promise.all(
      record.skillIds.map(async (skillId) => {
        const entry = entries.find((candidate) => candidate.id === skillId);
        if (entry === undefined || entry.status !== "needs-improvement") return;
        await this.#createProposalWhenNeeded(entry, await this.#readExecutionRecords(skillId));
      }),
    );
  }

  public async resolveImprovementProposal(input: {
    readonly skillId: string;
    readonly proposalId: string;
    readonly action: "apply" | "reject";
  }): Promise<SkillRegistryDetail> {
    const registry = await this.#load();
    const entry = registry.entries.find((candidate) => candidate.id === input.skillId);
    if (entry === undefined) throw new Error("The requested skill is not in the registry.");
    const proposals = await this.#readImprovementProposals(entry.id);
    const proposal = proposals.find((candidate) => candidate.id === input.proposalId);
    if (proposal === undefined) throw new Error("The requested improvement proposal does not exist.");
    if (proposal.status !== "proposed") throw new Error("This improvement proposal has already been resolved.");
    const resolvedAt = new Date().toISOString();
    if (input.action === "reject") {
      await this.#writeImprovementProposals(
        entry.id,
        proposals.map((candidate) =>
          candidate.id === proposal.id
            ? SkillImprovementProposalSchema.parse({ ...candidate, status: "rejected", resolvedAt })
            : candidate,
        ),
      );
      const detail = await this.detail(entry.id);
      if (detail === undefined) throw new Error("The skill could not be loaded after resolving the proposal.");
      return detail;
    }

    const enhancedId = `${entry.id}-enhanced`;
    if (registry.entries.some((candidate) => candidate.id === enhancedId)) {
      throw new Error("An enhanced version already exists for this skill.");
    }
    const original = await readFile(sourcePath(this.#root, entry.contentPath), "utf8");
    const enhancement = [
      "",
      "## Local Improvement (human approved)",
      "",
      proposal.suggestedImprovement,
      "",
      "### Evidence context",
      "",
      `This local enhancement was approved after ${proposal.evidence.failureCount} verified failures across ${proposal.evidence.executionCount} recorded executions. It does not change the original upstream skill.`,
      "",
    ].join("\n");
    const content = `${original.trimEnd()}\n${enhancement}`;
    const relativePath = join("enhanced", entry.id, "SKILL.md").replaceAll("\\", "/");
    const target = sourcePath(this.#root, relativePath);
    await mkdir(join(this.#enhancedRoot, entry.id), { recursive: true });
    await writeFile(target, content, { encoding: "utf8", flag: "wx" });
    if (entry.source === "upstream") {
      await copyFile(
        sourcePath(this.#root, "sources/openskills/LICENSE"),
        sourcePath(this.#root, join("enhanced", entry.id, "LICENSE")),
      );
    }
    const enhanced = RegistryEntrySchema.parse({
      ...entry,
      id: enhancedId,
      source: "enhanced",
      baseSkillId: entry.id,
      status: "active",
      version: `${entry.version}+enhanced.${digest(content).slice(0, 10)}`,
      contentDigest: digest(content),
      contentPath: relativePath,
      lastSyncedAt: resolvedAt,
      metrics: emptyMetrics(),
    });
    await this.#write({ ...registry, entries: [...registry.entries, enhanced] });
    await this.#writeImprovementProposals(
      entry.id,
      proposals.map((candidate) =>
        candidate.id === proposal.id
          ? SkillImprovementProposalSchema.parse({ ...candidate, status: "applied", resolvedAt })
          : candidate,
      ),
    );
    const detail = await this.detail(enhanced.id);
    if (detail === undefined) throw new Error("The enhanced skill could not be loaded after approval.");
    return detail;
  }

  async #load(): Promise<z.infer<typeof RegistryFileSchema>> {
    const registry = await this.#readRegistry();
    return registry.entries.length === 0
      ? (await this.#synchronizeIndex(), this.#readRegistry())
      : registry;
  }

  async #synchronizeIndex(): Promise<{
    readonly added: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly total: number;
    readonly syncedAt: string;
  }> {
    const previous = await this.#readRegistry();
    const manifestText = await readFile(join(this.#sourceRoot, "skills.json"), "utf8");
    const source = SourceManifestSchema.parse(JSON.parse(manifestText));
    const syncedAt = new Date().toISOString();
    const nextEntries: SkillRegistryEntry[] = [];
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    for (const skill of source.skills) {
      const contentPath = join("sources", "openskills", skill.path).replaceAll("\\", "/");
      const content = await readFile(sourcePath(this.#root, contentPath), "utf8");
      const frontmatter = parseFrontmatter(content);
      if (frontmatter.name !== undefined && frontmatter.name !== skill.name) {
        throw new Error(`Skill manifest and frontmatter disagree for ${skill.name}.`);
      }
      const contentDigest = digest(content);
      const old = previous.entries.find(
        (entry) => entry.id === skill.name && entry.source === "upstream",
      );
      if (old === undefined) added += 1;
      else if (old.contentDigest === contentDigest) unchanged += 1;
      else updated += 1;
      const description = frontmatter.description ?? skill.description;
      nextEntries.push(
        RegistryEntrySchema.parse({
          id: skill.name,
          name: titleFromMarkdown(content, skill.name),
          role: titleFromMarkdown(content, skill.name),
          description,
          triggers: triggerConditions({ id: skill.name, description, tags: skill.tags }),
          category: skill.category,
          phase: skill.phase,
          tags: skill.tags,
          source: "upstream",
          status: old?.status === "needs-improvement" ? "needs-improvement" : "active",
          version: source.version,
          contentDigest,
          contentPath,
          sourceUrl: source.repository,
          license: source.license,
          lastSyncedAt: syncedAt,
          metrics: old?.metrics ?? emptyMetrics(),
        }),
      );
    }
    const localEntries = previous.entries.filter((entry) => entry.source !== "upstream");
    await this.#write({
      sourceRevision: digest(manifestText),
      syncedAt,
      entries: [...nextEntries, ...localEntries],
    });
    return { added, updated, unchanged, total: nextEntries.length, syncedAt };
  }

  async #refreshUpstreamSource(): Promise<void> {
    try {
      await execFileAsync(
        "git",
        [
          "-c",
          "core.hooksPath=NUL",
          "-C",
          this.#sourceRoot,
          "pull",
          "--ff-only",
          "--quiet",
        ],
        { timeout: 20_000, windowsHide: true },
      );
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : "unknown error";
      throw new Error(`The OpenSkills source could not be synchronized: ${detail}`);
    }
  }

  async #fetchUpstreamSource(): Promise<void> {
    try {
      await execFileAsync(
        "git",
        ["-c", "core.hooksPath=NUL", "-C", this.#sourceRoot, "fetch", "--quiet", "origin", "HEAD"],
        { timeout: 20_000, windowsHide: true },
      );
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : "unknown error";
      throw new Error(`The OpenSkills source could not be checked for updates: ${detail}`);
    }
  }

  async #gitRevision(reference: string): Promise<string> {
    const result = await execFileAsync(
      "git",
      ["-C", this.#sourceRoot, "rev-parse", "--verify", reference],
      { timeout: 10_000, windowsHide: true },
    );
    return result.stdout.trim();
  }

  async #gitShow(revision: string, path: string): Promise<string> {
    const result = await execFileAsync(
      "git",
      ["-C", this.#sourceRoot, "show", `${revision}:${path.replaceAll("\\", "/")}`],
      { timeout: 10_000, windowsHide: true, maxBuffer: 1_000_000 },
    );
    return result.stdout;
  }

  #performance(records: readonly SkillExecutionRecord[]): SkillPerformance {
    const byModel = new Map<string, { executions: number; successes: number }>();
    for (const record of records) {
      const summary = byModel.get(record.model) ?? { executions: 0, successes: 0 };
      summary.executions += 1;
      summary.successes += record.outcome === "passed" ? 1 : 0;
      byModel.set(record.model, summary);
    }
    return {
      trend: records.slice(-10).map((record) => Math.round(record.score.total)),
      compatibility: [...byModel.entries()]
        .map(([model, value]) => ({
          model,
          executions: value.executions,
          successRate: Math.round((value.successes / value.executions) * 100),
        }))
        .toSorted((left, right) => right.successRate - left.successRate || right.executions - left.executions),
      recentFailures: records
        .filter((record) => record.outcome === "failed")
        .slice(-5)
        .toReversed()
        .map((record) => ({
          executionId: record.executionId,
          requirementId: record.requirementId,
          model: record.model,
          evidence: record.evidence,
          recordedAt: record.recordedAt,
        })),
    };
  }

  async #createProposalWhenNeeded(
    entry: SkillRegistryEntry,
    records: readonly SkillExecutionRecord[],
  ): Promise<void> {
    const proposals = await this.#readImprovementProposals(entry.id);
    if (proposals.some((proposal) => proposal.status === "proposed")) return;
    const failures = records.filter((record) => record.outcome === "failed");
    const failureRate = failures.length / records.length;
    if (records.length < 3 || failures.length < 2 || failureRate < 0.25) return;
    const examples = failures.slice(-3).map((record) => record.evidence);
    const recurringEvidence = examples[0] ?? "verified sandbox failures";
    const confidence = failures.length >= 4 && failureRate >= 0.5 ? "high" : "medium";
    const proposal = SkillImprovementProposalSchema.parse({
      id: `proposal-${digest(`${entry.id}\u0000${records.length}\u0000${failures.length}`).slice(0, 16)}`,
      skillId: entry.id,
      status: "proposed",
      observedIssue: `Repeated verified failures were recorded while ${entry.name} was selected (${failures.length} of ${records.length} executions).`,
      evidence: {
        executionCount: records.length,
        failureCount: failures.length,
        failureExamples: examples,
      },
      suggestedImprovement: `Add an explicit verification checkpoint to the execution workflow: before completion, inspect the relevant acceptance contract and validate the affected behavior. Recent evidence: ${recurringEvidence}`,
      expectedImpact: "Make the recurring verification step explicit for future agents and reduce repeat failures without changing the upstream source.",
      confidence,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    });
    await this.#writeImprovementProposals(entry.id, [...proposals, proposal]);
  }

  async #recordExists(skillId: string, executionId: string): Promise<boolean> {
    const records = await this.#readExecutionRecords(skillId);
    return records.some((record) => record.executionId === executionId);
  }

  async #appendExecution(
    skillId: string,
    record: z.infer<typeof SkillExecutionRecordSchema>,
  ): Promise<void> {
    const records = await this.#readExecutionRecords(skillId);
    await mkdir(join(this.#evaluationRoot, skillId), { recursive: true });
    await writeFile(
      join(this.#evaluationRoot, skillId, "results.json"),
      JSON.stringify([...records, record], null, 2),
      "utf8",
    );
  }

  async #readImprovementProposals(
    skillId: string,
  ): Promise<readonly SkillImprovementProposal[]> {
    try {
      return z
        .array(SkillImprovementProposalSchema)
        .parse(
          JSON.parse(
            await readFile(join(this.#evaluationRoot, skillId, "proposals.json"), "utf8"),
          ),
        );
    } catch (cause: unknown) {
      if (cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
        return [];
      }
      throw cause;
    }
  }

  async #writeImprovementProposals(
    skillId: string,
    proposals: readonly SkillImprovementProposal[],
  ): Promise<void> {
    await mkdir(join(this.#evaluationRoot, skillId), { recursive: true });
    await writeFile(
      join(this.#evaluationRoot, skillId, "proposals.json"),
      JSON.stringify(proposals, null, 2),
      "utf8",
    );
  }

  async #readExecutionRecords(
    skillId: string,
  ): Promise<readonly z.infer<typeof SkillExecutionRecordSchema>[]> {
    try {
      return z
        .array(SkillExecutionRecordSchema)
        .parse(
          JSON.parse(
            await readFile(join(this.#evaluationRoot, skillId, "results.json"), "utf8"),
          ),
        );
    } catch (cause: unknown) {
      if (cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
        return [];
      }
      throw cause;
    }
  }

  async #readRegistry(): Promise<z.infer<typeof RegistryFileSchema>> {
    try {
      return RegistryFileSchema.parse(JSON.parse(await readFile(this.#registryFile, "utf8")));
    } catch (cause: unknown) {
      if (cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
        return { sourceRevision: null, syncedAt: null, entries: [] };
      }
      throw cause;
    }
  }

  async #write(value: z.infer<typeof RegistryFileSchema>): Promise<void> {
    await mkdir(join(this.#root, "registry"), { recursive: true });
    await writeFile(this.#registryFile, JSON.stringify(value, null, 2), "utf8");
  }

  #toPublicEntry(entry: SkillRegistryEntry): SkillRegistryEntry {
    const {
      contentPath: _contentPath,
      metrics: {
        totalRetries: _totalRetries,
        totalExecutionMs: _totalExecutionMs,
        totalScore: _totalScore,
        ...metrics
      },
      ...publicEntry
    } = entry;
    return { ...publicEntry, metrics } as SkillRegistryEntry;
  }
}
