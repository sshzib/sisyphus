import { createHash } from "node:crypto";

import {
  createSkillVersionId,
  createSkillVersionKey,
  createTimestamp,
  createTriggerId,
  type SkillId,
  type SkillMatchCandidate,
  type SkillVersionId,
} from "@sisyphus/domain";

import {
  CanonicalSkillImportSchema,
  CanonicalSkillVersionSchema,
  MatchPromptInputSchema,
  RegisterRuntimeWrapperSchema,
  RuntimeSkillWrapperSchema,
  SetAdministratorPrioritySchema,
  createContentHash,
  createWrapperId,
  type CanonicalSkillImport,
  type CanonicalSkillVersion,
  type CanonicalTrigger,
  type ContentHash,
  type MatchPromptInput,
  type RegisterRuntimeWrapper,
  type RuntimeSkillWrapper,
  type SetAdministratorPriority,
} from "./schemas.js";

export type ImportSkillResult =
  | { readonly kind: "imported"; readonly version: CanonicalSkillVersion }
  | { readonly kind: "existing"; readonly version: CanonicalSkillVersion };

export interface ManagedSkillCatalog {
  importSkill(input: CanonicalSkillImport | unknown): ImportSkillResult;
  getVersion(skillVersionId: SkillVersionId): CanonicalSkillVersion | undefined;
  getCurrentVersion(skillId: SkillId): CanonicalSkillVersion | undefined;
  listLineage(skillId: SkillId): readonly CanonicalSkillVersion[];

  setAdministratorPriority(input: SetAdministratorPriority | unknown): void;
  matchPrompt(input: MatchPromptInput | unknown): readonly SkillMatchCandidate[];

  registerWrapper(input: RegisterRuntimeWrapper | unknown): RuntimeSkillWrapper;
  listWrappers(skillVersionId: SkillVersionId): readonly RuntimeSkillWrapper[];
}

function digest(text: string): ContentHash {
  return createContentHash(`sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`);
}

export function hashCanonicalContent(content: string): ContentHash {
  return digest(content);
}

function canonicalTriggerInputs(
  triggers: CanonicalSkillImport["triggers"],
): CanonicalSkillImport["triggers"] {
  return triggers.toSorted((left, right) => {
    const byKind = compareCodeUnits(left.kind, right.kind);
    return byKind !== 0 ? byKind : compareCodeUnits(left.pattern, right.pattern);
  });
}

function canonicalDefinitionHash(
  input: CanonicalSkillImport,
  contentHash: ContentHash,
  triggers: CanonicalSkillImport["triggers"],
) {
  return digest(
    JSON.stringify({
      skillId: input.skillId,
      displayName: input.displayName,
      description: input.description,
      contentHash,
      triggers,
    }),
  );
}

