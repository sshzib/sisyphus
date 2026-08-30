import type { DashboardSnapshot } from "./contracts.js";

export function createEmptyDashboardSnapshot(input?: {
  readonly generatedAt?: string;
  readonly workspace?: DashboardSnapshot["workspace"];
}): DashboardSnapshot {
  return {
    generatedAt: input?.generatedAt ?? new Date().toISOString(),
    workspace: input?.workspace ?? {
      id: "tenant-local",
      name: "Sisyphus Local",
      environment: "Local prototype",
    },
    overview: {
      totalRuns: 0,
      passRate: 0,
      retryRecoveryRate: 0,
      terminalFailures: 0,
      tokensSpent: 0,
      tokenBurnComparison: {
        kind: "unavailable",
        reason: "no-paired-runs",
      },
      averageLatencyMs: 0,
      enforcedShare: 0,
    },
    operations: [],
    engineering: {
      operations: [],
      events: [],
    },
    runs: [],
    agents: [],
    skills: [],
    conflicts: [],
    integrations: [],
    policies: [],
    audit: [],
    devices: [],
  };
}
