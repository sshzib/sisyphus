import type {
  RuntimeEventId,
  SkillCompletionRecord,
  SkillVersionId,
  Timestamp,
  SkillDispositionTransition,
} from "@sisyphus/domain";

export type RetryDirectiveCount = 0 | 1 | 2;

export type WorkItemState = {
  readonly finalEventId?: RuntimeEventId | undefined;
};

export type RetryBudgetState = {
  readonly retryDirectives: RetryDirectiveCount;
};

export type SkillStanding =
  | { readonly disposition: "active" }
  | {
      readonly disposition: "probation";
      readonly restoredAt: Timestamp;
      readonly reason: string;
    }
  | {
      readonly disposition: "quarantined";
      readonly quarantinedAt: Timestamp;
      readonly terminalFailures: number;
      readonly sampleSize: number;
    }
  | { readonly disposition: "revoked"; readonly reason: string };

export type QuarantineWindowResult = {
  readonly shouldQuarantine: boolean;
  readonly terminalFailures: number;
  readonly sampleSize: number;
};

export function evaluateQuarantineWindow(
  completions: readonly SkillCompletionRecord[],
): QuarantineWindowResult {
  const window = completions.slice(-10);
  const terminalFailures = window.filter(
    (completion) => completion.outcome === "terminal-failure",
  ).length;
  return {
    shouldQuarantine: terminalFailures >= 5,
    terminalFailures,
    sampleSize: window.length,
  };
}

export type RestoreSkillInput = {
  readonly skillVersionId: SkillVersionId;
  readonly reason: string;
  readonly restoredAt: Timestamp;
};

export type RestoreSkillResult =
  | {
      readonly kind: "restored";
      readonly standing: Extract<SkillStanding, { disposition: "probation" }>;
    }
  | {
      readonly kind: "not-quarantined";
      readonly standing: SkillStanding;
    }
  | {
      readonly kind: "not-restorable";
      readonly standing: Extract<SkillStanding, { disposition: "revoked" }>;
    };

export type ApplyDispositionTransitionResult =
  | { readonly kind: "applied"; readonly standing: SkillStanding }
  | {
      readonly kind: "ignored-revoked";
      readonly standing: Extract<SkillStanding, { disposition: "revoked" }>;
    };

export type ApplyDispositionTransitionInput = SkillDispositionTransition;
