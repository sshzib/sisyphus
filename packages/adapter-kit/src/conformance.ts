import {
  HookObservationSchema,
  RuntimeCapabilitySnapshotSchema,
  RuntimeIdentitySchema,
  RuntimeInstallationIdentitySchema,
  SkillActivationEvidenceSchema,
  type RuntimeCapabilitySnapshot,
} from "@sisyphus/domain";

import {
  AdapterDecisionContextSchema,
  AdapterInstallationSchema,
  ManagedSkillActivationSchema,
  type AdapterConformanceCase,
  type AdapterConformanceCheck,
  type AdapterConformanceFixture,
  type AdapterConformanceReport,
  type AgentRuntimeAdapter,
} from "./contracts.js";

function passed(name: string, detail: string): AdapterConformanceCheck {
  return { name, status: "passed", detail };
}

function failed(name: string, detail: string): AdapterConformanceCheck {
  return { name, status: "failed", detail };
}

function containsKey(input: unknown, forbiddenKey: string, visited: WeakSet<object>): boolean {
  if (typeof input !== "object" || input === null) return false;
  if (visited.has(input)) return false;
  visited.add(input);
  for (const [key, value] of Object.entries(input)) {
    if (key === forbiddenKey || containsKey(value, forbiddenKey, visited)) return true;
  }
  return false;
}

function collectStringClaims(input: string, key: string, claims: Set<string>): void {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`"${escapedKey}"\\s*:\\s*"([^"\\\\]*)"`, "gu");
  for (const match of input.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined) claims.add(value);
  }
}

function collectClaims(
  input: unknown,
  key: string,
  claims: Set<string>,
  visited: WeakSet<object>,
): void {
  if (typeof input === "string") {
    collectStringClaims(input, key, claims);
    return;
  }
  if (typeof input !== "object" || input === null || visited.has(input)) return;
  visited.add(input);
  for (const [entryKey, value] of Object.entries(input)) {
    if (entryKey === key && typeof value === "string") claims.add(value);
    collectClaims(value, key, claims, visited);
  }
}

function responseClaims(input: unknown, key: string): ReadonlySet<string> {
  const claims = new Set<string>();
  collectClaims(input, key, claims, new WeakSet<object>());
  return claims;
}

