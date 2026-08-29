import type { PromptDecision, SupervisionDecision } from "@sisyphus/domain";
import type { ManagedSkillActivation } from "@sisyphus/adapter-kit";

export type ClaudeHookResponse =
  | Record<string, never>
  | { readonly continue: true }
  | {
      readonly continue: true;
      readonly hookSpecificOutput: {
        readonly hookEventName: "UserPromptSubmit";
        readonly additionalContext: string;
      };
    }
  | {
      readonly hookSpecificOutput: {
        readonly hookEventName: "PreToolUse";
        readonly permissionDecision: "allow" | "deny";
        readonly permissionDecisionReason?: string;
        readonly additionalContext?: string;
      };
    }
  | { readonly decision: "block"; readonly reason: string };

function renderPrompt(
  decision: PromptDecision,
  activation: ManagedSkillActivation | undefined,
): ClaudeHookResponse {
  if (decision.resolution.kind === "none") return { continue: true };
  if (activation === undefined) {
    throw new Error("A selected prompt decision requires a worker-issued activation lease.");
  }
  const selected = decision.resolution.selected;
  const marker = JSON.stringify({
    skillVersionId: selected.skillVersionId,
    activationLeaseId: activation.activationLeaseId,
  });
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        "Sisyphus selected one managed skill for this work item.",
        `Use only ${selected.displayName} (${selected.skillVersionId}) as the managed skill.`,
        `Before applying it, call \`mcp__sisyphus__activate_skill\` with ${marker}.`,
        "Do not treat the skill as active unless the marker confirms the same skill version and lease.",
      ].join("\n"),
    },
  };
}

function feedbackText(
  summary: string,
  findings: readonly {
    readonly criterion: string;
    readonly message: string;
    readonly correction: string;
    readonly evidence: readonly string[];
  }[],
): string {
  const details = findings.map((finding) => {
    const evidence = finding.evidence.length === 0 ? "" : ` Evidence: ${finding.evidence.join("; ")}.`;
    return `- ${finding.criterion}: ${finding.message} Correction: ${finding.correction}${evidence}`;
  });
  const full = `${summary}\n\n${details.join("\n")}`;
  return full.length <= 8_000 ? full : `${full.slice(0, 8_000)}\n[feedback truncated]`;
}

export function renderClaudeDecision(
  decision: SupervisionDecision,
  activation?: ManagedSkillActivation,
): ClaudeHookResponse {
  switch (decision.kind) {
    case "prompt-decision":
      return renderPrompt(decision, activation);
    case "tool-request-decision":
      switch (decision.action) {
        case "allow":
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
            },
          };
        case "deny":
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: decision.reason,
            },
          };
        case "observe-denial":
          return {};
        default: {
          const exhaustive: never = decision;
          return exhaustive;
        }
      }
    case "tool-result-decision":
      return {};
    case "stop-decision":
      if (decision.action === "allow") return { continue: true };
      return {
        decision: "block",
        reason: feedbackText(decision.feedback.summary, decision.feedback.findings),
      };
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}
