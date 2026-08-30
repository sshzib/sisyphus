import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { FileSkillRegistry, type SkillRegistryEntry } from "./skill-registry.js";

const sourceRegistryFile = fileURLToPath(
  new URL("../../../skills/registry/skills.json", import.meta.url),
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function temporaryRegistry(contents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sisyphus-skill-registry-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "registry"), { recursive: true });
  await writeFile(join(root, "registry", "skills.json"), contents, "utf8");
  return root;
}

async function baselineRegistry(): Promise<string> {
  return readFile(sourceRegistryFile, "utf8");
}

function execution(skill: SkillRegistryEntry, index: number) {
  return {
    executionId: `atomic-regression-${index}`,
    skillIds: [skill.id],
    skillVersions: [
      {
        id: skill.id,
        skillVersionId: skill.version,
        contentHash: `sha256:${skill.contentDigest}`,
      },
    ],
    taskId: "atomic-regression-task",
    agentId: "atomic-regression-agent",
    requirementId: `atomic-regression-${index}`,
    model: "local-static-fallback",
    outcome: "passed" as const,
    attempts: 1,
    durationMs: 10,
    evidence: "Regression coverage for serialized skill evidence persistence.",
    score: {
      total: 100,
      functional: 100,
      contractTests: 100,
      security: 100,
      requirementCompliance: 100,
      codeQuality: 100,
    },
  };
}

describe("FileSkillRegistry persistence", () => {
  it("recovers a valid 49-skill registry with an interrupted trailing write", async () => {
    const root = await temporaryRegistry(`${await baselineRegistry()}\n{\"interrupted\":true}`);
    const registry = new FileSkillRegistry(root);

    await expect(registry.list()).resolves.toHaveLength(49);

    const recovered = await readFile(join(root, "registry", "skills.json"), "utf8");
    expect(() => JSON.parse(recovered)).not.toThrow();
  });

  it("serializes concurrent execution records without losing registry metrics", async () => {
    const root = await temporaryRegistry(await baselineRegistry());
    const registry = new FileSkillRegistry(root);
    const before = await registry.list();
    const skill = before.at(0);
    if (skill === undefined) throw new Error("Expected a seeded skill registry.");

    await Promise.all(Array.from({ length: 12 }, (_, index) => registry.recordExecution(execution(skill, index))));

    const after = (await registry.list()).find((entry) => entry.id === skill.id);
    expect(after?.metrics.executions).toBe(skill.metrics.executions + 12);

    const records = JSON.parse(
      await readFile(join(root, "evaluations", skill.id, "results.json"), "utf8"),
    );
    expect(records).toHaveLength(12);
  });
});
