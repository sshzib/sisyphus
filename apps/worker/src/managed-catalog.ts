import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CanonicalSkillImportSchema,
  RegisterRuntimeWrapperSchema,
  SetAdministratorPrioritySchema,
  createInMemorySkillCatalog,
  hashCanonicalContent,
  type ContentHash,
  type ManagedSkillCatalog,
  type RuntimeSkillWrapper,
} from "@sisyphus/catalog";
import {
  type AgentRuntime,
  type EvaluationConstraint,
  type HookObservation,
  type SkillDisposition,
  type SkillMatchCandidate,
  type SkillVersionId,
} from "@sisyphus/domain";
import { z } from "zod";

import type { PolicyProvider } from "./supervisor.js";

export const ManagedSkillCatalogConfigurationSchema = z
  .object({
    skills: z.array(CanonicalSkillImportSchema).default([]),
    administratorPriorities: z.array(SetAdministratorPrioritySchema).default([]),
    wrappers: z.array(RegisterRuntimeWrapperSchema).default([]),
  })
  .strict();
export type ManagedSkillCatalogConfiguration = z.infer<
  typeof ManagedSkillCatalogConfigurationSchema
>;

export interface ManagedSkillInstruction {
  readonly skillVersionId: SkillVersionId;
  readonly displayName: string;
  readonly content: string;
  readonly contentHash: ContentHash;
  readonly provenance:
    | { readonly kind: "canonical" }
    | {
        readonly kind: "runtime-wrapper";
        readonly wrapperId: string;
        readonly path: string;
      };
}

export interface ManagedSkillCatalogService {
  readonly catalog: ManagedSkillCatalog;
  instructionFor(
    runtime: AgentRuntime,
    skillVersionId: SkillVersionId,
  ): ManagedSkillInstruction | undefined;
}

interface SkillStandingReader {
  dispositionFor(skillVersionId: SkillVersionId): Promise<SkillDisposition>;
}

function wrapperKey(runtime: AgentRuntime, skillVersionId: SkillVersionId): string {
  return `${runtime}\u0000${skillVersionId}`;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stricterDisposition(
  configured: SkillDisposition,
  persisted: SkillDisposition,
): SkillDisposition {
  const rank: Readonly<Record<SkillDisposition, number>> = {
    active: 0,
    probation: 1,
    quarantined: 2,
    revoked: 3,
  };
  return rank[configured] >= rank[persisted] ? configured : persisted;
}

async function wrapperInstruction(
  catalog: ManagedSkillCatalog,
  wrapper: RuntimeSkillWrapper,
): Promise<ManagedSkillInstruction | undefined> {
  if (wrapper.reference.kind !== "file") return undefined;
  const content = await readFile(resolve(wrapper.reference.path), "utf8");
  const actualHash = hashCanonicalContent(content);
  if (actualHash !== wrapper.reference.contentHash) {
    throw new Error(
      `Managed skill wrapper hash mismatch for ${wrapper.skillVersionId} on ${wrapper.runtime}.`,
    );
  }
  const version = catalog.getVersion(wrapper.skillVersionId);
  if (version === undefined) throw new Error("Managed skill wrapper lost its canonical version.");
  return {
    skillVersionId: version.skillVersionId,
    displayName: version.displayName,
    content,
    contentHash: actualHash,
    provenance: {
      kind: "runtime-wrapper",
      wrapperId: wrapper.wrapperId,
      path: resolve(wrapper.reference.path),
    },
  };
}

export async function createManagedSkillCatalog(
  input: ManagedSkillCatalogConfiguration | unknown,
): Promise<ManagedSkillCatalogService> {
  const configuration = ManagedSkillCatalogConfigurationSchema.parse(input);
  const catalog = createInMemorySkillCatalog();
  for (const skill of configuration.skills) catalog.importSkill(skill);
  for (const priority of configuration.administratorPriorities) {
    catalog.setAdministratorPriority(priority);
  }

  const runtimeInstructions = new Map<string, ManagedSkillInstruction>();
  for (const registration of configuration.wrappers) {
    const wrapper = catalog.registerWrapper(registration);
    const instruction = await wrapperInstruction(catalog, wrapper);
    if (instruction !== undefined) {
      runtimeInstructions.set(
        wrapperKey(wrapper.runtime, wrapper.skillVersionId),
        instruction,
      );
    }
  }

  return {
    catalog,
    instructionFor(runtime, skillVersionId) {
      const runtimeInstruction = runtimeInstructions.get(
        wrapperKey(runtime, skillVersionId),
      );
      if (runtimeInstruction !== undefined) return runtimeInstruction;
      const version = catalog.getVersion(skillVersionId);
      if (version === undefined) return undefined;
      return {
        skillVersionId: version.skillVersionId,
        displayName: version.displayName,
        content: version.canonicalContent,
        contentHash: version.contentHash,
        provenance: { kind: "canonical" },
      };
    },
  };
}

export class ManagedCatalogPolicyProvider implements PolicyProvider {
  readonly #base: PolicyProvider;
  readonly #catalog: ManagedSkillCatalogService;
  readonly #standing: SkillStandingReader;

  constructor(input: {
    readonly base: PolicyProvider;
    readonly catalog: ManagedSkillCatalogService;
    readonly standing: SkillStandingReader;
  }) {
    this.#base = input.base;
    this.#catalog = input.catalog;
    this.#standing = input.standing;
  }

  async constraintFor(event: HookObservation): Promise<EvaluationConstraint> {
    const base = await this.#base.constraintFor(event);
    if (event.kind !== "prompt") return base;

    const candidatesByVersion = new Map<SkillVersionId, SkillMatchCandidate>();
    for (const candidate of base.skillCandidates) {
      const instruction = this.#catalog.instructionFor(
        event.capabilities.runtime,
        candidate.skillVersionId,
      );
      candidatesByVersion.set(candidate.skillVersionId, {
        ...candidate,
        activationAvailability:
          instruction === undefined
            ? {
                kind: "unavailable",
                reason: "The selected skill version has no managed instruction snapshot.",
              }
            : { kind: "available" },
      });
    }
    for (const candidate of this.#catalog.catalog.matchPrompt({ prompt: event.prompt })) {
      candidatesByVersion.set(candidate.skillVersionId, {
        ...candidate,
        activationAvailability: { kind: "available" },
      });
    }

    const candidates = await Promise.all(
      [...candidatesByVersion.values()].map(async (candidate) => ({
        ...candidate,
        disposition: stricterDisposition(
          candidate.disposition,
          await this.#standing.dispositionFor(candidate.skillVersionId),
        ),
      })),
    );
    return {
      ...base,
      skillCandidates: candidates.toSorted((left, right) =>
        compareCodeUnits(left.skillVersionId, right.skillVersionId),
      ),
    };
  }
}
