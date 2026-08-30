import type { EngineeringModelTier } from "@sisyphus/domain";
import { isReviewRole } from "./workforce-policy.js";

export type OpenRouterModelRoute = {
  readonly plannerModel: string;
  readonly specialistModel: string;
  readonly roleModels: Readonly<Record<string, string>>;
};

export type OpenRouterTierPolicy = Readonly<
  Record<EngineeringModelTier, OpenRouterModelRoute>
>;

export type LowTierModelOverride = {
  readonly plannerModel: string | undefined;
  readonly specialistModel: string | undefined;
  readonly roleModels: Readonly<Record<string, string>>;
};

const planningRoles = [
  "architect",
  "product",
  "research",
  "design",
  "accessibility",
  "performance",
  "documentation",
  "qa",
  "tester",
  "test",
  "reviewer",
  "security",
] as const;

const baseTierPolicy: OpenRouterTierPolicy = {
  low: route({
    plannerModel: "deepseek/deepseek-v4-flash",
    specialistModel: "qwen/qwen3.7-flash",
  }),
  medium: route({
    plannerModel: "google/gemini-2.5-flash",
    specialistModel: "qwen/qwen3.6-plus",
  }),
  high: route({
    plannerModel: "z-ai/glm-5.3",
    specialistModel: "moonshotai/kimi-k2.7-code",
  }),
  max: route({
    plannerModel: "anthropic/claude-opus-5",
    specialistModel: "anthropic/claude-sonnet-5",
  }),
};

export function createOpenRouterTierPolicy(
  lowOverride: LowTierModelOverride,
): OpenRouterTierPolicy {
  const low = baseTierPolicy.low;
  return {
    ...baseTierPolicy,
    low: {
      plannerModel: lowOverride.plannerModel ?? low.plannerModel,
      specialistModel: lowOverride.specialistModel ?? low.specialistModel,
      roleModels: {
        ...low.roleModels,
        ...lowOverride.roleModels,
      },
    },
  };
}

export function modelForTierRole(input: {
  readonly policy: OpenRouterTierPolicy;
  readonly modelTier: EngineeringModelTier;
  readonly role: string;
  readonly reassigned?: boolean;
}): string {
  const route = input.policy[input.modelTier];
  if (input.reassigned === true && !isReviewRole(input.role)) return route.plannerModel;

  const normalizedRole = input.role.trim().toLowerCase();
  const configuredModel = route.roleModels[normalizedRole];
  if (configuredModel !== undefined) return configuredModel;

  const matchingConfiguredRole = Object.entries(route.roleModels).find(([configuredRole]) =>
    normalizedRole.includes(configuredRole),
  );
  return matchingConfiguredRole?.[1] ?? (isReviewRole(normalizedRole)
    ? route.plannerModel
    : route.specialistModel);
}

export function hasTierRoleFallback(input: {
  readonly policy: OpenRouterTierPolicy;
  readonly modelTier: EngineeringModelTier;
  readonly role: string;
}): boolean {
  if (isReviewRole(input.role)) return false;
  return modelForTierRole(input) !== modelForTierRole({ ...input, reassigned: true });
}

export function modelForTierPlan(input: {
  readonly policy: OpenRouterTierPolicy;
  readonly modelTier: EngineeringModelTier;
  readonly retry: boolean;
}): string {
  const route = input.policy[input.modelTier];
  return input.retry ? route.specialistModel : route.plannerModel;
}

export function hasTierPlanFallback(input: {
  readonly policy: OpenRouterTierPolicy;
  readonly modelTier: EngineeringModelTier;
}): boolean {
  const route = input.policy[input.modelTier];
  return route.plannerModel !== route.specialistModel;
}

function route(input: {
  readonly plannerModel: string;
  readonly specialistModel: string;
}): OpenRouterModelRoute {
  return {
    ...input,
    roleModels: Object.fromEntries(planningRoles.map((role) => [role, input.plannerModel])),
  };
}
