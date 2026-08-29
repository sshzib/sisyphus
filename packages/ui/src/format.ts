import type {
  AgentRuntime,
  Attribution,
  EnforcementCoverage,
  EvaluationResult,
} from "./contracts.js";

export function runtimeLabel(runtime: AgentRuntime): string {
  switch (runtime) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    default: {
      const exhaustive: never = runtime;
      return exhaustive;
    }
  }
}

export function resultLabel(result: EvaluationResult): string {
  switch (result) {
    case "pass":
      return "Passed";
    case "retryable-failure":
      return "Retry failed";
    case "terminal-failure":
      return "Terminal failure";
    case "inconclusive":
      return "Inconclusive";
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

export function enforcementLabel(coverage: EnforcementCoverage): string {
  switch (coverage) {
    case "enforced":
      return "Enforced";
    case "partial":
      return "Partial";
    case "observed-only":
      return "Observed only";
    default: {
      const exhaustive: never = coverage;
      return exhaustive;
    }
  }
}

export function attributionLabel(attribution: Attribution): string {
  switch (attribution) {
    case "verified":
      return "Verified";
    case "inferred":
      return "Inferred";
    case "absent":
      return "No skill";
    default: {
      const exhaustive: never = attribution;
      return exhaustive;
    }
  }
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }
  return `${(milliseconds / 1000).toFixed(1)}s`;
}
