import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSkillId,
  createSkillVersionId,
  createTimestamp,
} from "@sisyphus/domain";

import {
  createContentHash,
  createInMemorySkillCatalog,
  type CanonicalSkillImport,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (!directory.startsWith(tmpdir())) {
      throw new Error(`refusing to remove unexpected test directory ${directory}`);
    }
    await rm(directory, { recursive: true, force: true });
  }
});

function skillImport(input: {
  content?: string;
  displayName?: string;
  triggers?: CanonicalSkillImport["triggers"];
} = {}): CanonicalSkillImport {
  return {
    skillId: createSkillId("test-skill"),
    displayName: input.displayName ?? "Test skill",
    description: "Checks a test task.",
    canonicalContent: input.content ?? "# Test skill\n\nFollow the test rules.",
    source: { kind: "file", path: "C:/skills/test-skill/SKILL.md" },
    triggers: input.triggers ?? [
      { kind: "contains", pattern: "test task" },
      { kind: "exact", pattern: "run the test task" },
    ],
  };
}

describe("managed skill import", () => {
  it("is content-addressed and idempotent", () => {
    const catalog = createInMemorySkillCatalog({
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    const definition = skillImport();

    const first = catalog.importSkill(definition);
    const replay = catalog.importSkill(definition);

    expect(first.kind).toBe("imported");
    expect(replay).toEqual({ kind: "existing", version: first.version });
    expect(first.version.contentHash).toBe(
      createContentHash(
        `sha256:${createHash("sha256").update(definition.canonicalContent).digest("hex")}`,
      ),
    );
    expect(catalog.listLineage(definition.skillId)).toHaveLength(1);
  });

  it("canonicalizes trigger order before deriving the version", () => {
    const catalog = createInMemorySkillCatalog();
    const definition = skillImport();
    const first = catalog.importSkill(definition);
    const reordered = catalog.importSkill({
      ...definition,
      triggers: [...definition.triggers].reverse(),
    });

    expect(reordered.kind).toBe("existing");
    expect(reordered.version.skillVersionId).toBe(first.version.skillVersionId);
  });

  it("preserves version lineage and does not promote an old replay", () => {
    const catalog = createInMemorySkillCatalog();
    const original = catalog.importSkill(skillImport({ content: "version one" })).version;
    const successor = catalog.importSkill(skillImport({ content: "version two" })).version;
    catalog.importSkill(skillImport({ content: "version one" }));

    expect(successor.lineage).toEqual({
      kind: "successor",
      previousVersionId: original.skillVersionId,
    });
    expect(catalog.listLineage(createSkillId("test-skill"))).toEqual([
      original,
      successor,
    ]);
    expect(catalog.getCurrentVersion(createSkillId("test-skill"))).toEqual(successor);
  });

  it("rejects unknown boundary fields and invalid regular expressions", () => {
    const catalog = createInMemorySkillCatalog();

    expect(() => catalog.importSkill({ ...skillImport(), vendorPayload: true })).toThrow();
    expect(() =>
      catalog.importSkill(skillImport({ triggers: [{ kind: "regex", pattern: "[" }] })),
    ).toThrow(/regular expression/i);
  });

  it("never modifies the source file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sisyphus-catalog-"));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, "SKILL.md");
    const original = "# Immutable source\n\nDo not rewrite me.\n";
    await writeFile(sourcePath, original, "utf8");
    const before = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
    const catalog = createInMemorySkillCatalog();

    catalog.importSkill({
      ...skillImport({ content: original }),
      source: { kind: "file", path: sourcePath },
    });

    const after = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
    expect(after).toBe(before);
    expect(await readFile(sourcePath, "utf8")).toBe(original);
  });
});

describe("runtime wrappers", () => {
  it("stores wrapper references outside the canonical version", () => {
    const catalog = createInMemorySkillCatalog();
    const version = catalog.importSkill(skillImport()).version;

    const wrapper = catalog.registerWrapper({
      runtime: "codex",
      skillVersionId: version.skillVersionId,
      reference: {
        kind: "plugin-resource",
        locator: "plugin://sisyphus/skills/test-skill.md",
        contentHash: createContentHash(
          "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        ),
      },
      registeredAt: createTimestamp("2026-08-29T10:00:00.000Z"),
    });

    expect("wrappers" in version).toBe(false);
    expect(catalog.listWrappers(version.skillVersionId)).toEqual([wrapper]);
    expect(catalog.getVersion(version.skillVersionId)).toEqual(version);
  });

  it("rejects wrappers for unknown skill versions", () => {
    const catalog = createInMemorySkillCatalog();

    expect(() =>
      catalog.registerWrapper({
        runtime: "cursor",
        skillVersionId: createSkillVersionId("missing-version"),
        reference: {
          kind: "file",
          path: "C:/wrappers/missing.md",
          contentHash: createContentHash(
            "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          ),
        },
        registeredAt: createTimestamp("2026-08-29T10:00:00.000Z"),
      }),
    ).toThrow(/unknown skill version/i);
  });
});

describe("trigger matching", () => {
  it("matches only current versions and keeps the most specific trigger per version", () => {
    const catalog = createInMemorySkillCatalog();
    const oldVersion = catalog.importSkill(
      skillImport({
        content: "old",
        triggers: [{ kind: "contains", pattern: "test" }],
      }),
    ).version;
    const current = catalog.importSkill(
      skillImport({
        content: "new",
        triggers: [
          { kind: "contains", pattern: "test" },
          { kind: "exact", pattern: "RUN THE TEST TASK" },
        ],
      }),
    ).version;
    catalog.setAdministratorPriority({
      skillId: createSkillId("test-skill"),
      priority: 17,
    });

    const matches = catalog.matchPrompt({ prompt: "run the test task" });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      skillVersionId: current.skillVersionId,
      administratorPriority: 17,
      disposition: "active",
      trigger: { kind: "exact", pattern: "RUN THE TEST TASK" },
    });
    expect(matches[0]?.skillVersionId).not.toBe(oldVersion.skillVersionId);
  });

  it("produces stable version IDs independent of catalog instance", () => {
    const definition = skillImport();
    const left = createInMemorySkillCatalog().importSkill(definition).version;
    const right = createInMemorySkillCatalog().importSkill(definition).version;

    expect(left.skillVersionId).toBe(right.skillVersionId);
    expect(left.stableVersionKey).toBe(right.stableVersionKey);
  });
});
