import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAdapterVersion,
  createAgentId,
  createRunId,
  createRetryBudgetId,
  createRuntimeInstallationIdentity,
  createEventId,
  createSessionId,
  createSkillId,
  createSkillVersionId,
  createSkillVersionKey,
  createTimestamp,
  createTriggerId,
  createWorkItemId,
  resolveSkill,
  type EvaluationConstraint,
  type HookObservation,
  type SkillDisposition,
  type SkillVersionId,
} from "@sisyphus/domain";
import { describe, expect, it } from "vitest";

import {
  ManagedCatalogPolicyProvider,
  createManagedSkillCatalog,
} from "./managed-catalog.js";
import { defaultEvaluationConstraint } from "./policy.js";
import type { PolicyProvider } from "./supervisor.js";

function sha256(source: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function promptEvent(prompt: string): HookObservation {
  return {
    kind: "prompt",
    eventId: createEventId("event-managed-catalog"),
    runId: createRunId("run-managed-catalog"),
    workItemId: createWorkItemId("work-managed-catalog"),
    retryBudgetId: createRetryBudgetId("budget-managed-catalog"),
    occurredAt: createTimestamp("2026-08-29T10:00:00.000Z"),
    adapterVersion: createAdapterVersion("0.1.0"),
    runtimeInstallation: createRuntimeInstallationIdentity({
      adapterInstallationId: "installation-managed-catalog",
      profile: "local",
    }),
    capabilities: {
      runtime: "codex",
      runtimeVersion: "0.99.0",
      promptInterception: { kind: "supported" },
      skillSelectionControl: { kind: "supported" },
      rootStopContinuation: { kind: "supported" },
      subagentStopContinuation: { kind: "supported" },
      toolPrevention: { kind: "supported" },
      toolObservation: { kind: "supported" },
      stableTokenUsage: { kind: "unsupported", reason: "not reported" },
      localEvidenceAccess: { kind: "supported" },
    },
    identity: {
      sessionId: createSessionId("session-managed-catalog"),
      agent: { kind: "root", agentId: createAgentId("agent-managed-catalog") },
    },
    prompt,
  };
}

function baseProvider(): PolicyProvider {
  return {
    constraintFor(): Promise<EvaluationConstraint> {
      return Promise.resolve(defaultEvaluationConstraint());
    },
  };
}

describe("managed skill catalog integration", () => {
  it("matches current versions and applies persisted standing before resolution", async () => {
    const service = await createManagedSkillCatalog({
      skills: [
        {
          skillId: createSkillId("specific-skill"),
          displayName: "Specific skill",
          description: "Handles the exact request.",
          canonicalContent: "Follow the exact workflow.",
          source: { kind: "file", path: "C:/skills/specific/SKILL.md" },
          triggers: [{ kind: "exact", pattern: "review this change" }],
        },
        {
          skillId: createSkillId("priority-skill"),
          displayName: "Priority skill",
          description: "Handles review requests.",
          canonicalContent: "Follow the administrator workflow.",
          source: { kind: "file", path: "C:/skills/priority/SKILL.md" },
          triggers: [{ kind: "contains", pattern: "review" }],
        },
      ],
      administratorPriorities: [
        { skillId: createSkillId("priority-skill"), priority: 20 },
      ],
      wrappers: [],
    });
    const priorityVersion = service.catalog.getCurrentVersion(
      createSkillId("priority-skill"),
    );
    if (priorityVersion === undefined) throw new Error("missing imported version");
    const standings = new Map<SkillVersionId, SkillDisposition>([
      [priorityVersion.skillVersionId, "quarantined"],
    ]);
    const provider = new ManagedCatalogPolicyProvider({
      base: baseProvider(),
      catalog: service,
      standing: {
        async dispositionFor(skillVersionId) {
          return standings.get(skillVersionId) ?? "active";
        },
      },
    });

    const constraint = await provider.constraintFor(promptEvent("review this change"));

    expect(constraint.skillCandidates).toHaveLength(2);
    expect(
      constraint.skillCandidates.find(
        (candidate) => candidate.skillVersionId === priorityVersion.skillVersionId,
      )?.disposition,
    ).toBe("quarantined");
    expect(
      constraint.skillCandidates.every(
        (candidate) => candidate.activationAvailability?.kind === "available",
      ),
    ).toBe(true);
    expect(resolveSkill(constraint.skillCandidates)).toMatchObject({
      kind: "selected",
    });
    expect(
      service.instructionFor("codex", priorityVersion.skillVersionId),
    ).toMatchObject({
      content: "Follow the administrator workflow.",
      provenance: { kind: "canonical" },
    });
  });

  it("records a policy candidate without a managed instruction as unavailable", async () => {
    const unavailableSkillVersionId = createSkillVersionId("missing-managed-snapshot");
    const base: PolicyProvider = {
      async constraintFor() {
        return {
          ...defaultEvaluationConstraint(),
          skillCandidates: [
            {
              skillVersionId: unavailableSkillVersionId,
              stableVersionKey: createSkillVersionKey("missing-managed-snapshot-v1"),
              displayName: "Missing managed snapshot",
              administratorPriority: 100,
              specificity: 100,
              disposition: "active",
              trigger: {
                triggerId: createTriggerId("missing-managed-snapshot-trigger"),
                kind: "contains",
                pattern: "review",
              },
            },
          ],
        };
      },
    };
    const service = await createManagedSkillCatalog({
      skills: [],
      administratorPriorities: [],
      wrappers: [],
    });
    const provider = new ManagedCatalogPolicyProvider({
      base,
      catalog: service,
      standing: { dispositionFor: async () => "active" },
    });

    const constraint = await provider.constraintFor(promptEvent("review this change"));

    expect(constraint.skillCandidates).toHaveLength(1);
    expect(constraint.skillCandidates[0]?.activationAvailability).toMatchObject({
      kind: "unavailable",
    });
    expect(resolveSkill(constraint.skillCandidates)).toMatchObject({
      kind: "none",
      candidates: [
        { outcome: { kind: "rejected", reason: "wrapper-unavailable" } },
      ],
    });
  });

  it("keeps wrappers separate and returns a hash-verified runtime instruction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-wrapper-"));
    const wrapperPath = join(directory, "codex-wrapper.md");
    const wrapperContent = "Use the Codex-specific managed workflow.";
    await writeFile(wrapperPath, wrapperContent, "utf8");
    const importedAt = createTimestamp("2026-08-29T10:00:00.000Z");
    const initial = await createManagedSkillCatalog({
      skills: [
        {
          skillId: createSkillId("wrapped-skill"),
          displayName: "Wrapped skill",
          description: "Uses a runtime wrapper.",
          canonicalContent: "Use the canonical workflow.",
          source: { kind: "file", path: join(directory, "SKILL.md") },
          triggers: [{ kind: "contains", pattern: "wrapped" }],
        },
      ],
      administratorPriorities: [],
      wrappers: [],
    });
    const version = initial.catalog.getCurrentVersion(createSkillId("wrapped-skill"));
    if (version === undefined) throw new Error("missing imported version");
    const service = await createManagedSkillCatalog({
      skills: [
        {
          skillId: createSkillId("wrapped-skill"),
          displayName: "Wrapped skill",
          description: "Uses a runtime wrapper.",
          canonicalContent: "Use the canonical workflow.",
          source: { kind: "file", path: join(directory, "SKILL.md") },
          triggers: [{ kind: "contains", pattern: "wrapped" }],
        },
      ],
      administratorPriorities: [],
      wrappers: [
        {
          runtime: "codex",
          skillVersionId: version.skillVersionId,
          reference: {
            kind: "file",
            path: wrapperPath,
            contentHash: sha256(wrapperContent),
          },
          registeredAt: importedAt,
        },
      ],
    });

    expect(service.instructionFor("codex", version.skillVersionId)).toMatchObject({
      content: wrapperContent,
      contentHash: sha256(wrapperContent),
      provenance: { kind: "runtime-wrapper" },
    });
    expect(service.catalog.getVersion(version.skillVersionId)).not.toHaveProperty("wrappers");
  });

  it("blocks startup when wrapper evidence does not match its declared hash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-wrapper-"));
    const wrapperPath = join(directory, "codex-wrapper.md");
    await writeFile(wrapperPath, "tampered", "utf8");
    const initial = await createManagedSkillCatalog({
      skills: [
        {
          skillId: createSkillId("wrapped-skill"),
          displayName: "Wrapped skill",
          description: "Uses a runtime wrapper.",
          canonicalContent: "Use the canonical workflow.",
          source: { kind: "file", path: join(directory, "SKILL.md") },
          triggers: [{ kind: "contains", pattern: "wrapped" }],
        },
      ],
      administratorPriorities: [],
      wrappers: [],
    });
    const version = initial.catalog.getCurrentVersion(createSkillId("wrapped-skill"));
    if (version === undefined) throw new Error("missing imported version");

    await expect(
      createManagedSkillCatalog({
        skills: [
          {
            skillId: createSkillId("wrapped-skill"),
            displayName: "Wrapped skill",
            description: "Uses a runtime wrapper.",
            canonicalContent: "Use the canonical workflow.",
            source: { kind: "file", path: join(directory, "SKILL.md") },
            triggers: [{ kind: "contains", pattern: "wrapped" }],
          },
        ],
        administratorPriorities: [],
        wrappers: [
          {
            runtime: "codex",
            skillVersionId: version.skillVersionId,
            reference: {
              kind: "file",
              path: wrapperPath,
              contentHash: sha256("expected"),
            },
            registeredAt: createTimestamp("2026-08-29T10:00:00.000Z"),
          },
        ],
      }),
    ).rejects.toThrow(/hash/i);
  });

  it("fails closed when a plugin-resource wrapper has no trusted loader", async () => {
    const initial = await createManagedSkillCatalog({
      skills: [
        {
          skillId: createSkillId("plugin-wrapped-skill"),
          displayName: "Plugin wrapped skill",
          description: "Requires a plugin-provided runtime wrapper.",
          canonicalContent: "Use the canonical workflow.",
          source: { kind: "file", path: "C:/skills/plugin-wrapped/SKILL.md" },
          triggers: [{ kind: "contains", pattern: "plugin wrapped" }],
        },
      ],
      administratorPriorities: [],
      wrappers: [],
    });
    const version = initial.catalog.getCurrentVersion(
      createSkillId("plugin-wrapped-skill"),
    );
    if (version === undefined) throw new Error("missing imported version");

    await expect(
      createManagedSkillCatalog({
        skills: [
          {
            skillId: createSkillId("plugin-wrapped-skill"),
            displayName: "Plugin wrapped skill",
            description: "Requires a plugin-provided runtime wrapper.",
            canonicalContent: "Use the canonical workflow.",
            source: { kind: "file", path: "C:/skills/plugin-wrapped/SKILL.md" },
            triggers: [{ kind: "contains", pattern: "plugin wrapped" }],
          },
        ],
        administratorPriorities: [],
        wrappers: [
          {
            runtime: "codex",
            skillVersionId: version.skillVersionId,
            reference: {
              kind: "plugin-resource",
              locator: "plugin://managed-skills/plugin-wrapped",
              contentHash: sha256("Use the Codex plugin workflow."),
            },
            registeredAt: createTimestamp("2026-08-29T10:00:00.000Z"),
          },
        ],
      }),
    ).rejects.toThrow("plugin-resource wrapper loader");
  });
});
