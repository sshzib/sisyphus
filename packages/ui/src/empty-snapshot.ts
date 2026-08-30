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
      execution: {
        status: "stopped",
        backend: "local-static",
        generation: 0,
        changedAt: "1970-01-01T00:00:00.000Z",
        changedBy: "system",
      },
      canManageExecution: false,
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
