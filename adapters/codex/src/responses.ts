import {
  type PromptDecision,
  type SupervisionDecision,
} from "@sisyphus/domain";
import type {
  ActivationLeaseId,
  SkillVersionId,
  Timestamp,
} from "@sisyphus/domain";

export type CodexHookResponse =
  | Record<string, never>
  | { readonly continue: true }
  | { readonly systemMessage: string }
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

export interface CodexActivationLease {
  readonly activationLeaseId: ActivationLeaseId;
  readonly skillVersionId: SkillVersionId;
  readonly expiresAt: Timestamp;
}

function renderPromptDecision(
  decision: PromptDecision,
  activationLease: CodexActivationLease | undefined,
): CodexHookResponse {
  if (decision.resolution.kind === "none") return { continue: true };
  const selected = decision.resolution.selected;
  if (activationLease === undefined) return { continue: true };
  const activationArguments = JSON.stringify({
    skillVersionId: selected.skillVersionId,
    activationLeaseId: activationLease.activationLeaseId,
  });
  const additionalContext = [
    "Sisyphus selected one managed skill for this work item.",
    `Use only ${selected.displayName} (${selected.skillVersionId}) as the managed skill.`,
    "Before applying it, call `mcp__sisyphus__activate_skill` with " + activationArguments + ".",
    "The activation result contains the exact managed instruction snapshot; follow it as the selected skill.",
    "Do not treat the skill as active unless the marker confirms the same skill version and lease.",
    `The activation lease expires at ${activationLease.expiresAt}.`,
  ].join("\n");
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  };
}

function feedbackReason(
  summary: string,
  findings: readonly {
    readonly criterion: string;
    readonly message: string;
    readonly correction: string;
    readonly evidence: readonly string[];
  }[],
): string {
  const findingLines = findings.map((finding) => {
    const evidence =
      finding.evidence.length === 0 ? "" : ` Evidence: ${finding.evidence.join("; ")}.`;
    return `- ${finding.criterion}: ${finding.message} Correction: ${finding.correction}${evidence}`;
  });
  const full = `${summary}\n\n${findingLines.join("\n")}`;
  const limit = 8_000;
  return full.length <= limit ? full : `${full.slice(0, limit)}\n[feedback truncated]`;
}

export function renderCodexDecision(
  decision: SupervisionDecision,
  activationLease?: CodexActivationLease,
): CodexHookResponse {
  switch (decision.kind) {
    case "prompt-decision":
      return renderPromptDecision(decision, activationLease);
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
        reason: feedbackReason(decision.feedback.summary, decision.feedback.findings),
      };
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}

export function codexFailOpenResponse(): CodexHookResponse {
  return {
    systemMessage: "Sisyphus supervision was unavailable. Codex continued without evaluation.",
  };
}
