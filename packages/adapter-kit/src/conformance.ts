import {
  HookObservationSchema,
  RuntimeCapabilitySnapshotSchema,
  RuntimeIdentitySchema,
  RuntimeInstallationIdentitySchema,
  SkillActivationEvidenceSchema,
} from "@sisyphus/domain";

import {
  AdapterInstallationSchema,
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

function checkCase(
  adapter: AgentRuntimeAdapter,
  fixture: AdapterConformanceCase,
  forbiddenNormalizedKeys: readonly string[],
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
      adapter.renderDecision(parsed.data, fixture.decision);
      checks.push(passed("render:prompt", "decision rendered"));
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
      checkCase(input.adapter, fixture, input.fixture.forbiddenNormalizedKeys),
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