function checkCase(
  adapter: AgentRuntimeAdapter,
  fixture: AdapterConformanceCase,
  forbiddenNormalizedKeys: readonly string[],
  capabilities: RuntimeCapabilitySnapshot,
): readonly AdapterConformanceCheck[] {
  const normalized = adapter.parseEvent(fixture.rawEvent);
  const leakedKey = forbiddenNormalizedKeys.find((key) =>
    containsKey(normalized, key, new WeakSet<object>()),
  );
  if (leakedKey !== undefined) {
    return [failed(`normalize:${fixture.kind}`, `vendor key ${leakedKey} leaked`)];
  }
  const parsed = HookObservationSchema.safeParse(normalized);
  if (!parsed.success) {
    return [failed(`parse:${fixture.kind}`, parsed.error.message)];
  }
  if (parsed.data.kind !== fixture.kind) {
    return [
      failed(
        `parse:${fixture.kind}`,
        `expected ${fixture.kind}, received ${parsed.data.kind}`,
      ),
    ];
  }

  const identity = RuntimeIdentitySchema.safeParse(adapter.deriveIdentity(fixture.rawEvent));
  const activation = SkillActivationEvidenceSchema.safeParse(
    adapter.verifySkillActivation(fixture.rawEvent),
  );
  const checks: AdapterConformanceCheck[] = [
    passed(`parse:${fixture.kind}`, "normalized observation is valid"),
    identity.success
      ? passed(`identity:${fixture.kind}`, "identity is valid")
      : failed(`identity:${fixture.kind}`, identity.error.message),
    activation.success
      ? passed(`activation:${fixture.kind}`, "activation evidence is valid")
      : failed(`activation:${fixture.kind}`, activation.error.message),
  ];
  const runtimeInstallation = RuntimeInstallationIdentitySchema.safeParse(
    parsed.data.runtimeInstallation,
  );
  checks.push(
    runtimeInstallation.success &&
      JSON.stringify(runtimeInstallation.data) ===
        JSON.stringify(adapter.installationIdentity)
      ? passed(
          `installation:${fixture.kind}`,
          "observation carries the adapter installation identity",
        )
      : failed(
          `installation:${fixture.kind}`,
          "observation installation identity does not match the adapter",
      ),
  );
  checks.push(
    JSON.stringify(parsed.data.capabilities) === JSON.stringify(capabilities)
      ? passed(
          `capabilities:${fixture.kind}`,
          "observation carries the probed capability snapshot",
        )
      : failed(
          `capabilities:${fixture.kind}`,
          "observation capability snapshot differs from the adapter probe",
        ),
  );
  checks.push(
    fixture.decision.eventId === parsed.data.eventId
      ? passed(`decision:${fixture.kind}`, "decision targets the parsed event")
      : failed(`decision:${fixture.kind}`, "decision eventId does not match the parsed event"),
  );
  if (
    identity.success &&
    JSON.stringify(identity.data) !== JSON.stringify(parsed.data.identity)
  ) {
    checks.push(
      failed(`identity:${fixture.kind}`, "derived identity does not match the observation"),
    );
  }

  switch (fixture.kind) {
    case "prompt": {
      if (parsed.data.kind !== "prompt") return checks;
      if (fixture.decision.resolution.kind !== "selected") {
        checks.push(
          failed(
            "activation:prompt",
            "managed activation conformance requires a selected prompt decision",
          ),
        );
        return checks;
      }
      const selectionCapability = capabilities.skillSelectionControl;
      const selectionEnforcement = fixture.decision.enforcement;
      const selectionDowngraded =
        selectionEnforcement.kind === "observation" &&
        selectionEnforcement.missingCapabilities.includes("skillSelectionControl");
      checks.push(
        selectionCapability.kind === "supported" || selectionDowngraded
          ? passed(
              "enforcement:prompt-skill-selection",
              selectionCapability.kind === "supported"
                ? "skill selection capability supports enforcement"
                : "partial or unsupported skill selection is observation-only",
            )
          : failed(
              "enforcement:prompt-skill-selection",
              "selected prompt claimed enforcement without supported skill selection control",
            ),
      );
      const workerIssued = ManagedSkillActivationSchema.safeParse(
        fixture.managedActivation.workerIssued,
      );
      if (!workerIssued.success) {
        checks.push(failed("activation:prompt", workerIssued.error.message));
        return checks;
      }
      if (
        workerIssued.data.skillVersionId !==
        fixture.decision.resolution.selected.skillVersionId
      ) {
        checks.push(
          failed(
            "activation:prompt",
            "worker-issued activation lease belongs to another selected skill",
          ),
        );
        return checks;
      }
      const context = AdapterDecisionContextSchema.parse({
        kind: "managed-skill-activation",
        activation: workerIssued.data,
      });
      let rejectedMissingLease = false;
      try {
        adapter.renderDecision(parsed.data, fixture.decision);
      } catch {
        rejectedMissingLease = true;
      }
      checks.push(
        rejectedMissingLease
          ? passed(
              "activation:prompt-missing-lease",
              "selected prompt rejected the two-argument render without a worker lease",
            )
          : failed(
              "activation:prompt-missing-lease",
              "selected prompt rendered without a worker-issued activation lease",
            ),
      );
      let response: unknown;
      try {
        response = adapter.renderDecision(parsed.data, fixture.decision, context);
      } catch (error: unknown) {
        checks.push(
          failed(
            "activation:prompt",
            error instanceof Error ? error.message : "selected prompt rendering failed",
          ),
        );
        return checks;
      }
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(response);
      } catch {
        checks.push(failed("render:prompt", "runtime response is not JSON serializable"));
        return checks;
      }
      if (serialized === undefined) {
        checks.push(failed("render:prompt", "runtime response is not JSON serializable"));
        return checks;
      }
      const leaseClaims = responseClaims(response, "activationLeaseId");
      const skillClaims = responseClaims(response, "skillVersionId");
      const containsOnlyWorkerLease =
        leaseClaims.size > 0 &&
        [...leaseClaims].every(
          (activationLeaseId) =>
            activationLeaseId === workerIssued.data.activationLeaseId,
        );
      const containsOnlySelectedSkill =
        skillClaims.size > 0 &&
        [...skillClaims].every(
          (skillVersionId) => skillVersionId === workerIssued.data.skillVersionId,
        );
      if (fixture.managedActivation.kind === "required") {
        let runtimeResponseAccepted = true;
        try {
          runtimeResponseAccepted =
            fixture.managedActivation.activationResponseAccepted?.(
              response,
              workerIssued.data,
            ) ?? true;
        } catch {
          runtimeResponseAccepted = false;
        }
        checks.push(
          containsOnlyWorkerLease &&
            containsOnlySelectedSkill &&
            runtimeResponseAccepted
            ? passed(
                "activation:prompt",
                "response carries the exact worker-issued activation lease and selected skill",
              )
            : failed(
                "activation:prompt",
                "response did not carry only the exact worker-issued activation lease and selected skill",
              ),
        );
      } else {
        checks.push(
          leaseClaims.size > 0
            ? failed(
                "activation:prompt",
                "runtime without managed activation support claimed an activation lease",
              )
            : passed(
                "activation:prompt",
                `managed activation is unsupported: ${fixture.managedActivation.reason}`,
              ),
        );
      }
      checks.push(passed("render:prompt", "selected prompt decision rendered"));
      return checks;
    }
    case "tool-request": {
      if (parsed.data.kind !== "tool-request") return checks;
      adapter.renderDecision(parsed.data, fixture.decision);
      checks.push(passed("render:tool-request", "decision rendered"));
      return checks;
    }
    case "tool-result": {
      if (parsed.data.kind !== "tool-result") return checks;
      adapter.renderDecision(parsed.data, fixture.decision);
      checks.push(passed("render:tool-result", "decision rendered"));
      return checks;
    }
    case "root-stop": {
      if (parsed.data.kind !== "root-stop") return checks;
      const response = adapter.renderDecision(parsed.data, fixture.decision);
      const accepted =
        fixture.decision.action !== "retry" || fixture.retryResponseAccepted(response);
      checks.push(
        accepted
          ? passed("render:root-stop", "stop decision rendered")
          : failed("render:root-stop", "runtime continuation response was not accepted"),
      );
      return checks;
    }
    case "subagent-stop": {
      if (parsed.data.kind !== "subagent-stop") return checks;
      const response = adapter.renderDecision(parsed.data, fixture.decision);
      const accepted =
        fixture.decision.action !== "retry" || fixture.retryResponseAccepted(response);
      checks.push(
        accepted
          ? passed("render:subagent-stop", "stop decision rendered")
          : failed(
              "render:subagent-stop",
              "runtime continuation response was not accepted",
            ),
      );
      return checks;
    }
    default: {
      const exhaustive: never = fixture;
      return exhaustive;
    }
  }
}

