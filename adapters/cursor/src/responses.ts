import type { SupervisionDecision } from "@sisyphus/domain";

export type CursorHookResponse =
  | Record<string, never>
  | { readonly continue: true }
  | {
      readonly permission: "allow" | "deny";
      readonly user_message?: string;
      readonly agent_message?: string;
    }
  | { readonly followup_message: string };

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

export function renderCursorDecision(decision: SupervisionDecision): CursorHookResponse {
  switch (decision.kind) {
    case "prompt-decision":
      return { continue: true };
    case "tool-request-decision":
      switch (decision.action) {
        case "allow":
          return { permission: "allow" };
        case "observe-denial":
          return {};
        case "deny":
          return {
            permission: "deny",
            user_message: decision.reason,
            agent_message: decision.reason,
          };
        default: {
          const exhaustive: never = decision;
          return exhaustive;
        }
      }
    case "tool-result-decision":
      return {};
    case "stop-decision":
      if (decision.action === "allow") return {};
      return {
        followup_message: feedbackText(
          decision.feedback.summary,
          decision.feedback.findings,
        ),
      };
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}