function specificity(kind: CanonicalTrigger["kind"], pattern: string): number {
  switch (kind) {
    case "exact":
      return 3_000_000 + pattern.length;
    case "prefix":
      return 2_000_000 + pattern.length;
    case "contains":
      return 1_000_000 + pattern.length;
    case "regex":
      return pattern.length;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function triggerMatches(prompt: string, trigger: CanonicalTrigger): boolean {
  const normalizedPrompt = prompt.toLowerCase();
  const normalizedPattern = trigger.pattern.toLowerCase();
  switch (trigger.kind) {
    case "exact":
      return normalizedPrompt === normalizedPattern;
    case "prefix":
      return normalizedPrompt.startsWith(normalizedPattern);
    case "contains":
      return normalizedPrompt.includes(normalizedPattern);
    case "regex":
      return new RegExp(trigger.pattern, "iu").test(prompt);
    default: {
      const exhaustive: never = trigger.kind;
      return exhaustive;
    }
  }
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function bestMatchingTrigger(
  prompt: string,
  triggers: readonly CanonicalTrigger[],
): CanonicalTrigger | undefined {
  return triggers
    .filter((trigger) => triggerMatches(prompt, trigger))
    .toSorted((left, right) => {
      const bySpecificity = right.specificity - left.specificity;
      return bySpecificity !== 0
        ? bySpecificity
        : compareCodeUnits(left.triggerId, right.triggerId);
    })[0];
}

function cloneVersion(version: CanonicalSkillVersion): CanonicalSkillVersion {
  return CanonicalSkillVersionSchema.parse(version);
}

function cloneWrapper(wrapper: RuntimeSkillWrapper): RuntimeSkillWrapper {
  return RuntimeSkillWrapperSchema.parse(wrapper);
}

export class InMemoryManagedSkillCatalog implements ManagedSkillCatalog {
  readonly #now: () => Date;
  readonly #versions = new Map<SkillVersionId, CanonicalSkillVersion>();
  readonly #versionByDefinitionHash = new Map<ContentHash, SkillVersionId>();
  readonly #lineage = new Map<SkillId, readonly SkillVersionId[]>();
  readonly #heads = new Map<SkillId, SkillVersionId>();
  readonly #priorities = new Map<SkillId, number>();
  readonly #wrappers = new Map<string, RuntimeSkillWrapper>();

  constructor(input: { readonly now?: () => Date } = {}) {
    this.#now = input.now ?? (() => new Date());
  }

  importSkill(input: CanonicalSkillImport | unknown): ImportSkillResult {
    const imported = CanonicalSkillImportSchema.parse(input);
    const contentHash = hashCanonicalContent(imported.canonicalContent);
    const canonicalTriggers = canonicalTriggerInputs(imported.triggers);
    const definitionHash = canonicalDefinitionHash(imported, contentHash, canonicalTriggers);
    const knownVersionId = this.#versionByDefinitionHash.get(definitionHash);
    if (knownVersionId !== undefined) {
      const known = this.#versions.get(knownVersionId);
      if (known === undefined) throw new Error("catalog definition index is inconsistent");
      return { kind: "existing", version: cloneVersion(known) };
    }

    const previousVersionId = this.#heads.get(imported.skillId);
    const skillVersionId = createSkillVersionId(
      `${imported.skillId}:${definitionHash}`,
    );
    const stableVersionKey = createSkillVersionKey(definitionHash);
    const importedAtDate = this.#now();
    if (Number.isNaN(importedAtDate.getTime())) throw new Error("now() returned an invalid date");
    const triggers: CanonicalTrigger[] = canonicalTriggers.map((trigger) => ({
      triggerId: createTriggerId(
        `${skillVersionId}:trigger:${digest(JSON.stringify(trigger))}`,
      ),
      kind: trigger.kind,
      pattern: trigger.pattern,
      specificity: specificity(trigger.kind, trigger.pattern),
    }));
    const version = CanonicalSkillVersionSchema.parse({
      skillId: imported.skillId,
      skillVersionId,
      stableVersionKey,
      contentHash,
      definitionHash,
      displayName: imported.displayName,
      description: imported.description,
      canonicalContent: imported.canonicalContent,
      source: imported.source,
      triggers,
      lineage:
        previousVersionId === undefined
          ? { kind: "initial" }
          : { kind: "successor", previousVersionId },
      importedAt: createTimestamp(importedAtDate.toISOString()),
    });

    this.#versions.set(skillVersionId, version);
    this.#versionByDefinitionHash.set(definitionHash, skillVersionId);
    this.#lineage.set(imported.skillId, [
      ...(this.#lineage.get(imported.skillId) ?? []),
      skillVersionId,
    ]);
    this.#heads.set(imported.skillId, skillVersionId);
    return { kind: "imported", version: cloneVersion(version) };
  }

  getVersion(skillVersionId: SkillVersionId): CanonicalSkillVersion | undefined {
    const version = this.#versions.get(skillVersionId);
    return version === undefined ? undefined : cloneVersion(version);
  }

  getCurrentVersion(skillId: SkillId): CanonicalSkillVersion | undefined {
    const skillVersionId = this.#heads.get(skillId);
    return skillVersionId === undefined ? undefined : this.getVersion(skillVersionId);
  }

  listLineage(skillId: SkillId): readonly CanonicalSkillVersion[] {
    return (this.#lineage.get(skillId) ?? []).map((skillVersionId) => {
      const version = this.#versions.get(skillVersionId);
      if (version === undefined) throw new Error("catalog lineage is inconsistent");
      return cloneVersion(version);
    });
  }

  setAdministratorPriority(input: SetAdministratorPriority | unknown): void {
    const priority = SetAdministratorPrioritySchema.parse(input);
    if (!this.#heads.has(priority.skillId)) {
      throw new Error(`unknown skill ${priority.skillId}`);
    }
    this.#priorities.set(priority.skillId, priority.priority);
  }

  matchPrompt(input: MatchPromptInput | unknown): readonly SkillMatchCandidate[] {
    const request = MatchPromptInputSchema.parse(input);
    const matches: SkillMatchCandidate[] = [];
    for (const [skillId, skillVersionId] of this.#heads) {
      const version = this.#versions.get(skillVersionId);
      if (version === undefined) throw new Error("catalog head is inconsistent");
      const trigger = bestMatchingTrigger(request.prompt, version.triggers);
      if (trigger === undefined) continue;
      matches.push({
        skillVersionId: version.skillVersionId,
        stableVersionKey: version.stableVersionKey,
        displayName: version.displayName,
        administratorPriority: this.#priorities.get(skillId) ?? 0,
        specificity: trigger.specificity,
        disposition: "active",
        trigger: {
          triggerId: trigger.triggerId,
          kind: trigger.kind,
          pattern: trigger.pattern,
        },
      });
    }
    return matches.toSorted((left, right) =>
      compareCodeUnits(left.skillVersionId, right.skillVersionId),
    );
  }

  registerWrapper(input: RegisterRuntimeWrapper | unknown): RuntimeSkillWrapper {
    const registration = RegisterRuntimeWrapperSchema.parse(input);
    if (!this.#versions.has(registration.skillVersionId)) {
      throw new Error(`unknown skill version ${registration.skillVersionId}`);
    }
    const wrapperId = createWrapperId(
      digest(
        JSON.stringify({
          runtime: registration.runtime,
          skillVersionId: registration.skillVersionId,
          reference: registration.reference,
        }),
      ),
    );
    const wrapper = RuntimeSkillWrapperSchema.parse({
      wrapperId,
      ...registration,
    });
    this.#wrappers.set(
      `${registration.skillVersionId}\u0000${registration.runtime}`,
      wrapper,
    );
    return cloneWrapper(wrapper);
  }

  listWrappers(skillVersionId: SkillVersionId): readonly RuntimeSkillWrapper[] {
    return [...this.#wrappers.values()]
      .filter((wrapper) => wrapper.skillVersionId === skillVersionId)
      .toSorted((left, right) => compareCodeUnits(left.runtime, right.runtime))
      .map(cloneWrapper);
  }
}

export function createInMemorySkillCatalog(
  input: { readonly now?: () => Date } = {},
): ManagedSkillCatalog {
  return new InMemoryManagedSkillCatalog(input);
}