export async function runAdapterConformance(input: {
  readonly adapter: AgentRuntimeAdapter;
  readonly fixture: AdapterConformanceFixture;
}): Promise<AdapterConformanceReport> {
  const capabilities = RuntimeCapabilitySnapshotSchema.parse(await input.adapter.probe());
  if (capabilities.runtime !== input.adapter.runtime) {
    throw new Error(
      `adapter runtime ${input.adapter.runtime} does not match probe runtime ${capabilities.runtime}`,
    );
  }

  const installation = AdapterInstallationSchema.parse(
    await input.adapter.install(input.fixture.installRequest),
  );
  const replayedInstallation = AdapterInstallationSchema.parse(
    await input.adapter.install(input.fixture.installRequest),
  );
  if (installation.runtime !== input.adapter.runtime) {
    throw new Error(
      `adapter runtime ${input.adapter.runtime} does not match installation runtime ${installation.runtime}`,
    );
  }

  const requiredKinds = [
    "prompt",
    "tool-request",
    "tool-result",
    "root-stop",
    "subagent-stop",
  ] satisfies readonly AdapterConformanceCase["kind"][];
  const coverageChecks = requiredKinds.map((kind) =>
    input.fixture.cases.some((fixture) => fixture.kind === kind)
      ? passed(`fixture:${kind}`, "fixture is present")
      : failed(`fixture:${kind}`, "fixture is missing"),
  );
  const installationChecks: AdapterConformanceCheck[] = [
    installation.adapterVersion === input.fixture.installRequest.adapterVersion
      ? passed("installation:adapter-version", "installation kept the requested version")
      : failed("installation:adapter-version", "installation changed the adapter version"),
    JSON.stringify(installation.capabilities) === JSON.stringify(capabilities)
      ? passed("installation:capabilities", "installation snapshot matches the probe")
      : failed("installation:capabilities", "installation snapshot differs from the probe"),
    installation.installationId ===
        input.adapter.installationIdentity.adapterInstallationId &&
      installation.profile === input.adapter.installationIdentity.profile
      ? passed("installation:identity", "installation identity matches the adapter")
      : failed("installation:identity", "installation identity differs from the adapter"),
    JSON.stringify(replayedInstallation) === JSON.stringify(installation)
      ? passed("installation:idempotency", "repeated installation converged")
      : failed("installation:idempotency", "repeated installation changed its record"),
  ];
  const checks = [
    ...coverageChecks,
    ...installationChecks,
    ...input.fixture.cases.flatMap((fixture) =>
      checkCase(
        input.adapter,
        fixture,
        input.fixture.forbiddenNormalizedKeys,
        capabilities,
      ),
    ),
  ];

  const rootRetryCase = input.fixture.cases.find(
    (fixture) => fixture.kind === "root-stop" && fixture.decision.action === "retry",
  );
  if (capabilities.rootStopContinuation.kind === "supported" && rootRetryCase === undefined) {
    checks.push(
      failed("continuation:root-stop", "supported capability lacks a retry fixture"),
    );
  }
  const subagentRetryCase = input.fixture.cases.find(
    (fixture) => fixture.kind === "subagent-stop" && fixture.decision.action === "retry",
  );
  if (
    capabilities.subagentStopContinuation.kind === "supported" &&
    subagentRetryCase === undefined
  ) {
    checks.push(
      failed("continuation:subagent-stop", "supported capability lacks a retry fixture"),
    );
  }

  if (input.fixture.uninstallAfterRun) {
    await input.adapter.uninstall({ installationId: installation.installationId });
  }

  return {
    runtime: input.adapter.runtime,
    capabilities,
    installation,
    checks,
  };
}

export function assertAdapterConformance(report: AdapterConformanceReport): void {
  const failures = report.checks.filter((check) => check.status === "failed");
  if (failures.length === 0) return;
  throw new Error(failures.map((failure) => `${failure.name}: ${failure.detail}`).join("\n"));
}
