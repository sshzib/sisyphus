import {
  type PromptDecision,
  type SupervisionDecision,
} from "@sisyphus/domain";
import type { ManagedSkillActivation } from "@sisyphus/adapter-kit";

export type OpenCodePluginResponse =
  | { readonly action: "observe"; readonly reason?: string }
  | { readonly action: "append-context"; readonly context: string }
  | { readonly action: "allow" }
  | { readonly action: "deny"; readonly error: string }
  | { readonly action: "recorded" };

function renderPrompt(
  decision: PromptDecision,
  activation: ManagedSkillActivation | undefined,
): OpenCodePluginResponse {
  if (decision.resolution.kind === "none") return { action: "observe" };
  if (activation === undefined) {
    throw new Error("A selected prompt decision requires a worker-issued activation lease.");
  }
  const selected = decision.resolution.selected;
  const marker = JSON.stringify({
    skillVersionId: selected.skillVersionId,
    activationLeaseId: activation.activationLeaseId,
  });
  return {
    action: "append-context",
    context: [
      `Sisyphus selected ${selected.displayName} (${selected.skillVersionId}).`,
      `Activate it through the Sisyphus MCP \`activate_skill\` tool with ${marker}.`,
      "Do not treat the skill as active unless the marker confirms the same skill version and lease.",
    ].join("\n"),
  };
}

export function renderOpenCodeDecision(
  decision: SupervisionDecision,
  activation?: ManagedSkillActivation,
): OpenCodePluginResponse {
  switch (decision.kind) {
    case "prompt-decision":
      return renderPrompt(decision, activation);
    case "tool-request-decision":
      switch (decision.action) {
        case "allow":
          return { action: "allow" };
        case "observe-denial":
          return { action: "observe", reason: decision.reason };
        case "deny":
          return { action: "deny", error: decision.reason };
        default: {
          const exhaustive: never = decision;
          return exhaustive;
        }
      }
    case "tool-result-decision":
      return { action: "recorded" };
    case "stop-decision":
      if (decision.action === "allow") return { action: "observe" };
      return {
        action: "observe",
        reason: "OpenCode stop continuation is unsupported; record a terminal failure.",
      };
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}
